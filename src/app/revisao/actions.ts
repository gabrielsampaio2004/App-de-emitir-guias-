"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { computeScheduledAt } from "@/lib/scheduling/rule";
import { requireSession } from "@/lib/auth/session";

export interface ConfirmDocumentState {
  error?: string;
}

/**
 * Confirma cliente + vencimento de um Document da fila de revisão e cria a
 * Delivery já agendada pela regra do tenant. Não chama `claimAndEnqueue`
 * aqui: `scheduledAt` normalmente é no futuro, e quem manda pra fila do
 * BullMQ quando chegar a hora é o `enqueueDue` do worker — igual a
 * qualquer outra Delivery agendada.
 *
 * Etapa E: erros esperados voltam como estado pro formulário
 * (`useActionState`), não como `Error` lançado.
 */
export async function confirmDocument(
  _prevState: ConfirmDocumentState,
  formData: FormData,
): Promise<ConfirmDocumentState> {
  const session = await requireSession();

  const documentId = formData.get("documentId");
  const clientId = formData.get("clientId");
  const dueDateRaw = formData.get("dueDate");

  if (typeof documentId !== "string" || !documentId) {
    return { error: "Documento inválido." };
  }
  if (typeof clientId !== "string" || !clientId) {
    return { error: "Selecione um cliente." };
  }
  if (typeof dueDateRaw !== "string" || !dueDateRaw) {
    return { error: "Informe o vencimento." };
  }

  const dueDate = new Date(`${dueDateRaw}T00:00:00Z`);
  if (Number.isNaN(dueDate.getTime())) {
    return { error: "Vencimento inválido." };
  }

  // Documento e cliente filtrados pelo tenantId da sessão, não do próprio
  // documentId: antes, um documentId de outro escritório (POST direto,
  // fora da tela) era aceito de ponta a ponta — o `tenant` usado pra
  // calcular scheduledAt vinha do document, nunca de quem estava logado.
  const document = await db.document.findFirstOrThrow({
    where: { id: documentId, tenantId: session.user.tenantId },
  });
  const client = await db.client.findFirstOrThrow({
    where: { id: clientId, tenantId: session.user.tenantId },
  });
  if (!client.active) {
    // O <select> só lista cliente ativo, mas isso é um POST comum — sem
    // essa checagem, uma aba desatualizada agendaria pra um cliente
    // desativado e o dispatcher cancelaria em silêncio na hora do envio.
    return { error: "Este cliente está desativado — reative em /clientes antes de agendar." };
  }
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: session.user.tenantId } });

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
        { tenantId: document.tenantId, actorId: session.user.id, actorLabel: session.user.email },
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
        { tenantId: document.tenantId, actorId: session.user.id, actorLabel: session.user.email },
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
      return { error: "Este documento já foi agendado — atualize a página." };
    }
    throw err;
  }

  revalidatePath("/revisao");
  return {};
}
