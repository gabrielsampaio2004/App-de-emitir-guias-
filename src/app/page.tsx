import { db } from "@/lib/db";
import { sendNow } from "./actions";

// Lê o banco a cada request (tenant, clientes, status dos envios). Sem isso
// o Next prerenderizaria a página no build e ela ficaria congelada com os
// dados daquele momento.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tenant = await db.tenant.findFirst({
    include: {
      clients: { where: { active: true }, orderBy: { name: "asc" } },
    },
  });

  const deliveries = tenant
    ? await db.delivery.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { client: true, document: true },
      })
    : [];

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "2rem auto" }}>
      <h1>GuiaZap</h1>

      {!tenant ? (
        <p>
          Nenhum tenant cadastrado. Rode <code>npm run db:seed</code> primeiro.
        </p>
      ) : (
        <>
          <p>
            <strong>{tenant.name}</strong>
          </p>

          <form action={sendNow}>
            <div>
              <label htmlFor="clientId">Cliente</label>
              <br />
              <select id="clientId" name="clientId" required>
                {tenant.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.document})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: "0.5rem" }}>
              <label htmlFor="file">Guia (PDF)</label>
              <br />
              <input id="file" type="file" name="file" accept="application/pdf" required />
            </div>

            <button type="submit" style={{ marginTop: "1rem" }}>
              Enviar agora
            </button>
          </form>

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
        </>
      )}
    </main>
  );
}
