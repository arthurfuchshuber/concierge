import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell } from "recharts";
import { labelFor } from "./insights";

type Row = { section: string; opens: number; sessions: number; autoResolveRate: number };

export function ContentImpactMatrix({ rows }: { rows: Row[] }) {
  const data = rows.map((r) => ({
    section: r.section,
    label: labelFor(r.section),
    x: r.opens,
    y: r.autoResolveRate,
  }));
  const xMed = median(data.map((d) => d.x));
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-2 pr-14">
        <h3 className="text-sm font-semibold">Matriz de impacto de conteúdo</h3>
        <p className="text-xs text-muted-foreground">
          Volume × autonomia. Alto & alto = <span className="font-medium text-emerald-600 dark:text-emerald-400">estrelas</span>.
          Baixo & baixo = ruído. Alto & baixo = gera atrito.
        </p>
      </header>
      <div className="h-72">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            Ainda não há aberturas de seção suficientes.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis
                type="number"
                dataKey="x"
                name="Aberturas"
                tick={{ fontSize: 11, fill: "var(--foreground)", opacity: 0.9, fontWeight: 500 }}
                label={{ value: "Aberturas", position: "insideBottom", offset: -8, fontSize: 11, fill: "var(--foreground)", opacity: 0.9, fontWeight: 500 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Auto-resolução"
                unit="%"
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: "var(--foreground)", opacity: 0.9, fontWeight: 500 }}
                width={40}
              />
              <ReferenceLine x={xMed} stroke="var(--border)" strokeDasharray="4 4" />
              <ReferenceLine y={70} stroke="var(--border)" strokeDasharray="4 4" />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
                formatter={(val: number | string, name) => name === "Auto-resolução" ? `${val}%` : val}
                labelFormatter={() => ""}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as { label: string; x: number; y: number };
                  return (
                    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground">
                      <div className="font-medium">{p.label}</div>
                      <div className="text-muted-foreground">{p.x} aberturas · {p.y}% autonomia</div>
                    </div>
                  );
                }}
              />
              <Scatter data={data}>
                {data.map((d, i) => {
                  const star = d.x >= xMed && d.y >= 70;
                  const friction = d.x >= xMed && d.y < 40;
                  const color = star
                    ? "var(--foreground)"
                    : friction
                    ? "var(--destructive)"
                    : "var(--foreground)";
                  return <Cell key={i} fill={color} />;
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
