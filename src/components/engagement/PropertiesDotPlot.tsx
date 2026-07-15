import { cn } from "@/lib/utils";
import { formatDur } from "./KpiStrip";

type Row = {
  id: string;
  name: string;
  accesses: number;
  chats: number;
  chatRate: number;
  completeness: number;
  sectionsPerSession: number;
  avgSessionSeconds: number;
  sessions: number;
};

export function PropertiesDotPlot({ rows, onSelect }: { rows: Row[]; onSelect?: (id: string) => void }) {
  const withData = rows.filter((r) => r.sessions > 0 || r.accesses > 0);
  const max = Math.max(1, ...withData.map((r) => r.avgSessionSeconds), 60);
  const sorted = [...withData].sort((a, b) => b.avgSessionSeconds - a.avgSessionSeconds);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3 pr-14">
        <h3 className="text-sm font-semibold">Ranking por tempo de permanência</h3>
        <p className="text-xs text-muted-foreground">
          Guias que prendem atenção. Ponto vermelho = alto atrito no chat.
        </p>
      </header>
      {sorted.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Sem dados no filtro atual.</div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((r) => {
            const pct = (r.avgSessionSeconds / max) * 100;
            const heat =
              r.chatRate >= 55 ? "bg-rose-500" :
              r.chatRate >= 30 ? "bg-amber-500" :
              "bg-emerald-500";
            return (
              <li
                key={r.id}
                className={cn(
                  "grid grid-cols-[minmax(140px,1fr)_auto] items-center gap-3 py-1.5 rounded-md",
                  onSelect && "cursor-pointer hover:bg-muted/40 px-2 -mx-2",
                )}
                onClick={() => onSelect?.(r.id)}
              >
                <div>
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="relative h-1.5 mt-1 bg-muted rounded-full overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-primary/40" style={{ width: `${pct}%` }} />
                    <div className={cn("absolute -top-0.5 size-2.5 rounded-full ring-2 ring-background", heat)} style={{ left: `calc(${pct}% - 5px)` }} />
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="text-sm font-semibold">{formatDur(r.avgSessionSeconds)}</div>
                  <div className="text-[10px] text-muted-foreground">{r.sessions} sess · chat {r.chatRate}%</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
