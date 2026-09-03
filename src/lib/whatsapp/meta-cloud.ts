import {
  WhatsAppProvider,
  SendDocumentParams,
  SendResult,
  WhatsAppError,
} from "./provider";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Envio via Cloud API oficial.
 *
 * Fazemos upload do PDF para a Meta primeiro e usamos o media ID no template.
 * A alternativa (passar uma URL pública) exigiria expor a guia — que contém
 * CPF/CNPJ e valores — numa URL acessível pela internet. O media ID evita isso.
 */
export class MetaCloudProvider implements WhatsAppProvider {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    /** Nome do template aprovado, categoria UTILITY, com header DOCUMENT */
    private readonly templateName = "envio_guia_fiscal",
    private readonly templateLang = "pt_BR",
  ) {}

  async sendDocument(p: SendDocumentParams): Promise<SendResult> {
    const mediaId = await this.uploadMedia(p.file, p.filename, p.mimeType);

    const body = {
      messaging_product: "whatsapp",
      to: p.to.replace("+", ""),
      type: "template",
      template: {
        name: this.templateName,
        language: { code: this.templateLang },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "document",
                document: { id: mediaId, filename: p.filename },
              },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: p.vars.nome },
              { type: "text", text: p.vars.tipo },
              { type: "text", text: p.vars.competencia },
              { type: "text", text: p.vars.vencimento },
            ],
          },
        ],
      },
    };

    const res = await fetch(`${GRAPH}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = await res.json();

    if (!res.ok) {
      const err = json?.error ?? {};
      throw new WhatsAppError(
        err.message ?? "Falha no envio",
        String(err.code ?? res.status),
        // 131049 = limite de marketing por usuário; 4/80007 = rate limit; 5xx = instabilidade
        res.status >= 500 || err.code === 4 || err.code === 80007,
      );
    }

    return { providerMessageId: json.messages[0].id };
  }

  private async uploadMedia(
    file: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([new Uint8Array(file)], { type: mimeType }), filename);

    const res = await fetch(`${GRAPH}/${this.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form,
    });

    const json = await res.json();
    if (!res.ok) {
      throw new WhatsAppError(
        json?.error?.message ?? "Falha no upload da mídia",
        String(json?.error?.code ?? res.status),
        res.status >= 500,
      );
    }
    return json.id;
  }
}
