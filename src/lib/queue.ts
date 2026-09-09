import { Queue } from "bullmq";

export const connection = { url: process.env.REDIS_URL! };

/** Fila única de envios — o worker (`src/workers/dispatcher.ts`) é quem consome. */
export const sendQueue = new Queue("deliveries", { connection });
