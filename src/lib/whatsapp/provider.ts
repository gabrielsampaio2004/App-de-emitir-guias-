/**
 * Contrato único de envio. Toda a aplicação fala com esta interface,
 * nunca direto com a Meta. Trocar de provedor = escrever outra classe.
 *
 * Não há campo de idempotência aqui: a API de mensagens da Meta não aceita
 * um token de deduplicação do lado do cliente, então prometer isso neste
 * contrato seria uma garantia que nenhuma implementação consegue cumprir.
 * A proteção real contra reenvio (a que o CLAUDE.md exige) mora uma camada
 * abaixo do provider — `jobId` do BullMQ e `Delivery.idempotencyKey` como
 * chave única no banco, em `src/lib/dispatch.ts` — e continua valendo.
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
