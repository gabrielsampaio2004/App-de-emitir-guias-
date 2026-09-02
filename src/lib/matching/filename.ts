/**
 * O coração do produto: descobrir de quem é a guia sem o contador digitar nada.
 *
 * Cobre os formatos que os portais e sistemas contábeis costumam gerar:
 *   DAS_11222333000181_2026-08.pdf
 *   darf-529.982.247-25-082026.pdf
 *   11222333000181 - FGTS - 08_2026.pdf
 *
 * O CPF/CNPJ é aceito só se o dígito verificador fechar. Isso evita casar com
 * número de protocolo, código de barras ou data solta no nome do arquivo.
 * Quando nada bate, devolve null e o documento cai em revisão manual — melhor
 * pedir confirmação do que mandar a guia do João para a Maria.
 */

export interface ParsedFilename {
  document: string | null;    // CPF/CNPJ, só dígitos
  kind: string | null;        // DAS, DARF, FGTS...
  competencia: string | null; // "2026-08"
}

const KINDS = ["DAS", "DARF", "DCTF", "FGTS", "GPS", "GARE", "ISS", "BOLETO", "INSS"];

export function parseFilename(filename: string): ParsedFilename {
  const base = filename.replace(/\.[^.]+$/, "");
  const upper = base.toUpperCase();

  return {
    document: extractDocument(base),
    kind:
      KINDS.find((k) => new RegExp(`(?<![A-Z])${k}(?![A-Z])`).test(upper)) ??
      null,
    competencia: extractCompetencia(base),
  };
}

function extractDocument(s: string): string | null {
  // Pega cada bloco de dígitos e separadores, depois desliza uma janela
  // procurando um CNPJ (14) ou CPF (11) cujo dígito verificador feche.
  for (const run of s.match(/[\d.\-/]{11,}/g) ?? []) {
    const digits = run.replace(/\D/g, "");
    for (const len of [14, 11] as const) {
      for (let i = 0; i + len <= digits.length; i++) {
        const cand = digits.slice(i, i + len);
        if (len === 14 ? isValidCNPJ(cand) : isValidCPF(cand)) return cand;
      }
    }
  }
  return null;
}

function extractCompetencia(s: string): string | null {
  const iso = s.match(/(20\d{2})[-_](0[1-9]|1[0-2])/); // 2026-08
  if (iso) return `${iso[1]}-${iso[2]}`;

  const br = s.match(/(0[1-9]|1[0-2])[-_](20\d{2})/); // 08-2026
  if (br) return `${br[2]}-${br[1]}`;

  const glued = s.match(/(?<!\d)(0[1-9]|1[0-2])(20\d{2})(?!\d)/); // 082026
  if (glued) return `${glued[2]}-${glued[1]}`;

  return null;
}

function isValidCPF(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (const [len, start] of [[9, 10], [10, 11]] as const) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (start - i);
    let dv = (sum * 10) % 11;
    if (dv === 10) dv = 0;
    if (dv !== Number(cpf[len])) return false;
  }
  return true;
}

function isValidCNPJ(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const len of [12, 13] as const) {
    const w = weights.slice(13 - len);
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * w[i];
    const rest = sum % 11;
    const dv = rest < 2 ? 0 : 11 - rest;
    if (dv !== Number(cnpj[len])) return false;
  }
  return true;
}
