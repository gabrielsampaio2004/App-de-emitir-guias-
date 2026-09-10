import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScheduledAt } from "./rule";

test("FIXED_DAY: dia N ainda não passou do vencimento no mesmo mês", () => {
  // dia 20, vencimento 25/08/2026 -> 20/08/2026 ainda cabe no mesmo mês.
  const scheduledAt = computeScheduledAt(
    { scheduleRuleType: "FIXED_DAY", scheduleRuleFixedDay: 20, scheduleRuleBusinessDaysBefore: null },
    new Date(Date.UTC(2026, 7, 25)),
  );
  assert.equal(scheduledAt.toISOString(), new Date(Date.UTC(2026, 7, 20)).toISOString());
});

test("FIXED_DAY: dia N já passou do vencimento, cai no mês anterior", () => {
  // dia 20, vencimento 15/08/2026 -> dia 20 já passaria do vencimento, então
  // manda dia 20 de julho.
  const scheduledAt = computeScheduledAt(
    { scheduleRuleType: "FIXED_DAY", scheduleRuleFixedDay: 20, scheduleRuleBusinessDaysBefore: null },
    new Date(Date.UTC(2026, 7, 15)),
  );
  assert.equal(scheduledAt.toISOString(), new Date(Date.UTC(2026, 6, 20)).toISOString());
});

test("BUSINESS_DAYS_BEFORE_DUE: 3 dias úteis antes de 7/set/2026 (feriado) é 2/set", () => {
  const scheduledAt = computeScheduledAt(
    {
      scheduleRuleType: "BUSINESS_DAYS_BEFORE_DUE",
      scheduleRuleFixedDay: null,
      scheduleRuleBusinessDaysBefore: 3,
    },
    new Date(Date.UTC(2026, 8, 7)),
  );
  assert.equal(scheduledAt.toISOString(), new Date(Date.UTC(2026, 8, 2)).toISOString());
});
