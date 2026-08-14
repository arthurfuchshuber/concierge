/**
 * Fuso horário do IMÓVEL (cidade/país), nunca o do aparelho do hóspede.
 * Todas as contagens e horários exibidos no guia devem usar estas funções.
 */

const DEFAULT_TZ = "America/Sao_Paulo";

function norm(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Cidades brasileiras fora de America/Sao_Paulo (e capitais vizinhas comuns). */
const CITY_TZ: Record<string, string> = {
  manaus: "America/Manaus",
  "boa vista": "America/Boa_Vista",
  "porto velho": "America/Porto_Velho",
  "rio branco": "America/Rio_Branco",
  cuiaba: "America/Cuiaba",
  "campo grande": "America/Campo_Grande",
  "fernando de noronha": "America/Noronha",
  "ciudad del este": "America/Asuncion",
  asuncion: "America/Asuncion",
  "puerto iguazu": "America/Argentina/Buenos_Aires",
  "buenos aires": "America/Argentina/Buenos_Aires",
  montevideu: "America/Montevideo",
  montevideo: "America/Montevideo",
  santiago: "America/Santiago",
  lisboa: "Europe/Lisbon",
  lisbon: "Europe/Lisbon",
  porto: "Europe/Lisbon",
  madri: "Europe/Madrid",
  madrid: "Europe/Madrid",
  miami: "America/New_York",
  orlando: "America/New_York",
  "nova york": "America/New_York",
  "new york": "America/New_York",
  "los angeles": "America/Los_Angeles",
  "cidade do mexico": "America/Mexico_City",
  cancun: "America/Cancun",
};

const COUNTRY_TZ: Record<string, string> = {
  brasil: DEFAULT_TZ,
  brazil: DEFAULT_TZ,
  br: DEFAULT_TZ,
  paraguai: "America/Asuncion",
  paraguay: "America/Asuncion",
  py: "America/Asuncion",
  argentina: "America/Argentina/Buenos_Aires",
  ar: "America/Argentina/Buenos_Aires",
  uruguai: "America/Montevideo",
  uruguay: "America/Montevideo",
  uy: "America/Montevideo",
  chile: "America/Santiago",
  cl: "America/Santiago",
  portugal: "Europe/Lisbon",
  pt: "Europe/Lisbon",
  espanha: "Europe/Madrid",
  spain: "Europe/Madrid",
  es: "Europe/Madrid",
  mexico: "America/Mexico_City",
  mx: "America/Mexico_City",
};

export function propertyTimeZone(
  city?: string | null,
  country?: string | null,
): string {
  const c = norm(city);
  if (c) {
    const key = Object.keys(CITY_TZ).find((k) => c === k || c.startsWith(`${k} `) || c.includes(k));
    if (key) return CITY_TZ[key];
  }
  const co = norm(country);
  if (co && COUNTRY_TZ[co]) return COUNTRY_TZ[co];
  return DEFAULT_TZ;
}

type Parts = { y: number; mo: number; d: number; h: number; mi: number; s: number };

/** Componentes de data/hora de um instante, no fuso informado. */
export function partsInTZ(date: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    mo: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour === "24" ? "0" : p.hour),
    mi: Number(p.minute),
    s: Number(p.second),
  };
}

function offsetMs(date: Date, tz: string): number {
  const p = partsInTZ(date, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instante UTC correspondente a uma data/hora "de parede" no fuso do imóvel. */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  let ts = naive - offsetMs(new Date(naive), tz);
  // Segunda passada resolve bordas de horário de verão.
  ts = naive - offsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** Data de hoje (YYYY-MM-DD) no fuso do imóvel. */
export function todayInTZ(tz: string, now: Date = new Date()): string {
  const p = partsInTZ(now, tz);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
