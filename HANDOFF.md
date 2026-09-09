# HANDOFF — plano de trabalho

Contexto do produto, stack e regras invioláveis estão no `CLAUDE.md`. **Leia-o
primeiro.** Este documento é só a ordem de trabalho.

Estado: `npm run typecheck` passa limpo. `npm run dev` sobe. `npm run build`
passa limpo (todas as rotas dinâmicas). Etapas 2 e 3 implementadas e
verificadas localmente (Postgres/Redis reais neste ambiente, sem R2/Meta
reais — ver seção 5).

Última atualização: 09/09/2026, etapa 3.

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
(dois na etapa 2, um na etapa 3 — ver seção 5). O que
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

### Etapa 3 — o produto ✅ (até o limite de credenciais reais)

Implementada e testada localmente (Postgres/Redis reais, sem R2/Meta reais —
mesma fronteira da etapa 2). Três decisões de produto que não estavam
escritas foram tomadas com o usuário antes de mexer no schema — registradas
aqui porque não têm como ficar óbvias só lendo o código:

1. **Regra de agendamento por tenant** (não por cliente, não por tipo de
   guia). Cada tenant tem uma regra só, configurável em `/configuracoes`:
   `FIXED_DAY` ("todo dia N do mês") ou `BUSINESS_DAYS_BEFORE_DUE` ("N dias
   úteis antes do vencimento").
2. **Só feriado nacional** no cálculo de dia útil — sem estadual/municipal.
   Cobre menos caso, mas não arrisca inventar feriado errado pro município
   do cliente (`src/lib/scheduling/holidays.ts`, com Páscoa calculada e
   Sexta-feira Santa; Carnaval e Corpus Christi ficam de fora de propósito
   por não serem feriado nacional por lei).
3. **A data de vencimento (`dueDate`) é confirmada pelo contador na fila de
   revisão**, não extraída/inferida do nome do arquivo ou do tipo da guia.
   `parseFilename` não muda: continua só `document`/`kind`/`competencia`.
   Chutar vencimento por tipo de guia (DAS/DARF/FGTS têm regras diferentes,
   às vezes municipais) arriscava mandar guia fora da data — dinheiro de
   verdade, mesmo raciocínio da regra "nunca chute o cliente".

O que foi construído:
- **`prisma/migrations/20260909182637_etapa3_schedule_rule/`** — campos de
  regra no `Tenant` (`scheduleRuleType`, `scheduleRuleFixedDay`,
  `scheduleRuleBusinessDaysBefore`).
- **`src/lib/scheduling/holidays.ts`** — feriado nacional (fixo + Sexta-feira
  Santa via algoritmo de Meeus/Jones/Butcher pra Páscoa) e dias úteis, tudo
  em UTC pra não pegar bug de fuso na virada do dia. Conferido manualmente:
  Sexta-feira Santa 2026 = 3/abr (Páscoa 5/abr), 7/set (Independência) cai
  numa segunda e não é dia útil, 3 dias úteis antes de 7/set/2026 = 2/set.
- **`src/lib/scheduling/rule.ts`** — traduz a regra do tenant + o vencimento
  numa data de envio. `FIXED_DAY`: dia N do mês do vencimento, ou do mês
  anterior se esse dia já passou do vencimento; sem ajuste de dia útil (se
  cair em fim de semana/feriado, o `enqueueDue` pega no tick seguinte, só
  atrasa minutos, não perde o envio).
- **`src/lib/matching/client.ts`** — matching automático por CPF/CNPJ
  (`parseFilename` + busca por `tenantId`+`document`+`active`), reaproveitado
  tanto no upload em lote quanto (implicitamente) na revisão manual.
- **`src/app/lote/`** — upload de pasta inteira (`webkitdirectory`, `multiple`
  no input). Cada arquivo é isolado num try/catch (duplicado, não-PDF, ou
  erro de storage não derruba o lote inteiro); documento sem match cai com
  `clientId = null`. Não cria `Delivery` — só o `/revisao` faz isso.
- **`src/app/revisao/`** — fila de tudo que ainda não tem `Delivery`
  (`deliveries: { none: {} }`). Confirma cliente + vencimento, calcula
  `scheduledAt` pela regra do tenant, grava `Document` + `Delivery` + audit
  na mesma transação. Não chama `claimAndEnqueue`: `scheduledAt` normalmente
  é no futuro, quem manda pra fila do BullMQ na hora certa é o `enqueueDue`
  do worker, igual qualquer outra `Delivery` agendada.
- **`src/app/configuracoes/`** — formulário pra trocar a regra do tenant.
- **`src/app/log/`** — leitura de `AuditLog` e `DeliveryEvent`, só leitura.
- **`src/app/clientes/`** — ativar/desativar cliente. O campo `Client.active`
  existia no schema desde o começo mas não tinha nenhuma tela; a coluna
  "guias agendadas" mostra o que você perde ao desativar. Desativar **não**
  cancela na hora as `Delivery`s já agendadas: quem garante que nada sai é o
  `dispatcher`, que recusa cliente inativo no momento do envio (mesma lógica
  do consentimento revogado). Reativar não ressuscita o que já foi cancelado.
- Nav simples em `layout.tsx` ligando as seis telas.

**Auditoria depois de entregar a tela de clientes** (o usuário pediu pra
verificar tudo de novo): reli `dispatcher.ts`, `actions.ts` da home e
`revisao/actions.ts` com foco no que mudou. Dois problemas reais, os dois
corrigidos:
1. **`sendNow` e `confirmDocument` não checavam `client.active` no
   servidor** — só o `<select>` da tela filtra cliente ativo. Uma aba
   desatualizada (ou um POST direto) com um cliente já desativado criava
   `Document`+`Delivery` normalmente; o `dispatcher` cancelava certinho no
   momento do envio (a trava que importa pro dinheiro continuava valendo),
   mas o contador via o formulário "dar certo" e a guia nunca saía, sem
   nenhum aviso na hora. Corrigido com uma checagem explícita nas duas
   actions, que agora rejeitam na hora com "Este cliente está desativado".
   Reproduzido injetando uma `<option>` de cliente inativo no `<select>` via
   DOM (simulando página desatualizada) nos dois formulários: os dois
   lançaram o erro e nenhum `Document`/`Delivery` foi criado.
2. **`dispatcher`: no caminho de falha (`catch` do envio), o `Delivery.update`
   e o `DeliveryEvent.create` não estavam na mesma transação** — dois writes
   separados, herdados da etapa 2 sem que eu tivesse notado antes. Um crash
   do processo entre os dois deixaria o status mudado sem o evento
   correspondente registrado. Não é o `AuditLog` (a regra do `CLAUDE.md` é
   sobre isso, e essa continuava valendo — esse caminho nunca chamou
   `audit()`), mas é o mesmo princípio. Corrigido envolvendo os dois num
   `$transaction`, igual o caminho de sucesso já fazia.

**Bug achado por execução (não por inspeção) e corrigido:** testando o fluxo
de revisão no navegador, uma aba com a página desatualizada conseguiu confirmar
o mesmo `Document` duas vezes — duas `Delivery`s pro mesmo documento, cada uma
com `idempotencyKey` diferente, então a trava de `jobId` do BullMQ não pegava
(pra ela são dois envios "diferentes"). Isso é exatamente o que a regra
"nunca envie duas vezes" do `CLAUDE.md` proíbe. Corrigido com
`@@unique([documentId])` no `Delivery` (migration
`20260909190000_delivery_document_unique`) — mesma filosofia das outras
travas do projeto (trava no banco, não só na aplicação). Reproduzido de
propósito com duas abas confirmando o mesmo documento quase ao mesmo tempo:
só uma `Delivery` foi criada, a segunda tentativa voltou com "Este documento
já foi agendado — atualize a página." Confirmado direto no `/log` depois:
uma linha `delivery.scheduled` só. **Limitação conhecida:** o Next não
propaga essa mensagem pro formulário na tela (erro de Server Action sem
`useActionState` vira uma tela de erro genérica) — a integridade dos dados
está garantida pela constraint, mas a UX do erro podia ser melhor.

Testado via navegador de verdade (Chromium headless), não só por tipo:
upload em lote (2 arquivos, um com CPF válido que bateu automático com o
cliente do seed, outro com CPF de dígito verificador inválido que caiu como
"não reconhecido"), confirmação na fila de revisão com cálculo de
`scheduledAt` nos dois ramos da regra `FIXED_DAY` (dia-do-vencimento-ainda-
não-passou e caiu-no-mês-anterior), e a tela de log mostrando a trilha
completa.

**Falta para o aceite 100%:** as mesmas credenciais reais de R2/Meta da
etapa 2 — o upload em lote para exatamente no `putObject` (`R2_ACCOUNT_ID
não definida`), mesma fronteira, sem linha órfã no banco.

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
