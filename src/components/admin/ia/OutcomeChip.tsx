import { OUTCOME_LABEL, type OutcomeKey } from "@/lib/admin-ia-telemetry";

/**
 * Desfecho da inferência. Base neutra; cor de status só como exceção pequena
 * (regra do projeto: sage = aplicado, âmbar = D9, rosa = erro).
 */
const TONE: Record<OutcomeKey, string> = {
  card: "bg-success/15 text-success",
  d9: "bg-warning/15 text-warning",
  error: "bg-destructive/15 text-destructive",
  silence: "bg-foreground/[0.05] text-muted-foreground",
  sent: "bg-foreground/[0.08] text-foreground",
  available: "bg-foreground/[0.08] text-foreground",
  discarded: "bg-foreground/[0.05] text-muted-foreground",
  superseded: "bg-foreground/[0.05] text-muted-foreground",
  generating: "bg-foreground/[0.05] text-muted-foreground",
};

export function OutcomeChip({ outcome, code }: { outcome: OutcomeKey; code?: string | null }) {
  const label =
    outcome === "error" && code ? `${OUTCOME_LABEL[outcome]} · ${code}` : OUTCOME_LABEL[outcome];
  return (
    <span
      className={`inline-block max-w-full truncate whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-bold ${TONE[outcome]}`}
      title={label}
    >
      {label}
    </span>
  );
}
