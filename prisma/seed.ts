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

  const client = await db.client.upsert({
    where: { tenantId_document: { tenantId: tenant.id, document: "52998224725" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "João da Silva",
      document: "52998224725",
      phoneE164: process.env.SEED_CLIENT_PHONE ?? "+5511999999999",
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

  if (!wabaId || !phoneNumberId || !accessToken) {
    console.warn(
      "[seed] WHATSAPP_WABA_ID / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN " +
        "não definidos — gravando WhatsAppAccount com placeholders. O botão " +
        "'enviar agora' vai falhar na chamada à Cloud API até esses valores " +
        "reais serem definidos e o seed rodado de novo.",
    );
  }

  await db.whatsAppAccount.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      wabaId: wabaId ?? "PLACEHOLDER_WABA_ID",
      phoneNumberId: phoneNumberId ?? "PLACEHOLDER_PHONE_NUMBER_ID",
      displayPhone,
      accessTokenEnc: encrypt(accessToken ?? "PLACEHOLDER_ACCESS_TOKEN"),
    },
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
