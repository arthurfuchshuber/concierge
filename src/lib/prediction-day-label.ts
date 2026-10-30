/**
 * Rótulo do dia da previsão (card do Kanban/esteira operacional).
 *
 * Chegada de madrugada (00:00–05:59) no check-in pertence à virada da noite da
 * diária de entrada: "02:00 HOJE" parecia que o hóspede já deveria ter chegado
 * (antes do check-in abrir). Na hotelaria o rótulo correto é "madrugada".
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

/** 00:00 até 05:59. */
export function isDawnTime(time: string | null | undefined): boolean {
  if (!time || !/^\d{1,2}:\d{2}/.test(time)) return false;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0) < 360;
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
): { label: string; tone: PredictionDayTone } {
  if (!dateISO) return { label: "", tone: "muted" };
  const day = dateISO.slice(0, 10);
  const isDawn = kind === "checkin" && isDawnTime(timeValue);

  if (day === todayISO) {
    if (isDawn) return { label: "madrugada", tone: "accent" };
    return { label: "hoje", tone: "muted" };
  }
  if (day === addDays(todayISO, 1)) {
    return { label: isDawn ? "madrugada" : "amanhã", tone: "accent" };
  }
  if (day === addDays(todayISO, -1)) return { label: "ontem", tone: "late" };
  return { label: fmtDateBR(day), tone: day < todayISO ? "late" : "accent" };
}
