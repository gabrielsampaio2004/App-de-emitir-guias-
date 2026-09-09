import { timingSafeEqual } from "crypto";
import { verifySignature, extractStatusEvents } from "@/lib/whatsapp/webhook";
import { webhookQueue } from "@/workers/webhook-dispatcher";

/**
 * Desafio de verificação do webhook, chamado uma vez quando a Meta valida a
 * URL cadastrada no painel. Confere o token que você mesmo inventou (env
 * `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) e ecoa o `hub.challenge`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "";
  const tokenBuf = Buffer.from(token ?? "", "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  const tokenMatches =
    expected.length > 0 &&
    tokenBuf.length === expectedBuf.length &&
    timingSafeEqual(tokenBuf, expectedBuf);

  if (mode === "subscribe" && tokenMatches && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Eventos de status (sent/delivered/read/failed) e outros callbacks da
 * Meta. Regra do CLAUDE.md: valida X-Hub-Signature-256 com
 * crypto.timingSafeEqual antes de qualquer processamento — sem isso,
 * qualquer um marca guias como entregues.
 *
 * Responde 200 rápido e processa fora do request: só valida a assinatura e
 * enfileira, quem escreve no banco é o webhookDispatcher (worker separado).
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";

  if (!verifySignature(rawBody, signature, appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Assinatura válida mas corpo não é JSON — nada a processar, mas a
    // requisição em si foi legítima (veio de quem tem o app secret).
    return new Response("OK", { status: 200 });
  }

  const events = extractStatusEvents(payload);
  if (events.length > 0) {
    await webhookQueue.add("process", { events });
  }

  return new Response("OK", { status: 200 });
}
