/**
 * Camada de apresentação das 3 telas de Operação (Dashboard, Kanban e
 * Calendário). Só layout: toda a lógica de dados, realtime e mutações
 * continua em OperationWorkspace.tsx — aqui entram apenas as peças visuais
 * novas (topbar, faixa "Agora", cards do dia, tira de amanhã, chips de
 * imóveis livres e atalhos).
 */
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  Clock,
  Home,
  LayoutGrid,
  Loader2,
  Sparkles,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ArrivalRow } from "@/lib/dashboard-arrival-types";

export type OperationView = "resumo" | "kanban" | "calendario";

/* ------------------------------- utils -------------------------------- */

export function effectiveTime(row: ArrivalRow): string | null {
  return row.arrivalTimeOverride ?? row.guestArrivalTime ?? row.standardTime ?? null;
}

export function minutesOf(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":");
  const n = Number(h) * 60 + Number(m);
  return Number.isFinite(n) ? n : null;
}

export function nowMinutesSaoPaulo(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return pick("hour") * 60 + pick("minute");
}

export function todayLabelPtBR(): string {
  const s = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date());
  return s.replace(/\./g, "");
}

/* ------------------------------ topbar -------------------------------- */

const TABS: Array<{ view: OperationView; label: string; to: string; icon: LucideIcon }> = [
  { view: "resumo", label: "Hoje", to: "/admin/dashboard", icon: LayoutGrid },
  { view: "kanban", label: "Kanban", to: "/admin/dashboard/kanban", icon: CalendarRange },
  { view: "calendario", label: "Calendário", to: "/admin/dashboard/calendario", icon: CalendarDays },
];

export function OperationTopbar({
  view,
  counts,
  right,
}: {
  view: OperationView;
  counts: { kanban: number };
  right?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 lg:-mx-10 px-4 sm:px-6 lg:px-10 pt-1 pb-2 bg-background/85 backdrop-blur-md">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Clock className="size-3 shrink-0" />
            <span className="truncate">{todayLabelPtBR()}</span>
          </div>
          <h1 className="truncate text-[22px] sm:text-2xl font-bold leading-tight tracking-tight">Operação</h1>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>

      <nav className="mt-2 flex gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((t) => {
          const active = t.view === view;
          const Icon = t.icon;
          const badge = t.view === "kanban" && counts.kanban > 0 ? counts.kanban : null;
          return (
            <Link
              key={t.view}
              to={t.to}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{t.label}</span>
              {badge ? (
                <span
                  className={`tabular-nums text-[10px] rounded-full px-1.5 py-px ${
                    active ? "bg-white/20" : "bg-foreground/8"
                  }`}
                >
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/* ---------------------------- faixa "Agora" ---------------------------- */

export function NowStrip({
  late,
  soon,
  cleaning,
}: {
  late: number;
  soon: number;
  cleaning: number;
}) {
  const items = [
    { key: "late", label: "Atrasados", value: late, icon: AlertTriangle, alert: late > 0 },
    { key: "soon", label: "Em até 3h", value: soon, icon: Timer, alert: false },
    { key: "cleaning", label: "Em limpeza", value: cleaning, icon: Sparkles, alert: false },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div
            key={it.key}
            className={`rounded-lg border px-2.5 py-2 ${
              it.alert ? "border-destructive/40 bg-destructive/8" : "border-border bg-card"
            }`}
          >
            <div
              className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${
                it.alert ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              <Icon className="size-3 shrink-0" />
              <span className="truncate">{it.label}</span>
            </div>
            <div
              className={`mt-0.5 text-2xl font-bold leading-none tabular-nums ${
                it.alert ? "text-destructive" : "text-foreground"
              }`}
            >
              {it.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------- card do dia ------------------------------ */

export type DayCardTone = "arrival" | "departure";

export function DayCard({
  title,
  icon: Icon,
  tone,
  rows,
  doneCount,
  loading,
  lateIds,
  onAdvance,
  busyRowId,
}: {
  title: string;
  icon: LucideIcon;
  tone: DayCardTone;
  rows: ArrivalRow[];
  doneCount: number;
  loading: boolean;
  lateIds: Set<string>;
  onAdvance: (row: ArrivalRow) => void;
  busyRowId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = rows.length + doneCount;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const visible = expanded ? rows : rows.slice(0, 3);
  const accent =
    tone === "arrival"
      ? "shadow-[0_6px_18px_-12px_rgba(16,185,129,0.55)]"
      : "shadow-[0_6px_18px_-12px_rgba(245,158,11,0.55)]";
  const barColor = tone === "arrival" ? "bg-emerald-500" : "bg-amber-500";

  return (
    <section className={`rounded-lg border border-border bg-card p-3 ${accent}`}>
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {doneCount}/{total}
        </span>
      </div>

      <div className="mt-1 flex items-end gap-2">
        <span className="text-[26px] font-bold leading-none tabular-nums">{rows.length}</span>
        <span className="pb-1 text-[11px] text-muted-foreground">pendentes</span>
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-foreground/8">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-2 space-y-1.5">
        {loading ? (
          <div className="flex h-11 items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">Tudo em dia por aqui.</p>
        ) : (
          visible.map((r) => {
            const late = lateIds.has(r.logId);
            const busy = busyRowId === r.logId;
            return (
              <div
                key={r.logId}
                className="grid h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border/70 bg-background px-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`shrink-0 text-[11px] font-semibold tabular-nums ${
                        late ? "text-destructive" : "text-foreground"
                      }`}
                    >
                      {effectiveTime(r) ?? "--:--"}
                    </span>
                    <span className="min-w-0 truncate text-xs font-medium">{r.guestName}</span>
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">{r.propertyName ?? "—"}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onAdvance(r)}
                  disabled={busy}
                  aria-label={tone === "arrival" ? "Confirmar check-in" : "Confirmar checkout"}
                  className="grid size-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-transparent hover:bg-gradient-to-br hover:from-[#7C1AD8] hover:to-[#E82DAE] hover:text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                </button>
              </div>
            );
          })
        )}
      </div>

      {rows.length > 3 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Ver menos" : `Ver todos (${rows.length})`}
          <ChevronDown className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      ) : null}
    </section>
  );
}

/* --------------------------- tira "Amanhã" ----------------------------- */

export function TomorrowStrip({ checkins, checkouts }: { checkins: number; checkouts: number }) {
  return (
    <Link
      to="/admin/dashboard/kanban"
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:border-foreground/20"
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Amanhã
      </span>
      <span className="flex items-center gap-1 text-xs">
        <strong className="tabular-nums">{checkins}</strong>
        <span className="text-muted-foreground">chegadas</span>
      </span>
      <span className="flex items-center gap-1 text-xs">
        <strong className="tabular-nums">{checkouts}</strong>
        <span className="text-muted-foreground">saídas</span>
      </span>
      <ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/* ------------------------- imóveis livres ------------------------------ */

export function FreePropertyChips({
  properties,
  loading,
}: {
  properties: Array<{ id: string; name: string | null }>;
  loading: boolean;
}) {
  const names = useMemo(() => properties.map((p) => p.name ?? "Imóvel"), [properties]);
  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Home className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Imóveis livres
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{properties.length}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {loading ? (
          <span className="text-xs text-muted-foreground">Carregando…</span>
        ) : names.length === 0 ? (
          <span className="text-xs text-muted-foreground">Nenhum imóvel livre hoje.</span>
        ) : (
          names.map((n, i) => (
            <span
              key={`${n}-${i}`}
              className="max-w-[45%] truncate rounded-full border border-border bg-background px-2 py-1 text-[11px]"
            >
              {n}
            </span>
          ))
        )}
      </div>
    </section>
  );
}

/* ----------------------------- atalhos --------------------------------- */

export function OperationShortcuts() {
  const items = [
    { to: "/admin/dashboard/kanban", label: "Abrir Kanban", icon: CalendarRange },
    { to: "/admin/dashboard/calendario", label: "Abrir Calendário", icon: CalendarDays },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <Link
            key={it.to}
            to={it.to}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-semibold transition-colors hover:border-foreground/20"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{it.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
