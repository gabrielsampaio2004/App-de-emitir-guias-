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

> **Compila e roda, mas ainda não envia nada.** `npm run typecheck` passa limpo e
> `npm run dev` responde em localhost:3000. O envio de ponta a ponta é a etapa
> atual — veja `HANDOFF.md` para a ordem de trabalho.

```
prisma/schema.prisma           modelo de dados completo
prisma/migrations/             migration inicial; trava o AuditLog como append-only
src/app/                       app Next (hoje só layout + página mínima)
src/lib/whatsapp/provider.ts   contrato de envio (troca de provedor sem reescrita)
src/lib/whatsapp/meta-cloud.ts implementação da Cloud API
src/lib/matching/filename.ts   vincula arquivo → cliente por CPF/CNPJ no nome
src/lib/audit/index.ts         gravação do log append-only
src/lib/crypto.ts              AES-256-GCM do accessToken da Meta
src/lib/storage.ts             R2 via SDK do S3
src/workers/dispatcher.ts      agendador, executor e varredor dos envios
src/workers/index.ts           entrypoint do worker
```

Não existe ainda: o handler do webhook (`src/app/api/webhooks/whatsapp/`),
qualquer tela além da página inicial, seed, e test runner.

## Setup

```bash
npm install                # roda prisma generate no postinstall
cp .env.example .env       # preencher DATABASE_URL, REDIS_URL, R2_*, ENCRYPTION_KEY
npm run db:migrate         # precisa de um Postgres de verdade
npm run dev                # web
npm run worker             # dispatcher, em outro terminal
```

O `npm run typecheck` depende do client do Prisma estar gerado. O `postinstall`
cuida disso num clone limpo; se o `node_modules` vier de outro checkout, rode
`npx prisma generate`.

A trava de auditoria já vem na migration inicial — não precisa rodar nada à mão.
Ela faz mais do que o `REVOKE UPDATE, DELETE ON "AuditLog" FROM PUBLIC`, porque
no Postgres o dono da tabela ignora GRANT/REVOKE: são três gatilhos que recusam
`UPDATE`, `DELETE` e `TRUNCATE` para qualquer usuário. Consequência prática: não
dá para limpar essa tabela em fixture de teste — use um banco novo.

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

## Roadmap

A numeração é a mesma do `HANDOFF.md`, que é o documento de trabalho.

**Etapa 1 — fazer rodar.** ✅ Concluída: o app sobe e o typecheck passa.

**Etapa 2 — provar o envio.** ← atual. Um tenant fixo, cadastro manual de
clientes, upload de um PDF, botão "enviar agora". Sem agendamento. O objetivo é
só ver a guia chegar no WhatsApp e o webhook voltar `delivered`.

**Etapa 3 — o produto.** Upload de pasta inteira (`<input webkitdirectory>`),
matching automático pelo nome do arquivo, fila de revisão para o que não casou,
agendamento por regra ("dia 20" ou "3 dias úteis antes do vencimento") e a tela
de log.

**Depois — SaaS de verdade.** Embedded Signup para cada escritório conectar o
próprio número, billing, e o agente desktop que monitora a pasta local.

## Nota de LGPD

Guia fiscal tem CPF/CNPJ e valores. O código sobe o PDF para a Meta via Media API
em vez de expor URL pública, redige segredos do log de auditoria e checa
consentimento antes de cada envio — por `status`, que é a fonte de verdade, com o
banco impedindo que `status` e `revokedAt` se contradigam.

Falta definir política de retenção e o fluxo de opt-in do cliente final.
