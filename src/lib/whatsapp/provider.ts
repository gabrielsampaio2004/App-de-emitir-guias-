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
  /**
   * Identifica este envio de ponta a ponta.
   *
   * Atenção ao que isto NÃO é: a Cloud API da Meta não tem cabeçalho de
   * idempotência, então o `MetaCloudProvider` não consegue usar esta chave
   * para deduplicar — ele a recebe e não tem o que fazer com ela. A garantia
   * de "nunca enviar duas vezes" mora em dois lugares, ambos nossos: o
   * `jobId` do BullMQ (que é esta chave) e a trava de status do dispatcher,
   * onde só quem move QUEUED -> SENDING envia. Um provedor que ofereça
   * idempotência de verdade deve usar este campo.
   */
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
