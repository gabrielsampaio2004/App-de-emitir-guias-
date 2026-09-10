import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./index";

/**
 * Sessão de verdade, não só cookie. O `middleware.ts` já redireciona cedo
 * quando não há cookie de sessão — isso é só UX (evita renderizar a página
 * pra depois redirecionar). A prova de que a sessão é válida é aqui:
 * `getSession` confere no banco. Nenhum código deve confiar só no cookie
 * pra decidir tenant ou autorização — "multi-tenant é segurança, não
 * cosmética".
 */
export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}

/** Mesma coisa, mas também exige `role: "OWNER"` — usado em `/usuarios`. */
export async function requireOwner() {
  const session = await requireSession();
  if (session.user.role !== "OWNER") redirect("/");
  return session;
}
