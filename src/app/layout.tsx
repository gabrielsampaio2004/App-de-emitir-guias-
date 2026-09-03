import type { ReactNode } from "react";

export const metadata = {
  title: "GuiaZap",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
