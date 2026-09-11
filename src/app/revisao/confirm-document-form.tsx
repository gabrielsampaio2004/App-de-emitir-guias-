"use client";

import { useActionState } from "react";
import { confirmDocument, type ConfirmDocumentState } from "./actions";

const initialState: ConfirmDocumentState = {};

/**
 * Uma instância por linha da fila (Etapa E: mínimo possível no cliente —
 * só o form vira Client Component, a tabela/página continuam Server).
 */
export function ConfirmDocumentForm({
  documentId,
  clients,
  defaultClientId,
}: {
  documentId: string;
  clients: Array<{ id: string; name: string; document: string }>;
  defaultClientId: string;
}) {
  const [state, formAction, isPending] = useActionState(confirmDocument, initialState);

  return (
    <div>
      <form action={formAction} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input type="hidden" name="documentId" value={documentId} />
        <select name="clientId" defaultValue={defaultClientId} required>
          <option value="" disabled>
            selecione
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.document})
            </option>
          ))}
        </select>
        <input type="date" name="dueDate" required />
        <button type="submit" disabled={isPending}>
          {isPending ? "Confirmando…" : "Confirmar"}
        </button>
      </form>
      {state.error && (
        <p role="alert" style={{ color: "crimson", margin: "0.25rem 0 0" }}>
          {state.error}
        </p>
      )}
    </div>
  );
}
