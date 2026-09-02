/**
 * Contrato único de envio. Toda a aplicação fala com esta interface,
 * nunca direto com a Meta. Trocar de provedor = escrever outra classe.
 */

export interface SendDocumentParams {
  /** Telefone do destinatário em E.164, ex: +5579999999999 */
  to: string;
  /** Conteúdo do PDF */
  file: Buffer;
  /** Nome que aparece para o cliente no WhatsApp */
  filename: string;
  mimeType: string;
  /** Variáveis do corpo da mensagem */
  vars: {
    nome: string;
    tipo: string;        // "DAS", "DARF"...
    competencia: string; // "08/2026"
    vencimento: string;  // "20/09/2026"
  };
  /** Evita duplicidade se a chamada for repetida */
  idempotencyKey: string;
}

export interface SendResult {
  providerMessageId: string;
}

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** true = vale a pena tentar de novo (rate limit, 5xx) */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface WhatsAppProvider {
  sendDocument(params: SendDocumentParams): Promise<SendResult>;
}
