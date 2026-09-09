"use server";

import { randomUUID, createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { claimAndEnqueue } from "@/lib/dispatch";
import { parseFilename } from "@/lib/matching/filename";

/**
 * Etapa 2: botão "enviar agora", sem agendamento. Sobe o PDF, cria o
 * Document e a Delivery (scheduledAt = agora) na mesma transação do
 * audit log, e manda direto pra fila — o worker (`npm run worker`) que
 * efetivamente chama a Cloud API.
 */
const ACTOR_LABEL = "system:web"; // sem auth ainda nesta etapa

export async function sendNow(formData: FormData) {
  const clientId = formData.get("clientId");
  const file = formData.get("file");

  if (typeof clientId !== "string" || !clientId) {
    throw new Error("Selecione um cliente.");
  }
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Selecione um arquivo PDF.");
  }
  if (file.type !== "application/pdf") {
    throw new Error("Só é aceito PDF.");
  }

  const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  if (!client.active) {
    // O <select> da tela só lista cliente ativo, mas o formulário chega
    // como POST comum — sem essa checagem, um cliente desativado entre o
    // carregamento da página e o envio criaria Document+Delivery que o
    // dispatcher cancela em silêncio, sem o contador nunca saber que a
    // guia não foi.
    throw new Error("Este cliente está desativado — reative em /clientes antes de enviar.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `${client.tenantId}/${sha256}-${file.name}`;
  const parsed = parseFilename(file.name);

  await putObject(storageKey, bytes, file.type);

  const idempotencyKey = randomUUID();

  const delivery = await db.$transaction(async (tx) => {
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
        uploadedBy: ACTOR_LABEL,
      },
    });

    await audit(
      tx,
      { tenantId: client.tenantId, actorLabel: ACTOR_LABEL },
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
      { tenantId: client.tenantId, actorLabel: ACTOR_LABEL },
      {
        action: "delivery.created",
        entityType: "Delivery",
        entityId: created.id,
        after: { documentId: document.id, clientId: client.id },
      },
    );

    return created;
  });

  await claimAndEnqueue(delivery.id, idempotencyKey);

  revalidatePath("/");
}
