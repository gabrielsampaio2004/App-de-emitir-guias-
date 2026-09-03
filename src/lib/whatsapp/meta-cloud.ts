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

    // A partir daqui não sabemos mais, em caso de erro, se a Meta processou o
    // envio ou não — e diferente do upload de mídia, reenviar aqui manda a
    // guia pela segunda vez para o cliente. Por isso qualquer falha a partir
    // deste ponto (rede caindo no meio do fetch, corpo 2xx sem o id esperado)
    // vira WhatsAppError não retryable: falha fechada, nunca reenvio às cegas.
    let res: Response;
    try {
      res = await fetch(`${GRAPH}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      const message =
        networkErr instanceof Error ? networkErr.message : String(networkErr);
      throw new WhatsAppError(
        `Rede caiu durante o envio da mensagem — não é possível saber se a Meta processou: ${message}`,
        "SEND_NETWORK_AMBIGUOUS",
        false,
      );
    }

    let json: any;
    try {
      json = await res.json();
    } catch (parseErr) {
      if (res.ok) {
        throw new WhatsAppError(
          "Meta respondeu 2xx no envio mas o corpo não é JSON válido — não é possível confirmar o id da mensagem",
          "SEND_BODY_UNPARSEABLE",
          false,
        );
      }
      throw new WhatsAppError(
        `Falha no envio (HTTP ${res.status}, corpo ilegível)`,
        String(res.status),
        res.status >= 500,
      );
    }

    if (!res.ok) {
      const err = json?.error ?? {};
      throw new WhatsAppError(
        err.message ?? "Falha no envio",
        String(err.code ?? res.status),
        // 131049 = limite de marketing por usuário; 4/80007 = rate limit; 5xx = instabilidade
        res.status >= 500 || err.code === 4 || err.code === 80007,
      );
    }

    const messageId = json?.messages?.[0]?.id;
    if (!messageId) {
      // 200 sem messages[0].id: a Meta aceitou a requisição mas não devolveu
      // o id. O envio provavelmente ocorreu — não reenviar às cegas.
      throw new WhatsAppError(
        "Meta respondeu 2xx no envio mas sem messages[0].id — envio provável, mas sem confirmação de qual mensagem foi criada",
        "SEND_NO_MESSAGE_ID",
        false,
      );
    }

    return { providerMessageId: messageId };
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
