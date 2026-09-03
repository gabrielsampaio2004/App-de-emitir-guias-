# GuiaZap

SaaS para escritórios de contabilidade. O contador joga as guias fiscais que
baixou (DAS, DARF, FGTS) numa pasta; o sistema descobre de qual cliente é cada
arquivo pelo CPF/CNPJ no nome, e envia por WhatsApp na data de vencimento. Toda
ação fica registrada numa trilha de auditoria.

O plano de trabalho e os bugs conhecidos estão em `HANDOFF.md`.

---

## Decisões travadas

Já foram discutidas e decididas. Não reabra sem motivo forte — se achar que
alguma está errada, diga antes de mudar.

**Meta Cloud API oficial**, não Z-API/Evolution/WPPConnect. O envio proativo com
PDF exige template aprovado categoria UTILITY com header DOCUMENT. Dois motivos:
o recibo de entrega via webhook (`delivered`/`read`) é a funcionalidade que vende
o produto, e conexão por QR Code arrisca banir o número do cliente — num SaaS, o
número banido é do cliente, não nosso.

**O PDF sobe para a Meta via Media API** e usamos o `media_id` no template. Nunca
exponha o arquivo numa URL pública: a guia contém CPF, CNPJ e valores.

**Pacote único, não monorepo.** Workspaces só quando entrar o agente desktop que
monitora a pasta local (fase 3).

**Envio atrás da interface `WhatsAppProvider`** (`src/lib/whatsapp/provider.ts`),
para trocar de provedor sem reescrever a aplicação. Nenhum código fora de
`src/lib/whatsapp/` deve falar direto com a Meta.

---

## Stack

Versões consultadas no npm em 02/09/2026 e fixadas no `package.json`.

| Camada | Escolha |
|---|---|
| Web | Next.js 16.3.4 (App Router) |
| Banco | PostgreSQL + Prisma 7.10.0 |
| Fila | BullMQ 6 + Redis (ioredis 6) |
| Arquivos | Cloudflare R2 via `@aws-sdk/client-s3` |
| Auth | better-auth 1.7.2 |
| TypeScript | 7.0.2 |

⚠️ **Armadilha do Prisma:** a tag `latest` do pacote `prisma` no npm aponta para
`8.0.0-rc.12`, um release candidate. O `package.json` pina `7.10.0` exato de
propósito, para casar com o `@prisma/client`. Não troque para `^` e não rode
`npm install prisma@latest`.

`package.json` tem `"type": "module"` — configs em `.mjs` ou ESM.

---

## Estrutura

```
prisma/schema.prisma            modelo de dados
src/lib/whatsapp/provider.ts    contrato de envio
src/lib/whatsapp/meta-cloud.ts  implementação da Cloud API
src/lib/matching/filename.ts    vincula arquivo → cliente por CPF/CNPJ
src/lib/audit/index.ts          gravação do log append-only
src/workers/dispatcher.ts       agendador + executor dos envios
src/workers/index.ts            entrypoint do worker
```

## Comandos

```bash
npm run typecheck    # tsc --noEmit
npm run dev          # web
npm run worker       # dispatcher (processo separado)
npm run db:migrate   # prisma migrate dev
```

---

## Regras invioláveis

**Nunca envie duas vezes.** Cada envio custa dinheiro e irrita o cliente final.
As duas travas existentes — o `UPDATE ... WHERE status = 'SCHEDULED'` em
`enqueueDue` e o `idempotencyKey` usado como `jobId` do BullMQ — devem continuar
valendo em qualquer refatoração.

**Nunca chute o cliente.** Se o `parseFilename` não identificar o CPF/CNPJ com
dígito verificador válido, o documento vai para revisão manual. Mandar a guia do
João para a Maria é o pior bug possível neste produto.

**`AuditLog` é append-only.** A primeira migration deve rodar
`REVOKE UPDATE, DELETE ON "AuditLog" FROM PUBLIC;`. Nunca escreva código que
altere ou apague uma linha dessa tabela.

**Grave a auditoria na mesma transação da ação.** O helper `audit()` aceita um
`tx` justamente para isso. Ação registrada sem o log, ou log sem a ação, é pior
que não ter auditoria.

**Template categoria UTILITY, nunca MARKETING.** No Brasil a diferença é
R$ 0,0350 contra R$ 0,3217 por mensagem — quase 10x.

**Nada de segredo em lugar nenhum:** nem em `console.log`, nem em `AuditLog`, nem
em mensagem de erro. O `accessToken` da Meta fica criptografado no banco
(AES-256-GCM) e só é descriptografado no momento do envio.

**Não desligue flags do `tsconfig.json` para fazer erro sumir.**
`noUncheckedIndexedAccess` e `strict` são intencionais.

**Valide a assinatura do webhook.** Todo `POST` em
`/api/webhooks/whatsapp` confere `X-Hub-Signature-256` com
`crypto.timingSafeEqual` antes de qualquer processamento. Sem isso, qualquer um
marca guias como entregues.

---

## Como trabalhar aqui

Separe sempre **o que você executou** do que apenas leu. Ao relatar, diga o
comando e a saída. Boa parte dos problemas anotados no `HANDOFF.md` está marcada
como não verificada — é bem possível que algum esteja errado, e descobrir isso é
tão útil quanto corrigir.

Se algo na documentação estiver errado ou não fizer sentido, diga em vez de
contornar em silêncio.
