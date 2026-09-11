import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { ConfirmDocumentForm } from "./confirm-document-form";

// Lista o que ainda não tem Delivery — precisa refletir uploads recentes.
export const dynamic = "force-dynamic";

export default async function RevisaoPage() {
  const session = await requireSession();

  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: session.user.tenantId },
    include: { clients: { where: { active: true }, orderBy: { name: "asc" } } },
  });

  const pending = await db.document.findMany({
    where: { tenantId: tenant.id, deliveries: { none: {} } },
    include: { client: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 900, margin: "2rem auto" }}>
      <h1>Fila de revisão</h1>

      {pending.length === 0 ? (
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
                  <ConfirmDocumentForm
                    documentId={doc.id}
                    clients={tenant.clients}
                    defaultClientId={doc.client?.active ? doc.client.id : ""}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
