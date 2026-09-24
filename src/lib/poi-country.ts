/**
 * PONTOS DO OUTRO LADO DA FRONTEIRA (auditoria das recomendações, 24/09/2026).
 *
 * Em cidade de fronteira (Foz do Iguaçu), o raio de 35–50 km da geração pega
 * lugares no Paraguai e na Argentina. O anfitrião de Foz queria esses pontos
 * separados — e, sem ter como fazer isso, renomeou a categoria GLOBAL
 * "Compras" para "No Paraguai", o que contaminou os guias de todas as outras
 * cidades. Agora isso sai sozinho: quando o endereço do lugar está em OUTRO
 * país que não o da cidade do guia, a categoria vira "No Paraguai" / "Na
 * Argentina" / etc. Numa cidade sem fronteira por perto, nenhum lugar cai
 * nessa regra — a categoria continua a do tipo (Compras, Restaurantes…).
 */
const COUNTRY_ALIASES: Record<string, string> = {
  br: "BR",
  brasil: "BR",
  brazil: "BR",
  py: "PY",
  paraguai: "PY",
  paraguay: "PY",
  ar: "AR",
  argentina: "AR",
  uy: "UY",
  uruguai: "UY",
  uruguay: "UY",
  bo: "BO",
  bolivia: "BO",
  cl: "CL",
  chile: "CL",
  pe: "PE",
  peru: "PE",
  co: "CO",
  colombia: "CO",
  ve: "VE",
  venezuela: "VE",
  gy: "GY",
  guiana: "GY",
  guyana: "GY",
  sr: "SR",
  suriname: "SR",
  gf: "GF",
  "guiana francesa": "GF",
  "french guiana": "GF",
};
const CROSS_BORDER_LABEL: Record<string, string> = {
  BR: "No Brasil",
  PY: "No Paraguai",
  AR: "Na Argentina",
  UY: "No Uruguai",
  BO: "Na Bolívia",
  CL: "No Chile",
  PE: "No Peru",
  CO: "Na Colômbia",
  VE: "Na Venezuela",
  GY: "Na Guiana",
  SR: "No Suriname",
  GF: "Na Guiana Francesa",
};
export function countryIsoFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const k = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  return COUNTRY_ALIASES[k] ?? null;
}
/** País de um endereço formatado do Google ("…, Ciudad del Este, Paraguai"). */
export function countryIsoFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const last = address.split(",").pop() ?? "";
  return countryIsoFromText(last);
}
/** Categoria de fronteira, ou null quando o lugar é do mesmo país da cidade. */
export function crossBorderCategory(
  placeAddress: string | null | undefined,
  cityCountry: string | null | undefined,
): string | null {
  const placeIso = countryIsoFromAddress(placeAddress);
  const cityIso = countryIsoFromText(cityCountry);
  if (!placeIso || !cityIso || placeIso === cityIso) return null;
  return CROSS_BORDER_LABEL[placeIso] ?? null;
}
