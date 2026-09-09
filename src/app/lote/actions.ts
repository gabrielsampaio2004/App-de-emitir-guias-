"use server";

import { createHash } from "crypto";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { parseFilename } from "@/lib/matching/filename";
import { matchClient } from "@/lib/matching/client";

/**
 * Upload de pasta inteira. Cada arquivo vira um Document (matching
 * automático por CPF/CNPJ no nome, via `matchClient` — sem cliente
 * reconhecido, `clientId` fica null e o documento cai na fila de revisão).
 * Nenhuma Delivery é criada aqui: falta o vencimento, que só é confirmado
 * na tela de revisão (`/revisao`).
 *
 * Um arquivo com problema (duplicado, não-PDF, falha de storage) não
 * derruba o lote inteiro — cada arquivo é isolado num try/catch.
 */
const ACTOR_LABEL = "system:web"; // sem auth ainda

export async function uploadBatch(formData: FormData) {
  const tenant = await db.tenant.findFirstOrThrow();
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);

  let ok = 0;
  let matched = 0;
  let unmatched = 0;
  let dup = 0;
  let invalid = 0;
  let erro = 0;

  for (const file of files) {
    if (file.type !== "application/pdf") {
      invalid++;
      continue;
    }

    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const storageKey = `${tenant.id}/${sha256}-${file.name}`;
      const parsed = parseFilename(file.name);
      const client = await matchClient(db, tenant.id, parsed);

      await putObject(storageKey, bytes, file.type);

      await db.$transaction(async (tx) => {
        const document = await tx.document.create({
          data: {
            tenantId: tenant.id,
            clientId: client?.id ?? null,
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
          { tenantId: tenant.id, actorLabel: ACTOR_LABEL },
          {
            action: "document.uploaded",
            entityType: "Document",
            entityId: document.id,
            after: {
              filename: document.filename,
              sha256,
              clientId: client?.id ?? null,
              matchedAutomatically: client !== null,
            },
          },
        );
      });

      ok++;
      if (client) matched++;
      else unmatched++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        dup++;
      } else {
        erro++;
        console.error(
          "[lote] falha ao processar arquivo:",
          file.name,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  const params = new URLSearchParams({
    ok: String(ok),
    matched: String(matched),
    unmatched: String(unmatched),
    dup: String(dup),
    invalid: String(invalid),
    erro: String(erro),
  });
  redirect(`/lote?${params.toString()}`);
}
