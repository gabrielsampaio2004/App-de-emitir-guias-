import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFilename } from "./filename";

// Os cinco casos da tabela na seção 3 do HANDOFF.md — não podem regredir.
// O último é o que importa: 14 dígitos que não formam CNPJ válido não
// podem ser aceitos como documento (mandar a guia do João para a Maria é o
// pior bug possível, por regra do CLAUDE.md).
const casos: Array<{
  entrada: string;
  document: string | null;
  kind: string | null;
  competencia: string | null;
}> = [
  {
    entrada: "DAS_11222333000181_2026-08.pdf",
    document: "11222333000181",
    kind: "DAS",
    competencia: "2026-08",
  },
  {
    entrada: "darf-529.982.247-25-082026.pdf",
    document: "52998224725",
    kind: "DARF",
    competencia: "2026-08",
  },
  {
    entrada: "11222333000181 - FGTS - 08_2026.pdf",
    document: "11222333000181",
    kind: "FGTS",
    competencia: "2026-08",
  },
  {
    entrada: "guia sem nada.pdf",
    document: null,
    kind: null,
    competencia: null,
  },
  {
    entrada: "boleto protocolo 99999999999999 08-2026.pdf",
    document: null,
    kind: "BOLETO",
    competencia: "2026-08",
  },
];

for (const caso of casos) {
  test(`parseFilename("${caso.entrada}")`, () => {
    const resultado = parseFilename(caso.entrada);
    assert.deepEqual(resultado, {
      document: caso.document,
      kind: caso.kind,
      competencia: caso.competencia,
    });
  });
}

test("14 dígitos que não formam CNPJ válido nunca viram document (nunca chute o cliente)", () => {
  // Mesmo caso da tabela, isolado: dígito verificador incorreto.
  const resultado = parseFilename("boleto protocolo 99999999999999 08-2026.pdf");
  assert.equal(resultado.document, null);
});

test("CPF com todos os dígitos iguais é rejeitado mesmo com 11 dígitos", () => {
  const resultado = parseFilename("das-11111111111-2026-08.pdf");
  assert.equal(resultado.document, null);
});
