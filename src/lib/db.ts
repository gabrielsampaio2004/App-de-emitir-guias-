import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Evita abrir uma conexão nova a cada hot-reload do Next em dev — guarda a
// instância em globalThis e reaproveita.
declare global {
  // eslint-disable-next-line no-var
  var __guiazapDb: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const db = globalThis.__guiazapDb ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__guiazapDb = db;
}
