import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { updateScheduleRule } from "./actions";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const session = await requireSession();
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: session.user.tenantId } });

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "2rem auto" }}>
      <h1>Configurações</h1>

      <form action={updateScheduleRule}>
        <fieldset>
          <legend>Regra de agendamento</legend>
          <p>
            <label>
              <input
                type="radio"
                name="scheduleRuleType"
                value="FIXED_DAY"
                defaultChecked={tenant.scheduleRuleType === "FIXED_DAY"}
              />{" "}
              Todo dia{" "}
              <input
                type="number"
                name="scheduleRuleFixedDay"
                min={1}
                max={31}
                defaultValue={tenant.scheduleRuleFixedDay ?? 20}
                style={{ width: "4rem" }}
              />{" "}
              do mês (ou o mais próximo antes do vencimento, se esse dia já passou)
            </label>
          </p>
          <p>
            <label>
              <input
                type="radio"
                name="scheduleRuleType"
                value="BUSINESS_DAYS_BEFORE_DUE"
                defaultChecked={tenant.scheduleRuleType === "BUSINESS_DAYS_BEFORE_DUE"}
              />{" "}
              <input
                type="number"
                name="scheduleRuleBusinessDaysBefore"
                min={1}
                defaultValue={tenant.scheduleRuleBusinessDaysBefore ?? 3}
                style={{ width: "4rem" }}
              />{" "}
              dias úteis antes do vencimento (feriados nacionais, sem estadual/municipal)
            </label>
          </p>
        </fieldset>
        <button type="submit" style={{ marginTop: "1rem" }}>
          Salvar
        </button>
      </form>
    </main>
  );
}
