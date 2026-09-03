import { enqueueDue, recoverStuckDeliveries, dispatcher, sendQueue } from "./dispatcher";

const TICK_MS = 60_000;

let timer: NodeJS.Timeout;
let running = false;

async function tick() {
  if (running) return; // não sobrepõe execuções se uma demorar
  running = true;
  try {
    await enqueueDue();
  } catch (err) {
    console.error("[dispatcher] falha ao enfileirar:", err);
  }
  try {
    await recoverStuckDeliveries();
  } catch (err) {
    console.error("[dispatcher] falha na varredura de entregas presas:", err);
  } finally {
    running = false;
  }
}

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} recebido, encerrando...`);
  clearInterval(timer);
  await dispatcher.close();   // espera os jobs em voo terminarem
  await sendQueue.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log("[worker] iniciado");
void tick();
timer = setInterval(() => void tick(), TICK_MS);
