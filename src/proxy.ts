import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * `middleware.ts` foi renomeado para `proxy.ts` no Next 16 (mesma função,
 * export renomeado) — ver node_modules/next/dist/docs/.../proxy.md.
 *
 * Isto é só UX (redireciona cedo, sem renderizar a página à toa): olha se
 * existe o cookie de sessão, não se ela é válida. A prova de verdade —
 * "existe sessão válida, e o tenantId dela" — é o `requireSession()` em
 * `src/lib/auth/session.ts`, chamado dentro de cada Server
 * Component/Action protegida. O próprio guia do Next avisa que Proxy não
 * cobre Server Functions cujo path escape do matcher, então a autorização
 * de verdade tem que estar em cada função, não só aqui.
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie = getSessionCookie(request);
  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Tudo, exceto: rotas de auth, o webhook da Meta (a Meta não manda
    // cookie de sessão), a própria /login, e assets do Next.
    "/((?!api/auth|api/webhooks|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
