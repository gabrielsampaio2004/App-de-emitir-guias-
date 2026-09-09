import { subtractBusinessDays } from "./holidays";

export interface ScheduleRule {
  scheduleRuleType: "FIXED_DAY" | "BUSINESS_DAYS_BEFORE_DUE";
  scheduleRuleFixedDay: number | null;
  scheduleRuleBusinessDaysBefore: number | null;
}

function daysInMonthUTC(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function dayOfMonthUTC(year: number, month0: number, day: number): Date {
  const clamped = Math.min(day, daysInMonthUTC(year, month0));
  return new Date(Date.UTC(year, month0, clamped));
}

/**
 * Traduz a regra do tenant + o vencimento da guia numa data de envio.
 *
 * FIXED_DAY ("dia 20"): manda no dia N do mês do vencimento, se esse dia
 * ainda não passou do vencimento; senão, dia N do mês anterior. Não há
 * ajuste de dia útil aqui — se cair num fim de semana ou feriado, o
 * `enqueueDue` do worker pega no primeiro tick depois (não há perda, só
 * atraso de minutos/horas, não de dias).
 *
 * BUSINESS_DAYS_BEFORE_DUE ("3 dias úteis antes"): conta dias úteis pra
 * trás a partir do vencimento, pulando fim de semana e feriado nacional.
 */
export function computeScheduledAt(rule: ScheduleRule, dueDate: Date): Date {
  if (rule.scheduleRuleType === "BUSINESS_DAYS_BEFORE_DUE") {
    const n = rule.scheduleRuleBusinessDaysBefore ?? 3;
    return subtractBusinessDays(dueDate, n);
  }

  const day = rule.scheduleRuleFixedDay ?? 20;
  const year = dueDate.getUTCFullYear();
  const month0 = dueDate.getUTCMonth();

  const candidate = dayOfMonthUTC(year, month0, day);
  if (candidate.getTime() <= dueDate.getTime()) return candidate;

  return dayOfMonthUTC(year, month0 - 1, day);
}
