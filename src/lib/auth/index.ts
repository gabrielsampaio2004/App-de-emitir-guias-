import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db";

/**
 * Config do better-auth adaptada ao `model User` que já existia no schema
 * (Etapa B) — nunca duplique usuário. Nenhum remap de modelName/fieldName é
 * necessário: `User`, `Account`, `Session`, `Verification` no
 * `schema.prisma` já usam exatamente os nomes de tabela/campo que o
 * better-auth espera por padrão (`prisma.user`, `emailVerified`, etc.).
 *
 * `tenantId` e `role` são nossos, não do better-auth — registrados como
 * `additionalFields` só para aparecerem em `session.user` na leitura
 * (`getSession`). A escrita desses dois campos nunca passa pelo cadastro
 * público (ver decisão abaixo): quem grava é sempre
 * `src/lib/auth/create-user.ts`.
 *
 * Cadastro público desligado de propósito: `disableSignUp: true` bloqueia
 * o endpoint `/api/auth/sign-up/email` de verdade (não é só uma tela que
 * deixamos de construir — o endpoint reage à flag e recusa antes de
 * qualquer escrita). Este é um SaaS onde o escritório convida quem usa;
 * deixar qualquer um se cadastrar e escolher um `tenantId` seria o
 * contrário do que "multi-tenant é segurança, não cosmética" pede.
 * Usuários entram só por `src/lib/auth/create-user.ts` (bootstrap do
 * primeiro OWNER e a tela `/usuarios`, OWNER-only).
 */
export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    // Sem serviço de e-mail no projeto (fora do escopo desta etapa); os
    // usuários são criados já verificados pelo helper interno.
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      tenantId: { type: "string", required: true, input: false },
      role: {
        type: "string",
        required: false,
        defaultValue: "OPERATOR",
        input: false,
      },
    },
  },
  // Precisa ser o último plugin — é o que faz sign-in/sign-out gravarem o
  // cookie de sessão nas Server Actions e Route Handlers do Next.
  plugins: [nextCookies()],
});
