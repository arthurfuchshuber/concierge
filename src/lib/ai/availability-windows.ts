/**
 * Contra-proposta de datas: dado o calendário ocupado de um imóvel, acha
 * (1) trechos livres DENTRO do período pedido e (2) o período livre de mesma
 * duração mais próximo do pedido. Puro — sem banco — para ser testável.
 * Datas AAAA-MM-DD; `saida` não conta como noite ocupada.
 */
export type Busy = { checkin_date: string; checkout_date: string };
export type Window = { entrada: string; saida: string; noites: number };

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toISO(toMs(d) + n * DAY);
const nights = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);

function nightBusy(busy: Busy[], night: string): boolean {
  return busy.some((b) => b.checkin_date <= night && night < b.checkout_date);
}

/** Trechos livres contíguos dentro de [entrada, saida) com pelo menos `minNoites`. */
export function partialWindows(busy: Busy[], entrada: string, saida: string, minNoites = 1): Window[] {
  const out: Window[] = [];
  let start: string | null = null;
  for (let d = entrada; d <= saida; d = addDays(d, 1)) {
    const free = d < saida && !nightBusy(busy, d);
    if (free && start == null) start = d;
    if (!free && start != null) {
      const n = nights(start, d);
      if (n >= minNoites) out.push({ entrada: start, saida: d, noites: n });
      start = null;
    }
  }
  return out.sort((a, b) => b.noites - a.noites);
}

/**
 * Período livre com a MESMA duração mais próximo do pedido (antes ou depois),
 * nunca antes de `hoje`, procurando até `raioDias` de deslocamento.
 */
export function nearestShiftedWindow(
  busy: Busy[],
  entrada: string,
  saida: string,
  hoje: string,
  raioDias = 21,
): Window | null {
  const n = nights(entrada, saida);
  const free = (start: string) => {
    for (let i = 0; i < n; i++) if (nightBusy(busy, addDays(start, i))) return false;
    return true;
  };
  for (let k = 1; k <= raioDias; k++) {
    for (const s of [k, -k]) {
      const start = addDays(entrada, s);
      if (start < hoje) continue;
      if (free(start)) return { entrada: start, saida: addDays(start, n), noites: n };
    }
  }
  return null;
}
