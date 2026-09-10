import type { ReactNode } from "react";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { LogoutButton } from "./logout-button";

export const metadata = {
  title: "GuiaZap",
};

const NAV_LINKS = [
  { href: "/", label: "Enviar agora" },
  { href: "/lote", label: "Upload em lote" },
  { href: "/revisao", label: "Fila de revisão" },
  { href: "/clientes", label: "Clientes" },
  { href: "/configuracoes", label: "Configurações" },
  { href: "/log", label: "Log" },
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Só pra decidir o que mostrar no nav (usuário logado, link de /usuarios
  // pra OWNER). Não é a trava de segurança — essa é o `requireSession()`
  // dentro de cada página/action; o proxy.ts também só redireciona cedo.
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <html lang="pt-BR">
      <body>
        {session && (
          <nav
            style={{
              fontFamily: "sans-serif",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              padding: "0.75rem 2rem",
              borderBottom: "1px solid #ccc",
            }}
          >
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
            {session.user.role === "OWNER" && <a href="/usuarios">Usuários</a>}
            <span style={{ marginLeft: "auto" }}>{session.user.name}</span>
            <LogoutButton />
          </nav>
        )}
        {children}
      </body>
    </html>
  );
}
