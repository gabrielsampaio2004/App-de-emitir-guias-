import { Worker } from "bullmq";
import { MetaCloudProvider } from "../lib/whatsapp/meta-cloud";
import { WhatsAppError } from "../lib/whatsapp/provider";
import { audit } from "../lib/audit";
import { getObject } from "../lib/storage";
import { decrypt } from "../lib/crypto";
import { db } from "../lib/db";
import { connection, sendQueue } from "../lib/queue";

export { enqueueDue } from "../lib/dispatch";
export { sendQueue };

/**
 * Cancela um envio antes de chamar a Meta (cliente desativado, consentimento
 * revogado). O log de auditoria vai na mesma transação da mudança de status,
 * como manda o CLAUDE.md — antes o cancelamento por falta de consentimento
 * mudava o status sem deixar rastro nenhum.
 */
async function cancelDelivery(deliveryId: string, tenantId: string, motivo: string) {
  await db.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: deliveryId },
      data: { status: "CANCELLED", lastError: motivo },
    });
    await tx.deliveryEvent.create({
      data: { deliveryId, type: "cancelled", payload: { motivo } },
    });
    await audit(tx, { tenantId, actorLabel: "system:dispatcher" }, {
      action: "delivery.cancelled",
      entityType: "Delivery",
      entityId: deliveryId,
      after: { motivo },
    });
  });
}

/**
 * Uma Delivery só está em SENDING quando este mesmo processador já a marcou
 * assim numa execução anterior deste job (é o único lugar que grava esse
 * status). Se o job roda de novo e ainda encontra SENDING, o processo
 * anterior morreu depois de a Meta aceitar a mensagem e antes de gravar
 * SENT/QUEUED/FAILED — não dá pra saber se o envio saiu. Reenviar seria
 * violar "nunca envie duas vezes"; ficar em SENDING para sempre esconderia o
 * problema. Por isso vira SEND_UNCERTAIN: visível na tela, e nunca
 * reenfileirado a partir daqui (só um humano decide).
 */
async function markSendUncertain(deliveryId: string, tenantId: string) {
  const motivo =
    "Processo interrompido durante o envio — confirme manualmente se a mensagem chegou ao cliente.";
  await db.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: deliveryId },
      data: { status: "SEND_UNCERTAIN", lastError: motivo },
    });
    await tx.deliveryEvent.create({
      data: { deliveryId, type: "send_uncertain", payload: { motivo } },
    });
    await audit(tx, { tenantId, actorLabel: "system:dispatcher" }, {
      action: "delivery.send_uncertain",
      entityType: "Delivery",
      entityId: deliveryId,
      after: { motivo },
    });
  });
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

    // Terminal para este worker: SENT/DELIVERED/READ/CANCELLED já resolveram
    // de verdade; SEND_UNCERTAIN não resolveu nada, mas só um humano decide
    // daqui em diante — o worker nunca reenvia nem reprocessa sozinho.
    if (["SENT", "DELIVERED", "READ", "CANCELLED", "SEND_UNCERTAIN"].includes(delivery.status)) {
      return;
    }

    // SENDING aqui só acontece se este job já rodou antes e morreu depois
    // do update abaixo (só este processador grava SENDING). Nunca reenvie:
    // torna visível para revisão humana em vez de tentar de novo.
    if (delivery.status === "SENDING") {
      await markSendUncertain(delivery.id, delivery.tenantId);
      return;
    }

    // Cliente desativado depois do agendamento? Não envia.
    if (!delivery.client.active) {
      await cancelDelivery(delivery.id, delivery.tenantId, "Cliente desativado");
      return;
    }

    // Consentimento revogado depois do agendamento? Não envia.
    // `status` é a fonte de verdade e a constraint do banco garante que
    // GRANTED nunca tem revokedAt (migration 20260910170000). O filtro por
    // revokedAt aqui é redundante de propósito: se um dia a constraint cair,
    // o pior desfecho é não enviar, nunca enviar para quem revogou.
    const consent = await db.consent.findFirst({
      where: { clientId: delivery.clientId, status: "GRANTED", revokedAt: null },
    });
    if (!consent) {
      await cancelDelivery(delivery.id, delivery.tenantId, "Sem consentimento ativo");
      return;
    }

    const wa = delivery.tenant.waAccount!;
    const provider = new MetaCloudProvider(
      wa.phoneNumberId,
      decrypt(wa.accessTokenEnc),
      // `||`, não `??`: WHATSAPP_TEMPLATE_NAME="" (não preenchida) tem que
      // cair no default, e string vazia não é null/undefined pro `??`.
      process.env.WHATSAPP_TEMPLATE_NAME || undefined,
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
        vars: {
          nome: delivery.client.name.split(" ")[0] ?? delivery.client.name,
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

      // Status e evento na mesma transação — antes eram dois writes
      // separados; um crash entre os dois deixava a Delivery em QUEUED/
      // FAILED sem o DeliveryEvent correspondente registrado.
      await db.$transaction(async (tx) => {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: { status: retryable ? "QUEUED" : "FAILED", lastError: message },
        });
        await tx.deliveryEvent.create({
          data: {
            deliveryId: delivery.id,
            type: "failed",
            payload: { message, retryable },
          },
        });
      });

      if (retryable) throw err; // deixa o BullMQ tentar de novo
    }
  },
  { connection, concurrency: 5, limiter: { max: 20, duration: 1000 } },
);
