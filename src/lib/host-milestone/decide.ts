/**
 * Marco operacional dito pelo ANFITRIÃO/equipe no chat do Airbnb (14/11/2026).
 * Pura: o modelo só LÊ o contexto (sem lista de palavras); quem decide se pode agir é esta função,
 * com as mesmas travas de data/estado dos marcos do hóspede.
 */
export type HostReading = { milestone: "checkin_done" | "checkout_done" | "none"; confidence: number };

export interface HostMilestoneInput {
  reading: HostReading | null;
  /** Data local de hoje no fuso do imóvel (YYYY-MM-DD) e hora local (HH:MM). */
  today: string | null;
  nowHm: string | null;
  reservation: { status: string | null; checkinDate: string | null; checkoutDate: string | null } | null;
  cards: { checkinDone: boolean; checkoutDone: boolean };
}

export type HostMilestoneDecision =
  | { act: true; action: "checkin_done" | "checkout_done" }
  | { act: false; code: string };

export const HOST_MIN_CONFIDENCE = 0.8;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Quais marcos são plausíveis agora (sem nenhum, nem chama o modelo). */
export function plausibleMilestones(i: Omit<HostMilestoneInput, "reading">): Array<"checkin_done" | "checkout_done"> {
  const r = i.reservation;
  if (!r || !i.today || !r.checkinDate || !r.checkoutDate) return [];
  const st = (r.status ?? "").toLowerCase();
  if (!st || st.includes("cancel") || st.includes("no_show") || st.includes("noshow")) return [];
  const out: Array<"checkin_done" | "checkout_done"> = [];
  const madrugada = !!i.nowHm && i.nowHm < "05:00";
  if (!i.cards.checkinDone && (i.today === r.checkinDate || (i.today === addDays(r.checkinDate, 1) && madrugada)))
    out.push("checkin_done");
  if (!i.cards.checkoutDone && i.today === r.checkoutDate) out.push("checkout_done");
  return out;
}

export function decideHostMilestone(i: HostMilestoneInput): HostMilestoneDecision {
  const allowed = plausibleMilestones(i);
  if (allowed.length === 0) return { act: false, code: "outside_window" };
  const m = i.reading;
  if (!m || m.milestone === "none") return { act: false, code: "no_milestone" };
  if (!(m.confidence >= HOST_MIN_CONFIDENCE)) return { act: false, code: "low_confidence" };
  if (!allowed.includes(m.milestone)) return { act: false, code: "milestone_not_allowed" };
  // checkout sem check-in concluído: a rotina do painel fecha a estadia; mantemos a ordem natural
  if (m.milestone === "checkout_done" && !i.cards.checkinDone && allowed.includes("checkin_done"))
    return { act: false, code: "checkin_pending" };
  return { act: true, action: m.milestone };
}

export function parseHostReading(raw: unknown): HostReading | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ms = o["milestone"];
  const c = Number(o["confidence"]);
  if (ms !== "checkin_done" && ms !== "checkout_done" && ms !== "none") return null;
  if (!Number.isFinite(c) || c < 0 || c > 1) return null;
  return { milestone: ms, confidence: c };
}
