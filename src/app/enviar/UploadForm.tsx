"use client";

import { useEffect, useState } from "react";

interface ClientOption {
  id: string;
  name: string;
  phoneE164: string;
}

const KINDS = ["DAS", "DARF", "DCTF", "FGTS", "GPS", "GARE", "ISS", "BOLETO", "INSS"];

export default function UploadForm() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then(setClients)
      .catch(() => setStatus("Falha ao carregar clientes"));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/deliveries", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setStatus(`Erro: ${json.error ?? res.statusText}`);
      } else {
        setStatus(`Agendado — delivery ${json.deliveryId}. ${json.message}`);
        e.currentTarget.reset();
      }
    } catch {
      setStatus("Falha de rede ao enviar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>
          Cliente
          <select name="clientId" required>
            <option value="">selecione</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.phoneE164})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label>
          Tipo
          <select name="kind" required>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <label>
          Competência (ex: 2026-08)
          <input type="text" name="competencia" placeholder="2026-08" />
        </label>
      </div>
      <div>
        <label>
          Vencimento
          <input type="date" name="dueDate" />
        </label>
      </div>
      <div>
        <label>
          PDF
          <input type="file" name="file" accept="application/pdf" required />
        </label>
      </div>
      <button type="submit" disabled={busy}>
        {busy ? "Enviando..." : "Enviar agora"}
      </button>
      {status && <p>{status}</p>}
    </form>
  );
}
