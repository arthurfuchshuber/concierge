import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";

export function DurationBuckets({ buckets }: { buckets: Array<{ label: string; count: number }> }) {
  const total = buckets.reduce((a, b) => a + b.count, 0);
  const colors = ["#f43f5e", "#f59e0b", "#eab308", "#22c55e", "#10b981"];
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3">
        <h3 className="text-sm font-semibold">Tempo de permanência</h3>
        <p className="text-xs text-muted-foreground">Distribuição das sessões por duração — revela se o guia prende atenção.</p>
      </header>
      {total === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Sem sessões no período.</div>
      ) : (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid hsl(var(--border))" }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {buckets.map((_, i) => <Cell key={i} fill={colors[i] ?? "hsl(var(--primary))"} />)}
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
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3">
        <h3 className="text-sm font-semibold">Profundidade da leitura</h3>
        <p className="text-xs text-muted-foreground">Quantas seções distintas cada sessão explora.</p>
      </header>
      {total === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Sem sessões no período.</div>
      ) : (
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={curve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid hsl(var(--border))" }} />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
