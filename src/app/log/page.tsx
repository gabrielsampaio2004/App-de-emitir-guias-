import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LogPage() {
  const tenant = await db.tenant.findFirst();

  const deliveryEvents = tenant
    ? await db.deliveryEvent.findMany({
        where: { delivery: { tenantId: tenant.id } },
        orderBy: { occurredAt: "desc" },
        take: 100,
        include: { delivery: { include: { client: true, document: true } } },
      })
    : [];

  const auditLogs = tenant
    ? await db.auditLog.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
    : [];

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 1000, margin: "2rem auto" }}>
      <h1>Log</h1>

      <h2>Eventos de entrega</h2>
      {deliveryEvents.length === 0 ? (
        <p>Nenhum evento ainda.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: "2rem" }}>
          <thead>
            <tr>
              <th align="left">Quando</th>
              <th align="left">Cliente</th>
              <th align="left">Arquivo</th>
              <th align="left">Tipo</th>
              <th align="left">Payload</th>
            </tr>
          </thead>
          <tbody>
            {deliveryEvents.map((e) => (
              <tr key={e.id}>
                <td>{e.occurredAt.toLocaleString("pt-BR")}</td>
                <td>{e.delivery.client.name}</td>
                <td>{e.delivery.document.filename}</td>
                <td>{e.type}</td>
                <td>
                  <code>{JSON.stringify(e.payload)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Auditoria</h2>
      {auditLogs.length === 0 ? (
        <p>Nenhuma entrada ainda.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th align="left">Quando</th>
              <th align="left">Ator</th>
              <th align="left">Ação</th>
              <th align="left">Entidade</th>
              <th align="left">Depois</th>
            </tr>
          </thead>
          <tbody>
            {auditLogs.map((a) => (
              <tr key={a.id}>
                <td>{a.createdAt.toLocaleString("pt-BR")}</td>
                <td>{a.actorLabel}</td>
                <td>{a.action}</td>
                <td>
                  {a.entityType}:{a.entityId}
                </td>
                <td>
                  <code>{JSON.stringify(a.after)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
