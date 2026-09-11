"use server";

import { randomUUID, createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { claimAndEnqueue } from "@/lib/dispatch";
import { parseFilename } from "@/lib/matching/filename";
import { requireSession } from "@/lib/auth/session";

export interface SendNowState {
  error?: string;
}

/**
 * Etapa 2: botão "enviar agora", sem agendamento. Sobe o PDF, cria o
 * Document e a Delivery (scheduledAt = agora) na mesma transação do
 * audit log, e manda direto pra fila — o worker (`npm run worker`) que
 * efetivamente chama a Cloud API.
 *
 * Etapa E: erros esperados voltam como estado pro formulário
 * (`useActionState`), não como `Error` lançado — sem isso o Next mostra
 * tela de erro genérica em vez da mensagem específica.
 */
export async function sendNow(
  _prevState: SendNowState,
  formData: FormData,
): Promise<SendNowState> {
  const session = await requireSession();

  const clientId = formData.get("clientId");
  const file = formData.get("file");

  if (typeof clientId !== "string" || !clientId) {
    return { error: "Selecione um cliente." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecione um arquivo PDF." };
  }
  if (file.type !== "application/pdf") {
    return { error: "Só é aceito PDF." };
  }

  // Filtra por tenantId da sessão, não só pelo id: um clientId de outro
  // tenant (mandado direto no POST, não pelo <select>) tem que dar "não
  // encontrado", nunca operar em cima do cliente de outro escritório.
  const client = await db.client.findFirstOrThrow({
    where: { id: clientId, tenantId: session.user.tenantId },
  });
  if (!client.active) {
    // O <select> da tela só lista cliente ativo, mas o formulário chega
    // como POST comum — sem essa checagem, um cliente desativado entre o
    // carregamento da página e o envio criaria Document+Delivery que o
    // dispatcher cancela em silêncio, sem o contador nunca saber que a
    // guia não foi.
    return { error: "Este cliente está desativado — reative em /clientes antes de enviar." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `${client.tenantId}/${sha256}-${file.name}`;
  const parsed = parseFilename(file.name);

  await putObject(storageKey, bytes, file.type);

  const idempotencyKey = randomUUID();

  let delivery;
  try {
    delivery = await db.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          tenantId: client.tenantId,
          clientId: client.id,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: bytes.length,
          sha256,
          storageKey,
          kind: parsed.kind,
          competencia: parsed.competencia,
          uploadedBy: session.user.email,
        },
      });

      await audit(
        tx,
        { tenantId: client.tenantId, actorId: session.user.id, actorLabel: session.user.email },
        {
          action: "document.uploaded",
          entityType: "Document",
          entityId: document.id,
          after: { filename: document.filename, sha256, clientId: client.id },
        },
      );

      const created = await tx.delivery.create({
        data: {
          tenantId: client.tenantId,
          documentId: document.id,
          clientId: client.id,
          scheduledAt: new Date(),
          idempotencyKey,
        },
      });

      await audit(
        tx,
        { tenantId: client.tenantId, actorId: session.user.id, actorLabel: session.user.email },
        {
          action: "delivery.created",
          entityType: "Delivery",
          entityId: created.id,
          after: { documentId: document.id, clientId: client.id },
        },
      );

      return created;
    });
  } catch (err) {
    // @@unique([tenantId, sha256]) no Document: mesmo PDF enviado duas
    // vezes por "enviar agora". O arquivo já subiu pro storage antes desta
    // checagem — reenviar o mesmo PDF sobrescreve a mesma storageKey (o
    // nome inclui o sha256), então não sobra lixo órfão no R2.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "Esta guia já foi enviada antes (mesmo arquivo) — duplicado, ignorado." };
    }
    throw err;
  }

  await claimAndEnqueue(delivery.id, idempotencyKey);

  revalidatePath("/");
  return {};
}
