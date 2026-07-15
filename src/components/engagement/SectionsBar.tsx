import { Badge } from "@/components/ui/badge";
import { labelFor } from "./insights";

type Row = { section: string; opens: number; sessions: number; autoResolveRate: number };

export function SectionsBar({ rows, silent }: { rows: Row[]; silent: string[] }) {
  const max = Math.max(1, ...rows.map((r) => r.opens));
  const p75 = (() => {
    if (rows.length === 0) return 0;
    const s = [...rows].sort((a, b) => a.opens - b.opens);
    return s[Math.floor(s.length * 0.75)]?.opens ?? 0;
  })();

  return (
    <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <header className="mb-3">
          <h3 className="text-sm font-semibold">Seções consumidas</h3>
          <p className="text-xs text-muted-foreground">Aberturas no período — o que realmente é lido</p>
        </header>
        {rows.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">
            Ainda não coletamos aberturas de seção neste recorte.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const w = (r.opens / max) * 100;
              const hot = r.opens >= p75 && r.opens > 0;
              return (
                <li key={r.section} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-medium">
                      {labelFor(r.section)}
                      {hot && <Badge variant="secondary" className="text-[9px] py-0 h-4">hotspot</Badge>}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      <span className="text-foreground font-semibold mr-2">{r.opens}</span>
                      <span className="text-[10px]">auto {r.autoResolveRate}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${w}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <header className="mb-3">
          <h3 className="text-sm font-semibold">Seções silenciosas</h3>
          <p className="text-xs text-muted-foreground">Existem no produto mas não receberam aberturas</p>
        </header>
        {silent.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">Nada silencioso 🎉</div>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {silent.map((s) => (
              <li key={s}>
                <Badge variant="outline" className="text-[11px] font-normal">
                  {labelFor(s)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
