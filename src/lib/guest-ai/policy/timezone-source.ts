/**
 * F2-B · B3.2 — FUSO IANA DO IMÓVEL COM ORIGEM DECLARADA (puro).
 *
 * B3.0 Rev. 2 §6.2: a derivação atual do SaaS (`propertyTimeZoneOrNull(city, country)`) não é
 * inequívoca — "Brasil" vira sempre `America/Sao_Paulo` (o país tem quatro fusos) e a tabela de
 * cidades casa sem conferir o país. Para o R6/G.2 só vale um fuso cuja origem seja PROVÁVEL:
 *
 *  - `explicit`: coluna de fuso explícita no imóvel (não existe hoje; o campo fica previsto);
 *  - `single_zone_country`: país com um único identificador IANA efetivo (Paraguai, Uruguai);
 *  - `verified_state`: país com vários fusos + estado de uma tabela verificada em que o estado
 *    inteiro usa um único identificador IANA.
 *
 * Estado com mais de um identificador (AM, PA, PE — Fernando de Noronha), estado ausente/desconhecido,
 * país desconhecido, cidade sozinha ou divergência entre a coluna explícita e a derivação ⇒ `null`
 * com motivo. A função antiga do SaaS continua intacta para o resto do sistema; aqui ela não é usada.
 *
 * Tabela conferida no tzdb (zone1970.tab / zone.tab, 2025): estados com um único identificador.
 */
import { isValidIanaTimezone } from "./wall-clock";

export const TIMEZONE_SOURCE_VERSION = "tz-source.2026-11-03.1";

export type TimezoneSource = "explicit" | "single_zone_country" | "verified_state";
export type TimezoneUnresolved =
  | "country_missing"
  | "country_unknown"
  | "state_missing"
  | "state_unknown"
  | "state_multi_zone"
  | "explicit_invalid"
  | "explicit_conflict";

export type PropertyTimezone =
  | { status: "resolved"; timezone: string; source: TimezoneSource; ambiguous: false }
  | { status: "unresolved"; timezone: null; source: null; reason: TimezoneUnresolved };

const BR_STATES: Readonly<Record<string, string>> = Object.freeze({
  AC: "America/Rio_Branco",
  AL: "America/Maceio",
  AP: "America/Belem",
  BA: "America/Bahia",
  CE: "America/Fortaleza",
  DF: "America/Sao_Paulo",
  ES: "America/Sao_Paulo",
  GO: "America/Sao_Paulo",
  MA: "America/Fortaleza",
  MG: "America/Sao_Paulo",
  MS: "America/Campo_Grande",
  MT: "America/Cuiaba",
  PB: "America/Fortaleza",
  PI: "America/Fortaleza",
  PR: "America/Sao_Paulo",
  RJ: "America/Sao_Paulo",
  RN: "America/Fortaleza",
  RO: "America/Porto_Velho",
  RR: "America/Boa_Vista",
  RS: "America/Sao_Paulo",
  SC: "America/Sao_Paulo",
  SE: "America/Maceio",
  SP: "America/Sao_Paulo",
  TO: "America/Araguaina",
});
/** Estados brasileiros com MAIS de um identificador IANA: exigem fonte explícita. */
const BR_MULTI_ZONE: ReadonlySet<string> = new Set(["AM", "PA", "PE"]);
const SINGLE_ZONE_COUNTRIES: Readonly<Record<string, string>> = Object.freeze({ paraguai: "America/Asuncion", paraguay: "America/Asuncion", uruguai: "America/Montevideo", uruguay: "America/Montevideo" });
const BRAZIL = new Set(["brasil", "brazil", "br"]);

const norm = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return s ? s : null;
};

function derive(country: unknown, state: unknown): PropertyTimezone {
  const c = norm(country);
  if (!c) return { status: "unresolved", timezone: null, source: null, reason: "country_missing" };
  const single = SINGLE_ZONE_COUNTRIES[c];
  if (single) return { status: "resolved", timezone: single, source: "single_zone_country", ambiguous: false };
  if (!BRAZIL.has(c)) return { status: "unresolved", timezone: null, source: null, reason: "country_unknown" };
  const s = norm(state)?.toUpperCase() ?? null;
  if (!s) return { status: "unresolved", timezone: null, source: null, reason: "state_missing" };
  if (BR_MULTI_ZONE.has(s)) return { status: "unresolved", timezone: null, source: null, reason: "state_multi_zone" };
  const tz = BR_STATES[s];
  if (!tz) return { status: "unresolved", timezone: null, source: null, reason: "state_unknown" };
  return { status: "resolved", timezone: tz, source: "verified_state", ambiguous: false };
}

/**
 * `explicit` (coluna futura) tem precedência, mas precisa ser IANA válida e, havendo derivação
 * resolvida, coincidir com ela; divergência ⇒ conflito ⇒ não resolvido.
 */
export function resolvePropertyTimezone(input: { explicit?: unknown; country: unknown; state: unknown }): PropertyTimezone {
  const derived = derive(input?.country, input?.state);
  const ex = input?.explicit;
  if (ex !== undefined && ex !== null && ex !== "") {
    if (!isValidIanaTimezone(ex) || !/\//.test(String(ex))) return { status: "unresolved", timezone: null, source: null, reason: "explicit_invalid" };
    if (derived.status === "resolved" && derived.timezone !== ex) return { status: "unresolved", timezone: null, source: null, reason: "explicit_conflict" };
    return { status: "resolved", timezone: String(ex), source: "explicit", ambiguous: false };
  }
  return derived;
}
