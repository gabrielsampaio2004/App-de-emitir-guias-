# HANDOFF — plano de trabalho

Contexto do produto, stack e regras invioláveis estão no `CLAUDE.md`. **Leia-o
primeiro.** Este documento é só a ordem de trabalho.

**O projeto não compila e não roda.**

---

## 1. Bugs confirmados — corrija primeiro

Reproduzidos por execução, não por leitura.

### 1.1 `src/lib/matching/filename.ts` não compila

```
filename.ts(82,60): error TS2532: Object is possibly 'undefined'.
```

O `tsconfig.json` liga `noUncheckedIndexedAccess`, e a linha
`sum += Number(cnpj[i]) * w[i]` indexa `w` sem garantia. Corrija o acesso (ex.:
`w[i] ?? 0`, ou reestruture o laço) **sem desligar a flag**.

Depois de corrigir, os casos abaixo já passavam e não podem regredir:

| entrada | `document` | `kind` | `competencia` |
|---|---|---|---|
| `DAS_11222333000181_2026-08.pdf` | `11222333000181` | `DAS` | `2026-08` |
| `darf-529.982.247-25-082026.pdf` | `52998224725` | `DARF` | `2026-08` |
| `11222333000181 - FGTS - 08_2026.pdf` | `11222333000181` | `FGTS` | `2026-08` |
| `guia sem nada.pdf` | `null` | `null` | `null` |
| `boleto protocolo 99999999999999 08-2026.pdf` | `null` | `BOLETO` | `2026-08` |

A última linha é a que importa: 14 dígitos que **não** são CNPJ válido devem ser
rejeitados. Escreva como teste automatizado, não rode na mão.

### 1.2 `src/lib/audit/index.ts` — a função `scrub` tem três defeitos

Comprovado rodando:

```
scrub(['a','b'])                       -> {"0":"a","1":"b"}   // array vira objeto
scrub(new Date('2026-01-01'))          -> {}                  // data some
scrub({user:{passwordHash:'segredo'}}) -> segredo intacto     // não desce um nível
```

O terceiro é o grave: **um segredo aninhado vaza para o log de auditoria**.
Reescreva `scrub` recursivo, preservando arrays como arrays e `Date` como ISO
string. A lista `REDACTED` deve valer em qualquer profundidade. Cubra os três
casos com teste.

---

## 2. Problemas por inspeção — confirme antes de corrigir

Estes **não** foram executados. Verifique cada um em vez de assumir.

1. **`dispatcher.ts` importa módulos inexistentes**: `../lib/storage` e
   `../lib/crypto`. O `npm run worker` quebra no import. Ver seção 3.
2. **`dispatcher.ts`**: `delivery.client.name.split(" ")[0]` é
   `string | undefined` sob `noUncheckedIndexedAccess`, mas vai para `nome: string`.
   Deve reprovar no `tsc` igual ao caso 1.1.
3. **Delivery órfã em `enqueueDue`**: o código faz `UPDATE ... status = 'QUEUED'`
   e depois `sendQueue.add()`. Se o `add` falhar (Redis fora do ar), a linha fica
   `QUEUED` para sempre e nada a recupera — `enqueueDue` só busca `SCHEDULED`.
   Resolva com um varredor de `QUEUED` parado há mais de N minutos, ou invertendo
   a ordem. Decida e documente qual.
4. **Não existe app Next nenhum.** Sem `src/app/`, sem `next.config.mjs`. O
   `npm run dev` falha.
5. **Consentimento inconsistente**: o schema permite `Consent` com
   `status: GRANTED` e `revokedAt` preenchido ao mesmo tempo, e o dispatcher só
   filtra por `status`. Escolha uma fonte de verdade única.
6. **Prisma 7 + `prisma-client-js`**: o schema usa o gerador antigo. O Prisma 7
   introduziu `prisma-client` com `output` obrigatório. Rode `prisma generate` e
   veja se o antigo ainda funciona sem aviso.
7. **`meta-cloud.ts`**: `new Blob([file])` com `file: Buffer` — funciona em runtime
   no Node 22, mas confira se o `tsc` reclama do tipo.

---

## 3. O que construir, em ordem

Cada etapa deve estar rodando antes da seguinte.

### Etapa 1 — fazer compilar

Corrija a seção 1 e os itens 1, 2, 4 e 6 da seção 2. Crie:

- **`src/lib/crypto.ts`** — AES-256-GCM usando `ENCRYPTION_KEY` (hex de 32 bytes).
  Exporte `encrypt(plain: string): string` e `decrypt(enc: string): string`.
  Guarde IV e authTag junto do ciphertext. Falha na verificação do authTag deve
  lançar, nunca retornar dado parcial.
- **`src/lib/storage.ts`** — `putObject(key, body, contentType)` e
  `getObject(key): Promise<Buffer>` no R2 via `@aws-sdk/client-s3`.
- **`next.config.mjs`** e um `src/app/layout.tsx` + `src/app/page.tsx` mínimos.

Aceite: `npm run typecheck` passa limpo e `npm run dev` sobe.

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

## 4. Como reportar

Ao terminar cada etapa, diga:

1. O que você **executou** para verificar (comando e saída), separado do que
   apenas leu.
2. Quais itens da seção 2 se confirmaram e quais não.
3. O que ficou faltando.
