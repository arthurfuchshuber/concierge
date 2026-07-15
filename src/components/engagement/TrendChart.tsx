import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type Point = { date: string; accesses: number; sessions: number; chats: number };

export function TrendChart({ data }: { data: Point[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Evolução no tempo</h3>
          <p className="text-xs text-muted-foreground">Acessos, sessões engajadas e conversas iniciadas</p>
        </div>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          <LegendDot color="hsl(var(--primary))" label="Acessos" />
          <LegendDot color="hsl(var(--muted-foreground))" label="Sessões" />
          <LegendDot color="hsl(var(--destructive))" label="Chats" />
        </div>
      </header>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gAcc" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => {
                const d = new Date(v);
                return `${d.getDate()}/${d.getMonth() + 1}`;
              }}
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={30} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))" }}
              labelFormatter={(v) => new Date(v as string).toLocaleDateString("pt-BR")}
            />
            <Area type="monotone" dataKey="accesses" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gAcc)" isAnimationActive={false} />
            <Area type="monotone" dataKey="sessions" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} fill="transparent" isAnimationActive={false} />
            <Area type="monotone" dataKey="chats" stroke="hsl(var(--destructive))" strokeWidth={1.5} fill="transparent" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
