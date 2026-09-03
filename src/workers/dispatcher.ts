import { Queue, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { MetaCloudProvider } from "../lib/whatsapp/meta-cloud";
import { WhatsAppError, SendResult } from "../lib/whatsapp/provider";
import { audit } from "../lib/audit";
import { getObject } from "../lib/storage";
import { decrypt } from "../lib/crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });
const connection = { url: process.env.REDIS_URL! };
export const sendQueue = new Queue("deliveries", { connection });

/**
 * Roda a cada minuto. Pega o que venceu e joga na fila.
 *
 * O UPDATE ... WHERE status = 'SCHEDULED' é a trava: se dois workers
 * subirem juntos, só um consegue mudar a linha, e o outro pega zero.
 */
export async function enqueueDue() {
  const due = await db.delivery.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    take: 500,
  });

  for (const d of due) {
    const claimed = await db.delivery.updateMany({
      where: { id: d.id, status: "SCHEDULED" },
      data: { status: "QUEUED" },
    });
    if (claimed.count === 0) continue;

    await sendQueue.add("send", { deliveryId: d.id }, {
      jobId: d.idempotencyKey,
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
    });
  }
}

const LIVE_JOB_STATES = new Set([
  "active",
  "waiting",
  "delayed",
  "waiting-children",
  "prioritized",
]);

/**
 * Varredura de entregas presas.
 *
 * QUEUED e SENDING descrevem coisas diferentes e não podem ser tratadas pelo
 * mesmo caminho:
 *
 * - QUEUED sem job vivo no Redis: pela construção do worker abaixo, só se
 *   chega em QUEUED (via catch + throw) quando a falha foi ANTES do envio
 *   ter sucesso. Nada saiu. Reenfileirar é seguro. Cobre tanto o job que
 *   nunca existiu (Redis caiu entre o UPDATE e o sendQueue.add) quanto o job
 *   que esgotou as 5 tentativas do BullMQ e não vai ser retomado sozinho.
 * - SENDING sem job vivo: o worker morreu no meio de uma tentativa. Pode ter
 *   saído, pode não ter — não há como saber. Reenfileirar aqui é criar
 *   exatamente a duplicata que o bloco de envio abaixo existe para evitar.
 *   Falha fechada: marca FAILED com um lastError explicando o motivo, para
 *   conferência humana.
 * - FAILED é terminal e não entra nesta varredura.
 */
export async function recoverStuckDeliveries() {
  const stuck = await db.delivery.findMany({
    where: { status: { in: ["QUEUED", "SENDING"] } },
    take: 500,
  });

  for (const d of stuck) {
    const job = await sendQueue.getJob(d.idempotencyKey);
    const state = job ? await job.getState() : null;

    if (state && LIVE_JOB_STATES.has(state)) {
      continue; // BullMQ ainda está cuidando disso, não mexer
    }

    if (d.status === "QUEUED") {
      if (!job) {
        await sendQueue.add("send", { deliveryId: d.id }, {
          jobId: d.idempotencyKey,
          attempts: 5,
          backoff: { type: "exponential", delay: 30_000 },
        });
      } else if (state === "failed") {
        await job.retry();
      }
      continue;
    }

    // d.status === "SENDING"
    const claimed = await db.delivery.updateMany({
      where: { id: d.id, status: "SENDING" },
      data: {
        status: "FAILED",
        lastError:
          "Processo interrompido em SENDING sem confirmação de resultado do envio — requer conferência manual antes de qualquer novo envio.",
      },
    });
    if (claimed.count === 0) continue; // resolvido enquanto varríamos

    await db.deliveryEvent.create({
      data: {
        deliveryId: d.id,
        type: "failed",
        payload: { message: "stuck_in_sending", retryable: false },
      },
    });
  }
}

export const dispatcher = new Worker(
  "deliveries",
  async (job) => {
    const delivery = await db.delivery.findUniqueOrThrow({
      where: { id: job.data.deliveryId },
      include: {
        client: true,
        document: true,
        tenant: { include: { waAccount: true } },
      },
    });

    if (["SENT", "DELIVERED", "READ", "CANCELLED"].includes(delivery.status)) {
      return; // já resolvido, nada a fazer
    }

    // Consentimento revogado depois do agendamento? Não envia.
    // status e revokedAt podem divergir — o schema não impede um Consent
    // GRANTED com revokedAt preenchido. Exigimos os dois em concordância:
    // se um dos dois ficar desatualizado por bug em algum caminho de escrita
    // futuro, o efeito é deixar de enviar, nunca enviar a mais. orderBy
    // garante que, havendo histórico de revogação/reconcessão, pegamos o
    // registro mais recente em vez de um indeterminado.
    const consent = await db.consent.findFirst({
      where: { clientId: delivery.clientId, status: "GRANTED", revokedAt: null },
      orderBy: { grantedAt: "desc" },
    });
    if (!consent) {
      await db.delivery.update({
        where: { id: delivery.id },
        data: { status: "CANCELLED", lastError: "Sem consentimento ativo" },
      });
      return;
    }

    const wa = delivery.tenant.waAccount;
    if (!wa) {
      // Configuração ausente, não uma falha transitória: retry não resolve
      // e só desperdiça as 5 tentativas do BullMQ. Falha terminal direto.
      const message = "Tenant sem conta WhatsApp configurada";
      await db.delivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", lastError: message },
      });
      await db.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          type: "failed",
          payload: { message, retryable: false },
        },
      });
      return;
    }
    const provider = new MetaCloudProvider(wa.phoneNumberId, decrypt(wa.accessTokenEnc));

    // Única escrita garantida antes de a requisição de envio sair. Não é só
    // observabilidade: é a sentinela que distingue "não tentamos" (QUEUED) de
    // "tentamos, resultado desconhecido" (SENDING) se o processo morrer daqui
    // em diante — é o que recoverStuckDeliveries() usa para decidir entre
    // reenfileirar e exigir conferência humana. Nunca mova esta escrita para
    // dentro da transação de sucesso "pra economizar uma escrita": isso
    // apaga a única evidência de que um envio ficou pendente, em silêncio.
    await db.delivery.update({
      where: { id: delivery.id },
      data: { status: "SENDING", attempts: { increment: 1 } },
    });

    let result: SendResult;
    try {
      const file = await getObject(delivery.document.storageKey);

      result = await provider.sendDocument({
        to: delivery.client.phoneE164,
        file,
        filename: delivery.document.filename,
        mimeType: delivery.document.mimeType,
        vars: {
          nome: delivery.client.name.split(" ")[0] ?? delivery.client.name,
          tipo: delivery.document.kind ?? "documento",
          competencia: delivery.document.competencia ?? "-",
          vencimento:
            delivery.document.dueDate?.toLocaleDateString("pt-BR") ?? "-",
        },
      });
    } catch (err) {
      // Falha antes de qualquer confirmação de envio (getObject, upload de
      // mídia, ou uma das ambiguidades de meta-cloud.ts já convertidas em
      // WhatsAppError não retryable). Ainda é seguro decidir entre
      // reenfileirar e falhar terminal.
      const retryable = err instanceof WhatsAppError ? err.retryable : true;
      const message = err instanceof Error ? err.message : String(err);

      await db.delivery.update({
        where: { id: delivery.id },
        data: { status: retryable ? "QUEUED" : "FAILED", lastError: message },
      });
      await db.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          type: "failed",
          payload: { message, retryable },
        },
      });

      if (retryable) throw err; // deixa o BullMQ tentar de novo
      return;
    }

    // A partir daqui a Meta confirmou o envio (result.providerMessageId veio
    // de uma resposta 2xx com id). NUNCA relançar depois deste ponto: um
    // relançamento faria o BullMQ tentar de novo e reenviar uma guia que o
    // cliente já pode ter recebido.
    try {
      // Escrita mínima, isolada da transação de auditoria abaixo — é o que
      // impede reenvio se tudo daqui pra frente falhar. Isto é uma exceção
      // deliberada à regra do CLAUDE.md de gravar a auditoria na mesma
      // transação da ação: gravar status+waMessageId e o log de auditoria
      // juntos reabriria a janela de reenvio duplo que este bloco existe
      // para fechar (transação por inteiro falha = catch marca QUEUED =
      // reenvio). O preço é uma janela minúscula em que o envio está
      // confirmado mas o DeliveryEvent/AuditLog ainda não — ver bloco
      // seguinte.
      await db.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "SENT",
          waMessageId: result.providerMessageId,
          sentAt: new Date(),
          lastError: null,
        },
      });
    } catch (persistErr) {
      // Envio confirmado, mas nem essa escrita mínima foi possível. Não há
      // como saber se ela realmente não aplicou ou só não confirmou — de
      // qualquer forma não relançamos. O delivery fica em SENDING (setado
      // acima antes da tentativa), nosso "não sei": cai em
      // recoverStuckDeliveries() para conferência humana em vez de reenvio
      // automático.
      console.error(
        `[dispatcher] delivery ${delivery.id}: envio confirmado (msg ${result.providerMessageId}) mas falha ao persistir:`,
        persistErr,
      );
      return;
    }

    try {
      await db.$transaction(async (tx) => {
        await tx.deliveryEvent.create({
          data: { deliveryId: delivery.id, type: "sent" },
        });
        await audit(tx, {
          tenantId: delivery.tenantId,
          actorLabel: "system:dispatcher",
        }, {
          action: "delivery.sent",
          entityType: "Delivery",
          entityId: delivery.id,
          after: { waMessageId: result.providerMessageId },
        });
      });
    } catch (auditErr) {
      // Status e waMessageId já estão persistidos (bloco acima): o envio já
      // está protegido contra duplicidade. Falta só o evento/log de
      // auditoria — não é motivo para reenviar.
      console.error(
        `[dispatcher] delivery ${delivery.id}: enviada e persistida, mas falha ao gravar evento/auditoria:`,
        auditErr,
      );
    }
  },
  { connection, concurrency: 5, limiter: { max: 20, duration: 1000 } },
);
