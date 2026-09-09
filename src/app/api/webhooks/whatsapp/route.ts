import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Webhook da Cloud API. Recebe atualizações de status (`sent`, `delivered`,
 * `read`, `failed`) das mensagens que mandamos.
 *
 * GET responde o desafio de verificação da Meta. POST valida a assinatura
 * (regra do CLAUDE.md — sem isso qualquer um marca guias como entregues) e
 * processa fora do ciclo de request/response, depois de responder 200.
 */

const statusSchema = z.object({
  id: z.string(),
  status: z.string(),
  timestamp: z.string(),
});

const webhookPayloadSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z
                .object({
                  statuses: z.array(statusSchema).optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

/**
 * Status da Cloud API que avançam o funil, em ordem. Nunca regride.
 * Chaves em maiúsculas para bater com o enum `DeliveryStatus` do Prisma
 * (`delivery.status` sempre vem como "SENT"/"DELIVERED"/"READ"...).
 */
const STATUS_RANK: Record<string, number> = {
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  if (!hasValidSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const parsed = webhookPayloadSchema.safeParse(safeJsonParse(rawBody));
  if (!parsed.success) {
    return new Response("Invalid payload", { status: 400 });
  }

  const payload = parsed.data;

  // Responde rápido; processa depois, fora do ciclo do request. O processo
  // do Next continua rodando (não é uma function serverless de vida curta),
  // então o processamento em segundo plano chega ao fim normalmente.
  queueMicrotask(() => {
    processStatuses(payload).catch((err) => {
      console.error(
        "[webhook whatsapp] falha ao processar evento:",
        err instanceof Error ? err.message : String(err),
      );
    });
  });

  return new Response("EVENT_RECEIVED", { status: 200 });
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasValidSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header) return false;

  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expected = Buffer.from(`sha256=${expectedHex}`, "utf8");
  const received = Buffer.from(header, "utf8");

  // Comprimentos diferentes: timingSafeEqual lançaria. Both branches return
  // false, então não vaza informação por tempo de resposta.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

async function processStatuses(payload: z.infer<typeof webhookPayloadSchema>) {
  const statuses = (payload.entry ?? []).flatMap((entry) =>
    (entry.changes ?? []).flatMap((change) => change.value?.statuses ?? []),
  );

  for (const status of statuses) {
    await applyStatusEvent(status.id, status.status, status.timestamp);
  }
}

async function applyStatusEvent(waMessageId: string, waStatus: string, timestamp: string) {
  const delivery = await db.delivery.findFirst({ where: { waMessageId } });
  // Mensagem não é nossa (ou webhook chegou antes do nosso próprio update de
  // sentAt/waMessageId, caso raro) — nada a fazer.
  if (!delivery) return;

  // Reentrega do mesmo evento: a Meta reenvia webhooks que não foram
  // confirmados a tempo. Dedup por (delivery, status, timestamp do evento).
  const duplicate = await db.deliveryEvent.findFirst({
    where: {
      deliveryId: delivery.id,
      type: waStatus,
      payload: { path: ["timestamp"], equals: timestamp },
    },
  });
  if (duplicate) return;

  await db.$transaction(async (tx) => {
    await tx.deliveryEvent.create({
      data: {
        deliveryId: delivery.id,
        type: waStatus,
        payload: { timestamp },
      },
    });

    if (waStatus === "failed") {
      // Só regride para FAILED se ainda não avançou (entregue/lido não pode
      // "falhar" depois — webhook fora de ordem).
      if (delivery.status === "SENT" || delivery.status === "QUEUED" || delivery.status === "SENDING") {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: { status: "FAILED", lastError: "Falha reportada pelo webhook da Meta" },
        });
      }
    } else {
      const newRank = STATUS_RANK[waStatus.toUpperCase()];
      const currentRank = STATUS_RANK[delivery.status] ?? 0;
      if (newRank !== undefined && newRank > currentRank) {
        const occurredAt = new Date(Number(timestamp) * 1000);
        await tx.delivery.update({
          where: { id: delivery.id },
          data: {
            status: waStatus.toUpperCase() as "SENT" | "DELIVERED" | "READ",
            // "sent" normalmente já foi gravado pelo worker antes deste
            // webhook chegar; só preenche se por algum motivo ainda faltar.
            ...(waStatus === "sent" ? { sentAt: delivery.sentAt ?? occurredAt } : {}),
            ...(waStatus === "delivered" ? { deliveredAt: occurredAt } : {}),
            ...(waStatus === "read" ? { readAt: occurredAt } : {}),
          },
        });
      }
    }

    await audit(
      tx,
      { tenantId: delivery.tenantId, actorLabel: "system:webhook" },
      {
        action: `delivery.webhook_${waStatus}`,
        entityType: "Delivery",
        entityId: delivery.id,
        after: { waStatus, waMessageId, timestamp },
      },
    );
  });
}
