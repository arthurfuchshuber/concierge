import type { StatusTone } from "@/components/admin-pages/integration-window";

/** Status do contrato no ClickSign → etiqueta e ordem (ativo primeiro, cancelado por último). */
export const CLICKSIGN_STATUS: Record<string, { label: string; tone: StatusTone; rank: number }> = {
  closed: { label: "Assinado", tone: "ok", rank: 0 },
  running: { label: "Em Andamento", tone: "warn", rank: 1 },
  draft: { label: "Rascunho", tone: "warn", rank: 2 },
  canceled: { label: "Cancelado", tone: "bad", rank: 3 },
};

/** Ordem da lista: por status (Assinado → Cancelado) e, dentro dele, do mais recente ao mais antigo. */
export function sortClicksignDocs<
  T extends { status: string | null; finished_at: string | null; synced_at: string | null },
>(docs: T[]): T[] {
  const rank = (s: string | null) => CLICKSIGN_STATUS[s ?? ""]?.rank ?? 2.5;
  const time = (d: T) => Date.parse(d.finished_at ?? d.synced_at ?? "") || 0;
  return [...docs].sort((a, b) => rank(a.status) - rank(b.status) || time(b) - time(a));
}
