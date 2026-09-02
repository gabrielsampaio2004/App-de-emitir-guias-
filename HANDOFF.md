# HANDOFF — instruções para continuar o GuiaZap

Você está assumindo um projeto parcialmente construído. **Ele não compila e não
roda.** Este documento lista o que existe, o que está quebrado (com prova), e a
ordem de trabalho. Leia inteiro antes de escrever código.

---

## 1. O produto

SaaS para escritórios de contabilidade. O contador joga as guias fiscais que
baixou (DAS, DARF, FGTS) numa pasta; o sistema descobre de qual cliente é cada
arquivo pelo CPF/CNPJ no nome, e envia por WhatsApp na data de vencimento. Toda
ação fica registrada numa trilha de auditoria.

Decisões já tomadas, **não reabra sem motivo forte**:

- **Meta Cloud API oficial**, não Z-API/Evolution. O envio proativo com PDF exige
  template aprovado categoria UTILITY com header DOCUMENT. Motivo: recibo de
  entrega via webhook (`delivered`/`read`) é a funcionalidade que vende o produto,
  e conexão por QR Code arrisca banir o número do cliente.
- **O PDF sobe para a Meta via Media API**, e usamos o `media_id` no template.
  Não exponha o arquivo numa URL pública: a guia tem CPF e valores (LGPD).
- **Pacote único, não monorepo.** Workspaces só quando entrar o agente desktop.
- Envio atrás da interface `WhatsAppProvider`, para trocar de provedor sem
  reescrever a aplicação.

---

## 2. Stack e versões

Versões consultadas no npm em 02/09/2026. Estão fixadas no `package.json`.

| Camada | Escolha |
|---|---|
| Web | Next.js 16.3.4 (App Router) |
| Banco | PostgreSQL + Prisma 7.10.0 |
| Fila | BullMQ 6 + Redis (ioredis 6) |
| Arquivos | Cloudflare R2 via `@aws-sdk/client-s3` |
| Auth | better-auth 1.7.2 |
| TypeScript | 7.0.2 |

⚠️ A tag `latest` do pacote `prisma` no npm aponta para `8.0.0-rc.12`, um release
candidate. O `package.json` pina `7.10.0` exato de propósito. **Não troque para
`^` nem rode `npm install prisma@latest`.**

---

## 3. Bugs confirmados — corrija primeiro

Estes foram reproduzidos por execução, não por leitura.

### 3.1 `src/lib/matching/filename.ts` não compila

```
filename.ts(82,60): error TS2532: Object is possibly 'undefined'.
```

O `tsconfig.json` liga `noUncheckedIndexedAccess`, e a linha
`sum += Number(cnpj[i]) * w[i]` indexa `w` sem garantia. Corrija o acesso (ex.:
`w[i] ?? 0`, ou reestruture o laço) **sem desligar a flag** — ela é intencional.

Depois de corrigir, rode os casos abaixo; o parser já acertava todos antes e
não pode regredir:

| entrada | `document` | `kind` | `competencia` |
|---|---|---|---|
| `DAS_11222333000181_2026-08.pdf` | `11222333000181` | `DAS` | `2026-08` |
| `darf-529.982.247-25-082026.pdf` | `52998224725` | `DARF` | `2026-08` |
| `11222333000181 - FGTS - 08_2026.pdf` | `11222333000181` | `FGTS` | `2026-08` |
| `guia sem nada.pdf` | `null` | `null` | `null` |
| `boleto protocolo 99999999999999 08-2026.pdf` | `null` | `BOLETO` | `2026-08` |

A última linha é a que importa: 14 dígitos que **não** são CNPJ válido devem ser
rejeitados. Escreva isso como teste automatizado, não rode na mão.

### 3.2 `src/lib/audit/index.ts` — a função `scrub` tem três defeitos

Comprovado rodando:

```
scrub(['a','b'])                       -> {"0":"a","1":"b"}   // array vira objeto
scrub(new Date('2026-01-01'))          -> {}                  // data some
scrub({user:{passwordHash:'segredo'}}) -> segredo intacto     // não desce um nível
```

O terceiro é o grave: **um segredo aninhado vaza para o log de auditoria**, que é
exatamente a tabela que precisa ser confiável. Reescreva `scrub` recursivo,
preservando arrays como arrays e `Date` como ISO string. A lista `REDACTED`
(`passwordHash`, `accessTokenEnc`, `accessToken`) deve valer em qualquer
profundidade. Cubra os três casos acima com teste.

---

## 4. Problemas por inspeção — confirme antes de corrigir

Estes eu **não** executei. Verifique cada um em vez de assumir que estão certos.

1. **`dispatcher.ts` importa módulos inexistentes**: `../lib/storage` e
   `../lib/crypto`. O `npm run worker` quebra no import. Ver seção 5.
2. **`dispatcher.ts`**: `delivery.client.name.split(" ")[0]` é
   `string | undefined` sob `noUncheckedIndexedAccess`, mas é atribuído a
   `nome: string`. Deve reprovar no `tsc` igual ao caso 3.1.
3. **Delivery órfã em `enqueueDue`**: o código faz `UPDATE ... status = 'QUEUED'`
   e depois `sendQueue.add()`. Se o `add` falhar (Redis fora do ar), a linha fica
   `QUEUED` para sempre e nada a recupera — `enqueueDue` só busca `SCHEDULED`.
   Resolva com um varredor de `QUEUED` parado há mais de N minutos, ou invertendo
   a ordem. Decida e documente qual.
4. **Não existe app Next nenhum.** Sem `src/app/`, sem `next.config.mjs`. O
   `npm run dev` falha. Note que `package.json` tem `"type": "module"`, então a
   config precisa ser `.mjs` ou ESM.
5. **Consentimento inconsistente**: o schema permite uma linha `Consent` com
   `status: GRANTED` e `revokedAt` preenchido ao mesmo tempo, e o dispatcher só
   filtra por `status`. Escolha uma fonte de verdade única.
6. **Prisma 7 + `prisma-client-js`**: o schema usa o gerador antigo. O Prisma 7
   introduziu `prisma-client` com `output` obrigatório. Rode `prisma generate` e
   veja se o antigo ainda funciona sem aviso. Se não, migre o schema.
7. **`meta-cloud.ts`**: `new Blob([file])` com `file: Buffer` — funciona em runtime
   no Node 22, mas confira se o `tsc` reclama do tipo.

---

## 5. O que construir, em ordem

Não pule etapas. Cada uma deve estar rodando antes da seguinte.

### Etapa 1 — fazer compilar

Corrija 3.1, 3.2 e os itens 1, 2, 4, 6 da seção 4. Crie:

- **`src/lib/crypto.ts`** — AES-256-GCM usando `ENCRYPTION_KEY` (hex de 32 bytes).
  Exporte `encrypt(plain: string): string` e `decrypt(enc: string): string`.
  Guarde IV e authTag junto do ciphertext. Falha na verificação do authTag deve
  lançar, nunca retornar dado parcial.
- **`src/lib/storage.ts`** — `putObject(key, body, contentType)` e
  `getObject(key): Promise<Buffer>` no R2 via `@aws-sdk/client-s3`.
- **`next.config.mjs`** e um `src/app/layout.tsx` + `src/app/page.tsx` mínimos.

Critério de aceite: `npm run typecheck` passa limpo e `npm run dev` sobe.

### Etapa 2 — provar o envio de ponta a ponta

Um tenant fixo em seed, um cliente cadastrado na mão, upload de um PDF, botão
"enviar agora". **Sem agendamento ainda.** O objetivo é ver a guia chegar no
WhatsApp e o webhook voltar `delivered`.

- **`src/app/api/webhooks/whatsapp/route.ts`** — `GET` responde o desafio de
  verificação com `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; `POST` processa os eventos.
  **Valide `X-Hub-Signature-256`** com `WHATSAPP_APP_SECRET` usando comparação de
  tempo constante (`crypto.timingSafeEqual`) antes de qualquer processamento. Sem
  isso, qualquer um marca guias como entregues. Responda 200 rápido e processe
  fora do request.
- Grave `DeliveryEvent` para cada status e atualize `sentAt`/`deliveredAt`/`readAt`.
- Webhooks da Meta **chegam fora de ordem e repetidos**. Nunca regrida o status
  (`READ` não volta para `DELIVERED`) e trate reentrega do mesmo evento.

Critério de aceite: uma guia real chega num WhatsApp real e o banco registra
`sent` → `delivered`.

### Etapa 3 — o produto

- Upload de pasta inteira via `<input type="file" webkitdirectory />`.
- Matching automático pelo `parseFilename`; o que não casar vai para uma fila de
  revisão manual. **Nunca chute o cliente** — mandar a guia do João para a Maria
  é o pior bug possível aqui.
- Agendamento por regra ("dia 20", "3 dias úteis antes do vencimento"), com
  calendário de feriados.
- Tela de log lendo `AuditLog` e `DeliveryEvent`.

---

## 6. Regras que não podem ser quebradas

- **Nunca envie duas vezes.** Cada envio custa dinheiro e irrita o cliente final.
  As duas travas existentes (`UPDATE ... WHERE status = 'SCHEDULED'` e o
  `idempotencyKey` como `jobId` do BullMQ) devem continuar valendo em qualquer
  refatoração.
- **`AuditLog` é append-only.** Rode na primeira migration:
  `REVOKE UPDATE, DELETE ON "AuditLog" FROM PUBLIC;`
  Nunca escreva código que altere ou apague uma linha dessa tabela.
- **Grave a auditoria na mesma transação da ação.** O helper `audit()` aceita um
  `tx` justamente para isso. Ação sem log é pior que ação nenhuma.
- **Template categoria UTILITY**, nunca MARKETING. No Brasil a diferença é de
  R$ 0,0350 contra R$ 0,3217 por mensagem — quase 10x.
- **Nada de segredo em log**, nem em `console.log`, nem em `AuditLog`.
- **Não desligue flags do `tsconfig`** para fazer erro sumir.

---

## 7. Como reportar

Ao terminar cada etapa, diga:

1. O que você **executou** para verificar (comando e saída), separado do que
   apenas leu.
2. Quais itens da seção 4 se confirmaram e quais não — eu não testei nenhum
   deles, então é bem possível que algum esteja errado.
3. O que ficou faltando.

Se algo neste documento estiver errado ou não fizer sentido, diga em vez de
contornar em silêncio.
