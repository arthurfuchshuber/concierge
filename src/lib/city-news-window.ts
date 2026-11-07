/**
 * "O que rola na cidade" (Home do Guia Digital) — regras PURAS compartilhadas entre o feed público
 * (`city-news.functions.ts`), a IA do hóspede (`guest-ai/data/city-events.server.ts`) e a validação do item
 * clicado no guia (`guide-context.server.ts`). Uma regra só: o que a IA conhece é exatamente o que a Home
 * pode mostrar.
 */

export type CityNewsItemLike = {
  title?: string | null;
  category?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Janela editorial: 7 dias (hoje + 6). A busca roda toda quarta às 8h. */
export const NEWS_WINDOW_DAYS = 6;

/** Edições gravadas aceitas (dias para trás), a mesma do feed público. */
export const NEWS_LOOKBACK_DAYS = 8;

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Regra de ouro do calendário: nada que já aconteceu chega ao hóspede, e nada distante demais.
 * - Itens de categoria "evento" só passam com data confirmada.
 * - Um evento é válido enquanto (endDate ?? startDate) >= hoje e começa até hoje + janela.
 * - Itens perenes (restaurante, passeio, natureza…) não têm data e seguem válidos.
 */
export function filterUpcoming<T extends CityNewsItemLike>(items: T[], today: string): T[] {
  const horizon = addDaysIso(today, NEWS_WINDOW_DAYS);
  return items.filter((it) => {
    const isEvent = (it.category ?? "").toLowerCase() === "evento";
    const start = it.startDate && ISO_DATE.test(it.startDate) ? it.startDate : null;
    const end = it.endDate && ISO_DATE.test(it.endDate) ? it.endDate : null;
    const last = end ?? start;
    if (isEvent && !last) return false; // evento sem data confirmada nunca é exibido
    if (last && last < today) return false; // já aconteceu
    if (start && start > horizon) return false; // fora da janela
    return true;
  });
}

/**
 * Id estável de um item do feed (o feed não grava id): FNV-1a de título normalizado + data de início.
 * O mesmo item gera o mesmo id no guia (evento do chat) e no servidor (IA e validação).
 */
export function cityNewsItemId(it: CityNewsItemLike): string {
  const title = (it.title ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const key = `${title}|${it.startDate && ISO_DATE.test(it.startDate) ? it.startDate : ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `evt-${h.toString(16).padStart(8, "0")}`;
}
