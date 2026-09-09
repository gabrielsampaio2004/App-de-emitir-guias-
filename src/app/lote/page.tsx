import { uploadBatch } from "./actions";

// Mostra o resumo do último lote via query string — precisa ler searchParams
// a cada request.
export const dynamic = "force-dynamic";

export default async function LotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const hasSummary = typeof sp.ok === "string";

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "2rem auto" }}>
      <h1>Upload em lote</h1>

      {hasSummary && (
        <div style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
          <strong>Resultado do lote:</strong>
          <ul>
            <li>{sp.ok} arquivo(s) processado(s) com sucesso</li>
            <li>{sp.matched} vinculado(s) automaticamente ao cliente</li>
            <li>{sp.unmatched} sem cliente reconhecido — foram para a fila de revisão</li>
            <li>{sp.dup} já tinham sido enviados antes (duplicado, ignorado)</li>
            <li>{sp.invalid} não eram PDF (ignorado)</li>
            <li>{sp.erro} falharam (ver log do servidor)</li>
          </ul>
        </div>
      )}

      <form action={uploadBatch}>
        <label htmlFor="files">Pasta com as guias (PDF)</label>
        <br />
        <input
          id="files"
          type="file"
          name="files"
          accept="application/pdf"
          multiple
          required
          // webkitdirectory não está nos tipos do React, mas é suportado
          // pelos browsers (Chrome/Edge/Firefox) para escolher uma pasta.
          // @ts-expect-error atributo não-padrão, sem tipagem no React
          webkitdirectory=""
        />
        <p style={{ marginTop: "0.5rem" }}>
          <button type="submit">Enviar pasta</button>
        </p>
      </form>

      <p>
        Depois do upload, confira a <a href="/revisao">fila de revisão</a> para
        confirmar cliente e vencimento antes do agendamento.
      </p>
    </main>
  );
}
