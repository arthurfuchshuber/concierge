import { Bot, ClipboardCheck, Coins, DollarSign, Info, Target, Timer } from "lucide-react";
import { StatCard } from "@/components/ds/StatCard";
import {
  SURFACE_LABEL,
  TELEMETRY_WINDOW_DAYS,
  formatBrl,
  formatPct,
  formatSeconds,
  formatUsd,
  modelLabel,
  type TelemetryKpis as Kpis,
  type TelemetrySurface,
} from "@/lib/admin-ia-telemetry";

const RETENTION_TIP = `As sugestões do Copiloto ficam guardadas por ${TELEMETRY_WINDOW_DAYS} dias (expires_at) e depois são apagadas; este custo cobre só esse período.`;

/** Barra de indicadores da Telemetria IA — cartões de número padrão (Limpeza). */
export function TelemetryKpis({ kpis, loading }: { kpis: Kpis | null; loading: boolean }) {
  const k = kpis;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Custo hoje"
          icon={DollarSign}
          loading={loading}
          value={k ? formatUsd(k.costTodayUsd) : "—"}
          note={k ? `${formatBrl(k.costTodayUsd)} · ${k.dailyUsePct}% do teto` : null}
        />
        <div className="relative min-w-0">
          <StatCard
            label={`Custo (Últimos ${TELEMETRY_WINDOW_DAYS} dias)`}
            icon={Coins}
            loading={loading}
            value={k ? formatUsd(k.costWindowUsd) : "—"}
            note={k ? formatBrl(k.costWindowUsd) : null}
          />
          <span
            title={RETENTION_TIP}
            aria-label={RETENTION_TIP}
            className="absolute right-2 top-2 inline-flex cursor-help text-muted-foreground"
          >
            <Info className="size-3.5" />
          </span>
        </div>
        <StatCard
          label="Latência média"
          icon={Timer}
          loading={loading}
          value={k ? formatSeconds(k.avgLatencyMs) : "—"}
          note={k && k.maxLatencyMs !== null ? `mais lenta ${formatSeconds(k.maxLatencyMs)}` : null}
        />
        <StatCard
          label="Modelo"
          icon={Bot}
          loading={loading}
          value={k ? modelLabel(k.activeModel).replace(" (reserva)", "") : "—"}
          note={
            k
              ? k.reserveUsesToday
                ? `reserva usada ${k.reserveUsesToday}× hoje`
                : "sem reserva hoje"
              : null
          }
        />
        <StatCard
          label="Assertividade"
          icon={Target}
          loading={loading}
          value={k ? formatPct(k.assertivenessPct) : "—"}
          note={k ? `sem edição · adoção ${formatPct(k.adoptionPct)}` : null}
        />
        <StatCard
          label="Ações nos cards"
          icon={ClipboardCheck}
          loading={loading}
          value={k ? `${k.cardsApplied} / ${k.cardsRefused}` : "—"}
          note="aplicadas / recusadas"
        />
      </div>
      {k ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="ds-eyebrow mr-1">Hoje por canal</span>
          {(Object.keys(SURFACE_LABEL) as TelemetrySurface[]).map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]"
            >
              <b className="tabular-nums">{k.todayBySurface[s] ?? 0}</b> {SURFACE_LABEL[s]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
