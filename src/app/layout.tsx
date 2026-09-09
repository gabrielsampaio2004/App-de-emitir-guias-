import type { ReactNode } from "react";

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <nav
          style={{
            fontFamily: "sans-serif",
            display: "flex",
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
        </nav>
        {children}
      </body>
    </html>
  );
}
