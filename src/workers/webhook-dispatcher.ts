import { Queue, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { audit } from "../lib/audit";
import {
  nextDeliveryStatus,
  STATUS_TIMESTAMP_FIELD,
  type StatusUpdateEvent,
} from "../lib/whatsapp/webhook";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });
const connection = { url: process.env.REDIS_URL! };

/**
 * Fila separada da de envio (`deliveries`). A rota do webhook só valida a
 * assinatura e enfileira aqui — o processamento de verdade (achar o
 * Delivery, decidir se avança o status, gravar evento+auditoria) acontece
 * neste worker, fora do request HTTP.
 */
export const webhookQueue = new Queue("webhook-events", { connection });

export const webhookDispatcher = new Worker(
  "webhook-events",
  async (job) => {
    const events = job.data.events as StatusUpdateEvent[];

    for (const event of events) {
      const matches = await db.delivery.findMany({
        where: { waMessageId: event.waMessageId },
      });

      if (matches.length === 0) {
        // Pode ser evento de um envio de outro ambiente, ou reentrega tardia
        // de algo que não temos mais — não é erro nosso, só não há o que
        // atualizar.
        console.warn(`[webhook] nenhuma delivery para waMessageId ${event.waMessageId}`);
        continue;
      }
      if (matches.length > 1) {
        // waMessageId não é @unique no schema — se isso acontecer é sinal de
        // bug em outro lugar. Não adivinha qual das duas atualizar.
        console.error(
          `[webhook] ${matches.length} deliveries com o mesmo waMessageId ${event.waMessageId} — ambíguo, ignorando`,
        );
        continue;
      }

      const delivery = matches[0]!;

      // Registro bruto do que a Meta mandou, sempre — inclusive quando o
      // evento não muda nada (duplicata, fora de ordem). É o histórico
      // técnico; DeliveryEvent não é o AuditLog.
      await db.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          type: `webhook:${event.status}`,
          payload: {
            waMessageId: event.waMessageId,
            status: event.status,
            timestamp: event.timestamp,
            errors: event.errors ?? null,
          },
        },
      });

      const newStatus = nextDeliveryStatus(delivery.status, event.status);
      if (!newStatus) continue; // duplicata ou fora de ordem — não regride, não faz nada

      const tsField = STATUS_TIMESTAMP_FIELD[newStatus];
      await db.$transaction(async (tx) => {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: {
            status: newStatus as never,
            ...(tsField ? { [tsField]: new Date() } : {}),
          },
        });
        await audit(
          tx,
          { tenantId: delivery.tenantId, actorLabel: "system:webhook" },
          {
            action: "delivery.status_updated",
            entityType: "Delivery",
            entityId: delivery.id,
            before: { status: delivery.status },
            after: { status: newStatus, waMessageId: event.waMessageId },
          },
        );
      });
    }
  },
  { connection, concurrency: 5 },
);
