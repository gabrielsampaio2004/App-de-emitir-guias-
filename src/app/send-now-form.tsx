"use client";

import { useActionState } from "react";
import { sendNow, type SendNowState } from "./actions";

const initialState: SendNowState = {};

/**
 * Só o form vira Client Component (Etapa E: mínimo possível no cliente) —
 * o resto de HomePage (nome do tenant, tabela de últimos envios) continua
 * Server Component.
 */
export function SendNowForm({
  clients,
}: {
  clients: Array<{ id: string; name: string; document: string }>;
}) {
  const [state, formAction, isPending] = useActionState(sendNow, initialState);

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="clientId">Cliente</label>
        <br />
        <select id="clientId" name="clientId" required>
          {clients.map((c) => (
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

      {state.error && (
        <p role="alert" style={{ color: "crimson", marginTop: "0.5rem" }}>
          {state.error}
        </p>
      )}

      <button type="submit" disabled={isPending} style={{ marginTop: "1rem" }}>
        {isPending ? "Enviando…" : "Enviar agora"}
      </button>
    </form>
  );
}
