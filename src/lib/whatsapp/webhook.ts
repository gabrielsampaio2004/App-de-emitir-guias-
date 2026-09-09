import { createHmac, timingSafeEqual } from "crypto";

/**
 * Confere X-Hub-Signature-256 contra o corpo bruto da requisição, com
 * comparação em tempo constante. `rawBody` precisa ser o texto exatamente
 * como chegou (antes de qualquer JSON.parse) — o HMAC da Meta é sobre os
 * bytes crus do corpo, não sobre uma representação re-serializada.
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;

  const [algo, hex] = signatureHeader.split("=");
  if (algo !== "sha256" || !hex) return false;

  const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(hex, "hex");

  // timingSafeEqual lança se os tamanhos diferirem — precisa checar antes.
  // Isso ainda vaza 1 bit (tamanho bate ou não) por timing, mas o tamanho de
  // um hex de SHA-256 é fixo (64 chars); só varia se o header vier corrompido.
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export interface StatusUpdateEvent {
  waMessageId: string;
  status: string;
  timestamp: string;
  errors?: unknown;
}

/**
 * Extrai os eventos de status de um payload de webhook da Meta. Tolerante a
 * formato — qualquer campo ausente ou de tipo errado é ignorado em vez de
 * lançar, porque isto processa dado de fora (já autenticado pela assinatura,
 * mas o formato ainda não é nosso pra garantir).
 */
export function extractStatusEvents(payload: unknown): StatusUpdateEvent[] {
  const events: StatusUpdateEvent[] = [];
  const entries = isRecord(payload) ? payload.entry : undefined;
  if (!Array.isArray(entries)) return events;

  for (const entry of entries) {
    const changes = isRecord(entry) ? entry.changes : undefined;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = isRecord(change) ? change.value : undefined;
      const statuses = isRecord(value) ? value.statuses : undefined;
      if (!Array.isArray(statuses)) continue;

      for (const s of statuses) {
        if (!isRecord(s)) continue;
        if (typeof s.id === "string" && typeof s.status === "string") {
          events.push({
            waMessageId: s.id,
            status: s.status,
            timestamp: typeof s.timestamp === "string" ? s.timestamp : String(s.timestamp ?? ""),
            errors: "errors" in s ? s.errors : undefined,
          });
        }
      }
    }
  }
  return events;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const WEBHOOK_STATUS_TO_DELIVERY_STATUS: Record<string, string> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

// Ordem de progressão: sent < delivered < read. FAILED é terminal, mas só é
// aceito enquanto ainda não sabíamos de nada melhor (até SENT) — uma vez
// DELIVERED ou READ, a mensagem obviamente chegou, então um "failed"
// atrasado da Meta não desfaz isso.
const PROGRESS_RANK: Record<string, number> = {
  SCHEDULED: 0,
  QUEUED: 0,
  SENDING: 0,
  SENT: 1,
  FAILED: 1,
  DELIVERED: 2,
  READ: 3,
  CANCELLED: 0,
};

/**
 * Decide se um evento de status recebido do webhook deve avançar o status
 * do Delivery. Devolve o novo status, ou null se o evento deve ser
 * ignorado (fora de ordem, duplicado, ou tipo desconhecido) — nunca
 * regride, e nunca lança pra quem chama decidir sozinho o que fazer com
 * duplicata: aqui a resposta pra duplicata e pra "chegou fora de ordem" é a
 * mesma, null.
 */
export function nextDeliveryStatus(currentStatus: string, incomingWebhookStatus: string): string | null {
  const mapped = WEBHOOK_STATUS_TO_DELIVERY_STATUS[incomingWebhookStatus];
  if (!mapped) return null;

  const currentRank = PROGRESS_RANK[currentStatus] ?? -1;
  const sentRank = PROGRESS_RANK.SENT ?? 1;

  if (mapped === "FAILED") {
    return currentRank <= sentRank ? mapped : null;
  }

  const incomingRank = PROGRESS_RANK[mapped] ?? -1;
  return incomingRank > currentRank ? mapped : null;
}

export const STATUS_TIMESTAMP_FIELD: Record<string, "sentAt" | "deliveredAt" | "readAt" | undefined> = {
  SENT: "sentAt",
  DELIVERED: "deliveredAt",
  READ: "readAt",
  FAILED: undefined,
};
