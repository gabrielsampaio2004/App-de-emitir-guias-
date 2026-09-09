# HANDOFF — plano de trabalho

Contexto do produto, stack e regras invioláveis estão no `CLAUDE.md`. **Leia-o
primeiro.** Este documento é só a ordem de trabalho.

Estado: `npm run typecheck` passa limpo. `npm run dev` sobe e responde (Etapa 1
concluída). Etapa 2 (envio de ponta a ponta) está implementada e verificada
localmente — falta só a validação com Meta/R2 reais, que este ambiente não
alcança (ver seção 5, Etapa 2).

Última atualização: 09/09/2026. Implementada a Etapa 2 inteira (migration
real, webhook com validação de assinatura, seed, upload + "enviar agora").
Ver seção 5 para o relato completo. **A seção 2.1 (achado sobre o "já feito"
que não estava no `filename.ts`) continua válida e sem novidade** — não foi
mexida nesta rodada.

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

Nenhum nos módulos tocados nesta rodada (`whatsapp/`, `workers/dispatcher.ts`)
— ver "Corrigido nesta rodada" abaixo. **`filename.ts` tem um bug real e
mensurado (falso positivo de 46,9% em código de barras) que segue sem
correção** — ver 2.1.

### Corrigido nesta rodada (itens 4, 5, 6, 7a da revisão externa)

Verificado com um script de integração ad hoc (não versionado — não há test
runner no projeto) rodando contra Postgres e Redis locais reais, com
`fetch`/`S3Client` mockados. 34/34 asserções passaram. Comando: `npx tsx
<script>` a partir da raiz do projeto, com `prisma db push` (não uma
migration real — não existe nenhuma neste repo ainda, ver Etapa 2) para
sincronizar o schema num Postgres local.

- **Item 4 — `idempotencyKey` nunca era usado** (`src/lib/whatsapp/provider.ts`,
  `meta-cloud.ts`, `dispatcher.ts`). Confirmado: a Cloud API não tem chave de
  idempotência no `/messages` (só dedupe de webhook por `messages[].id`/
  `statuses[].id`, entrega at-least-once) — não consegui confirmar direto na
  doc oficial porque `developers.facebook.com`/`developers.meta.com` estão
  bloqueados pelo proxy de rede desta sessão; a conclusão vem de busca +
  conhecimento treinado convergindo com a mesma leitura que a revisão já
  tinha feito. As duas armadilhas descritas (repassar a chave pra Meta,
  consultar a Meta pra saber se saiu) seguem descartadas pelo mesmo motivo
  já levantado.

  Removido `idempotencyKey` de `SendDocumentParams` — não tinha uso real ali,
  só o comentário mentindo. A deduplicação real continua sendo o `jobId` do
  BullMQ (`sendQueue.add`) e a `@unique` do schema; agora está dito
  explicitamente na interface.

  Implementado: `MetaCloudProvider.sendDocument` grava e retorna o
  `providerMessageId` só quando a Meta confirma com 2xx **e** um
  `messages[0].id` (item 7a). No `dispatcher.ts`, assim que `sendDocument`
  retorna, uma escrita mínima (`status: SENT`, `waMessageId`, `sentAt`) grava
  ANTES da transação de evento+auditoria, isolada dela. Daquele ponto em
  diante o worker nunca mais relança erro — se a transação de
  evento/auditoria falhar depois, o envio já está protegido contra
  duplicidade (só faltou o registro do evento, logado via `console.error`).

  **O que cobre:** falha da transação de auditoria/evento depois do envio ter
  sucesso confirmado (o caminho de reenvio duplo original: sucesso → transação
  falha → catch marcava QUEUED → throw → BullMQ tentava de novo).

  **O que fica descoberto — dito explicitamente, não escondido:** se a rede
  cair NO MEIO do fetch para `/messages` (a requisição sai mas a resposta não
  volta), não há como saber se a Meta processou o envio, e não há como saber
  nunca. Convertido em `WhatsAppError` com `retryable: false` — decisão
  FALHAR FECHADO: não reenviar, `status: FAILED` com `lastError` explicando a
  ambiguidade, para conferência humana. O mesmo tratamento foi aplicado ao
  corpo da resposta não parsear como JSON depois de um 2xx. Isso reduz o dano
  (não duplica) mas não elimina a ambiguidade — ela é irredutível a partir daqui.

  Achado à parte, fora do escopo do item mas na mesma região de código:
  `delivery.tenant.waAccount!` (non-null assertion) virava `TypeError` não
  capturado ANTES do `try/catch` do worker — nem chegava a marcar `SENDING`,
  ficava `QUEUED` para sempre sem `lastError`, silenciosamente. Trocado por um
  guard explícito que marca `FAILED` na hora, sem gastar as 5 tentativas do
  BullMQ.

- **Item 5 — varredura de entregas presas** (`recoverStuckDeliveries()` em
  `dispatcher.ts`, chamada a cada tick em `workers/index.ts` junto com
  `enqueueDue`). Distingue os três estados consultando o job no BullMQ pelo
  `idempotencyKey` (que já é o `jobId`):
  - `QUEUED` sem job vivo (nulo, ou `state === "failed"` — tentativas
    esgotadas): pela construção do worker acima, só se chega em `QUEUED` via
    `throw` quando a falha foi ANTES do envio ter sucesso — nada saiu.
    Reenfileira (`sendQueue.add` se não existe job, `job.retry()` se
    esgotou tentativas).
  - `SENDING` sem job vivo: o worker morreu no meio de uma tentativa,
    resultado desconhecido. NÃO reenfileira — marca `FAILED` com
    `lastError` explicando que precisa de conferência manual.
  - `FAILED` não entra na varredura (terminal).
  - Um job em estado `active`/`waiting`/`delayed`/`waiting-children`/
    `prioritized` não é tocado em nenhum dos dois casos — o BullMQ ainda
    pode estar cuidando dele.

  O comentário em cima do `db.delivery.update({ data: { status: "SENDING"
  ... } })` foi reescrito para declarar o invariante que ele protege (é a
  única escrita garantida antes do envio sair, e é o que diferencia "não
  tentamos" de "tentamos, não sei o resultado"), não o mecanismo — para que
  uma refatoração futura que mova essa escrita "para economizar uma
  chamada" tenha que confrontar o comentário, não só o código.

- **Item 6 — consentimento**: a consulta em `dispatcher.ts` agora exige
  `status: "GRANTED"` **e** `revokedAt: null` juntos (não um dos dois
  isoladamente) — se um bug futuro em algum caminho de escrita deixar só um
  dos dois campos desatualizado, o efeito é deixar de enviar, nunca enviar a
  mais. Adicionado `orderBy: { grantedAt: "desc" }` para pegar o registro
  mais recente quando há histórico de revogação/reconcessão.

- **Item 7a** — coberto dentro do item 4 acima (guard contra
  `messages[0].id` ausente vira `WhatsAppError` não retryable em vez de
  `TypeError` não tratado).

**Exceção deliberada ao CLAUDE.md, documentada no próprio código
(`dispatcher.ts`):** a regra "grave a auditoria na mesma transação da ação"
foi quebrada de propósito só nesse ponto. Gravar `status: SENT` +
`waMessageId` e o `DeliveryEvent`/`AuditLog` na mesma transação reabre
exatamente a janela de reenvio duplo que o item 4 existe para fechar (a
transação inteira falha → catch original marcava `QUEUED` → reenvio). O
preço é uma janela minúscula em que o envio está confirmado mas o evento/log
ainda não. Sinalizando aqui porque a regra é do CLAUDE.md e mudar seu
comportamento sem dizer seria contornar em silêncio.

---

### 2.1 Achado: o "já feito" da revisão externa não está no repositório

A revisão externa que gerou os itens acima descrevia um commit anterior,
já aplicado antes desta rodada, corrigindo três coisas em
`src/lib/matching/filename.ts`:
1. Falso positivo de código de barras (janela deslizante → segmentação por
   pontuação), medido em 46,91% → 0,00% falsos positivos em 44 dígitos.
2. Competência: reconhecimento de `AAAAMM` colado e priorização de
   competência marcada explicitamente sobre vencimento.
3. `extractKind` retornando pela ordem de aparição na string, não pela ordem
   da lista `KINDS`.

**Conferido e não está no código.** `git log --all -- src/lib/matching/filename.ts`
(incluindo `origin/main` e todas as branches, depois de `git fetch`) mostra
só dois commits: `9dfc138` (restauração da estrutura do projeto) e `0748c63`
(migração pro Prisma 7 — só corrigiu bugs de typecheck, não a lógica de
matching). O arquivo atual ainda usa a janela deslizante original
(`s.match(/[\d.\-\/]{11,}/g)` seguido de um loop testando todo `i` dentro do
bloco), `extractCompetencia` não tem nenhum tratamento de "comp" explícito, e
`kind` em `parseFilename` usa `KINDS.find(...)`, que segue a ordem do array,
não a ordem de aparição. Este próprio `HANDOFF.md`, na versão anterior a esta
atualização, também não mencionava esse commit — só a lista em "1. Feito" já
documentada aqui, que é outra coisa.

Não tentei corrigir isso por conta própria: (a) a instrução desta rodada foi
explícita — "NUNCA reabra o filename.ts nas partes marcadas como já feitas" —
e mexer aqui exigiria decidir se essa instrução ainda vale sobre um trabalho
que não existe; (b) os cinco itens que eu de fato tinha mandato pra fazer
(4, 5, 6, 7a, e as pendências/item 3 que dependem deste) são independentes
dos arquivos de `whatsapp/`/`workers/` que toquei, então terminá-los não
ficou bloqueado; (c) o "falso positivo de código de barras" é um bug de
produto real e sério (mascara documento identificável como trabalho manual,
em silêncio) — implementá-lo de cabeça, sem confirmação, arriscava duplicar
ou conflitar com um trabalho que pode estar em andamento em outra sessão/branch.

**Por causa disso, não fiz as "pendências de baixa prioridade" do commit
anterior (comentários que citam esse fix) nem o item 3 (CNPJ alfanumérico) —
ambos partem da premissa de que a segmentação por grupos já existe.** Ver
seção 4 abaixo.

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

Os dois itens que estavam aqui (delivery órfã em `enqueueDue`, consentimento
inconsistente) foram resolvidos nesta rodada — ver seção 2 (itens 5 e 6).

Pendente, bloqueado pelo achado da seção 2.1 (não fiz por depender de um fix
que não existe no repo — decidir isso é chamada de quem prioriza o trabalho,
não algo pra eu assumir sozinho):

1. **Falso positivo de código de barras em `filename.ts`** (46,91% medido em
   44 dígitos) — descrito como já corrigido, não está. Precisa da
   segmentação por pontuação (só combinar grupos INTEIROS e contíguos) em vez
   da janela deslizante atual. Depois disso, dois refinamentos de baixa
   prioridade ficam disponíveis (documentados na revisão original): casar o
   FORMATO dos grupos de CPF/CNPJ (mata linha digitável e CNJ, não mata o
   grupo solto de 14 dígitos — resíduo irredutível a partir do nome do
   arquivo) e corrigir dois comentários que hoje superestimam o dano do bug
   antigo (dizem "manda pro cliente errado"; o dano real é mascarar o
   documento certo, não misturar clientes — `clientId` fica `null` e vai pra
   revisão manual).
2. **CNPJ alfanumérico** (IN RFB nº 2.229/2024, vigente desde 31/07/2026):
   `extractDocument` e `isValidCNPJ` são puramente numéricos, então um CNPJ
   alfanumérico no nome do arquivo devolve `document: null` (cai em revisão
   manual — modo de falha seguro, por isso é baixa prioridade). Corrigir só o
   parser não basta: `Client.document` no schema está comentado como "só
   dígitos" e o matching compara contra ele — os dois lados precisam mudar
   juntos. Confirmar se guardar letras no campo (já é `String`) realmente
   dispensa migration antes de mexer.

---

## 5. O que construir, em ordem

### Etapa 1 — fazer rodar ✅ concluída

`src/app/layout.tsx` e `src/app/page.tsx` existiam desde antes desta rodada
(commits `e87aa49`/`c7cb484`, anteriores à sessão que corrigiu os itens 4-7a —
o HANDOFF ficou desatualizado dizendo que faltava fazer isso; confirmado por
execução: `npm run dev` sobe com Turbopack e responde 200 em localhost:3000).

### Etapa 2 — provar o envio de ponta a ponta ✅ implementada e verificada localmente

**O que foi construído:**
- **Migration real** — `prisma/migrations/20260903183454_init/`. Gerada com
  `prisma migrate dev --create-only` e editada à mão pra incluir
  `REVOKE UPDATE, DELETE ON "AuditLog" FROM PUBLIC;` no final (regra do
  CLAUDE.md). **Ressalva importante, documentada como comentário na própria
  migration:** REVOKE não tem efeito sobre roles `SUPERUSER` — o Postgres
  ignora GRANT/REVOKE pra elas. Em dev local, a role usual (`postgres`) é
  superuser, então essa trava fica sem efeito observável ali. Testei isso na
  prática: criei uma role comum, dei só `SELECT, INSERT` na `AuditLog`, e um
  `DELETE` por essa role deu `permission denied for table AuditLog` — a trava
  funciona. **Mas isso só protege de verdade se, em produção, a role da
  aplicação NÃO for superuser.** Se ninguém decidir isso explicitamente, a
  trava do CLAUDE.md existe só no papel.
- **`prisma/seed.ts`** (+ `migrations.seed` em `prisma.config.ts`, rodável via
  `npx prisma db seed`) — cria um tenant fixo e um cliente (CPF/CNPJ de teste,
  conferidos contra o `isValidCPF`/`isValidCNPJ` do próprio projeto antes de
  escrever o arquivo) e o `Consent` `GRANTED`. Exige `SEED_CLIENT_PHONE` (não
  inventa número). Só cria `WhatsAppAccount` se `SEED_WA_WABA_ID`,
  `SEED_WA_PHONE_NUMBER_ID`, `SEED_WA_DISPLAY_PHONE` e `SEED_WA_ACCESS_TOKEN`
  vierem no ambiente — nunca pede nem inventa credencial da Meta.
- **`src/app/api/webhooks/whatsapp/route.ts`** — `GET` responde o desafio
  (`hub.mode`/`hub.verify_token`/`hub.challenge`) comparando o token com
  `timingSafeEqual`. `POST` confere `X-Hub-Signature-256` com HMAC-SHA256 +
  `timingSafeEqual` sobre o corpo bruto (`request.text()`, antes de qualquer
  `JSON.parse`) — sem assinatura válida, `401` direto, nada é processado.
  Assinatura válida → enfileira na fila `webhook-events` e responde `200`
  imediatamente; quem escreve no banco é o worker separado, fora do request.
- **`src/lib/whatsapp/webhook.ts`** — `verifySignature`, `extractStatusEvents`
  (parsing tolerante do payload da Meta) e `nextDeliveryStatus` (a regra de
  não regressão: `sent < delivered < read`; `failed` só é aceito se a entrega
  ainda não passou de `sent` — um `failed` atrasado depois de `delivered`/`read`
  é ignorado).
- **`src/workers/webhook-dispatcher.ts`** — worker que consome `webhook-events`:
  acha o `Delivery` pelo `waMessageId`, grava um `DeliveryEvent` bruto pra
  TODO evento recebido (inclusive duplicata/fora de ordem — é o histórico
  técnico), e só avança `status`+timestamp+`AuditLog` (na mesma transação,
  seguindo a regra do CLAUDE.md — aqui não tem o conflito que forçou a exceção
  no item 4, porque não há reenvio em jogo) quando `nextDeliveryStatus`
  autoriza. Zero matches pelo `waMessageId` → loga aviso e segue (pode ser
  webhook de outro ambiente). Mais de um match → **achado**: `waMessageId` não
  é `@unique` no schema; se algum dia acontecer, o worker loga erro e não
  adivinha qual atualizar, mas o schema não impede a ambiguidade acontecer. Não
  mudei o schema pra corrigir isso — é a mesma cautela da rodada anterior com
  schema, fica registrado aqui em vez de mexido em silêncio.
- **`src/lib/db.ts`** — `PrismaClient` compartilhado (cacheado em `globalThis`
  em dev) pras rotas do Next, pra não abrir conexão nova a cada hot-reload.
- **`src/app/api/clients/route.ts`** (`GET`) e **`src/app/api/deliveries/route.ts`**
  (`GET`/`POST`) — o `POST` recebe o PDF direto (multipart), sem matching
  automático (isso é Etapa 3): valida cliente e consentimento ativo (mesma
  regra do item 6 — `status GRANTED` **e** `revokedAt: null`), sobe pro R2
  (`putObject`), cria `Document` (a trava `@@unique([tenantId, sha256])` do
  schema faz o trabalho de impedir reenvio do mesmo arquivo — testei, dá
  `409`) e um `Delivery` já `SCHEDULED` pra agora. **Não enfileira na hora** —
  quem pega isso é o `enqueueDue()` do worker, no tick seguinte (até 60s). Não
  criei um caminho de disparo imediato porque isso exigiria a rota da web
  importar `dispatcher.ts`, que tem `export const dispatcher = new Worker(...)`
  como efeito colateral de módulo — importar isso no processo do Next faria o
  processo web também processar a fila de envio, misturando os dois processos
  que o CLAUDE.md separa de propósito (`workers/index.ts` é o processo do
  worker). Troquei imediatismo por manter a separação de processos; se o botão
  "enviar agora" precisar ser realmente instantâneo, isso é decisão de
  arquitetura pra discutir, não algo pra eu resolver sozinho.
- **`src/app/enviar/page.tsx` + `UploadForm.tsx`** — UI mínima: lista clientes
  (via `/api/clients`), formulário com seleção de cliente, tipo (dropdown dos
  `KINDS`), competência, vencimento e o PDF. Não toquei em `src/app/page.tsx`
  (raiz, já validado na Etapa 1).
- `src/workers/index.ts` agora também sobe e fecha o `webhookDispatcher`/`webhookQueue`
  junto com o `dispatcher`/`sendQueue` existentes.

**O que NÃO foi implementado, de propósito:** autenticação (`better-auth` seguia
sem uso antes desta rodada e continua assim — o enunciado da Etapa 2 no HANDOFF
não pede login, só "tenant fixo em seed, cliente cadastrado na mão", e
implementar auth de verdade é escopo bem maior que isso pediu).

**O que executei pra verificar** (tudo com Postgres 16 e Redis 7 locais, subidos
nesta sessão via `pg_ctlcluster`/`redis-server`):
1. `npx prisma migrate dev --create-only` + edição manual do SQL + `npx prisma migrate dev`
   → migration aplicada de verdade num banco limpo (`guiazap`, recriado do
   zero pra isso). Confirmei o `REVOKE` funcionando com uma role de teste
   não-superuser (`permission denied for table AuditLog` num `DELETE`).
2. `SEED_CLIENT_PHONE=... npx prisma db seed` → rodou via
   `prisma.config.ts`/`migrations.seed`, criou tenant+client+consent,
   confirmou que não cria `WhatsAppAccount` sem as credenciais.
3. Script de integração ad hoc (não versionado, mesma prática das rodadas
   anteriores — não há test runner) rodando os módulos de verdade (rotas do
   Next chamadas diretamente como funções, `dispatcher.ts`,
   `webhook-dispatcher.ts`) contra um banco de teste clonado do schema
   migrado, com `fetch` e `S3Client.prototype.send` mockados — as duas únicas
   dependências externas que este ambiente não alcança (ver item 6 abaixo).
   **24/24 asserções passaram**, cobrindo: listagem de clientes; upload
   bloqueado por falta de consentimento (`422`, nada gravado); upload +
   dedup por sha256 (`409` na segunda vez); `enqueueDue` + dispatcher enviando
   de verdade (`SENT` + `waMessageId`); desafio `GET` do webhook (token certo
   e errado); `POST` com assinatura inválida ou ausente (`401`, nada
   alterado); progressão `SENT → DELIVERED → READ`; evento duplicado
   (idempotente, não regride, mas fica registrado no `DeliveryEvent`);
   evento atrasado chegando depois de um mais avançado (`delivered` depois de
   `read` — ignorado, não regride); `waMessageId` desconhecido (`200`, loga
   aviso, não quebra).
4. `npm run dev` real (não o script) contra o banco `guiazap` migrado e
   seedado: `/` → 200, `/enviar` → 200, `/api/clients` → retornou o cliente
   seedado de verdade, `GET` do webhook sem `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   configurado → 403 (falha fechada por padrão, não abre sozinho).
5. `npm run worker` real: sobe, loga `[worker] iniciado`, responde a
   `SIGTERM` com desligamento gracioso dos dois workers.
6. `npm run typecheck` limpo em todos os passos.

**O que este ambiente não consegue validar** (mesma limitação já registrada na
checagem de prontidão): chamada real a `graph.facebook.com` e
`cloudflarestorage.com` — bloqueadas pelo proxy de rede desta sessão. Ou seja,
a lógica de negócio inteira (envio, webhook, não-regressão, idempotência) está
provada; o que falta é literalmente só a Meta e o R2 responderem de verdade —
isso precisa acontecer fora deste ambiente, com credenciais reais, antes de
considerar a Etapa 2 fechada de fato. O critério de aceite original ("uma guia
real chega num WhatsApp real") continua pendente por esse motivo, não por
falha de implementação.

Artefatos de teste (bancos `guiazap_test`, script `.scratch-*.mts`, role de
teste no Postgres) foram todos limpos/removidos ao final — não sobra nada
fora do que está listado acima como criado.

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

Reforçado na rodada de 03/09: o mesmo vale para trabalho descrito como "já
feito". Ver seção 2.1 — um commit inteiro que a revisão externa deu como
aplicado não existe neste repositório. Confirmar antes de assumir "já feito"
importa tanto quanto confirmar antes de assumir "bug real".
