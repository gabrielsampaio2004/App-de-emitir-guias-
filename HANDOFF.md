# HANDOFF — plano de trabalho

Contexto do produto, stack e regras invioláveis estão no `CLAUDE.md`. **Leia-o
primeiro.** Este documento é só a ordem de trabalho.

Estado: `npm run typecheck` passa limpo. `npm run dev` sobe. `npm run build`
passa limpo (`/` como rota dinâmica). Etapa 2 implementada e verificada
localmente (Postgres/Redis reais neste ambiente, sem R2/Meta reais — ver
seção 5).

Última atualização: 09/09/2026, etapa 2.

---

## 1. Feito (não refazer)

Registrado porque a versão anterior deste documento descrevia alguns destes
problemas de forma errada.

- **`filename.ts` TS2532** — corrigido com `w[i] ?? 0`. ⚠️ Os cinco casos da
  tabela na seção 3 **ainda não viraram teste automatizado** (não há test runner).
- **`split(" ")[0]` no `dispatcher.ts`** — era o item "não verificado" da lista
  antiga. Confirmou-se; corrigido com fallback para o nome completo.
- **`new Blob([file])` com `Buffer`** — também era "não verificado". Confirmou-se
  (`Buffer<ArrayBufferLike>` não é `BlobPart`); corrigido com `new Uint8Array(file)`.
- **Prisma 7** — a versão anterior dizia que o problema era o gerador antigo
  `prisma-client-js`. **Estava errado.** A causa real era outra e maior: o
  Prisma 7 proíbe `url` no `schema.prisma` (erro P1012) e exige driver adapter
  no construtor do `PrismaClient`. Resolvido criando `prisma.config.ts`,
  removendo a `url` do schema e passando `PrismaPg` ao cliente. O gerador
  `prisma-client-js` continua funcionando normalmente.
- **`tsconfig.json`: `baseUrl`** — não estava na lista. O TypeScript 7 removeu a
  opção (erro TS5102) e o typecheck nem começava. Removida; `paths` funciona
  sozinho, resolvendo relativo ao `tsconfig.json`.
- **`tsconfig.json`: `types`** — não estava na lista. O TS 7 não inclui mais os
  tipos do Node automaticamente; `Buffer`, `process` e `NodeJS` davam TS2591
  mesmo com `@types/node` instalado. Resolvido com `"types": ["node"]`.
- **`tx` implicitamente `any`** — apareceu e sumiu sozinho. Era consequência do
  `PrismaClient` não resolver; com o client gerado, a inferência funciona.
- **`scrub` no `audit/index.ts`** — os três defeitos foram corrigidos. Agora é
  recursiva (segredo aninhado em qualquer profundidade vira `[redacted]`),
  preserva arrays, converte `Date` para ISO e `bigint` para string, com limite
  de 20 níveis contra estruturas circulares. Verificada com 14 casos. ⚠️ Os
  testes rodaram fora do projeto e **não estão versionados** — ver seção 3.
- **`src/lib/crypto.ts` e `src/lib/storage.ts`** — criados. O `crypto.ts` foi
  testado funcionalmente: cifra, decifra e rejeita dado adulterado.

---

## 2. Bugs abertos

Nenhum no momento. Todos os bugs confirmados por execução foram corrigidos
(incluindo dois novos, achados testando a etapa 2 — ver seção 5). O que
resta não é conserto, é construção: ver seções 3, 4 e 5.

---

## 3. Testes — decisão pendente

Não há test runner no `package.json`. Instalar um é decisão de arquitetura;
**não instale nada sem perguntar antes.**

Quando houver runner, estes cinco casos do `parseFilename` já passavam e não
podem regredir:

| entrada | `document` | `kind` | `competencia` |
|---|---|---|---|
| `DAS_11222333000181_2026-08.pdf` | `11222333000181` | `DAS` | `2026-08` |
| `darf-529.982.247-25-082026.pdf` | `52998224725` | `DARF` | `2026-08` |
| `11222333000181 - FGTS - 08_2026.pdf` | `11222333000181` | `FGTS` | `2026-08` |
| `guia sem nada.pdf` | `null` | `null` | `null` |
| `boleto protocolo 99999999999999 08-2026.pdf` | `null` | `BOLETO` | `2026-08` |

A última linha é a que importa: 14 dígitos que **não** são CNPJ válido devem ser
rejeitados.

---

## 4. Problemas por inspeção — confirme antes de corrigir

Não foram executados. Verifique cada um em vez de assumir.

1. **Delivery órfã em `enqueueDue`** (`dispatcher.ts`): o código faz
   `UPDATE ... status = 'QUEUED'` e depois `sendQueue.add()`. Se o `add` falhar
   (Redis fora do ar), a linha fica `QUEUED` para sempre e nada a recupera —
   `enqueueDue` só busca `SCHEDULED`. Resolva com um varredor de `QUEUED` parado
   há mais de N minutos, ou invertendo a ordem. Decida e documente qual.
2. **Consentimento inconsistente**: o schema permite `Consent` com
   `status: GRANTED` e `revokedAt` preenchido ao mesmo tempo, e o dispatcher só
   filtra por `status`. Escolha uma fonte de verdade única.

---

## 5. O que construir, em ordem

### Etapa 1 — fazer rodar ✅

Feito. `src/app/layout.tsx` e `src/app/page.tsx` mínimos criados nos commits
anteriores. `npm run dev` sobe e responde em localhost:3000.

### Etapa 2 — provar o envio de ponta a ponta ✅ (até o limite de credenciais reais)

Implementado e testado localmente nesta sessão contra Postgres e Redis reais
(subidos no próprio ambiente — `service postgresql start` + `redis-server
--daemonize yes`). **Não há R2 nem Meta reais disponíveis aqui**, então a
etapa foi verificada até esse limite; falta rodar com credenciais reais para
o aceite completo ("guia chega num WhatsApp real").

O que foi construído:
- `prisma/migrations/20260909180050_init/` — primeira migration, com o
  `REVOKE UPDATE, DELETE ON "AuditLog" FROM PUBLIC;` que o `CLAUDE.md` exige.
- `prisma/seed.ts` — tenant fixo, cliente com consentimento concedido,
  `WhatsAppAccount` com token cifrado (usa `WHATSAPP_WABA_ID` /
  `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` do ambiente; sem eles
  grava placeholders e avisa). Rode com `npm run db:seed`.
- `src/app/api/webhooks/whatsapp/route.ts` — `GET` responde o desafio de
  verificação; `POST` valida `X-Hub-Signature-256` com `timingSafeEqual` antes
  de processar, responde 200 e processa os `statuses[]` via `queueMicrotask`
  (fora do ciclo do request). Grava `DeliveryEvent`, atualiza
  `sentAt`/`deliveredAt`/`readAt`, nunca regride o status, e dedupa reentrega
  do mesmo evento (mesma `delivery` + `type` + `timestamp` do payload).
- `src/lib/db.ts`, `src/lib/queue.ts`, `src/lib/dispatch.ts` — extraídos de
  `dispatcher.ts` para serem compartilhados entre o worker e a rota web
  (`claimAndEnqueue` reaplica as duas travas contra envio duplicado — trava
  de `status` e `idempotencyKey` — tanto no varredor de agendamento quanto no
  botão "enviar agora").
- `src/app/page.tsx` + `src/app/actions.ts` — formulário com seletor do
  cliente (do seed) e upload de PDF; a *server action* `sendNow` sobe o
  arquivo pro storage, cria `Document` + `Delivery` (`scheduledAt` = agora) e
  o audit log na mesma transação, e manda pra fila.

Dois bugs achados **por execução** (não por inspeção) e corrigidos:
1. **Regressão de status no webhook.** `STATUS_RANK` comparava `delivery.status`
   (vem em maiúsculas do enum do Prisma — `"READ"`) contra chaves minúsculas
   (`sent`/`delivered`/`read`). O rank atual sempre caía no fallback `0`, então
   um evento `delivered` atrasado sobrescrevia um `READ` já gravado — exatamente
   o que este documento pede pra nunca acontecer. Confirmado enviando a
   sequência `delivered → read → delivered(atrasado)` pro webhook local e
   vendo o status voltar pra `DELIVERED`; corrigido usando chaves maiúsculas
   no mapa, reexecutado, e o status ficou em `READ` como deveria.
2. **`npm run worker` não carregava `.env`.** O `next dev` carrega `.env`
   sozinho; o `tsx src/workers/index.ts` não. O worker subia e tentava
   conectar no Postgres sem `DATABASE_URL`, caindo pra um usuário/banco padrão
   e levando "acesso negado". Corrigido com `import "dotenv/config"` como
   primeiro import de `src/workers/index.ts`.

Testado e confirmado com o pipeline completo local (`enqueueDue` reivindica a
`Delivery` `SCHEDULED`, o worker processa, chama `getObject`/Cloud API): falha
exatamente na chamada ao R2 (`R2_ACCOUNT_ID não definida`), que é a fronteira
esperada sem credencial real — nenhuma linha órfã ficou no banco.

`npm run build` também passa; `/` precisou de `export const dynamic =
"force-dynamic"` porque lê o banco a cada request e o Next ia
pré-renderizá-la como estática no build, congelando os dados.

**Falta para o aceite 100%:** credenciais reais da Meta (`WHATSAPP_WABA_ID`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, template aprovado
`envio_guia_fiscal` categoria UTILITY) e do R2 (`R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`), rodar o seed de novo
com elas, subir `npm run dev` + `npm run worker`, e clicar "enviar agora" de
verdade.

### Etapa 3 — o produto  ← ATUAL

- Upload de pasta inteira via `<input type="file" webkitdirectory />`.
- Matching automático pelo `parseFilename`; o que não casar vai para fila de
  revisão manual.
- Agendamento por regra ("dia 20", "3 dias úteis antes do vencimento"), com
  calendário de feriados.
- Tela de log lendo `AuditLog` e `DeliveryEvent`.

---

## 6. Como reportar

Ao terminar cada etapa, diga:

1. O que você **executou** para verificar (comando e saída), separado do que
   apenas leu.
2. Quais itens da seção 4 se confirmaram e quais não.
3. O que ficou faltando.

Vale notar: dos problemas listados como "não verificados" na versão anterior
deste documento, dois se confirmaram, um estava descrito com a causa errada, e
três problemas reais não estavam listados. Verificar de fato importa.
