import { test } from "node:test";
import assert from "node:assert/strict";
import { isNationalHoliday, isBusinessDay, subtractBusinessDays } from "./holidays";

test("Sexta-feira Santa de 2026 é 3 de abril", () => {
  assert.equal(isNationalHoliday(new Date(Date.UTC(2026, 3, 3))), true);
  // A quinta e o sábado ao redor não são feriado por esse motivo.
  assert.equal(isNationalHoliday(new Date(Date.UTC(2026, 3, 2))), false);
  assert.equal(isNationalHoliday(new Date(Date.UTC(2026, 3, 4))), false);
});

test("7/set/2026 é feriado nacional (Independência) e não é dia útil", () => {
  const data = new Date(Date.UTC(2026, 8, 7));
  assert.equal(isNationalHoliday(data), true);
  assert.equal(isBusinessDay(data), false);
});

test("3 dias úteis antes de 7/set/2026 é 2/set/2026", () => {
  const scheduledAt = subtractBusinessDays(new Date(Date.UTC(2026, 8, 7)), 3);
  assert.equal(scheduledAt.toISOString(), new Date(Date.UTC(2026, 8, 2)).toISOString());
});

test("fim de semana não é dia útil, mesmo sem ser feriado", () => {
  // 5/set/2026 é sábado.
  assert.equal(isBusinessDay(new Date(Date.UTC(2026, 8, 5))), false);
  // 4/set/2026 é sexta, dia útil comum.
  assert.equal(isBusinessDay(new Date(Date.UTC(2026, 8, 4))), true);
});
