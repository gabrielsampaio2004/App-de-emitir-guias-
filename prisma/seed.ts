import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encrypt } from "../src/lib/crypto";

/**
 * Seed da Etapa 2: um tenant fixo e um cliente cadastrado na mão, pra provar
 * o envio de ponta a ponta sem depender de matching automático (isso é
 * Etapa 3). CPF/CNPJ abaixo passam no dígito verificador do próprio projeto
 * (conferido com `isValidCPF`/`isValidCNPJ` antes de escrever este arquivo),
 * mas são valores de teste — nenhum dos dois é usado pelo matching aqui.
 *
 * A WhatsAppAccount só é criada se as credenciais reais vierem por variável
 * de ambiente (SEED_WA_*). Sem elas, o seed cria só tenant+client e avisa —
 * este script nunca inventa nem pede um token da Meta.
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  const tenant = await db.tenant.upsert({
    where: { cnpj: "00000000000191" },
    update: {},
    create: { name: "Escritório de Teste", cnpj: "00000000000191" },
  });
  console.log(`Tenant: ${tenant.id} (${tenant.name})`);

  const clientPhone = process.env.SEED_CLIENT_PHONE;
  if (!clientPhone) {
    throw new Error(
      "SEED_CLIENT_PHONE não definida — precisa de um número real em E.164 " +
        "(ex: +5579999999999) pra receber a guia de teste. Não uso um número inventado.",
    );
  }
  const client = await db.client.upsert({
    where: { tenantId_document: { tenantId: tenant.id, document: "11144477735" } },
    update: { phoneE164: clientPhone },
    create: {
      tenantId: tenant.id,
      name: "Cliente de Teste",
      document: "11144477735",
      phoneE164: clientPhone,
    },
  });
  console.log(`Client: ${client.id} (${client.phoneE164})`);

  await db.consent.upsert({
    where: { id: `seed-consent-${client.id}` },
    update: { status: "GRANTED", revokedAt: null },
    create: {
      id: `seed-consent-${client.id}`,
      clientId: client.id,
      status: "GRANTED",
      evidence: { origem: "seed de desenvolvimento" },
    },
  });
  console.log("Consent: GRANTED");

  const { SEED_WA_WABA_ID, SEED_WA_PHONE_NUMBER_ID, SEED_WA_DISPLAY_PHONE, SEED_WA_ACCESS_TOKEN } =
    process.env;
  if (SEED_WA_WABA_ID && SEED_WA_PHONE_NUMBER_ID && SEED_WA_DISPLAY_PHONE && SEED_WA_ACCESS_TOKEN) {
    await db.whatsAppAccount.upsert({
      where: { tenantId: tenant.id },
      update: {
        wabaId: SEED_WA_WABA_ID,
        phoneNumberId: SEED_WA_PHONE_NUMBER_ID,
        displayPhone: SEED_WA_DISPLAY_PHONE,
        accessTokenEnc: encrypt(SEED_WA_ACCESS_TOKEN),
      },
      create: {
        tenantId: tenant.id,
        wabaId: SEED_WA_WABA_ID,
        phoneNumberId: SEED_WA_PHONE_NUMBER_ID,
        displayPhone: SEED_WA_DISPLAY_PHONE,
        accessTokenEnc: encrypt(SEED_WA_ACCESS_TOKEN),
      },
    });
    console.log("WhatsAppAccount: criada/atualizada a partir de SEED_WA_*");
  } else {
    console.log(
      "WhatsAppAccount: não criada (defina SEED_WA_WABA_ID, SEED_WA_PHONE_NUMBER_ID, " +
        "SEED_WA_DISPLAY_PHONE e SEED_WA_ACCESS_TOKEN com credenciais reais da Meta " +
        "pra habilitar o envio de verdade).",
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
