import { createLocalAccountIssuer } from "better-auth";
import { auth } from "./index";

export interface CreateUserInput {
  tenantId: string;
  email: string;
  name: string;
  password: string;
  role?: "OWNER" | "OPERATOR" | "VIEWER";
}

/**
 * Cria um User + a Account "credential" (senha), sem passar pelo endpoint
 * público `/sign-up/email` — esse fica desligado de propósito
 * (`emailAndPassword.disableSignUp: true` em `src/lib/auth/index.ts`).
 *
 * Reaproveita o mesmo hash e a mesma escrita que o sign-up do better-auth
 * usa por baixo (`ctx.password.hash` + `ctx.internalAdapter.createUser` +
 * `ctx.internalAdapter.linkAccount`) — só pula o gate HTTP, não reinventa a
 * senha nem o formato da credencial.
 *
 * Dois chamadores: `prisma/seed.ts` (bootstrap do primeiro OWNER) e a
 * Server Action OWNER-only em `/usuarios` (para os seguintes).
 */
export async function createUserWithPassword(input: CreateUserInput) {
  const ctx = await auth.$context;

  const normalizedEmail = input.email.toLowerCase();
  const existing = await ctx.internalAdapter.findUserByEmail(normalizedEmail);
  if (existing?.user) {
    throw new Error(`Já existe um usuário com o e-mail ${normalizedEmail}`);
  }

  const minLength = ctx.password.config.minPasswordLength;
  if (input.password.length < minLength) {
    throw new Error(`Senha muito curta (mínimo ${minLength} caracteres)`);
  }

  const hash = await ctx.password.hash(input.password);

  const user = await ctx.internalAdapter.createUser(
    {
      email: normalizedEmail,
      name: input.name,
      emailVerified: true,
      tenantId: input.tenantId,
      role: input.role ?? "OPERATOR",
    },
    { method: "internal" },
  );

  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    issuer: createLocalAccountIssuer("credential"),
    accountId: user.id,
    password: hash,
  });

  return user;
}
