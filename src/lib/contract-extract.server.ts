// Extração de dados cadastrais a partir do contrato (server-only).
// Lê apenas a PRIMEIRA página do PDF e isola o bloco "CONTRATANTE",
// depois estrutura os campos com o modelo de IA.

export type ContractParty = {
  name: string | null;
  doc: string | null;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  cep: string | null;
  address: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
};

const EMPTY: ContractParty = {
  name: null,
  doc: null,
  birth_date: null,
  email: null,
  phone: null,
  cep: null,
  address: null,
  district: null,
  city: null,
  state: null,
};

/** Texto da primeira página do PDF. */
export async function firstPageText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Não foi possível baixar o contrato (${res.status}).`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text)];
  return String(pages[0] ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Recorta o trecho do "CONTRATANTE" — do rótulo até o próximo bloco
 * (CONTRATADA/CONTRATADO, cláusula, objeto…). Se não achar, devolve o
 * início da página para a IA analisar mesmo assim.
 */
export function contratanteBlock(pageText: string): string {
  const t = pageText;
  const start = t.search(/CONTRATANTE|LOCADOR|PROPRIET[ÁA]RI[OA]/i);
  if (start < 0) return t.slice(0, 3000);
  const rest = t.slice(start);
  const endRe = /(CONTRATAD[AO]|LOCAT[ÁA]RI[OA]|CL[ÁA]USULA|DO OBJETO|RESOLVEM|T[ÊE]M ENTRE SI)/i;
  const end = rest.slice(40).search(endRe);
  return (end > 0 ? rest.slice(0, 40 + end) : rest).slice(0, 3000);
}

function digits(v: unknown) {
  return String(v ?? "").replace(/\D+/g, "");
}

function toIsoDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const br = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/** Usa o modelo de IA para estruturar o bloco em JSON. */
export async function parseContratante(block: string): Promise<ContractParty> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key || !block.trim()) return { ...EMPTY };

  const { chatText } = await import("@/lib/ai/gateway.server");
  const { text: raw } = await chatText(
    "contracts",
    [
      {
        role: "system",
        content:
          "Você extrai dados cadastrais do CONTRATANTE de contratos brasileiros. " +
          "Responda SOMENTE com JSON válido, sem markdown, no formato " +
          '{"name":"","doc":"","birth_date":"DD/MM/AAAA","email":"","phone":"","cep":"","address":"","district":"","city":"","state":""}. ' +
          "Use string vazia quando o dado não estiver no texto. Nunca invente informação. " +
          "address deve conter logradouro, número e complemento. state é a sigla (2 letras).",
      },
      { role: "user", content: block },
    ],
    { json: true, signal: AbortSignal.timeout(120_000) },
  );

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ...EMPTY };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return { ...EMPTY };
  }

  const str = (k: string) => {
    const v = String(parsed[k] ?? "").trim();
    return v ? v : null;
  };
  const doc = digits(parsed["doc"]);
  const phone = digits(parsed["phone"]);
  const cep = digits(parsed["cep"]);

  return {
    name: str("name"),
    doc: doc.length === 11 || doc.length === 14 ? doc : null,
    birth_date: toIsoDate(parsed["birth_date"]),
    email: str("email"),
    phone: phone.length >= 10 ? phone.slice(-11) : null,
    cep: cep.length === 8 ? cep : null,
    address: str("address"),
    district: str("district"),
    city: str("city"),
    state: (str("state") ?? "").slice(0, 2).toUpperCase() || null,
  };
}
