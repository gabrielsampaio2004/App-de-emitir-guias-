import { db } from "@/lib/db";
import { confirmDocument } from "./actions";

// Lista o que ainda não tem Delivery — precisa refletir uploads recentes.
export const dynamic = "force-dynamic";

export default async function RevisaoPage() {
  const tenant = await db.tenant.findFirst({
    include: { clients: { where: { active: true }, orderBy: { name: "asc" } } },
  });

  const pending = tenant
    ? await db.document.findMany({
        where: { tenantId: tenant.id, deliveries: { none: {} } },
        include: { client: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 900, margin: "2rem auto" }}>
      <h1>Fila de revisão</h1>

      {!tenant ? (
        <p>Nenhum tenant cadastrado.</p>
      ) : pending.length === 0 ? (
        <p>Nada pendente — todo documento enviado já tem cliente e vencimento confirmados.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th align="left">Arquivo</th>
              <th align="left">Tipo</th>
              <th align="left">Competência</th>
              <th align="left">Cliente reconhecido</th>
              <th align="left">Confirmar</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((doc) => (
              <tr key={doc.id}>
                <td>{doc.filename}</td>
                <td>{doc.kind ?? "-"}</td>
                <td>{doc.competencia ?? "-"}</td>
                {/* Cliente que casou automático mas foi desativado depois não
                    pode ser sugerido: ele nem aparece na lista de opções. */}
                <td>
                  {!doc.client
                    ? "não reconhecido"
                    : doc.client.active
                      ? `${doc.client.name} (automático)`
                      : `${doc.client.name} — desativado, escolha outro`}
                </td>
                <td>
                  <form
                    action={confirmDocument}
                    style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
                  >
                    <input type="hidden" name="documentId" value={doc.id} />
                    <select
                      name="clientId"
                      defaultValue={doc.client?.active ? doc.client.id : ""}
                      required
                    >
                      <option value="" disabled>
                        selecione
                      </option>
                      {tenant.clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.document})
                        </option>
                      ))}
                    </select>
                    <input type="date" name="dueDate" required />
                    <button type="submit">Confirmar</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
