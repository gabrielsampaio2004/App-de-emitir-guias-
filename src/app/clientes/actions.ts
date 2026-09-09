"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Liga/desliga um cliente. Desativar não apaga nada e não cancela na hora as
 * Deliveries já agendadas: quem garante que nada sai é o dispatcher, que
 * recusa enviar para cliente inativo no momento do envio (mesma lógica do
 * consentimento revogado). A tela mostra quantas guias agendadas serão
 * afetadas antes de você desativar.
 */
const ACTOR_LABEL = "system:web"; // sem auth ainda

export async function setClientActive(formData: FormData) {
  const clientId = formData.get("clientId");
  const activeRaw = formData.get("active");

  if (typeof clientId !== "string" || !clientId) {
    throw new Error("Cliente inválido.");
  }
  if (activeRaw !== "true" && activeRaw !== "false") {
    throw new Error("Estado inválido.");
  }
  const active = activeRaw === "true";

  const client = await db.client.findUniqueOrThrow({ where: { id: clientId } });

  if (client.active !== active) {
    await db.$transaction(async (tx) => {
      await tx.client.update({ where: { id: client.id }, data: { active } });

      await audit(
        tx,
        { tenantId: client.tenantId, actorLabel: ACTOR_LABEL },
        {
          action: active ? "client.reactivated" : "client.deactivated",
          entityType: "Client",
          entityId: client.id,
          before: { active: client.active },
          after: { active },
        },
      );
    });
  }

  revalidatePath("/clientes");
  revalidatePath("/revisao");
  revalidatePath("/");
}
