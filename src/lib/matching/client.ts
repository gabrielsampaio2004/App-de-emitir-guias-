import type { PrismaClient, Prisma } from "@prisma/client";
import { parseFilename, type ParsedFilename } from "./filename";

/**
 * Liga um arquivo a um Client existente pelo CPF/CNPJ extraído do nome.
 * `null` (documento não reconhecido ou cliente inexistente) manda o
 * documento pra fila de revisão manual — nunca adivinha.
 */
export async function matchClient(
  db: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  parsed: ParsedFilename,
) {
  if (!parsed.document) return null;

  return db.client.findFirst({
    where: { tenantId, document: parsed.document, active: true },
  });
}

export { parseFilename };
export type { ParsedFilename };
