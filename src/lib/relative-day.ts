/**
 * PALAVRA RELATIVA NO LUGAR DA DATA (regra global de 23/11/2026): Hoje, Amanhã, Ontem, Anteontem e Depois de
 * Amanhã substituem a data quando couberem; fora dessa janela de ±2 dias, a data "dd/mm/aaaa". Quem desenha
 * mostra a palavra SEMPRE em negrito e na cor do status (ver `RelDay`, `src/components/handoff/stay-view.tsx`).
 * Datas no fuso de São Paulo. Puro: sem relógio próprio quando `today` é informado.
 */
const WORDS: Record<number, string> = { 0: "Hoje", 1: "Amanhã", [-1]: "Ontem", [-2]: "Anteontem", 2: "Depois de Amanhã" };
const DAY = 86_400_000;

export function todaySaoPauloIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

const dayNum = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);

/** Palavra relativa ("Hoje"…) ou `null` quando a data está fora de ±2 dias. */
export function relativeDayWord(iso: string | null | undefined, today: string = todaySaoPauloIso()): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  return WORDS[dayNum(iso) - dayNum(today)] ?? null;
}

/** "2026-11-19" → "19/11/2026". */
export function formatDayBR(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}
