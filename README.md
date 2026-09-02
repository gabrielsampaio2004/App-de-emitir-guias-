# GuiaZap

Envio automatizado de guias fiscais por WhatsApp, com agendamento e trilha de auditoria completa.

## Stack

| Camada | Escolha |
|---|---|
| Web | Next.js 16 (App Router) |
| Banco | PostgreSQL + Prisma |
| Fila | BullMQ + Redis |
| Arquivos | Cloudflare R2 (S3-compatível) |
| WhatsApp | Meta Cloud API (oficial) |

## Estado atual

> **O projeto ainda não compila nem roda.** Veja `HANDOFF.md` para a lista de
> bugs confirmados e a ordem de trabalho.

```
prisma/schema.prisma           modelo de dados completo
src/lib/whatsapp/provider.ts   contrato de envio (troca de provedor sem reescrita)
src/lib/whatsapp/meta-cloud.ts implementação da Cloud API
src/lib/matching/filename.ts   vincula arquivo → cliente por CPF/CNPJ no nome
src/lib/audit/index.ts         gravação do log append-only  (tem bugs, ver HANDOFF)
src/workers/dispatcher.ts      agendador + executor dos envios
src/workers/index.ts           entrypoint do worker
```

Não existe ainda: app Next (`src/app/`), `next.config.mjs`, `src/lib/storage.ts`,
`src/lib/crypto.ts`, nem o handler do webhook.

## Setup

```bash
npm install
cp .env.example .env       # preencher DATABASE_URL, REDIS_URL, R2_*, ENCRYPTION_KEY
npx prisma migrate dev
npm run dev                # web
npm run worker             # dispatcher, em outro terminal
```

Trave a tabela de auditoria logo na primeira migration:

```sql
REVOKE UPDATE, DELETE ON "AuditLog" FROM PUBLIC;
```

## O template da Meta

Crie um template **categoria UTILITY** (não marketing — a diferença de preço no
Brasil é de quase 10x), idioma `pt_BR`, nome `envio_guia_fiscal`, com header do
tipo **DOCUMENT** e corpo:

```
Olá {{1}}, segue sua guia de {{2}} referente a {{3}}.
Vencimento: {{4}}.
Qualquer dúvida, é só responder por aqui.
```

Aprovação leva de algumas horas a poucos dias. Se a Meta reclassificar como
marketing, reescreva sem nada que soe promocional.

## Webhook de status

Configure `POST /api/webhooks/whatsapp` no painel da Meta. Os eventos
`sent`, `delivered`, `read` e `failed` chegam com o `waMessageId`, que você usa
para achar a `Delivery` e gravar o `DeliveryEvent`. **Valide a assinatura
`X-Hub-Signature-256`** antes de processar — sem isso qualquer um marca guias
como entregues.

## Roadmap sugerido

**Semana 1–2 — provar o envio.** Um tenant fixo, cadastro manual de clientes,
upload de um PDF, botão "enviar agora". Sem agendamento. O objetivo é só ver a
guia chegar no WhatsApp e o webhook voltar `delivered`.

**Semana 3–4 — o produto.** Upload de pasta inteira (`<input webkitdirectory>`),
matching automático pelo nome do arquivo, fila de revisão para o que não casou,
agendamento por regra ("dia 20" ou "3 dias úteis antes do vencimento") e a tela
de log.

**Semana 5+ — SaaS de verdade.** Embedded Signup para cada escritório conectar o
próprio número, billing, e o agente desktop que monitora a pasta local.

## Nota de LGPD

Guia fiscal tem CPF/CNPJ e valores. O código já sobe o PDF para a Meta via Media
API em vez de expor URL pública, redige segredos do log de auditoria e checa
consentimento ativo antes de cada envio. Falta definir política de retenção e o
fluxo de opt-in do cliente final.
