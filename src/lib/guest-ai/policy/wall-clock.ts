/**
 * Horário "de parede" do imóvel → instante absoluto. PURO e determinístico:
 * nenhuma função aqui lê o relógio do sistema, o banco ou a rede.
 *
 * ESTRATÉGIA PARA HORÁRIO DE VERÃO (documentada, testada em `wall-clock.test.ts`):
 *  - horário local INEXISTENTE (salto para a frente, ex. 01:30 em 29/03/2026 em
 *    Europe/Lisbon): nenhum instante real tem esse relógio local;
 *  - horário local AMBÍGUO (volta do relógio, ex. 01:30 em 25/10/2026 em
 *    Europe/Lisbon): dois instantes reais têm esse relógio local.
 *  Em ambos os casos o chamador escolhe `prefer`: "later" para o INÍCIO da
 *  liberação (libera mais tarde = mais conservador) e "earlier" para o CORTE do
 *  checkout (corta mais cedo = mais conservador). Nunca se resolve para o lado
 *  que libera mais credenciais.
 */
import { partsInTZ } from "@/lib/property-timezone";

export type WallClockPrefer = "earlier" | "later";

const IANA_RE = /^(?:UTC|[A-Za-z]+(?:_[A-Za-z]+)*(?:\/[A-Za-z0-9_+-]+)+)$/;

/** Aceita só identificador IANA (Região/Cidade). Offsets fixos ("+03:00", "GMT-3") são recusados. */
export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !IANA_RE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** "15:00" | "15:00:00" → [h, m]. Qualquer outra coisa → null. */
export function parseHm(value: unknown): [number, number] | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(mi) || h > 23 || mi > 59) return null;
  return [h, mi];
}

/** "2026-11-02" → [2026, 11, 2] (calendário real; recusa 2026-02-30). */
export function parseIsoDate(value: unknown): [number, number, number] | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return [y, mo, d];
}

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Instante ISO 8601 COM designador de fuso (Z ou ±HH:MM). Data solta ("2026-11-02") é recusada. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_INSTANT_RE.test(value.trim())) return null;
  const t = Date.parse(value.trim());
  return Number.isNaN(t) ? null : new Date(t);
}

function offsetAt(ms: number, tz: string): number {
  const p = partsInTZ(new Date(ms), tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Instante absoluto de `AAAA-MM-DD` + `HH:MM` no fuso `tz`.
 * Devolve `null` se data, hora ou fuso forem inválidos.
 */
export function wallClockToInstant(
  dateIso: unknown,
  hm: unknown,
  tz: unknown,
  prefer: WallClockPrefer,
): Date | null {
  const date = parseIsoDate(dateIso);
  const time = parseHm(hm);
  if (!date || !time || !isValidIanaTimezone(tz)) return null;
  const [y, mo, d] = date;
  const [h, mi] = time;
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  const DAY = 86_400_000;
  // Os dois deslocamentos possíveis em volta da data (antes/depois de uma transição).
  const offsets = Array.from(new Set([offsetAt(naive - DAY, tz), offsetAt(naive + DAY, tz)]));
  const candidates = offsets.map((o) => naive - o).sort((a, b) => a - b);
  const matchesWall = (ms: number) => {
    const p = partsInTZ(new Date(ms), tz);
    return p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi;
  };
  const valid = candidates.filter(matchesWall);
  const pool = valid.length > 0 ? valid : candidates; // sem válido = horário inexistente (salto)
  const pick = prefer === "earlier" ? pool[0] : pool[pool.length - 1];
  return pick === undefined ? null : new Date(pick);
}

/**
 * B3.2 — classificação do horário local num fuso: `valid` (um único instante), `nonexistent`
 * (salto do horário de verão), `ambiguous` (repetido no fim do horário de verão) ou `invalid`
 * (data, hora ou fuso inválidos). Usada pela G.2 para NEGAR horários sem referencial único.
 */
export function wallClockStatus(dateIso: unknown, hm: unknown, tz: unknown): "valid" | "nonexistent" | "ambiguous" | "invalid" {
  const date = parseIsoDate(dateIso);
  const time = parseHm(hm);
  if (!date || !time || !isValidIanaTimezone(tz)) return "invalid";
  const [y, mo, d] = date;
  const [h, mi] = time;
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  const DAY = 86_400_000;
  const offsets = Array.from(new Set([offsetAt(naive - DAY, tz), offsetAt(naive, tz), offsetAt(naive + DAY, tz)]));
  const valid = Array.from(new Set(offsets.map((o) => naive - o))).filter((ms) => {
    const p = partsInTZ(new Date(ms), tz);
    return p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi;
  });
  if (valid.length === 0) return "nonexistent";
  return valid.length > 1 ? "ambiguous" : "valid";
}

/** "2026-11-02" + n dias, no calendário (sem fuso). */
export function addDaysIso(dateIso: string, days: number): string | null {
  const date = parseIsoDate(dateIso);
  if (!date) return null;
  const dt = new Date(Date.UTC(date[0], date[1] - 1, date[2]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
