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

function scrub(value: unknown): Prisma.InputJsonValue | undefined {
  if (value == null || typeof value !== "object") {
    return value as Prisma.InputJsonValue | undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACTED.has(k) ? "[redacted]" : v;
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
