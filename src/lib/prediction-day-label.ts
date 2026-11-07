/**
 * Rótulo do dia da previsão (card do Kanban/esteira operacional).
 *
 * Chegada de madrugada no check-in pertence à virada da noite da diária de
 * entrada: "02:00 HOJE" parecia que o hóspede já deveria ter chegado (antes do
 * check-in abrir). Na hotelaria o rótulo correto é "madrugada".
 *
 * Diretriz definitiva (06/11/2026, Gate G2c): madrugada = 00:00 até antes das
 * 05:00 (a MESMA regra da IA, `ops/policy.ts`), rotulada "nesta madrugada" na
 * noite de entrada de hoje — inclusive depois da virada do dia, enquanto ainda
 * é madrugada — e NUNCA "amanhã".
 *
 * Módulo puro (sem React) para ser testado isoladamente; `OperationWorkspace`
 * reexporta as duas funções.
 */

export type PredictionDayTone = "muted" | "accent" | "late";

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const fmtDateBR = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

/** Fim (exclusivo) da madrugada: 05:00 — mesma regra da IA (`MADRUGADA_END_MINUTES`). */
export const DAWN_END_MINUTES = 5 * 60;

/** 00:00 até 04:59. */
export function isDawnTime(time: string | null | undefined): boolean {
  if (!time || !/^\d{1,2}:\d{2}/.test(time)) return false;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0) < DAWN_END_MINUTES;
}

/**
 * Pedido explícito (08/09/2026): quando é HOJE a palavra fica apagada; qualquer
 * outro dia ganha destaque e um dia que já passou fica vermelho.
 */
export function predictionDayLabel(
  dateISO: string | null,
  todayISO: string,
  timeValue?: string | null,
  kind?: "checkin" | "checkout" | null,
  /** Minutos desde a meia-noite AGORA (mesmo fuso de `todayISO`); habilita "nesta madrugada" após a virada. */
  nowMinutes?: number | null,
): { label: string; tone: PredictionDayTone } {
  if (!dateISO) return { label: "", tone: "muted" };
  const day = dateISO.slice(0, 10);
  const isDawn = kind === "checkin" && isDawnTime(timeValue);

  if (day === todayISO) {
    if (isDawn) return { label: "nesta madrugada", tone: "accent" };
    return { label: "hoje", tone: "muted" };
  }
  // virou o dia mas ainda é madrugada: a chegada continua sendo desta noite (nunca "ontem"/atraso)
  if (
    isDawn &&
    day === addDays(todayISO, -1) &&
    nowMinutes != null &&
    nowMinutes < DAWN_END_MINUTES
  )
    return { label: "nesta madrugada", tone: "accent" };
  if (day === addDays(todayISO, 1)) {
    return { label: isDawn ? "madrugada" : "amanhã", tone: "accent" };
  }
  if (day === addDays(todayISO, -1)) return { label: "ontem", tone: "late" };
  return { label: fmtDateBR(day), tone: day < todayISO ? "late" : "accent" };
}
