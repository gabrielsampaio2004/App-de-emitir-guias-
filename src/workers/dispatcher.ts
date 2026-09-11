import { Queue, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { MetaCloudProvider } from "../lib/whatsapp/meta-cloud";
import { WhatsAppError } from "../lib/whatsapp/provider";
import { audit } from "../lib/audit";
import { getObject } from "../lib/storage";
import { decrypt } from "../lib/crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });
const connection = { url: process.env.REDIS_URL! };
export const sendQueue = new Queue("deliveries", { connection });

const ACTOR = { actorLabel: "system:dispatcher" } as const;

/**
 * Tempo sem transição de status a partir do qual `sweepStalled` considera a
 * delivery travada. Precisa ser maior que o envio mais lento plausível (upload
 * do PDF para a Meta + POST do template), senão o varredor mexeria numa linha
 * que ainda está em voo.
 */
const STALLED_AFTER_MS = 10 * 60_000;

type StalledDelivery = Awaited<ReturnType<typeof db.delivery.findMany>>[number];

/**
 * O texto de erro vai parar no `AuditLog`, que é append-only: o que entrar ali
 * não sai nunca mais. Não há garantia de que a mensagem de um terceiro não
 * carregue credencial, então cortamos os formatos que carregariam.
 */
function redactSecrets(message: string): string {
  return message
    .replace(/Bearer\s+[\w.\-]+/gi, "Bearer [redacted]")
    .replace(/(access_?token)=[^&\s"']+/gi, "$1=[redacted]");
}

/** "2026-08", como o `parseFilename` grava, vira "08/2026", como o cliente lê. */
function formatCompetencia(value: string | null): string {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[2]}/${match[1]}` : value;
}

/**
 * Vencimento é data de calendário, não instante. Formatar no fuso do servidor
 * faria um vencimento gravado à meia-noite UTC aparecer como o dia anterior para
 * quem roda em UTC-3. Fixando UTC, o dia exibido é o dia gravado.
 */
function formatDueDate(value: Date | null): string {
  return value ? value.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "-";
}

/**
 * Roda a cada minuto. Pega o que venceu e joga na fila.
 *
 * O UPDATE ... WHERE status = 'SCHEDULED' é a trava: se dois workers subirem
 * juntos, só um consegue mudar a linha, e o outro pega zero.
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

    try {
      await sendQueue.add("send", { deliveryId: d.id }, {
        jobId: d.idempotencyKey,
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
      });
    } catch (err) {
      // O `add` falhou (Redis fora do ar, tipicamente) com a linha já em QUEUED,
      // estado que o `enqueueDue` não busca: ela ficaria órfã para sempre.
      // Devolvemos para SCHEDULED na hora. O `sweepStalled` é a rede de
      // segurança para quando nem esta devolução der certo.
      await db.delivery.updateMany({
        where: { id: d.id, status: "QUEUED" },
        data: { status: "SCHEDULED" },
      });
      throw err;
    }
  }
}

export const dispatcher = new Worker(
  "deliveries",
  async (job) => {
    const deliveryId = job.data.deliveryId as string;

    // Trava de reentrada, e a razão de ser um UPDATE condicional: só quem
    // conseguir mover QUEUED -> SENDING envia. Se um envio anterior morreu no
    // meio, a linha ficou em SENDING e esta tentativa não a pega — é isso que
    // impede o reenvio. Substitui a lista de status "já resolvidos" que existia
    // aqui antes, que deixava SENDING passar e reenviar.
    const claimed = await db.delivery.updateMany({
      where: { id: deliveryId, status: "QUEUED" },
      data: { status: "SENDING", attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return;

    const delivery = await db.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      include: {
        client: true,
        document: true,
        tenant: { include: { waAccount: true } },
      },
    });

    // Consentimento revogado depois do agendamento? Não envia. `status` é a
    // fonte de verdade — o CHECK da migration inicial garante que `revokedAt`
    // concorde com ele — e o filtro por `revokedAt` aqui é cinto e suspensório.
    const consent = await db.consent.findFirst({
      where: {
        clientId: delivery.clientId,
        channel: "whatsapp",
        status: "GRANTED",
        revokedAt: null,
      },
      orderBy: { grantedAt: "desc" },
    });

    if (!consent) {
      const reason = "Sem consentimento ativo";
      await db.$transaction(async (tx) => {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: { status: "CANCELLED", lastError: reason },
        });
        await tx.deliveryEvent.create({
          data: { deliveryId: delivery.id, type: "cancelled", payload: { reason } },
        });
        await audit(tx, { ...ACTOR, tenantId: delivery.tenantId }, {
          action: "delivery.cancelled",
          entityType: "Delivery",
          entityId: delivery.id,
          before: { status: "SENDING" },
          after: { status: "CANCELLED", reason },
        });
      });
      return;
    }

    try {
      const wa = delivery.tenant.waAccount;
      if (!wa) {
        // Era `waAccount!`. Um tenant sem conta conectada virava TypeError, que
        // não é WhatsAppError e portanto contava como retentável: cinco
        // tentativas inúteis e a linha parada. Isto não melhora com retry.
        throw new WhatsAppError(
          "Tenant sem conta WhatsApp conectada",
          "no_wa_account",
          false,
        );
      }

      const provider = new MetaCloudProvider(
        wa.phoneNumberId,
        decrypt(wa.accessTokenEnc),
      );

      const file = await getObject(delivery.document.storageKey);

      const result = await provider.sendDocument({
        to: delivery.client.phoneE164,
        file,
        filename: delivery.document.filename,
        mimeType: delivery.document.mimeType,
        idempotencyKey: delivery.idempotencyKey,
        vars: {
          nome: delivery.client.name.split(" ")[0] ?? delivery.client.name,
          tipo: delivery.document.kind ?? "documento",
          competencia: formatCompetencia(delivery.document.competencia),
          vencimento: formatDueDate(delivery.document.dueDate),
        },
      });

      await db.$transaction(async (tx) => {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: {
            status: "SENT",
            waMessageId: result.providerMessageId,
            sentAt: new Date(),
            lastError: null,
          },
        });
        await tx.deliveryEvent.create({
          data: { deliveryId: delivery.id, type: "sent" },
        });
        await audit(tx, { ...ACTOR, tenantId: delivery.tenantId }, {
          action: "delivery.sent",
          entityType: "Delivery",
          entityId: delivery.id,
          before: { status: "SENDING" },
          after: { status: "SENT", waMessageId: result.providerMessageId },
        });
      });
    } catch (err) {
      const retryable = err instanceof WhatsAppError ? err.retryable : true;
      const message = redactSecrets(
        err instanceof Error ? err.message : String(err),
      );
      const status = retryable ? "QUEUED" : "FAILED";

      // Estado e trilha na mesma transação: ação sem log é pior que log nenhum.
      await db.$transaction(async (tx) => {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: { status, lastError: message },
        });
        await tx.deliveryEvent.create({
          data: {
            deliveryId: delivery.id,
            type: "failed",
            payload: { message, retryable },
          },
        });
        await audit(tx, { ...ACTOR, tenantId: delivery.tenantId }, {
          action: retryable ? "delivery.send_failed" : "delivery.failed",
          entityType: "Delivery",
          entityId: delivery.id,
          before: { status: "SENDING" },
          after: { status, retryable, error: message },
        });
      });

      // Relança para o BullMQ tentar de novo, mas com a mensagem já redigida: o
      // `failedReason` do job também é lugar nenhum para segredo.
      if (retryable) throw new Error(message, { cause: err });
    }
  },
  { connection, concurrency: 5, limiter: { max: 20, duration: 1000 } },
);

/**
 * Rede de segurança para deliveries travadas entre estados.
 *
 * Decisão registrada (HANDOFF, seção 4, item 1): a ordem `UPDATE -> QUEUED`
 * antes do `sendQueue.add` **fica como está**. Inverter faria o job existir
 * antes de a linha estar travada, abrindo janela para dois workers pegarem a
 * mesma delivery — trocar risco de linha parada por risco de envio duplo é
 * troca ruim num produto em que cada envio custa dinheiro. A ordem fica e o
 * buraco é coberto aqui.
 *
 * Este varredor nunca reenvia por conta própria. Ele só devolve para SCHEDULED
 * o que comprovadamente não chegou à fila; todo caso em que o envio possa ter
 * acontecido vira FAILED, para um humano decidir.
 */
export async function sweepStalled() {
  const cutoff = new Date(Date.now() - STALLED_AFTER_MS);

  const stalled = await db.delivery.findMany({
    where: { status: { in: ["QUEUED", "SENDING"] }, updatedAt: { lt: cutoff } },
    take: 200,
  });

  for (const d of stalled) {
    // waMessageId preenchido = a Meta aceitou a mensagem. O que quer que tenha
    // acontecido depois, reenviar está fora de questão.
    if (d.waMessageId) {
      await resolveStalled(
        d,
        "FAILED",
        "Mensagem já aceita pela Meta; a linha travou depois disso",
      );
      continue;
    }

    if (d.status === "SENDING") {
      await resolveStalled(
        d,
        "FAILED",
        "Envio interrompido em SENDING: não dá para saber se a Meta recebeu. " +
          "Confira no painel da Meta antes de reenviar",
      );
      continue;
    }

    // QUEUED: o job é a fonte de verdade, já que o jobId é o idempotencyKey.
    const job = await sendQueue.getJob(d.idempotencyKey);

    if (!job) {
      // Nunca entrou na fila. SCHEDULED é o único estado que o enqueueDue busca.
      await resolveStalled(d, "SCHEDULED", null);
      continue;
    }

    const state = await job.getState();
    if (state !== "completed" && state !== "failed") continue; // ainda vivo

    await resolveStalled(
      d,
      "FAILED",
      `A fila encerrou o job como "${state}" com a delivery ainda em QUEUED`,
    );
  }
}

async function resolveStalled(
  d: StalledDelivery,
  status: "SCHEDULED" | "FAILED",
  reason: string | null,
) {
  const requeued = status === "SCHEDULED";

  await db.$transaction(async (tx) => {
    // Só age se a linha ainda estiver como o varredor a viu.
    const moved = await tx.delivery.updateMany({
      where: { id: d.id, status: d.status },
      data: { status, lastError: reason },
    });
    if (moved.count === 0) return;

    await tx.deliveryEvent.create({
      data: {
        deliveryId: d.id,
        type: requeued ? "requeued" : "failed",
        payload: reason
          ? { from: d.status, to: status, reason }
          : { from: d.status, to: status },
      },
    });

    await audit(tx, { ...ACTOR, tenantId: d.tenantId }, {
      action: requeued ? "delivery.requeued" : "delivery.failed",
      entityType: "Delivery",
      entityId: d.id,
      before: { status: d.status },
      after: { status, reason },
    });
  });
}
