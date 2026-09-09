/**
 * Feriados nacionais brasileiros, só isso — sem estadual/municipal (decisão
 * explícita: cobre menos casos, mas não inventa feriado que pode não valer
 * pro município do cliente).
 *
 * Datas fixas + Sexta-feira Santa (feriado nacional inequívoco, calculado a
 * partir da Páscoa). Carnaval e Corpo de Deus ficam de fora de propósito:
 * são ponto facultativo / discricionários, não feriado nacional por lei —
 * incluir errado aqui atrasaria um envio de verdade.
 *
 * Tudo em UTC: `dueDate` chega como data pura (meia-noite UTC) do formulário
 * de revisão, e misturar getters locais com UTC aqui criaria um bug de
 * fuso ao redor da virada do dia.
 */

const FIXED_HOLIDAYS: ReadonlyArray<readonly [month: number, day: number]> = [
  [1, 1], // Confraternização Universal
  [4, 21], // Tiradentes
  [5, 1], // Dia do Trabalho
  [9, 7], // Independência
  [10, 12], // Nossa Senhora Aparecida
  [11, 2], // Finados
  [11, 15], // Proclamação da República
  [11, 20], // Consciência Negra (Lei 14.759/2023)
  [12, 25], // Natal
];

/** Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher (calendário gregoriano). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUTC(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function sameUTCDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function isNationalHoliday(date: Date): boolean {
  const year = date.getUTCFullYear();
  const goodFriday = addDaysUTC(easterSunday(year), -2);
  if (sameUTCDate(date, goodFriday)) return true;

  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return FIXED_HOLIDAYS.some(([m, d]) => m === month && d === day);
}

export function isBusinessDay(date: Date): boolean {
  const weekday = date.getUTCDay(); // 0 = domingo, 6 = sábado
  if (weekday === 0 || weekday === 6) return false;
  return !isNationalHoliday(date);
}

/** Anda N dias úteis para trás a partir de `date` (não inclui `date` em si). */
export function subtractBusinessDays(date: Date, n: number): Date {
  let cursor = date;
  let remaining = n;
  while (remaining > 0) {
    cursor = addDaysUTC(cursor, -1);
    if (isBusinessDay(cursor)) remaining--;
  }
  return cursor;
}
