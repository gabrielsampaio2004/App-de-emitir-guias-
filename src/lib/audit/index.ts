import { PrismaClient, Prisma } from "@prisma/client";

export interface AuditContext {
  tenantId: string;
  actorId?: string;
  actorLabel: string;
  ip?: string;
  userAgent?: string;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Campos que nunca devem cair no log. */
const REDACTED = new Set(["passwordHash", "accessTokenEnc", "accessToken"]);

/** Profundidade máxima, como proteção contra estruturas patologicamente aninhadas. */
const MAX_DEPTH = 20;

function scrub(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null as unknown as Prisma.InputJsonValue;

  // Date vira ISO string. Sem isto, Object.entries() devolveria {} e a data
  // sumiria silenciosamente do log.
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== "object") {
    // bigint não é serializável em JSON; vira string em vez de quebrar o insert.
    if (typeof value === "bigint") return value.toString();
    return value as Prisma.InputJsonValue;
  }

  if (depth >= MAX_DEPTH) {
    return "[profundidade máxima atingida]";
  }

  // Arrays precisam continuar arrays. A versão anterior os transformava em
  // objetos indexados por posição: ['a','b'] virava {"0":"a","1":"b"}.
  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, depth + 1) ?? null) as Prisma.InputJsonValue;
  }

  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED.has(k)) {
      out[k] = "[redacted]";
      continue;
    }
    // A recursão é o ponto crítico: sem ela, um segredo aninhado como
    // { user: { accessToken: "..." } } passava intacto para o AuditLog.
    const scrubbed = scrub(v, depth + 1);
    if (scrubbed !== undefined) out[k] = scrubbed;
  }
  return out as Prisma.InputJsonValue;
}

/**
 * Grava uma entrada de auditoria. Passe o mesmo `tx` da operação para que
 * a ação e o log sejam commitados juntos — ou nenhum dos dois.
 */
export async function audit(
  db: PrismaClient | Prisma.TransactionClient,
  ctx: AuditContext,
  entry: AuditEntry,
) {
  await db.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorLabel: ctx.actorLabel,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: scrub(entry.before),
      after: scrub(entry.after),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });
}
