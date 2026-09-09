import { db } from "./db";
import { sendQueue } from "./queue";

/**
 * Reivindica uma Delivery agendada e a coloca na fila.
 *
 * As duas travas contra envio duplicado moram aqui: o `UPDATE ... WHERE
 * status = 'SCHEDULED'` (só quem ganha a corrida consegue trocar para
 * QUEUED) e o `idempotencyKey` como `jobId` do BullMQ. Usado tanto pelo
 * varredor de agendamento (`enqueueDue`) quanto pelo botão "enviar agora".
 */
export async function claimAndEnqueue(
  deliveryId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const claimed = await db.delivery.updateMany({
    where: { id: deliveryId, status: "SCHEDULED" },
    data: { status: "QUEUED" },
  });
  if (claimed.count === 0) return false;

  await sendQueue.add(
    "send",
    { deliveryId },
    {
      jobId: idempotencyKey,
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
    },
  );
  return true;
}

/** Roda a cada minuto no worker: pega o que venceu e joga na fila. */
export async function enqueueDue() {
  const due = await db.delivery.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    take: 500,
  });

  for (const d of due) {
    await claimAndEnqueue(d.id, d.idempotencyKey);
  }
}
