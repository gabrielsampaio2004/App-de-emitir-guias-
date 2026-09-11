# HANDOFF — plano de trabalho

Contexto do produto, stack e regras invioláveis estão no `CLAUDE.md`. **Leia-o
primeiro.** Este documento é só a ordem de trabalho.

Estado: `npm run typecheck` passa limpo, `npm run dev` sobe e responde em
localhost:3000, e a migration inicial existe e aplica. **A Etapa 1 está
fechada.** O que falta é provar o envio de ponta a ponta — Etapa 2.

Última atualização: 11/09/2026.

---

## 1. Feito (não refazer)

Registrado porque versões anteriores deste documento descreveram alguns destes
problemas de forma errada.

- **`filename.ts` TS2532** — corrigido com `w[i] ?? 0`. Os cinco casos da tabela
  da seção 3 foram reexecutados em 11/09 e **os cinco passam**. ⚠️ Continuam sem
  virar teste automatizado (não há test runner — ver seção 3).
- **`split(" ")[0]` no `dispatcher.ts`** — confirmado e corrigido com fallback
  para o nome completo.
- **`new Blob([file])` com `Buffer`** — confirmado (`Buffer<ArrayBufferLike>` não
  é `BlobPart`); corrigido com `new Uint8Array(file)`.
- **Prisma 7** — a causa real era o Prisma 7 proibir `url` no `schema.prisma`
  (P1012) e exigir driver adapter no construtor. Resolvido com `prisma.config.ts`,
  `url` fora do schema e `PrismaPg` no cliente. O gerador `prisma-client-js`
  nunca foi o problema.
- **`tsconfig.json`: `baseUrl`** — o TypeScript 7 removeu a opção (TS5102).
  Removida; `paths` resolve relativo ao `tsconfig.json`.
- **`tsconfig.json`: `types`** — o TS 7 não inclui mais os tipos do Node
  automaticamente. Resolvido com `"types": ["node"]`.
- **`scrub` no `audit/index.ts`** — recursiva, preserva arrays, converte `Date` e
  `bigint`, limite de 20 níveis.
- **`src/lib/crypto.ts` e `src/lib/storage.ts`** — criados e funcionais.
- **Etapa 1** — `src/app/layout.tsx` e `src/app/page.tsx` criados; o `dev` sobe.
- **Migration inicial** (11/09) — `prisma/migrations/20260911032831_init`. Além do
  schema, carrega as travas descritas na seção 2.
- **Rodada de correções de 11/09** — detalhada na seção 2.

---

## 2. Correções de 11/09 e as decisões que elas travaram

Tudo aqui foi verificado com Postgres e Redis reais (23 asserções, todas
passando). Os scripts de verificação **não foram versionados**, pela mesma razão
da seção 3.

### `AuditLog` append-only de verdade

O `REVOKE UPDATE, DELETE ... FROM PUBLIC` que o `CLAUDE.md` exige está na
migration, mas **sozinho ele não funcionava**: o dono da tabela ignora
GRANT/REVOKE no Postgres, e a aplicação conecta com o usuário que criou o schema.
Medido: com só o `REVOKE`, `UPDATE "AuditLog" SET action='adulterado'` retorna
`UPDATE 1`. A migration agora também instala os gatilhos `auditlog_no_update`,
`auditlog_no_delete` e `auditlog_no_truncate`. Efeito colateral aceito: fixture
de teste não consegue dar `TRUNCATE` — use banco novo a cada rodada.

### Envio duplo: a trava mudou de lugar

O guarda de reentrada do worker era uma lista de status já resolvidos
(`SENT`, `DELIVERED`, `READ`, `CANCELLED`) que **não incluía `SENDING`**. Se o
processo morresse entre marcar `SENDING` e marcar `SENT`, a retentativa do BullMQ
passava direto e reenviava — contra a regra inviolável.

Agora o worker só trabalha se conseguir mover `QUEUED -> SENDING` num `UPDATE`
condicional. Quem não conseguir, sai sem tocar na Meta. É estritamente mais forte
que a lista anterior e cobre o caso do crash.

### Varredor de deliveries travadas — decisão da antiga seção 4, item 1

**Decisão: a ordem `UPDATE -> QUEUED` antes do `sendQueue.add` fica como está.**
Inverter faria o job existir antes de a linha estar travada, abrindo janela para
dois workers pegarem a mesma delivery. Trocar risco de linha parada por risco de
envio duplo é troca ruim aqui.

O buraco foi coberto por dois lados:

1. Se o `add` falhar, o `enqueueDue` devolve a linha para `SCHEDULED` na hora.
2. `sweepStalled()` roda a cada minuto junto com o `enqueueDue` e cuida do resto.

O varredor **nunca reenvia por conta própria**. Ele só devolve para `SCHEDULED` o
que comprovadamente não chegou à fila (sem job com aquele `jobId`, e sem
`waMessageId`). Todo caso em que o envio possa ter acontecido — parado em
`SENDING`, ou com `waMessageId` já preenchido — vira `FAILED` com o motivo no
`lastError`, para um humano conferir no painel da Meta antes de decidir. Isso
troca entrega automática por não cobrar duas vezes, que é o lado certo da regra.

`Delivery` ganhou `updatedAt` (`@updatedAt`) e o índice `[status, updatedAt]`;
é por ele que o varredor mede há quanto tempo a linha não anda. A janela é
`STALLED_AFTER_MS`, hoje 10 minutos.

### Consentimento — decisão da antiga seção 4, item 2

**Decisão: `status` é a fonte de verdade única. `revokedAt` é só a data.** O
banco passa a impedir o par contraditório, via CHECK na migration inicial:
`("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)`. O dispatcher também filtra
por `revokedAt: null`, ordena por `grantedAt desc` e passou a filtrar por
`channel` (antes pegava um consentimento qualquer, de qualquer canal).

### Auditoria nos caminhos que não tinham

Havia **uma única** chamada de `audit()` no projeto inteiro, no caminho de
sucesso. Cancelamento por falta de consentimento e falha de envio mudavam o
status da `Delivery` sem log — e, no caso da falha, com dois writes fora de
transação. Agora cancelamento, falha retentável, falha definitiva e as duas
saídas do varredor gravam `Delivery` + `DeliveryEvent` + `AuditLog` na mesma
transação. Ações novas: `delivery.cancelled`, `delivery.send_failed`,
`delivery.failed`, `delivery.requeued`.

### Outros

- **`waAccount!`** — tenant sem conta conectada virava `TypeError`, que não é
  `WhatsAppError` e portanto contava como retentável: cinco tentativas inúteis e
  a linha parada. Agora é `WhatsAppError(..., retryable: false)` e falha na
  primeira.
- **Segredo em mensagem de erro** — o texto do erro agora vai para o `AuditLog`,
  que é append-only: o que entrar ali não sai. `redactSecrets()` corta
  `Bearer ...` e `access_token=...` antes de persistir, e a exceção relançada
  para o BullMQ também vai redigida.
- **Formato da competência** — o `parseFilename` grava `"2026-08"` e o contrato
  do provider documenta `"08/2026"`. O dispatcher mandava o formato cru para o
  WhatsApp. Agora converte na fronteira.
- **Vencimento** — `toLocaleDateString` sem fuso fazia um vencimento gravado à
  meia-noite UTC aparecer como o dia anterior em UTC-3. Fixado em UTC.
- **`idempotencyKey`** — o `MetaCloudProvider` **recebia e ignorava**. A Cloud API
  não tem cabeçalho de idempotência; não há o que fazer com ela ali. O contrato
  em `provider.ts` foi corrigido para dizer isso, em vez de prometer uma garantia
  que não existe. A proteção real é o `jobId` do BullMQ mais a trava de status.
- **`prisma generate`** — num clone limpo o `typecheck` não compilava, porque o
  `prisma.config.ts` usava `env("DATABASE_URL")`, que aborta o carregamento do
  config e derrubava até o `generate`. Agora lê `process.env` direto, e há um
  `postinstall`.
- **`next.config.mjs`** — criado só para `agentRules: false`. O `next dev` do
  Next 16 reescrevia o `CLAUDE.md` a cada execução, acrescentando um bloco vindo
  do `node_modules`.

---

## 3. Testes — decisão ainda pendente

Continua não havendo test runner no `package.json`, e **nada foi instalado**.
A decisão segue sua: o Node 22 traz `node:test` embutido, o que permitiria um
`npm test` sem dependência nova — mas ainda é decisão de arquitetura, então não
tomei. **Pergunte antes de instalar qualquer coisa.**

As verificações de 11/09 rodaram em scripts descartáveis, fora do versionamento.
Enquanto não houver runner, nada disso protege contra regressão.

Quando houver, comece por estes cinco casos do `parseFilename` — reexecutados em
11/09, os cinco passando:

| entrada | `document` | `kind` | `competencia` |
|---|---|---|---|
| `DAS_11222333000181_2026-08.pdf` | `11222333000181` | `DAS` | `2026-08` |
| `darf-529.982.247-25-082026.pdf` | `52998224725` | `DARF` | `2026-08` |
| `11222333000181 - FGTS - 08_2026.pdf` | `11222333000181` | `FGTS` | `2026-08` |
| `guia sem nada.pdf` | `null` | `null` | `null` |
| `boleto protocolo 99999999999999 08-2026.pdf` | `null` | `BOLETO` | `2026-08` |

A última linha é a que importa: 14 dígitos que **não** são CNPJ válido devem ser
rejeitados.

E depois estes, que hoje só existem como script descartável: a trava
`QUEUED -> SENDING` sob concorrência, as quatro saídas do `sweepStalled`, o CHECK
do `Consent` e os gatilhos do `AuditLog`. Todos precisam de Postgres real.

---

## 4. Em aberto — confirme antes de assumir

Os dois itens que ocupavam esta seção foram confirmados e resolvidos (seção 2).
O que resta aqui **não foi executado**:

1. **`connection: { url: REDIS_URL }` do BullMQ** — funciona nos testes contra
   Redis local sem senha e sem TLS. Não foi exercitado contra Redis gerenciado
   (`rediss://`, senha, TLS). Confirme antes de subir para produção.
2. **`STALLED_AFTER_MS` = 10 minutos** — chutado para ser maior que o envio mais
   lento plausível (upload do PDF para a Meta + POST do template). Nunca foi
   medido contra a Meta de verdade. Meça na Etapa 2 e ajuste.
3. **Retentabilidade dos códigos da Meta** — `meta-cloud.ts` trata como
   retentável só 5xx, `4` e `80007`. A lista veio de documentação, não de
   observação. Confira contra o que aparecer de verdade.

---

## 5. O que construir, em ordem

### Etapa 1 — fazer rodar ✅ concluída

`npm run dev` sobe e responde em localhost:3000; `npm run typecheck` limpo.

### Etapa 2 — provar o envio de ponta a ponta  ← ATUAL

Um tenant fixo em seed, um cliente cadastrado na mão, upload de um PDF, botão
"enviar agora". **Sem agendamento ainda.** O objetivo é ver a guia chegar no
WhatsApp e o webhook voltar `delivered`.

- **`src/app/api/webhooks/whatsapp/route.ts`** — `GET` responde o desafio de
  verificação com `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; `POST` processa os eventos e
  valida a assinatura (ver regra no `CLAUDE.md`). Responda 200 rápido e processe
  fora do request.
- Grave `DeliveryEvent` para cada status e atualize `sentAt`/`deliveredAt`/`readAt`.
- Webhooks da Meta **chegam fora de ordem e repetidos**. Nunca regrida o status
  (`READ` não volta para `DELIVERED`) e trate reentrega do mesmo evento.
- O webhook é também o lugar de gravar auditoria dos status que chegam — siga o
  padrão da seção 2: estado e log na mesma transação.

A migration inicial já existe; basta um Postgres de verdade e `npm run db:migrate`.

Aceite: uma guia real chega num WhatsApp real e o banco registra
`sent` → `delivered`.

### Etapa 3 — o produto

- Upload de pasta inteira via `<input type="file" webkitdirectory />`.
- Matching automático pelo `parseFilename`; o que não casar vai para fila de
  revisão manual.
- Agendamento por regra ("dia 20", "3 dias úteis antes do vencimento"), com
  calendário de feriados.
- Tela de log lendo `AuditLog` e `DeliveryEvent`. Inclua as deliveries que o
  `sweepStalled` marcou como `FAILED`: são exatamente as que precisam de decisão
  humana, e hoje não há tela que as mostre.

---

## 6. Como reportar

Ao terminar cada etapa, diga:

1. O que você **executou** para verificar (comando e saída), separado do que
   apenas leu.
2. Quais itens da seção 4 se confirmaram e quais não.
3. O que ficou faltando.

Vale notar: na revisão de 11/09, o próprio cabeçalho deste documento estava
errado (dizia que o `dev` não subia, quando subia desde dois commits antes), o
`README.md` listava como inexistentes três arquivos que existiam, e a regra do
`AuditLog` no `CLAUDE.md` estava implementável ao pé da letra e ainda assim não
funcionaria. Verificar de fato importa.
