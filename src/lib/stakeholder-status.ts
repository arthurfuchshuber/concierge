/**
 * Situação do cadastro de stakeholders (proprietários / prestadores).
 *
 * Estados finais: active, paused, canceled.
 * Estados intermediários (data futura): documentation, contract, signature (rumo a "Ativo")
 * e canceling (cancelamento agendado, que só vira "Cancelado" após confirmação humana).
 */
export const STAKEHOLDER_STATUSES = [
  "active",
  "documentation",
  "contract",
  "signature",
  "paused",
  "canceling",
  "canceled",
  "inactive",
] as const;

export type StakeholderStatus = (typeof STAKEHOLDER_STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  documentation: "Documentação",
  contract: "Contrato",
  signature: "Assinatura",
  paused: "Pausado",
  canceling: "Cancelando",
  canceled: "Cancelado",
  inactive: "Inativo",
};

export const STATUS_HINT: Record<string, string> = {
  active: "Contrato vigente",
  documentation: "Cliente pendente de documentação",
  contract: "Contrato pendente de envio",
  signature: "Contrato já enviado, aguardando assinatura",
  paused: "Pausado por tempo determinado",
  canceling: "Cancelamento agendado, aguardando confirmação",
  canceled: "Cancelado definitivamente",
  inactive: "Inativo",
};

/** Classe do badge (borda + fundo + texto). */
export const STATUS_STYLE: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  documentation: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  contract: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  signature: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  canceling: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500",
  canceled: "border-destructive/30 bg-destructive/10 text-destructive",
  inactive: "border-border text-muted-foreground",
};

/** Versão compacta usada nos cards da listagem. */
export const STATUS_CHIP: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  documentation: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  contract: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  signature: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  paused: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  canceling: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
  canceled: "bg-destructive/15 text-destructive",
  inactive: "bg-muted text-muted-foreground",
};

/**
 * Situação exibida: "Cancelado" com data futura é, na prática, "Cancelando"
 * (amarelo) até a confirmação humana na data agendada.
 */
export function effectiveStatus(
  status: string | null | undefined,
  changedAt?: string | null,
): string {
  const s = String(status ?? "inactive");
  if (s === "canceled" && changedAt && isFutureDate(changedAt)) return "canceling";
  return s;
}

export function statusLabel(status: string | null | undefined): string {
  return STATUS_LABEL[String(status ?? "inactive")] ?? "Inativo";
}

export function statusStyle(status: string | null | undefined): string {
  return STATUS_STYLE[String(status ?? "inactive")] ?? STATUS_STYLE.inactive;
}

export function statusChip(status: string | null | undefined): string {
  return STATUS_CHIP[String(status ?? "inactive")] ?? STATUS_CHIP.inactive;
}

/** Data está no futuro (comparando por dia). */
export function isFutureDate(value: string | Date): boolean {
  const d = typeof value === "string" ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value) : value;
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return target.getTime() > today.getTime();
}

/** "a partir de 31/08/2026" quando a mudança ainda vai acontecer; "desde …" caso contrário. */
export function statusDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const prefix = isFutureDate(d) ? "a partir de" : "desde";
  return `${prefix} ${d.toLocaleDateString("pt-BR")}`;
}
