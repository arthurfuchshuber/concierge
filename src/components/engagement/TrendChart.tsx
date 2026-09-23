import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type Point = { date: string; accesses: number; sessions: number; chats: number };

export function TrendChart({ data }: { data: Point[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <header className="mb-3">
        <h3 className="text-sm font-semibold whitespace-nowrap truncate">Evolução no tempo</h3>
        <p className="text-xs text-muted-foreground">Acessos, sessões engajadas e conversas iniciadas</p>
      </header>
      <div className="h-64">

        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gAcc" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--foreground)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => {
                const d = new Date(v);
                return `${d.getDate()}/${d.getMonth() + 1}`;
              }}
              tick={{ fontSize: 11, fill: "var(--foreground)", opacity: 0.9, fontWeight: 500 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis tick={{ fontSize: 11, fill: "var(--foreground)", opacity: 0.9, fontWeight: 500 }} tickLine={false} axisLine={false} width={30} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
              itemStyle={{ color: "var(--popover-foreground)" }}
              labelStyle={{ color: "var(--popover-foreground)", fontWeight: 500 }}
              labelFormatter={(v) => new Date(v as string).toLocaleDateString("pt-BR")}
            />
            <Area type="monotone" dataKey="accesses" stroke="var(--foreground)" strokeWidth={2.25} fill="url(#gAcc)" isAnimationActive={false} />
            <Area type="monotone" dataKey="sessions" stroke="var(--muted-foreground)" strokeWidth={1.75} fill="transparent" isAnimationActive={false} />
            <Area type="monotone" dataKey="chats" stroke="var(--destructive)" strokeWidth={1.75} fill="transparent" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-foreground/85">
        <LegendDot color="var(--foreground)" label="Acessos" />
        <LegendDot color="var(--muted-foreground)" label="Sessões" />
        <LegendDot color="var(--destructive)" label="Chats" />
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
