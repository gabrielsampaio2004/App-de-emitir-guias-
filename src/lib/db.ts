import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Singleton via globalThis: em dev, o hot-reload do Next recarrega este
 * módulo a cada mudança e criaria um PrismaClient novo (com pool de conexões
 * novo) a cada vez, até esgotar as conexões do Postgres.
 */
declare global {
  var __db: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const db = globalThis.__db ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__db = db;
}
