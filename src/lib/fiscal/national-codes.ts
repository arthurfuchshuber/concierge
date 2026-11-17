/**
 * Catálogo de códigos de tributação nacional (LC 116/2003 → 6 dígitos: item.subitem.desdobro) para a busca da janela
 * "Adicionar serviço". Catálogo INICIAL, só com códigos conferidos nos mockups; a carga da tabela oficial completa do
 * Ambiente Nacional substitui `NATIONAL_SERVICE_CODES` sem mudar a interface (pendência registrada).
 */
export interface NationalServiceCode { code: string; description: string }

export const NATIONAL_SERVICE_CODES: ReadonlyArray<NationalServiceCode> = [
  { code: "100501", description: "Agenciamento, corretagem ou intermediação de bens móveis ou imóveis, não abrangidos em outros itens ou subitens, por quaisquer meios." },
  { code: "170101", description: "Assessoria ou consultoria de qualquer natureza, não contida em outros itens desta lista; análise, exame, pesquisa, coleta, compilação e fornecimento de dados e informações de qualquer natureza, inclusive cadastro e similares." },
  { code: "171901", description: "Contabilidade, inclusive serviços técnicos e auxiliares." },
  { code: "172001", description: "Consultoria e assessoria econômica ou financeira." },
];

export const formatNationalCode = (code: string) => code.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1.$2.$3");
const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca por código (com ou sem pontos) ou por trecho da descrição; no máximo `limit` resultados. */
export function searchNationalCodes(query: string, limit = 8): NationalServiceCode[] {
  const q = norm(query).trim();
  if (!q) return NATIONAL_SERVICE_CODES.slice(0, limit) as NationalServiceCode[];
  const digits = q.replace(/\D/g, "");
  return NATIONAL_SERVICE_CODES.filter((c) => (digits && c.code.startsWith(digits)) || norm(c.description).includes(q) || formatNationalCode(c.code).includes(q)).slice(0, limit);
}

/** Sugestão pelo CNAE principal (7 dígitos): imobiliário (68xx) e hospedagem (55xx) → 10.05.01, como no mockup aprovado. */
export function suggestServiceForCnae(cnae: string | null | undefined): { nationalCode: string; title: string; description: string } | null {
  const c = String(cnae ?? "").replace(/\D/g, "");
  if (!/^(68|55)/.test(c)) return null;
  const hit = NATIONAL_SERVICE_CODES.find((x) => x.code === "100501")!;
  return { nationalCode: hit.code, title: "Gestão de imóveis e serviços para hospedagem", description: hit.description };
}
