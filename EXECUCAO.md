# EXECUÇÃO — o que falta, e como fazer

Este arquivo é **subordinado** aos outros dois. Se algo aqui contradisser o
`CLAUDE.md`, o `CLAUDE.md` vence — sem exceção.

- **`CLAUDE.md`** — o que é verdade e o que é proibido. Leia primeiro.
- **`HANDOFF.md`** — onde estamos, o que já foi feito e verificado.
- **este arquivo** — como executar o que ainda falta.

Escrito em 10/09/2026. **É descartável:** quando as etapas abaixo estiverem
todas fechadas, apague este arquivo e deixe o registro no `HANDOFF.md`. Não
deixe os três documentos divergindo.

---

## Como trabalhar aqui

O `CLAUDE.md` já manda separar o que você executou do que apenas leu. Na
prática, neste projeto isso significa:

1. **Reproduza antes de corrigir.** Todo bug real encontrado até hoje foi
   confirmado rodando, e vários "problemas" descritos em documento estavam
   errados. Se você não conseguiu reproduzir, diga isso em vez de corrigir no
   escuro.
2. **Trave no banco, não só na aplicação.** As travas que seguraram os bugs
   sérios deste projeto são de banco: `REVOKE` no `AuditLog`,
   `@@unique([documentId])` no `Delivery`, o `CHECK` no `Consent`. Checagem só
   em TypeScript tem janela de corrida.
3. **Verifique com comando, e mostre a saída.** `npm run typecheck` e
   `npm run build` são o piso, não a prova. Prova é reproduzir o cenário.
4. **Não invente resultado.** Se algo depende de credencial que você não tem,
   pare e diga. Nunca simule um envio e relate como se tivesse acontecido.

Rode `npm run typecheck` **e** `npm run build` antes de cada commit. Se mexer
em schema, confirme que as migrations aplicam num banco limpo:

```bash
psql "postgresql://postgres:postgres@localhost:5432/postgres" -c "CREATE DATABASE guiazap_teste;"
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/guiazap_teste" npx prisma migrate deploy
psql "postgresql://postgres:postgres@localhost:5432/postgres" -c "DROP DATABASE guiazap_teste;"
```

---

## Duas decisões já tomadas

Registradas aqui porque foram tomadas na conversa, não no código. **Se
discordar, mude aqui antes de começar** — não descubra isso no meio da
implementação.

- **Etapa A** vai pular `SENDING` e marcar para revisão humana, em vez de
  reenviar. Justificativa dentro da etapa.
- **Etapa C** pode instalar test runner. O `HANDOFF.md` seção 3 diz "não
  instale nada sem perguntar antes" — foi perguntado e autorizado pelo dono do
  projeto em 10/09/2026, com a condição de usar o `node:test` nativo, que não
  adiciona dependência.

---

## Etapa A — envio duplicado quando o processo morre no meio ✅ prioridade

**✅ Fechada em 10/09/2026 — ver seção 4 do `HANDOFF.md` para reprodução,
decisão e verificação.** O resto desta seção fica como registro do raciocínio
original; não reabra sem motivo.

**O problema, já confirmado por leitura do código.** O dispatcher pula
`["SENT","DELIVERED","READ","CANCELLED"]` (`src/workers/dispatcher.ts`, linha
49). `SENDING` **não** está na lista. Se o processo morrer depois de a Meta
aceitar a mensagem e antes de gravar `SENT`, a detecção de job travado do
BullMQ reexecuta o job, o dispatcher vê `SENDING` e envia de novo.

Agrava: o `idempotencyKey` é declarado em `src/lib/whatsapp/provider.ts:22`
com o comentário *"Evita duplicidade se a chamada for repetida"*, o dispatcher
o passa, e o `src/lib/whatsapp/meta-cloud.ts` **nunca o lê**. Não existe
proteção nenhuma do lado da Meta. Confirme com
`grep -n idempotencyKey src/lib/whatsapp/*.ts`.

**Comece reproduzindo.** Uma `Delivery` em `SENDING`, um job reexecutado, e
observe o dispatcher seguir para o envio. Se não reproduzir, diga.

**A decisão.** Pôr `SENDING` na lista de pulos elimina o envio duplicado mas
cria guia presa para sempre. Então:

- `SENDING` entra na lista de pulos — **nunca** reenvie algo que pode ter
  saído;
- e a linha presa precisa virar **visível para um humano**, não sumir. Depois
  de uma queda no meio do envio, só uma pessoa pode checar se a mensagem
  chegou. Isso é o mesmo espírito do "nunca chute o cliente".

Você decide *como* tornar visível: reusar `FAILED` com um `lastError` claro é
mais barato, mas mente (diz "não foi" quando talvez tenha ido); um valor novo
no enum `DeliveryStatus` é honesto e custa uma migration. **Escolha e
documente qual**, como foi feito na seção 4 do `HANDOFF.md`.

Cuidado: `recoverOrphanedQueued()` em `src/lib/dispatch.ts` hoje só olha
`QUEUED`. Se ele passar a mexer em `SENDING`, ele **não pode** reenfileirar —
só marcar.

Enquanto estiver aí, resolva a mentira do `idempotencyKey`: ou use de fato,
ou tire do contrato e corrija o comentário. Contrato que promete garantia
inexistente é pior que contrato nenhum.

**Aceite:** cenário reproduzido antes; depois da correção, o mesmo cenário não
envia duas vezes; a linha presa aparece na interface; `typecheck` e `build`
limpos; decisão documentada no `HANDOFF.md`.

---

## Etapa B — autenticação (o buraco maior)

**✅ Fechada em 10/09/2026 — ver seção 5 (Etapa B) do `HANDOFF.md` para as
duas decisões (conflito User×better-auth, cadastro desligado), o que foi
construído e a verificação.** O resto desta seção fica como registro do
raciocínio original; não reabra sem motivo.

`BETTER_AUTH_SECRET` e `BETTER_AUTH_URL` estão no `.env.example` desde o começo
e **não são usadas em lugar nenhum**. Toda ação grava
`actorLabel: "system:web"` — veja o `const ACTOR_LABEL` no topo de cada
`actions.ts`. O `AuditLog` é tratado pelo `CLAUDE.md` como funcionalidade
central, e hoje ele não responde *quem* fez cada coisa. Num SaaS onde vários
funcionários do escritório mexem nas guias de terceiros, isso esvazia a
trilha.

O `better-auth@1.7.2` já está no `package.json`.

**Armadilha principal:** o `schema.prisma` já tem um model `User` próprio
(`email`, `passwordHash`, `role`, `tenantId`) e um enum `UserRole`. O
`better-auth` quer gerar o schema dele. **Não duplique usuário** e não apague
o `User` existente sem entender quem depende dele. Decida se adapta o
better-auth ao model atual ou migra o model — e documente.

O que precisa acontecer:

- login funcionando, com as rotas protegidas (hoje qualquer um que alcance a
  porta vê e opera tudo);
- `actorId` **e** `actorLabel` do `AuditLog` passam a identificar a pessoa
  real. O `actorId` já é nullable no schema justamente para distinguir ação de
  sistema;
- as ações de sistema continuam como estão: `system:dispatcher` no worker,
  `system:webhook` no webhook. Elas não têm usuário e isso está correto;
- multi-tenant de verdade: hoje **sete arquivos** fazem
  `tenant.findFirst()`/`findFirstOrThrow()` e assumem que só existe um tenant —
  `src/app/page.tsx`, `clientes/page.tsx`, `configuracoes/page.tsx`,
  `configuracoes/actions.ts`, `log/page.tsx`, `lote/actions.ts` e
  `revisao/page.tsx`. Com sessão, o tenant vem do usuário logado. **Isto é
  segurança, não cosmética** — sem isso, um escritório enxerga guia de outro.
  Confira a lista com `grep -rln "tenant.findFirst" src/app` antes de começar,
  caso tenha mudado.

**Aceite:** login e logout funcionam; rota sem sessão é recusada; uma ação
feita na interface gera `AuditLog` com o `actorId` da pessoa; ação do worker
continua sem `actorId`; nenhuma tela usa mais `findFirst()` de tenant;
`typecheck` e `build` limpos.

---

## Etapa C — testes automatizados

**✅ Fechada em 10/09/2026 — ver seção 3 do `HANDOFF.md` para as quatro
suítes, os 20 testes e a armadilha do getter desestruturado.** O resto desta
seção fica como registro do raciocínio original; não reabra sem motivo.

Use `node:test` (nativo, sem dependência nova) e adicione um script `test` ao
`package.json`. Note que `"type": "module"` — os testes são ESM.

Comece pelos cinco casos do `parseFilename` na tabela da seção 3 do
`HANDOFF.md`. Essa função decide **de quem é cada guia**; uma regressão ali
manda a guia do João para a Maria, que o `CLAUDE.md` chama do pior bug
possível. O caso que mais importa é o último: 14 dígitos que não formam CNPJ
válido têm que ser rejeitados.

Depois, estas três já foram verificadas à mão e merecem virar teste, porque
são lógica pura e quebram em silêncio:

- `src/lib/scheduling/rule.ts` — os dois ramos do `FIXED_DAY` (o dia do mês
  ainda não passou do vencimento; e já passou, caindo no mês anterior) e o
  `BUSINESS_DAYS_BEFORE_DUE`;
- `src/lib/scheduling/holidays.ts` — Sexta-feira Santa de 2026 é 3/abr;
  7/set/2026 é feriado e não é dia útil; 3 dias úteis antes de 7/set/2026 é
  2/set;
- `src/lib/audit/index.ts` — o `scrub` precisa continuar removendo segredo
  aninhado em qualquer profundidade, preservando array e convertendo `Date`.

Não tente testar aqui o webhook nem o dispatcher: dependem de Postgres e Redis
e viram teste de integração, que é outra decisão de arquitetura. Se achar que
vale, **pergunte antes**.

**Aceite:** `npm test` roda e passa; os cinco casos da tabela estão cobertos;
nenhuma dependência nova no `package.json`.

---

## Etapa D — nome do template configurável (curta)

**✅ Fechada em 10/09/2026 — ver seção 5 (Etapa 2) do `HANDOFF.md` para a
mudança e a verificação.** O resto desta seção fica como registro do
raciocínio original; não reabra sem motivo.

O `MetaCloudProvider` tem `templateName = "envio_guia_fiscal"` fixo como
default no construtor, e o dispatcher nunca passa outro. Isso impede testar a
conexão com a Meta antes de o template estar aprovado — e a aprovação leva
horas. Torne configurável por ambiente, com o valor atual como default.

**Não encoste na decisão travada:** categoria UTILITY, nunca MARKETING. Isso é
escolha de template no painel da Meta, não do código, mas não introduza nada
que facilite mandar por um template MARKETING.

Documente a variável nova no `.env.example`.

---

## Etapa E — erros que não chegam na tela

As Server Actions lançam `Error` com mensagem boa — "Este documento já foi
agendado", "Este cliente está desativado" — mas o Next não propaga isso para o
formulário: o usuário vê tela de erro genérica. Verificado na etapa 3.

Use `useActionState` (React 19) para devolver o erro ao formulário. Cobre pelo
menos: documento já agendado, cliente desativado, PDF duplicado (`sha256`
repetido) e arquivo que não é PDF.

Isso transforma componentes de servidor em componentes de cliente onde for
preciso — mantenha o mínimo possível no cliente.

---

## Etapa F — ponta a ponta com a Meta (bloqueada, não force)

Só acontece na máquina do dono, com credencial real. **Não simule.** O que
falta está no fim da seção 5 do `HANDOFF.md`: as três variáveis
`WHATSAPP_*` e o template `envio_guia_fiscal` aprovado (UTILITY, header
DOCUMENT, quatro variáveis no corpo: nome, tipo, competência, vencimento).

Dois limites do ambiente de teste da Meta: o token temporário expira em 24h
(para valer, token de System User), e o número de teste só entrega para
destinatários verificados no painel — por isso `SEED_CLIENT_PHONE` precisa ser
um número dessa lista.

O R2 **já foi verificado** contra bucket real e não é mais fronteira.

---

## Como conduzir as sessões

**Uma etapa por sessão.** Este arquivo cobre seis, mas executá-las de uma vez
enche o contexto e a qualidade cai justamente no fim, quando vem a parte
difícil. A etapa B mexe em schema de usuário e isolamento entre escritórios —
erro ali é caro.

Ordem sugerida: **A** (fecha o último furo conhecido no caminho do dinheiro),
**C** e **D** (curtas, e a D destrava testar a Meta mais cedo), **B** (a maior),
**E**, e por fim **F**, que depende de credencial.

Comece cada sessão com `git pull`, e no fim de cada etapa confira antes de
seguir para a próxima:

- o aceite da etapa foi de fato executado, com a saída do comando à vista;
- `npm run typecheck` e `npm run build` limpos;
- se mexeu em schema, as migrations aplicam num banco novo;
- o `HANDOFF.md` foi atualizado — decisão tomada, o que foi verificado e como.
  Uma etapa fechada sem esse registro obriga a próxima sessão a redescobrir
  tudo.

Se uma sessão terminar no meio de uma etapa, anote no `HANDOFF.md` onde parou
antes de encerrar.

---

## Armadilhas deste repositório

Todas custaram tempo de verdade. Não redescubra.

- **`middleware.ts` foi renomeado para `proxy.ts` no Next 16** (mesma
  função, export renomeado de `middleware` pra `proxy`). Um `middleware.ts`
  não dá erro — é só **ignorado em silêncio**, o que pareceria "a proteção
  de rota não funciona" sem nenhuma mensagem explicando por quê. Ver
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/middleware.md`.
  Vai em `src/proxy.ts` (mesmo nível de `app/`, já que o projeto usa `src/`).
- **Prisma:** o CLI sugere subir para `8.0.0-rc.13` a cada comando. Ignore — a
  versão é pinada de propósito (`CLAUDE.md`).
- **`prisma migrate dev` é interativo** e recusa rodar sem TTY quando há aviso.
  Para aplicar migrations existentes use `npm run db:deploy`. Para criar
  migration com SQL que o Prisma não gera (como `CHECK`), escreva o
  `migration.sql` à mão, aplique com `psql -f` e registre com
  `npx prisma migrate resolve --applied <nome>`.
- **`prisma migrate reset` é bloqueado** neste ambiente por ser destrutivo.
  Não tente contornar; recrie o banco com `DROP DATABASE` / `CREATE DATABASE`
  se for mesmo necessário, e só em banco local de desenvolvimento.
- **`npm run worker` não carrega `.env` sozinho** — por isso
  `src/workers/index.ts` importa `dotenv/config` como primeiro import. Mantenha
  essa ordem; qualquer import antes dele lê `process.env` vazio.
- **Toda página que lê o banco precisa de `export const dynamic =
  "force-dynamic"`**, senão o Next a pré-renderiza no build e ela congela com
  os dados daquele momento.
- **O seed não sobrescreve credencial real com placeholder**, e só atualiza a
  conta da Meta quando as três variáveis estão presentes. É de propósito.
- **Playwright e o `revalidatePath`:** ao testar formulário no navegador, a
  linha pode continuar visível na tela mesmo depois da ação ter funcionado.
  Isso é artefato de timing do teste. **Confirme no banco**, que é a fonte da
  verdade — já houve conclusão errada por causa disso.
- **Não apague linha do `AuditLog`**, nem em limpeza de teste. É append-only e
  o `CLAUDE.md` proíbe.

---

## O que não fazer

- Não commite `.env`, nem coloque valor real no `.env.example`.
- Não reabra decisão travada do `CLAUDE.md` sem dizer antes.
- Não desligue flag do `tsconfig.json` para calar erro.
- Não instale dependência sem perguntar — exceto o que a seção "decisões já
  tomadas" acima autoriza.
- Não marque etapa como pronta sem ter rodado o aceite dela.
