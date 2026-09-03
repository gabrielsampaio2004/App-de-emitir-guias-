# HANDOFF — plano de trabalho

Contexto do produto, stack e regras invioláveis estão no `CLAUDE.md`. **Leia-o
primeiro.** Este documento é só a ordem de trabalho.

Estado: `npm run typecheck` passa limpo. `npm run dev` **ainda falha** — não
existe `src/app/`.

Última atualização: 02/09/2026, após o commit `0748c63`.

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
- **`src/lib/crypto.ts` e `src/lib/storage.ts`** — criados. O `crypto.ts` foi
  testado funcionalmente: cifra, decifra e rejeita dado adulterado.

---

## 2. Bug aberto — corrigir primeiro

### 2.1 `src/lib/audit/index.ts` — a função `scrub` tem três defeitos

Comprovado rodando:

```
scrub(['a','b'])                       -> {"0":"a","1":"b"}   // array vira objeto
scrub(new Date('2026-01-01'))          -> {}                  // data some
scrub({user:{passwordHash:'segredo'}}) -> segredo intacto     // não desce um nível
```

O terceiro é o grave: **um segredo aninhado vaza para o log de auditoria**, que
é exatamente a tabela que precisa ser confiável.

Reescreva `scrub` recursivo, preservando arrays como arrays e `Date` como ISO
string. A lista `REDACTED` (`passwordHash`, `accessTokenEnc`, `accessToken`)
deve valer em qualquer profundidade. Cubra os três casos com teste.

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
