import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Timer, Layers, Activity, MessageCircle } from "lucide-react";

type Point = { date: string; accesses: number; sessions: number; chats: number; avgDurSec: number };

export function KpiStrip({ kpis, timeseries }: {
  kpis: {
    totalAccesses: number;
    uniqueSessions: number;
    avgSessionSeconds: number;
    p90SessionSeconds: number;
    depthAvg: number;
    depthEngagedRate: number;
    chatRate: number;
    autoResolveRate: number;
    openFeedback: number;
  };
  timeseries: Point[];
}) {
  const cards = [
    {
      icon: Timer,
      label: "Tempo médio no guia",
      value: formatDur(kpis.avgSessionSeconds),
      hint: `p90 ${formatDur(kpis.p90SessionSeconds)} · sessão típica`,
      series: timeseries.map((p) => p.avgDurSec),
    },
    {
      icon: Layers,
      label: "Profundidade média",
      value: kpis.depthAvg.toString(),
      suffix: "seções",
      hint: `${kpis.depthEngagedRate}% das sessões abrem ≥ 3`,
      series: timeseries.map((p) => p.sessions),
    },
    {
      icon: Activity,
      label: "Sessões únicas",
      value: kpis.uniqueSessions.toString(),
      hint: `${kpis.totalAccesses} acessos no total`,
      series: timeseries.map((p) => p.sessions),
    },
    {
      icon: MessageCircle,
      label: "Atrito no chat",
      value: `${kpis.chatRate}%`,
      hint: `auto-resolução ${kpis.autoResolveRate}% · ${kpis.openFeedback} feedback aberto`,
      series: timeseries.map((p) => p.chats),
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((k) => (
        <div key={k.label} className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
            <k.icon className="size-3.5" /> {k.label}
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl sm:text-3xl font-display tabular-nums">{k.value}</span>
            {"suffix" in k && k.suffix && <span className="text-xs text-muted-foreground">{k.suffix}</span>}
          </div>
          <div className="h-7">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={k.series.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke="var(--foreground)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] text-muted-foreground leading-snug">{k.hint}</div>
        </div>
      ))}
    </div>
  );
}

export function formatDur(seconds: number): string {
  if (!seconds || seconds < 1) return "0s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m - h * 60}m`;
}
