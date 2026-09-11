import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * `prisma generate` não fala com o banco, mas o helper `env()` do Prisma resolve
 * a variável no carregamento deste arquivo e aborta com `PrismaConfigEnvError`
 * antes mesmo de ler o schema. Como o client gerado é pré-requisito do
 * `npm run typecheck`, isso quebrava o typecheck num clone limpo.
 *
 * Lendo `process.env` direto, o `generate` passa sem banco configurado. Os
 * comandos que realmente precisam do Postgres (`migrate`, `studio`, `db`)
 * continuam falhando — agora com a mensagem abaixo, que diz o que fazer.
 */
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: url ?? "postgresql://DATABASE_URL-nao-definida-veja-o-env-example",
  },
});
