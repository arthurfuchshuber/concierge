// Regras PURAS para trocar a reserva do iCal pela reserva da API (Channex) sem perder vínculos.
// O iCal não traz o código de confirmação, então o par é imóvel + datas de entrada e saída.

export type StayRow = { id: string; property_id: string; checkin_date: string; checkout_date: string; status: string | null; source: string; raw_summary?: string | null };
export type CardRow = { id: string; reservation_id: string; kind: string; status?: string | null; concluded_at?: string | null; cleaning_type?: string | null };

export const SUPERSEDED_TAG = "[substituída pela API Channex]";

const live = (s: string | null | undefined) => !String(s ?? "").toLowerCase().includes("cancel");

/** Emparelha cada reserva ativa do iCal (inclusive o bloqueio "Not available" da mesma estadia) com a reserva da API. */
export function pairIcalWithApi(rows: StayRow[]): Array<{ ical: StayRow; api: StayRow }> {
  const api = rows.filter((r) => r.source === "channex" && live(r.status));
  const out: Array<{ ical: StayRow; api: StayRow }> = [];
  for (const i of rows) {
    if (i.source !== "airbnb" || !live(i.status)) continue;
    const hit = api.find((a) => a.property_id === i.property_id && a.checkin_date === i.checkin_date && a.checkout_date === i.checkout_date);
    if (hit) out.push({ ical: i, api: hit });
  }
  return out;
}

const progressed = (c: CardRow) => !!c.concluded_at || !!c.cleaning_type || String(c.status ?? "") === "done";

/**
 * Por tipo de cartão (chegada/saída): se a API não tem, o do iCal é movido; se os dois existem,
 * fica o que tem mais andamento (concluído / limpeza / feito). Nada é apagado sem o outro cobrir.
 */
export function planCards(icalCards: CardRow[], apiCards: CardRow[]): { moveIds: string[]; dropIds: string[] } {
  const moveIds: string[] = [];
  const dropIds: string[] = [];
  for (const kind of new Set([...icalCards, ...apiCards].map((c) => c.kind))) {
    const ic = icalCards.filter((c) => c.kind === kind);
    const ac = apiCards.filter((c) => c.kind === kind);
    if (!ic.length) continue;
    if (!ac.length) {
      moveIds.push(...ic.map((c) => c.id));
      continue;
    }
    const icBest = ic.some(progressed);
    const acBest = ac.some(progressed);
    if (icBest && !acBest) {
      dropIds.push(...ac.map((c) => c.id));
      moveIds.push(...ic.map((c) => c.id));
    }
    // senão a API já tem o cartão (igual ou mais adiantado): o do iCal fica para trás com a reserva aposentada
  }
  return { moveIds, dropIds };
}
