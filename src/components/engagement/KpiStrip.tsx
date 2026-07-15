import { LineChart, Line, ResponsiveContainer } from "recharts";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Point = { date: string; accesses: number; sessions: number; chats: number };

type Kpi = {
  label: string;
  value: number | string;
  suffix?: string;
  delta?: number | null;
  series: number[];
  hint?: string;
};

function trendFrom(series: Point[], key: keyof Point): number[] {
  return series.map((p) => Number(p[key] ?? 0));
}

export function KpiStrip({ kpis, timeseries }: {
  kpis: {
    totalAccesses: number;
    uniqueSessions: number;
    chatRate: number;
    autoResolveRate: number;
    accessesDelta: number | null;
  };
  timeseries: Point[];
}) {
  const cards: Kpi[] = [
    {
      label: "Acessos",
      value: kpis.totalAccesses,
      delta: kpis.accessesDelta,
      series: trendFrom(timeseries, "accesses"),
      hint: "Aberturas do guia no período",
    },
    {
      label: "Sessões únicas",
      value: kpis.uniqueSessions,
      series: trendFrom(timeseries, "sessions"),
      hint: "Hóspedes distintos que navegaram",
    },
    {
      label: "Auto-resolução",
      value: kpis.autoResolveRate,
      suffix: "%",
      series: trendFrom(timeseries, "accesses").map((v, i) => v - (timeseries[i]?.chats ?? 0)),
      hint: "Visitas que não precisaram de chat",
    },
    {
      label: "Taxa de conversa",
      value: kpis.chatRate,
      suffix: "%",
      series: trendFrom(timeseries, "chats"),
      hint: "Sessões que iniciaram chat",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((k) => (
        <div key={k.label} className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            <span>{k.label}</span>
            {typeof k.delta === "number" && <DeltaBadge value={k.delta} />}
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-display tabular-nums">{k.value}</span>
            {k.suffix && <span className="text-lg text-muted-foreground">{k.suffix}</span>}
          </div>
          <div className="h-8">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={k.series.map((v, i) => ({ i, v }))}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {k.hint && <div className="text-[10px] text-muted-foreground">{k.hint}</div>}
        </div>
      ))}
    </div>
  );
}

function DeltaBadge({ value }: { value: number }) {
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  const cls = value > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : value < 0
    ? "text-rose-600 dark:text-rose-400"
    : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium", cls)}>
      <Icon className="size-3" /> {Math.abs(value)}%
    </span>
  );
}
