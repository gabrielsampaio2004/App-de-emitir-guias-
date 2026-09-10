"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth/session";
import { createUserWithPassword } from "@/lib/auth/create-user";

/**
 * OWNER-only (checado por `requireOwner`, não só pelo `<select>` da tela).
 * Cria User + Account credential pra um usuário novo do mesmo tenant.
 *
 * Sem log de auditoria por enquanto: `createUserWithPassword` grava pelo
 * adapter do better-auth, fora do `$transaction` que `audit()` exige junto
 * da ação (regra do CLAUDE.md). Gravar sem essa garantia seria pior do que
 * não gravar — fica registrado como falta no HANDOFF.md.
 */
export async function createUser(formData: FormData) {
  const session = await requireOwner();

  const name = formData.get("name");
  const email = formData.get("email");
  const password = formData.get("password");
  const role = formData.get("role");

  if (typeof name !== "string" || !name) throw new Error("Nome inválido.");
  if (typeof email !== "string" || !email) throw new Error("E-mail inválido.");
  if (typeof password !== "string" || !password) throw new Error("Senha inválida.");
  if (role !== "OWNER" && role !== "OPERATOR" && role !== "VIEWER") {
    throw new Error("Papel inválido.");
  }

  await createUserWithPassword({
    tenantId: session.user.tenantId,
    email,
    name,
    password,
    role,
  });

  revalidatePath("/usuarios");
}
