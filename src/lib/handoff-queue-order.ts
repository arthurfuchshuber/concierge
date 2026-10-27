/**
 * ORDEM DA FILA DE AVISOS DO HÓSPEDE (mockup "Playbook atual" aprovado, 27/10/2026).
 *
 * Quando mais de um hóspede aguarda atendimento, os avisos formam um LEQUE ao redor do
 * botão da IA, ordenado pelo CHECK-IN MAIS PRÓXIMO: o topo do arco é a estadia mais
 * próxima; seguindo para a esquerda vêm as seguintes; o que não cabe vira "+N".
 *
 * Regras (puras, sem rede):
 *  · estadia que já começou (check-in hoje ou no passado, checkout ainda não passou)
 *    conta como a mais próxima — quem está hospedado e precisa de ajuda vem primeiro;
 *  · depois, check-ins futuros do mais próximo para o mais distante;
 *  · sem data de check-in vai para o fim;
 *  · empate: o aviso mais antigo primeiro (quem esperou mais).
 */
export type QueueOrderItem = {
  id: string;
  checkinDate: string | null;
  checkoutDate: string | null;
  /** ISO do momento em que o chamado entrou na fila (desempate). */
  at: string | null;
};

const SP_TZ = "America/Sao_Paulo";

/** "AAAA-MM-DD" de hoje no fuso de São Paulo. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

/** Dias entre hoje e o check-in (negativo = já começou). `null` sem data válida. */
export function daysUntilCheckin(checkinDate: string | null, now: Date = new Date()): number | null {
  if (!checkinDate || !/^\d{4}-\d{2}-\d{2}/.test(checkinDate)) return null;
  return dayNumber(checkinDate) - dayNumber(todayInSaoPaulo(now));
}

/** Chave de ordenação: quanto menor, mais urgente. */
function urgencyKey(item: QueueOrderItem, now: Date): number {
  const d = daysUntilCheckin(item.checkinDate, now);
  if (d === null) return Number.MAX_SAFE_INTEGER;
  // Estadia em andamento (check-in já passou, saída ainda não): vale como "hoje".
  if (d <= 0) {
    const out = item.checkoutDate ? daysUntilCheckin(item.checkoutDate, now) : null;
    if (out !== null && out < 0) return Number.MAX_SAFE_INTEGER - 1; // já terminou: perde para qualquer futura
    return 0;
  }
  return d;
}

export function sortByNearestCheckin<T extends QueueOrderItem>(items: T[], now: Date = new Date()): T[] {
  return items
    .map((it, i) => ({ it, i, k: urgencyKey(it, now) }))
    .sort((a, b) => {
      if (a.k !== b.k) return a.k - b.k;
      const ta = a.it.at ? Date.parse(a.it.at) : NaN;
      const tb = b.it.at ? Date.parse(b.it.at) : NaN;
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return a.i - b.i;
    })
    .map((x) => x.it);
}

/** "1º", "2º"… (o mockup usa "1º · check-in em 7 dias"; "1ª" só na descrição de acessibilidade). */
export function ordinalLabel(position: number): string {
  return `${position}º`;
}

/** "check-in em 7 dias" / "check-in amanhã" / "check-in hoje" / "em estadia" / "" sem data. */
export function checkinPhrase(checkinDate: string | null, checkoutDate: string | null, now: Date = new Date()): string {
  const d = daysUntilCheckin(checkinDate, now);
  if (d === null) return "";
  if (d > 1) return `check-in em ${d} dias`;
  if (d === 1) return "check-in amanhã";
  if (d === 0) return "check-in hoje";
  const out = checkoutDate ? daysUntilCheckin(checkoutDate, now) : null;
  return out !== null && out < 0 ? "" : "em estadia";
}

/** "2026-11-03" → "03/11/2026". */
export function brDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

/** "03/11" (curto, para a descrição de acessibilidade do leque). */
export function brDayMonth(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}` : iso;
}

/** "agora" (< 1 min), "há 5 min", "há 2 h", "há 3 d". */
export function agoLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "agora";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "agora";
  const min = Math.floor((now.getTime() - t) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}
