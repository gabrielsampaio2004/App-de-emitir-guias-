import { test } from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { audit } from "./index";

/**
 * Fake mínimo do client do Prisma: só captura o `data` passado para
 * `auditLog.create`, sem tocar em Postgres. `audit()` é a única função
 * exportada deste módulo — `scrub` é privada — então testamos o
 * comportamento real do scrub através da entrada pública de verdade, não
 * reimplementando a lógica no teste.
 *
 * Não desestruture `captured` na hora de chamar `fakeDb()`: `audit()` ainda
 * não rodou nesse ponto, então o valor capturado seria sempre `undefined`.
 * Leia `fake.captured` só depois do `await audit(...)`.
 */
function fakeDb() {
  const state: { captured?: Prisma.AuditLogUncheckedCreateInput } = {};
  const db = {
    auditLog: {
      create: async ({ data }: { data: Prisma.AuditLogUncheckedCreateInput }) => {
        state.captured = data;
        return data;
      },
    },
  } as unknown as PrismaClient;
  return { db, state };
}

const CTX = { tenantId: "tenant-1", actorLabel: "system:test" };

test("scrub remove segredo aninhado em qualquer profundidade", async () => {
  const fake = fakeDb();
  await audit(fake.db, CTX, {
    action: "test.nested_secret",
    entityType: "Test",
    entityId: "1",
    after: {
      user: {
        profile: {
          credentials: { accessToken: "super-secreto" },
        },
      },
    },
  });

  assert.deepEqual(fake.state.captured?.after, {
    user: {
      profile: {
        credentials: { accessToken: "[redacted]" },
      },
    },
  });
});

test("scrub redige passwordHash e accessTokenEnc no primeiro nível", async () => {
  const fake = fakeDb();
  await audit(fake.db, CTX, {
    action: "test.top_level_secrets",
    entityType: "Test",
    entityId: "1",
    after: { passwordHash: "hash123", accessTokenEnc: "iv:tag:cipher", nome: "João" },
  });

  assert.deepEqual(fake.state.captured?.after, {
    passwordHash: "[redacted]",
    accessTokenEnc: "[redacted]",
    nome: "João",
  });
});

test("scrub preserva array (não vira objeto indexado por posição)", async () => {
  const fake = fakeDb();
  await audit(fake.db, CTX, {
    action: "test.array",
    entityType: "Test",
    entityId: "1",
    after: { tags: ["a", "b", { accessToken: "x" }] },
  });

  assert.deepEqual(fake.state.captured?.after, { tags: ["a", "b", { accessToken: "[redacted]" }] });
  assert.ok(Array.isArray((fake.state.captured?.after as { tags: unknown }).tags));
});

test("scrub converte Date para string ISO", async () => {
  const fake = fakeDb();
  const quando = new Date(Date.UTC(2026, 8, 10, 12, 0, 0));
  await audit(fake.db, CTX, {
    action: "test.date",
    entityType: "Test",
    entityId: "1",
    after: { ocorreuEm: quando },
  });

  assert.deepEqual(fake.state.captured?.after, { ocorreuEm: quando.toISOString() });
});

test("scrub converte bigint para string", async () => {
  const fake = fakeDb();
  await audit(fake.db, CTX, {
    action: "test.bigint",
    entityType: "Test",
    entityId: "1",
    after: { valorCentavos: 123456789012345n },
  });

  assert.deepEqual(fake.state.captured?.after, { valorCentavos: "123456789012345" });
});

test("before/after undefined não viram chave no registro", async () => {
  const fake = fakeDb();
  await audit(fake.db, CTX, {
    action: "test.no_before",
    entityType: "Test",
    entityId: "1",
  });

  assert.equal(fake.state.captured?.before, undefined);
  assert.equal(fake.state.captured?.after, undefined);
});
