import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { SendNowForm } from "./send-now-form";

// Lê o banco a cada request (tenant, clientes, status dos envios). Sem isso
// o Next prerenderizaria a página no build e ela ficaria congelada com os
// dados daquele momento.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requireSession();

  // tenantId vem da sessão, nunca de findFirst(): antes, a primeira página
  // era sempre do primeiro tenant criado no banco, não do tenant de quem
  // estava logado — qualquer escritório enxergava guia de outro.
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: session.user.tenantId },
    include: {
      clients: { where: { active: true }, orderBy: { name: "asc" } },
    },
  });

  const deliveries = await db.delivery.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { client: true, document: true },
  });

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "2rem auto" }}>
      <h1>GuiaZap</h1>

      <p>
        <strong>{tenant.name}</strong>
      </p>

      <SendNowForm clients={tenant.clients} />

      <h2 style={{ marginTop: "2rem" }}>Últimos envios</h2>
      {deliveries.length === 0 ? (
        <p>Nenhum envio ainda.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th align="left">Cliente</th>
              <th align="left">Arquivo</th>
              <th align="left">Status</th>
              <th align="left">Enviado</th>
              <th align="left">Entregue</th>
              <th align="left">Lido</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <td>{d.client.name}</td>
                <td>{d.document.filename}</td>
                <td>{d.status}</td>
                <td>{d.sentAt?.toLocaleString("pt-BR") ?? "-"}</td>
                <td>{d.deliveredAt?.toLocaleString("pt-BR") ?? "-"}</td>
                <td>{d.readAt?.toLocaleString("pt-BR") ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
