import type { Insight } from "./insights";
import { AlertTriangle, CheckCircle2, Info, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const ICON = {
  positive: CheckCircle2,
  info: Info,
  warn: AlertTriangle,
  critical: Sparkles,
} as const;

const TONE = {
  positive: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  info: "border-border bg-muted/30 text-foreground",
  warn: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  critical: "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300",
} as const;

export function InsightsRibbon({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
        Nenhum padrão relevante detectado ainda no período. Aumente o intervalo ou aguarde mais visitas.
      </div>
    );
  }
  return (
    <div className="flex gap-3 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 pb-1 snap-x">
      {insights.map((i, idx) => {
        const Icon = ICON[i.severity];
        return (
          <div
            key={idx}
            className={cn(
              "shrink-0 snap-start w-[300px] rounded-2xl border p-4 space-y-1.5",
              TONE[i.severity],
            )}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Icon className="size-3.5" /> {i.title}
            </div>
            <p className="text-xs text-foreground/70 leading-relaxed">{i.detail}</p>
          </div>
        );
      })}
    </div>
  );
}
