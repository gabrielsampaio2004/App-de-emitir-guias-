import { Queue, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { MetaCloudProvider } from "../lib/whatsapp/meta-cloud";
import { WhatsAppError } from "../lib/whatsapp/provider";
import { audit } from "../lib/audit";
import { getObject } from "../lib/storage";
import { decrypt } from "../lib/crypto";

const db = new PrismaClient();
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
    const consent = await db.consent.findFirst({
      where: { clientId: delivery.clientId, status: "GRANTED" },
    });
    if (!consent) {
      await db.delivery.update({
        where: { id: delivery.id },
        data: { status: "CANCELLED", lastError: "Sem consentimento ativo" },
      });
      return;
    }

    const wa = delivery.tenant.waAccount!;
    const provider = new MetaCloudProvider(
      wa.phoneNumberId,
      decrypt(wa.accessTokenEnc),
    );

    await db.delivery.update({
      where: { id: delivery.id },
      data: { status: "SENDING", attempts: { increment: 1 } },
    });

    try {
      const file = await getObject(delivery.document.storageKey);

      const result = await provider.sendDocument({
        to: delivery.client.phoneE164,
        file,
        filename: delivery.document.filename,
        mimeType: delivery.document.mimeType,
        idempotencyKey: delivery.idempotencyKey,
        vars: {
          nome: delivery.client.name.split(" ")[0],
          tipo: delivery.document.kind ?? "documento",
          competencia: delivery.document.competencia ?? "-",
          vencimento:
            delivery.document.dueDate?.toLocaleDateString("pt-BR") ?? "-",
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
    } catch (err) {
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
    }
  },
  { connection, concurrency: 5, limiter: { max: 20, duration: 1000 } },
);
