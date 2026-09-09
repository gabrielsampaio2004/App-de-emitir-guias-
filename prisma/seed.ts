import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encrypt } from "../src/lib/crypto";

/**
 * Seed da Etapa 2: só o necessário para provar o envio de ponta a ponta.
 * Um tenant fixo, um cliente com consentimento concedido, e a conta
 * WhatsApp do tenant (token cifrado, como exige o CLAUDE.md).
 *
 * As credenciais reais da Meta (WABA ID, phone number ID, access token) vêm
 * de variáveis de ambiente — sem elas o seed usa placeholders óbvios e avisa,
 * porque com placeholders o botão "enviar agora" vai falhar na chamada à
 * Cloud API (o que é esperado: não dá pra testar envio real sem credencial real).
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  const tenant = await db.tenant.upsert({
    where: { cnpj: "11222333000181" },
    update: {},
    create: {
      name: "Escritório Contábil Demo",
      cnpj: "11222333000181",
    },
  });

  // SEED_CLIENT_PHONE definida = intenção explícita de trocar o número de
  // teste (normalmente o seu, pra guia chegar em algum lugar). Sem ela, um
  // re-seed não mexe no telefone que já está gravado.
  const seedClientPhone = process.env.SEED_CLIENT_PHONE;

  const client = await db.client.upsert({
    where: { tenantId_document: { tenantId: tenant.id, document: "52998224725" } },
    update: seedClientPhone ? { phoneE164: seedClientPhone } : {},
    create: {
      tenantId: tenant.id,
      name: "João da Silva",
      document: "52998224725",
      phoneE164: seedClientPhone ?? "+5511999999999",
    },
  });

  const existingConsent = await db.consent.findFirst({
    where: { clientId: client.id, status: "GRANTED" },
  });
  if (!existingConsent) {
    await db.consent.create({
      data: {
        clientId: client.id,
        status: "GRANTED",
        evidence: { origem: "seed", nota: "consentimento de demonstração" },
      },
    });
  }

  const wabaId = process.env.WHATSAPP_WABA_ID;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const displayPhone = process.env.WHATSAPP_DISPLAY_PHONE ?? "+55 79 9999-9999";

  const hasRealCredentials = Boolean(wabaId && phoneNumberId && accessToken);

  if (!hasRealCredentials) {
    console.warn(
      "[seed] WHATSAPP_WABA_ID / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN " +
        "não definidos — o envio real vai falhar na chamada à Cloud API. " +
        "Preencha as três no .env e rode `npm run db:seed` de novo; uma conta " +
        "já gravada com valores reais NÃO é sobrescrita por placeholder.",
    );
  }

  const waAccount = {
    wabaId: wabaId ?? "PLACEHOLDER_WABA_ID",
    phoneNumberId: phoneNumberId ?? "PLACEHOLDER_PHONE_NUMBER_ID",
    displayPhone,
    // O token vai cifrado (AES-256-GCM) com ENCRYPTION_KEY, nunca em texto puro.
    accessTokenEnc: encrypt(accessToken ?? "PLACEHOLDER_ACCESS_TOKEN"),
  };

  await db.whatsAppAccount.upsert({
    where: { tenantId: tenant.id },
    // Só atualiza quando as três variáveis reais estão presentes. Antes era
    // `update: {}`: rodar o seed de novo depois de preencher as credenciais
    // não fazia nada, e o registro ficava com os placeholders para sempre —
    // exatamente o contrário do que o aviso acima mandava fazer. O guard
    // também impede o caminho oposto: um re-seed sem as variáveis apagando
    // credencial real.
    update: hasRealCredentials ? waAccount : {},
    create: { tenantId: tenant.id, ...waAccount },
  });

  console.log(`[seed] tenant=${tenant.id} client=${client.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
