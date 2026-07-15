import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import type { CSSProperties } from "react";

const tickStyle = { fontSize: 12, fill: "var(--foreground)", opacity: 0.95, fontWeight: 500 };
const tooltipContentStyle: CSSProperties = {
  fontSize: 12,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
};
const tooltipItemStyle: CSSProperties = { color: "var(--popover-foreground)" };
const tooltipLabelStyle: CSSProperties = { color: "var(--popover-foreground)", fontWeight: 500 };

export function DurationBuckets({ buckets }: { buckets: Array<{ label: string; count: number }> }) {
  const total = buckets.reduce((a, b) => a + b.count, 0);
  const colors = ["#f43f5e", "#f59e0b", "#eab308", "#22c55e", "#10b981"];
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3 pr-14">
        <h3 className="text-sm font-semibold whitespace-nowrap">Tempo de permanência</h3>
        <p className="text-xs text-muted-foreground">Distribuição das sessões por duração — revela se o guia prende atenção.</p>
      </header>
      {total === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Sem sessões no período.</div>
      ) : (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 10 }}>
              <XAxis dataKey="label" tick={tickStyle} axisLine={false} tickLine={false} tickMargin={8} interval={0} height={34} />
              <Tooltip
                cursor={false}
                contentStyle={tooltipContentStyle}
                itemStyle={tooltipItemStyle}
                labelStyle={tooltipLabelStyle}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {buckets.map((_, i) => <Cell key={i} fill={colors[i] ?? "var(--foreground)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function DepthCurve({ curve }: { curve: Array<{ label: string; count: number }> }) {
  const total = curve.reduce((a, b) => a + b.count, 0);
  // Reverse ramp: 1 seção = ruim (vermelho), 5+ = ótimo (verde)
  const colors = ["#f43f5e", "#f59e0b", "#eab308", "#22c55e", "#10b981"];
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3 pr-14">
        <h3 className="text-sm font-semibold whitespace-nowrap">Profundidade da leitura</h3>
        <p className="text-xs text-muted-foreground">Quantas seções distintas cada sessão explora.</p>
      </header>
      {total === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Sem sessões no período.</div>
      ) : (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={curve} margin={{ top: 8, right: 8, left: 0, bottom: 10 }}>
              <XAxis dataKey="label" tick={tickStyle} axisLine={false} tickLine={false} tickMargin={8} interval={0} height={34} />
              <Tooltip
                cursor={false}
                contentStyle={tooltipContentStyle}
                itemStyle={tooltipItemStyle}
                labelStyle={tooltipLabelStyle}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {curve.map((_, i) => <Cell key={i} fill={colors[i] ?? "#22c55e"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

