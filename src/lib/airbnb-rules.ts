/**
 * "REGRAS ADICIONAIS" DO AIRBNB → "REGRAS DO ESPAÇO" DO GUIA.
 *
 * Pedido explícito (01/10/2026): "todo o conteúdo que esteja dentro de
 * 'Regras adicionais' no scrap seja direcionado também para o campo 'regras
 * da casa', exatamente como fizemos com os horários — e eu quero o conteúdo
 * limpo: se tiver hífen ou qualquer coisa antes da frase de cada linha, limpa,
 * pois já temos a nossa estrutura linha a linha".
 *
 * O cartão "Regras da casa" do Airbnb tem TRÊS partes (Durante sua estadia /
 * Regras adicionais / Antes de deixar o local) e `airbnb_house_rules` guarda
 * as três juntas, só para leitura. O campo "Regras do espaço" (`house_rules`)
 * é o do guia: uma regra por linha. Só a parte "Regras adicionais" vai para
 * ele, e cada linha chega sem marcador.
 *
 * Mora num arquivo PURO (sem servidor, sem rede) para ser testado de verdade.
 */

/** Tamanho máximo do campo "Regras do espaço" (ver `maxLength` do editor). */
export const HOUSE_RULES_MAX = 3000;

// Marcadores que o Airbnb/Firecrawl deixam no começo de uma linha: hífens de
// vários tipos (inclusive o "\-" escapado do markdown), bolinhas, asteriscos,
// setas e numeração ("1." / "1)"). Repetido em laço porque pode vir mais de
// um colado ("- • texto", "1) - texto").
const LEADING_MARKER = /^\s*(?:\\?[-–—−‐‑•·▪▫◦●○■□*›»>]+|\d{1,2}[.)])\s*/;

const ADDITIONAL_HEADING =
  /^\s*(?:#{1,6}\s*)?\**\s*(regras adicionais|additional rules)\s*\**\s*:?\s*$/i;

// Os outros dois títulos do cartão — o que fecha a seção "Regras adicionais".
const OTHER_HEADINGS =
  /^\s*(?:#{1,6}\s*)?\**\s*(antes de deixar o local|before you leave|durante sua estadia|during your stay)\s*\**\s*:?\s*$/i;

/** Tira os marcadores do começo de UMA linha e os `**` de negrito. */
export function stripRuleMarker(line: string): string {
  let out = line;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(LEADING_MARKER, "");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Texto cru → uma regra por linha, sem marcador, sem linha em branco e sem o
 * título "Regras adicionais" (o modelo às vezes o devolve junto). Devolve
 * `null` quando não sobra nada. Respeita o limite do campo cortando numa
 * linha inteira — nunca no meio de uma regra.
 */
export function cleanRuleLines(
  text: string | null | undefined,
  max = HOUSE_RULES_MAX,
): string | null {
  if (!text) return null;
  const lines = text
    .split(/\r?\n/)
    .filter((l) => !ADDITIONAL_HEADING.test(l) && !OTHER_HEADINGS.test(l))
    .map(stripRuleMarker)
    .filter(Boolean);
  if (lines.length === 0) return null;
  const kept: string[] = [];
  let size = 0;
  for (const l of lines) {
    const add = l.length + (kept.length ? 1 : 0);
    if (size + add > max) break;
    kept.push(l);
    size += add;
  }
  return kept.length ? kept.join("\n") : null;
}

/**
 * Plano B: acha a parte "Regras adicionais" dentro do texto das três partes
 * (`house_rules` do scrap, ou `airbnb_house_rules` salvo). Vai do título até o
 * próximo título do cartão (ou o fim do texto).
 */
export function extractAdditionalRules(houseRulesText: string | null | undefined): string | null {
  if (!houseRulesText) return null;
  const lines = houseRulesText.split(/\r?\n/);
  const start = lines.findIndex((l) => ADDITIONAL_HEADING.test(l));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => OTHER_HEADINGS.test(l));
  return cleanRuleLines((end === -1 ? rest : rest.slice(0, end)).join("\n"));
}
