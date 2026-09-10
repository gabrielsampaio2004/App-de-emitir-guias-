import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { setClientActive } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const session = await requireSession();

  const clients = await db.client.findMany({
    where: { tenantId: session.user.tenantId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          deliveries: { where: { status: { in: ["SCHEDULED", "QUEUED"] } } },
        },
      },
    },
  });

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 900, margin: "2rem auto" }}>
      <h1>Clientes</h1>

      {clients.length === 0 ? (
        <p>Nenhum cliente cadastrado.</p>
      ) : (
        <>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th align="left">Nome</th>
                <th align="left">CPF/CNPJ</th>
                <th align="left">WhatsApp</th>
                <th align="left">Situação</th>
                <th align="left">Guias agendadas</th>
                <th align="left">Ação</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} style={{ opacity: c.active ? 1 : 0.6 }}>
                  <td>{c.name}</td>
                  <td>{c.document}</td>
                  <td>{c.phoneE164}</td>
                  <td>{c.active ? "ativo" : "inativo"}</td>
                  <td>{c._count.deliveries}</td>
                  <td>
                    <form action={setClientActive}>
                      <input type="hidden" name="clientId" value={c.id} />
                      <input type="hidden" name="active" value={c.active ? "false" : "true"} />
                      <button type="submit">{c.active ? "Desativar" : "Reativar"}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ marginTop: "1.5rem" }}>
            Cliente inativo não aparece para envio, não casa mais no matching
            automático do upload em lote, e as guias que já estavam agendadas
            para ele são canceladas na hora em que o envio seria feito — a
            coluna &quot;guias agendadas&quot; mostra quantas.
          </p>
        </>
      )}
    </main>
  );
}
