# HANDOFF — plano de trabalho

Contexto do produto, stack e regras invioláveis estão no `CLAUDE.md`. **Leia-o
primeiro.** Este documento é só a ordem de trabalho.

Estado: `npm run typecheck` passa limpo. `npm run dev` **ainda falha** — não
existe `src/app/`.

Última atualização: 03/09/2026, depois de uma revisão externa que apontou 8
problemas. Cinco foram corrigidos nesta rodada (itens 4, 5, 6, 7a do relato —
ver seção 2). **Achado importante: a revisão descrevia um commit anterior
que corrige falso positivo de código de barras no `filename.ts` como já
aplicado — não está. Ver seção 2.1.**

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

### Etapa 1 — fazer rodar  ← ATUAL

Falta só o app Next. Crie `src/app/layout.tsx` e `src/app/page.tsx` mínimos.
O Next 16 sobe sem `next.config.mjs`; só crie um se precisar de configuração.
Lembre que `package.json` tem `"type": "module"`.

Aceite: `npm run dev` sobe e responde em localhost:3000. (`npm run typecheck`
limpo já está feito.)

### Etapa 2 — provar o envio de ponta a ponta

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

Antes disso vai ser preciso rodar a primeira migration (`npm run db:migrate`),
que exige um Postgres de verdade — hoje o `.env` aponta para um localhost que
pode não existir.

Aceite: uma guia real chega num WhatsApp real e o banco registra
`sent` → `delivered`.

### Etapa 3 — o produto

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
