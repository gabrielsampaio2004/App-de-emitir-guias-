"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

const ACTOR_LABEL = "system:web"; // sem auth ainda

function parseIntField(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export async function updateScheduleRule(formData: FormData) {
  const tenant = await db.tenant.findFirstOrThrow();
  const ruleTypeRaw = formData.get("scheduleRuleType");

  if (ruleTypeRaw !== "FIXED_DAY" && ruleTypeRaw !== "BUSINESS_DAYS_BEFORE_DUE") {
    throw new Error("Regra inválida.");
  }
  // O `!==` acima exclui `File`/`null`, mas o TS não estreita o `string`
  // genérico do FormData pros dois literais do enum — o guard já garantiu
  // isso em runtime, então o cast é seguro.
  const ruleType = ruleTypeRaw as "FIXED_DAY" | "BUSINESS_DAYS_BEFORE_DUE";

  let fixedDay: number | null = null;
  let businessDays: number | null = null;

  if (ruleType === "FIXED_DAY") {
    fixedDay = parseIntField(formData.get("scheduleRuleFixedDay"));
    if (fixedDay === null || fixedDay < 1 || fixedDay > 31) {
      throw new Error("Dia do mês precisa ser um número entre 1 e 31.");
    }
  } else {
    businessDays = parseIntField(formData.get("scheduleRuleBusinessDaysBefore"));
    if (businessDays === null || businessDays < 1) {
      throw new Error("Dias úteis precisa ser um número positivo.");
    }
  }

  await db.$transaction(async (tx) => {
    const before = {
      scheduleRuleType: tenant.scheduleRuleType,
      scheduleRuleFixedDay: tenant.scheduleRuleFixedDay,
      scheduleRuleBusinessDaysBefore: tenant.scheduleRuleBusinessDaysBefore,
    };
    const after = {
      scheduleRuleType: ruleType,
      scheduleRuleFixedDay: fixedDay,
      scheduleRuleBusinessDaysBefore: businessDays,
    };

    await tx.tenant.update({ where: { id: tenant.id }, data: after });

    await audit(
      tx,
      { tenantId: tenant.id, actorLabel: ACTOR_LABEL },
      {
        action: "tenant.schedule_rule_updated",
        entityType: "Tenant",
        entityId: tenant.id,
        before,
        after,
      },
    );
  });

  revalidatePath("/configuracoes");
}
