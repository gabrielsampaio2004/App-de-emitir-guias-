import { db } from "./db";
import { sendQueue } from "./queue";

/**
 * Opções do job. Compartilhadas entre o enfileiramento normal e o resgate
 * de órfãs: se divergirem, uma Delivery resgatada passa a ter política de
 * retentativa diferente das outras, o que ninguém esperaria.
 */
const JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
} as const;

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

  await sendQueue.add("send", { deliveryId }, { jobId: idempotencyKey, ...JOB_OPTIONS });
  return true;
}

/**
 * Resgata Delivery presa em QUEUED sem job correspondente na fila.
 *
 * O `claimAndEnqueue` faz o UPDATE para QUEUED e só depois chama o
 * `sendQueue.add`. Se o Redis estiver fora nessa janela, o `add` fica
 * pendurado (o BullMQ usa `maxRetriesPerRequest: null`, então o comando
 * espera reconexão em vez de falhar) e, se o processo morrer aí, a linha
 * fica QUEUED para sempre: o `enqueueDue` só procura SCHEDULED. Reproduzido
 * de verdade — a guia nunca sai e não aparece erro em lugar nenhum.
 *
 * Por que resgatar em vez de inverter a ordem (enfileirar antes do UPDATE):
 * inverter troca "guia presa" por "guia enviada duas vezes", já que o job
 * poderia rodar com a linha ainda SCHEDULED e o `enqueueDue` a pegaria de
 * novo. O `CLAUDE.md` é explícito que envio duplicado é o pior desfecho.
 *
 * A checagem é a pergunta exata que importa — "existe job para esta
 * Delivery?" — em vez de um limite de tempo chutado. E reenfileirar usa o
 * mesmo `jobId`, então se o job existir o BullMQ ignora: a trava de
 * idempotência continua valendo. Job que esgotou as retentativas continua
 * na fila como `failed`, com o id ocupado, e por isso não é ressuscitado em
 * silêncio — esse caso tem `lastError` preenchido e aparece na tela.
 */
export async function recoverOrphanedQueued(): Promise<number> {
  const queued = await db.delivery.findMany({
    where: { status: "QUEUED" },
    take: 500,
  });

  let resgatadas = 0;
  for (const d of queued) {
    if (await sendQueue.getJob(d.idempotencyKey)) continue;

    await sendQueue.add("send", { deliveryId: d.id }, { jobId: d.idempotencyKey, ...JOB_OPTIONS });
    resgatadas++;
    console.warn(`[dispatch] Delivery ${d.id} estava QUEUED sem job na fila; reenfileirada`);
  }
  return resgatadas;
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

  await recoverOrphanedQueued();
}
