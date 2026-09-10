# HANDOFF — plano de trabalho

Contexto do produto, stack e regras invioláveis estão no `CLAUDE.md`. **Leia-o
primeiro.** Este documento é só a ordem de trabalho.

Para *executar* o que ainda falta, veja o `EXECUCAO.md`: ele detalha cada
etapa aberta com aceite, armadilhas e as decisões já tomadas. É um arquivo
descartável — quando as etapas fecharem, o registro volta para cá e ele é
apagado.

Estado: `npm run typecheck`, `npm run build` e `npm test` passam limpos
(todas as rotas dinâmicas; 20 testes, `node:test` nativo). Etapas 1, 2 e 3
implementadas e verificadas contra Postgres, Redis e **R2 reais**. Para o
aceite ponta a ponta falta só o lado da Meta (seção 5). Sem bug sério aberto
no caminho do envio — Etapas A, C e D do `EXECUCAO.md` fechadas em sessões
anteriores: A (envio duplicado) na seção 4, C (testes automatizados) na
seção 3, D (nome do template configurável) na seção 5 (Etapa 2).

Última atualização: 10/09/2026 — reverificado nesta sessão (`npm run
typecheck`, `npm test`, `npm run build` limpos); nenhum código mudou desde a
Etapa D, só esta checagem.

---

## 0. Subir o projeto numa máquina nova

Levantado rodando de verdade num Debian 13 com Postgres 17. Na ordem:

```bash
cp .env.example .env

# Postgres: o .env conecta por TCP com senha, mas o pacote Debian instala
# com autenticação peer e sem senha no usuário postgres. Sem este ALTER, a
# conexão falha mesmo com o banco criado.
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres createdb guiazap
psql "postgresql://postgres:postgres@localhost:5432/guiazap" -c "SELECT 1;"

# Chave que cifra o accessToken da Meta. O seed falha sem ela.
# GUARDE: trocar depois de semear torna o token no banco indecifrável.
openssl rand -hex 32   # cole em ENCRYPTION_KEY no .env

sudo apt install -y redis-server && sudo systemctl enable --now redis-server

npm install
npm run db:deploy   # aplica as migrations; `db:migrate` é pra CRIAR migration nova
npm run db:seed
```

Confira as duas travas que precisam ter sobrevivido às migrations:

```bash
psql "postgresql://postgres:postgres@localhost:5432/guiazap" -c '\dp "AuditLog"'
# PUBLIC não pode aparecer com privilégio (append-only)
psql "postgresql://postgres:postgres@localhost:5432/guiazap" -c '\d "Delivery"' | grep -i unique
# tem que existir Delivery_documentId_key UNIQUE
```

Depois: `npm run dev` (web) e `npm run worker` (dispatcher, processo separado).

⚠️ O CLI do Prisma sugere atualizar para `8.0.0-rc.13` a cada comando.
**Ignore** — é a armadilha documentada no `CLAUDE.md`; a versão é pinada de
propósito.

Segredo nenhum vai para o GitHub, nem para GitHub Secrets: não há workflow de
CI neste repositório, e o app lê o `.env` local. Secrets guardados lá são
invisíveis para a aplicação.

---

## 1. Feito (não refazer)

Registrado porque a versão anterior deste documento descrevia alguns destes
problemas de forma errada.

- **`filename.ts` TS2532** — corrigido com `w[i] ?? 0`. Os cinco casos da
  tabela na seção 3 **agora são teste automatizado** — ver seção 3.
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
  de 20 níveis contra estruturas circulares. Verificada com 14 casos
  manualmente, e agora com teste automatizado versionado — ver seção 3.
- **`src/lib/crypto.ts` e `src/lib/storage.ts`** — criados. O `crypto.ts` foi
  testado funcionalmente: cifra, decifra e rejeita dado adulterado.

---

## 2. Bugs abertos

**Um, encontrado nesta sessão ao montar o ambiente para reproduzir a Etapa A
— fora do escopo dela, não corrigido.** `prisma/seed.ts` grava o
`accessToken` cifrado com `accessToken ?? "PLACEHOLDER_ACCESS_TOKEN"`
(perto do fim do arquivo). `??` só cai no fallback para `null`/`undefined` —
não para string vazia. E o próprio `.env.example` que a seção 0 manda copiar
tem `WHATSAPP_ACCESS_TOKEN=""`: uma string vazia, não uma variável ausente.
Resultado: `npm run db:seed` sem preencher as credenciais da Meta cifra uma
string vazia em vez do placeholder, e a `WhatsAppAccount` fica com um
`accessTokenEnc` que o `decrypt()` rejeita com "Formato de texto cifrado
inválido" — quebrando *qualquer* delivery desse tenant assim que o dispatcher
tenta descriptografar o token, antes até de chegar na Meta ou no R2.

**Confirmado por execução.** Segui a seção 0 à risca (`cp .env.example
.env`, preenchi só banco/Redis/`ENCRYPTION_KEY`, sem as três variáveis da
Meta) e rodei `npm run db:seed`; a `WhatsAppAccount` ficou com
`accessTokenEnc` terminando em `:` (ciphertext vazio — confirmado com
`SELECT length("accessTokenEnc")` e comparando com o tamanho esperado para
"PLACEHOLDER_ACCESS_TOKEN"). Contornei manualmente (regravando a coluna) só
para poder reproduzir a Etapa A; não mexi no `seed.ts`.

**Não corrigido de propósito — decisão travada da sessão foi só a Etapa A.**
Fica para quem pegar a próxima etapa: trocar `??` por uma checagem de
truthiness (`accessToken || "PLACEHOLDER_ACCESS_TOKEN"`, ou `accessToken
?.trim() || ...`) resolve.

Fora esse, todos os bugs confirmados por execução foram corrigidos (dois na
etapa 2, um na etapa 3, os dois da seção 4, e o da Etapa A). O resto não é
conserto, é construção: ver seções 3 e 5.

---

## 3. Testes — feito em 10/09/2026 (Etapa C do `EXECUCAO.md`) ✅

Não havia test runner no `package.json`. Instalar era decisão de arquitetura e
estava condicionada a perguntar antes; **foi perguntado e autorizado pelo dono
do projeto em 10/09/2026**, com a condição de usar o `node:test` nativo, que
não adiciona dependência — e é exatamente o que foi usado. Nenhuma dependência
nova entrou no `package.json` (conferido com `git diff package.json` antes de
commitar: só a linha do script `test`).

Qualquer outra dependência continua exigindo perguntar antes.

**`npm test` roda `tsx --test 'src/**/*.test.ts'`.** `tsx` já era
devDependency (usado pelo worker). O glob entre aspas simples é proposital:
sem aspas o shell (`dash`, que é o `/bin/sh` do Debian — bash só expande `**`
com `globstar` habilitado) tentaria expandir antes de chamar o `tsx`, e podia
não casar nada; citado, o padrão chega inteiro no test runner do Node, que
sabe expandir glob nativamente.

Quatro suítes, 20 testes, todos passando:

- **`src/lib/matching/filename.test.ts`** — os cinco casos obrigatórios da
  tabela abaixo, mais dois extras (CNPJ inválido isolado, CPF com todos os
  dígitos iguais). O quinto caso da tabela é o que mais importa: 14 dígitos
  que não formam CNPJ válido não podem virar `document` — é a trava contra
  mandar a guia do João para a Maria.

  | entrada | `document` | `kind` | `competencia` |
  |---|---|---|---|
  | `DAS_11222333000181_2026-08.pdf` | `11222333000181` | `DAS` | `2026-08` |
  | `darf-529.982.247-25-082026.pdf` | `52998224725` | `DARF` | `2026-08` |
  | `11222333000181 - FGTS - 08_2026.pdf` | `11222333000181` | `FGTS` | `2026-08` |
  | `guia sem nada.pdf` | `null` | `null` | `null` |
  | `boleto protocolo 99999999999999 08-2026.pdf` | `null` | `BOLETO` | `2026-08` |

- **`src/lib/scheduling/rule.test.ts`** — os dois ramos do `FIXED_DAY` (dia
  do mês ainda não passou do vencimento, fica no mesmo mês; já passou, cai no
  mês anterior) e o `BUSINESS_DAYS_BEFORE_DUE` (3 dias úteis antes de
  7/set/2026 é 2/set, reaproveitando o caso já verificado à mão na etapa 3).
- **`src/lib/scheduling/holidays.test.ts`** — Sexta-feira Santa de 2026 é
  3/abr (e os dias ao redor não são), 7/set/2026 é feriado nacional e não é
  dia útil, 3 dias úteis antes de 7/set/2026 é 2/set, e fim de semana comum
  (sem ser feriado) também não é dia útil.
- **`src/lib/audit/index.test.ts`** — `scrub` é privada (só `audit()` é
  exportada), então o teste passa um `PrismaClient` falso — um objeto que só
  captura o `data` de `auditLog.create`, sem tocar em Postgres — e chama a
  função pública de verdade. Cobre: segredo aninhado em qualquer
  profundidade, `passwordHash`/`accessTokenEnc` redigidos no primeiro nível,
  array preservado como array, `Date` para ISO, `bigint` para string, e
  `before`/`after` ausentes não viram chave `null` no registro.

**Armadilha encontrada escrevendo o teste do audit:** o primeiro rascunho
desestruturava `const { db, captured } = fakeDb()` — mas `captured` era um
getter, e desestruturar **lê o valor na hora**, antes do `await audit(...)`
rodar. Os seis testes falhavam com "Cannot read properties of undefined".
Corrigido guardando o estado num objeto (`fake.state.captured`) e só lendo
depois do `await`.

Não há teste de webhook nem de dispatcher: dependem de Postgres e Redis
(teste de integração, decisão de arquitetura separada — combinado não
escrever sem perguntar antes, e não foi perguntado nesta sessão).

---

## 4. Problemas confirmados por execução e corrigidos ✅

Estavam marcados como "não executados" ou "não reproduzidos". Em 10/09/2026
os três foram **reproduzidos de verdade** contra Postgres e Redis reais, e
corrigidos.

1. **Delivery órfã em `enqueueDue`** — **confirmado.** Reprodução: com o Redis
   derrubado, o `UPDATE` para `QUEUED` passa e o `sendQueue.add()` fica
   pendurado (o BullMQ usa `maxRetriesPerRequest: null`, então o comando espera
   reconexão em vez de falhar). Matando o processo aí, a linha fica `QUEUED`
   com `attempts` em 0. Com o Redis de volta, `enqueueDue()` rodou e **não** a
   recuperou — só procura `SCHEDULED` — e a fila ficou com zero jobs. Ou seja:
   guia agendada que nunca sai, sem erro em lugar nenhum.

   **Decisão (a seção pedia para decidir e documentar): varredor, não inverter
   a ordem.** Inverter (enfileirar antes do UPDATE) trocaria "guia presa" por
   "guia enviada duas vezes", já que o job poderia rodar com a linha ainda
   `SCHEDULED` e o `enqueueDue` a pegaria de novo — e o `CLAUDE.md` é explícito
   que envio duplicado é o pior desfecho.

   `recoverOrphanedQueued()` em `src/lib/dispatch.ts` roda junto do
   `enqueueDue`, a cada minuto. Em vez de um limite de tempo chutado, faz a
   pergunta exata: *existe job para esta Delivery?* Se não existe, reenfileira
   com o mesmo `idempotencyKey` como `jobId` — então a trava de idempotência
   continua valendo. Verificado: resgatou a órfã, e a segunda passada resgatou
   zero com a fila ainda em exatamente 1 job (não duplica). Job que esgotou as
   retentativas fica na fila como `failed` com o id ocupado, e por isso não é
   ressuscitado em silêncio — esse caso tem `lastError` e aparece na tela.

2. **Consentimento inconsistente** — **confirmado.** O banco aceitava
   `status: GRANTED` com `revokedAt` preenchido, e a query do dispatcher (que
   filtra só por `status`) dava esse consentimento como válido: mandaria
   mensagem para quem revogou.

   **Fonte de verdade única: `status`.** `revokedAt` é só o carimbo de quando
   a revogação aconteceu. A migration `20260910170000_consent_revoked_consistency`
   adiciona um CHECK que proíbe a combinação incoerente no banco, não só na
   aplicação. O dispatcher também passou a filtrar `revokedAt: null` — filtro
   redundante de propósito: se a constraint cair um dia, o pior desfecho é não
   enviar, nunca enviar para quem revogou. Verificado: a constraint rejeita
   `GRANTED` + `revokedAt`, e uma revogação de verdade (`REVOKED` + carimbo)
   continua permitida.

3. **Envio duplicado quando o processo morre no meio do envio (Etapa A do
   `EXECUCAO.md`) — confirmado.** O dispatcher pulava
   `["SENT","DELIVERED","READ","CANCELLED"]`; `SENDING` não estava na lista.
   Reprodução: criei uma `Delivery` já em `SENDING` (simulando processo morto
   depois de a Meta aceitar a mensagem e antes de gravar `SENT`) e enfileirei
   um job pra ela — o mesmo efeito, do ponto de vista do processador, de o
   BullMQ reexecutar um job travado. No código antes da correção, o guard não
   barrou: `attempts` incrementou de novo e o dispatcher seguiu até a chamada
   de envio (parou no limite esperado sem credencial real — `getObject`
   falhou com "R2_ACCOUNT_ID não definida" — mas o ponto é que chegou lá de
   novo). Sem credencial de R2/Meta neste ambiente, não dava pra provar o
   caminho completo até a Cloud API; a reprodução prova exatamente a parte
   que importa, o guard não segurando.

   Confirmado também: `idempotencyKey` é declarado em
   `src/lib/whatsapp/provider.ts` como "evita duplicidade", o dispatcher
   passava, e o `meta-cloud.ts` nunca lê (`grep -n idempotencyKey
   src/lib/whatsapp/*.ts` não retorna nenhum uso dentro de `meta-cloud.ts`).

   **Decisão 1 — como tratar `SENDING`:** entra na lista de status que o
   worker nunca reprocessa, mas ao invés de só devolver silenciosamente
   (o que deixaria a linha presa pra sempre, invisível), vira um novo status
   `SEND_UNCERTAIN` (migration `20260910180000_delivery_send_uncertain`,
   `ALTER TYPE ... ADD VALUE`, escrita à mão como as outras que mexem em
   `CHECK`/enum). Não reusei `FAILED`: `FAILED` afirma "não saiu", que pode
   ser mentira aqui — não sabemos se a Meta recebeu ou não. Só um humano,
   checando o WhatsApp real do cliente, resolve daqui pra frente; o worker
   nunca reenfileira uma `SEND_UNCERTAIN` sozinho.
   `src/workers/dispatcher.ts` grava `Delivery.lastError`,
   `DeliveryEvent(type: "send_uncertain")` e `AuditLog` na mesma transação.
   Verificado: subi `npm run dev`, deixei a `Delivery` de teste em
   `SEND_UNCERTAIN` no banco e conferi com `curl http://localhost:3000/log`
   que a linha aparece nas duas tabelas da tela — nenhuma tela nova precisou
   ser criada, `/log` já lê `DeliveryEvent`/`AuditLog` de forma genérica.

   **Decisão 2 — `idempotencyKey` no contrato do provider:** removido de
   `SendDocumentParams`, não tirado de uso — a API de mensagens da Meta não
   aceita um token de deduplicação do cliente nesse endpoint, então prometer
   isso ali era uma garantia que nenhuma implementação real cumpre. A
   proteção de verdade contra reenvio continua onde sempre esteve e sem
   mudança nenhuma: `Delivery.idempotencyKey` como `jobId` do BullMQ e o
   `UPDATE ... WHERE status = 'SCHEDULED'`, os dois em `src/lib/dispatch.ts`.
   Comentário do arquivo atualizado para apontar pra lá.

   Reexecutei a mesma reprodução depois da correção: `attempts` não mudou, a
   `Delivery` foi para `SEND_UNCERTAIN` com `lastError` explicando o motivo,
   `DeliveryEvent` e `AuditLog` gravados, job terminou `completed` (não
   `failed` — não entra na fila de retentativa do BullMQ).

   Rodei `npm run typecheck` e `npm run build` — limpos. Confirmei as
   migrations num banco novo (`CREATE DATABASE guiazap_teste` + `prisma
   migrate deploy` + `DROP DATABASE`): as cinco aplicam, e
   `SELECT unnest(enum_range(NULL::"DeliveryStatus"))` mostra `SEND_UNCERTAIN`
   na lista.

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

**R2: verificado de verdade em 10/09/2026.** `src/lib/storage.ts` foi exercitado
contra um bucket Cloudflare real (`guiazap-docs`, Public Access desabilitado),
com `putObject` seguido de `getObject` e comparação do conteúdo — escrita e
leitura completas. Até então esse código nunca tinha rodado contra R2 de
verdade: todo teste da etapa 2 e da 3 morria em `R2_ACCOUNT_ID não definida`.

**Falta para o aceite 100%:** só o lado da Meta — `WHATSAPP_WABA_ID`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` e o template aprovado
`envio_guia_fiscal` (categoria UTILITY, header DOCUMENT). Depois: rodar o seed
com essas variáveis, subir `npm run dev` + `npm run worker`, e clicar "enviar
agora" de verdade.

Limites do ambiente de teste da Meta, que valem enquanto não houver conta de
produção: o token temporário da tela "API Setup" **expira em 24h** (para valer
é preciso um token de System User), e o número de teste só entrega para
destinatários previamente verificados no painel — por isso `SEED_CLIENT_PHONE`
precisa ser um número dessa lista.

**Nome do template configurável — Etapa D do `EXECUCAO.md`, feita em
10/09/2026 ✅.** Antes, `MetaCloudProvider.templateName` só tinha o default
fixo `"envio_guia_fiscal"` no construtor e o dispatcher nunca passava outro —
não dava pra testar a conexão com a Meta com um template já aprovado antes de
`envio_guia_fiscal` passar pela aprovação (que leva horas). Agora
`src/workers/dispatcher.ts` lê `WHATSAPP_TEMPLATE_NAME` do ambiente ao montar
o provider, com `||` (não `??`) para o default — mesma lição do bug aberto do
`seed.ts` na seção 2: variável presente mas vazia no `.env` não pode vencer o
default. Documentada em `.env.example`, com nota de que é lida direto pelo
dispatcher (dá pra trocar sem rodar `npm run db:seed` de novo, diferente das
outras variáveis `WHATSAPP_*`).

Não mexi na decisão travada de categoria: `MetaCloudProvider` continua sem
nenhum parâmetro de categoria — UTILITY/MARKETING é escolha exclusiva do
painel da Meta ao aprovar o template, e o código não introduz nada que
facilite apontar para um template MARKETING.

**Verificado por execução** (sem credencial real da Meta, que não existe
neste ambiente): script chamou `MetaCloudProvider.sendDocument` de verdade
com `global.fetch` stubado (só a rede foi trocada — a classe real, o
construtor real e a mesma expressão `process.env.WHATSAPP_TEMPLATE_NAME ||
undefined` que o dispatcher usa, todos de verdade) e capturou o `template.name`
no corpo da chamada a `/messages` em três cenários:
`WHATSAPP_TEMPLATE_NAME="teste_template_configuravel"` → enviou
`teste_template_configuravel`; `WHATSAPP_TEMPLATE_NAME=""` → caiu no default
`envio_guia_fiscal`; variável ausente → também caiu no default. Script era
scratch, apagado depois — não versionado.

`npm run typecheck`, `npm test` (as 20 suítes da Etapa C não regrediram) e
`npm run build` limpos depois da mudança.

### Etapa 3 — o produto ✅ (até o limite de credenciais reais)

Implementada e testada localmente contra Postgres e Redis reais. O R2 era a
fronteira quando isto foi escrito, mas foi verificado depois (10/09/2026): só
a Meta continua faltando. Três decisões de produto que não estavam
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

**Falta para o aceite 100%:** só as credenciais da Meta (ver etapa 2 — o R2
já foi verificado contra bucket real). O upload em lote parava exatamente no
`putObject`; com o R2 configurado, essa fronteira saiu do caminho e o próximo
limite passa a ser a chamada à Cloud API.

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
