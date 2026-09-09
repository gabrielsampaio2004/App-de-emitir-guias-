"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { computeScheduledAt } from "@/lib/scheduling/rule";

/**
 * Confirma cliente + vencimento de um Document da fila de revisão e cria a
 * Delivery já agendada pela regra do tenant. Não chama `claimAndEnqueue`
 * aqui: `scheduledAt` normalmente é no futuro, e quem manda pra fila do
 * BullMQ quando chegar a hora é o `enqueueDue` do worker — igual a
 * qualquer outra Delivery agendada.
 */
const ACTOR_LABEL = "system:web"; // sem auth ainda

export async function confirmDocument(formData: FormData) {
  const documentId = formData.get("documentId");
  const clientId = formData.get("clientId");
  const dueDateRaw = formData.get("dueDate");

  if (typeof documentId !== "string" || !documentId) {
    throw new Error("Documento inválido.");
  }
  if (typeof clientId !== "string" || !clientId) {
    throw new Error("Selecione um cliente.");
  }
  if (typeof dueDateRaw !== "string" || !dueDateRaw) {
    throw new Error("Informe o vencimento.");
  }

  const dueDate = new Date(`${dueDateRaw}T00:00:00Z`);
  if (Number.isNaN(dueDate.getTime())) {
    throw new Error("Vencimento inválido.");
  }

  const document = await db.document.findUniqueOrThrow({ where: { id: documentId } });
  const client = await db.client.findFirstOrThrow({
    where: { id: clientId, tenantId: document.tenantId },
  });
  if (!client.active) {
    // O <select> só lista cliente ativo, mas isso é um POST comum — sem
    // essa checagem, uma aba desatualizada agendaria pra um cliente
    // desativado e o dispatcher cancelaria em silêncio na hora do envio.
    throw new Error("Este cliente está desativado — reative em /clientes antes de agendar.");
  }
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: document.tenantId } });

  const scheduledAt = computeScheduledAt(tenant, dueDate);
  const idempotencyKey = randomUUID();

  try {
    await db.$transaction(async (tx) => {
      const before = { clientId: document.clientId, dueDate: document.dueDate };

      await tx.document.update({
        where: { id: document.id },
        data: { clientId: client.id, dueDate },
      });

      await audit(
        tx,
        { tenantId: document.tenantId, actorLabel: ACTOR_LABEL },
        {
          action: "document.reviewed",
          entityType: "Document",
          entityId: document.id,
          before,
          after: { clientId: client.id, dueDate },
        },
      );

      // @@unique([documentId]) no schema é quem realmente impede duas
      // Deliveries pro mesmo Document (ex: duplo-clique, ou POST de uma
      // aba com a fila de revisão desatualizada). Se estourar aqui, a
      // transação inteira volta atrás — o documento não fica marcado como
      // revisado sem uma Delivery de verdade.
      const delivery = await tx.delivery.create({
        data: {
          tenantId: document.tenantId,
          documentId: document.id,
          clientId: client.id,
          scheduledAt,
          idempotencyKey,
        },
      });

      await audit(
        tx,
        { tenantId: document.tenantId, actorLabel: ACTOR_LABEL },
        {
          action: "delivery.scheduled",
          entityType: "Delivery",
          entityId: delivery.id,
          after: { documentId: document.id, clientId: client.id, scheduledAt },
        },
      );
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new Error("Este documento já foi agendado — atualize a página.");
    }
    throw err;
  }

  revalidatePath("/revisao");
}
