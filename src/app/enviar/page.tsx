import UploadForm from "./UploadForm";

export const metadata = {
  title: "Enviar guia — GuiaZap",
};

export default function EnviarPage() {
  return (
    <main>
      <h1>Enviar guia (Etapa 2)</h1>
      <p>
        Sem matching automático ainda — selecione o cliente na mão, suba o PDF
        e clique em enviar. O worker pega no próximo tick (até 60s).
      </p>
      <UploadForm />
    </main>
  );
}
