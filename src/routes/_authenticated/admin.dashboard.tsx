import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  CalendarCheck, CalendarX, LogIn, LogOut, MessageCircle, StickyNote, Check,
  AlertTriangle, Clock, Loader2, Home, Info, Sparkles, TrendingUp, Bell,
  ChevronDown, UserPlus, Hash,
} from "lucide-react";
import { toast } from "sonner";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  getDashboardKpis, getGuideEngagement, listDashboardArrivals, upsertArrivalStatus, updateGuestStayDates,
  type ArrivalRow,
} from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard operacional — ConciergeIA" },
      { name: "description", content: "Painel operacional diário do anfitrião: check-ins, check-outs e engajamento do guia." },
    ],
  }),
  component: DashboardPage,
});

function fmtDateBR(iso: string) {
  try { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; } catch { return iso; }
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
function waLink(phone: string | null, country: string | null): string | null {
  if (!phone) return null;
  const raw = `${country ?? ""}${phone}`.replace(/[^\d+]/g, "");
  const p = parsePhoneNumberFromString(raw.startsWith("+") ? raw : `+${raw}`);
  if (p && p.isValid()) return `https://wa.me/${p.number.replace("+", "")}`;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

/* ---------- Info tooltip ---------- */
function InfoHint({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Sobre: ${title}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex size-5 items-center justify-center rounded-full text-current/60 hover:text-current transition-colors opacity-70 hover:opacity-100"
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={6}
        className="w-64 max-w-[calc(100vw-2rem)] rounded-xl border-border/70 bg-popover/95 backdrop-blur p-3 text-xs leading-relaxed shadow-xl"
      >
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</div>
        <div className="text-foreground/90">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

function DashboardPage() {
  const kpisFn = useServerFn(getDashboardKpis);
  const engFn = useServerFn(getGuideEngagement);
  const listFn = useServerFn(listDashboardArrivals);
  const upsertFn = useServerFn(upsertArrivalStatus);
  const updateDatesFn = useServerFn(updateGuestStayDates);
  const qc = useQueryClient();

  const [kind, setKind] = useState<"checkin" | "checkout">("checkin");
  const [range, setRange] = useState<"today" | "tomorrow" | "7d" | "all">("today");
  const [engRange, setEngRange] = useState<"today" | "7d" | "30d">("7d");

  const kpisQ = useQuery({ queryKey: ["dash-kpis"], queryFn: () => kpisFn(), staleTime: 60_000 });
  const engQ = useQuery({
    queryKey: ["dash-eng", engRange],
    queryFn: () => engFn({ data: { range: engRange } }),
    staleTime: 60_000,
  });
  const listQ = useQuery({
    queryKey: ["dash-list", kind, range],
    queryFn: () => listFn({ data: { kind, range } }),
    staleTime: 30_000,
  });

  // KPI drill-down data (loaded on demand)
  const kpiTodayQ = useQuery({
    queryKey: ["dash-list", "checkin", "today"],
    queryFn: () => listFn({ data: { kind: "checkin", range: "today" } }),
    enabled: false, staleTime: 30_000,
  });
  const kpiTomorrowQ = useQuery({
    queryKey: ["dash-list", "checkin", "tomorrow"],
    queryFn: () => listFn({ data: { kind: "checkin", range: "tomorrow" } }),
    enabled: false, staleTime: 30_000,
  });
  const kpiCoTodayQ = useQuery({
    queryKey: ["dash-list", "checkout", "today"],
    queryFn: () => listFn({ data: { kind: "checkout", range: "today" } }),
    enabled: false, staleTime: 30_000,
  });
  const kpiCoTomorrowQ = useQuery({
    queryKey: ["dash-list", "checkout", "tomorrow"],
    queryFn: () => listFn({ data: { kind: "checkout", range: "tomorrow" } }),
    enabled: false, staleTime: 30_000,
  });

  type UpsertPayload = {
    logId: string;
    kind: "checkin" | "checkout";
    status?: "pending" | "done";
    note?: string | null;
    arrivalTimeOverride?: string | null;
  };
  const upsert = useMutation({
    mutationFn: (v: UpsertPayload) => upsertFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dash-list"] });
      qc.invalidateQueries({ queryKey: ["dash-kpis"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar."),
  });

  const updateDates = useMutation({
    mutationFn: (v: { logId: string; checkinDate?: string; checkoutDate?: string | null }) => updateDatesFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dash-list"] });
      qc.invalidateQueries({ queryKey: ["dash-kpis"] });
      toast.success("Datas atualizadas.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar datas."),
  });

  const rows = listQ.data?.rows ?? [];
  const pending = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  const done = useMemo(() => rows.filter((r) => r.status === "done"), [rows]);

  /* ---------- Attention alerts ---------- */
  const alerts = useMemo(() => {
    const list: Array<{ tone: "warn" | "info" | "success"; icon: React.ElementType; text: React.ReactNode }> = [];
    const k = kpisQ.data;
    const e = engQ.data;

    if (k && k.checkinsTomorrow > 0) {
      list.push({
        tone: "info",
        icon: Bell,
        text: <>Amanhã: <b className="tabular-nums">{k.checkinsTomorrow}</b> check-in{k.checkinsTomorrow > 1 ? "s" : ""} — revise horários e mensagens.</>,
      });
    }
    if (e && e.checkinsInPeriod > 0) {
      const gap = e.checkinsInPeriod - e.checkinTabOpens;
      if (gap > 0) {
        list.push({
          tone: "warn", icon: AlertTriangle,
          text: <><b className="tabular-nums">{gap}</b> hóspede{gap > 1 ? "s" : ""} ainda não abriu a aba <i>Chegada</i>.</>,
        });
      } else {
        list.push({
          tone: "success", icon: Sparkles,
          text: <>Todos os hóspedes do período abriram a aba <i>Chegada</i>.</>,
        });
      }
    }
    const pendingFillCount = rows.filter((r) => r.pendingFill).length;
    if (pendingFillCount > 0) {
      list.push({
        tone: "warn", icon: UserPlus,
        text: <><b className="tabular-nums">{pendingFillCount}</b> reserva{pendingFillCount > 1 ? "s" : ""} sem formulário de acesso preenchido.</>,
      });
    }
    const divergentCount = rows.filter((r) => {
      const t = r.arrivalTimeOverride ?? r.guestArrivalTime;
      return t && r.standardTime && !isTimeWithin(t, r.standardTime, r.standardTimeMax);
    }).length;
    if (divergentCount > 0) {
      list.push({
        tone: "warn", icon: Clock,
        text: <><b className="tabular-nums">{divergentCount}</b> horário{divergentCount > 1 ? "s" : ""} divergente{divergentCount > 1 ? "s" : ""} do padrão.</>,
      });
    }
    return list;
  }, [kpisQ.data, engQ.data, rows]);

  const rangeLabel: Record<typeof range, string> = {
    today: "Hoje", tomorrow: "Amanhã", "7d": "7 dias", all: "Todos",
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl tracking-tight">Dashboard operacional</h1>
        <p className="text-sm text-muted-foreground">Sua rotina diária: check-ins, check-outs e engajamento do guia.</p>
      </header>

      {/* Attention strip — stacked vertically */}
      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {alerts.map((a, i) => {
            const tone =
              a.tone === "warn"
                ? "bg-amber-500/8 text-amber-800 dark:text-amber-300 border-amber-500/20"
                : a.tone === "success"
                ? "bg-emerald-500/8 text-emerald-800 dark:text-emerald-300 border-emerald-500/20"
                : "bg-primary/8 text-primary border-primary/20";
            const Icon = a.icon;
            return (
              <div
                key={i}
                className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-xs sm:text-sm backdrop-blur-sm ${tone}`}
              >
                <Icon className="size-4 shrink-0" />
                <span>{a.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Check-ins hoje" value={kpisQ.data?.checkinsToday} icon={LogIn} tone="primary"
          loading={kpisQ.isLoading}
          listQuery={kpiTodayQ} kind="checkin"
          rangeLabel="Hoje"
        />
        <KpiCard
          label="Check-ins amanhã" value={kpisQ.data?.checkinsTomorrow} icon={LogIn} tone="primary-soft"
          loading={kpisQ.isLoading}
          listQuery={kpiTomorrowQ} kind="checkin"
          rangeLabel="Amanhã"
        />
        <KpiCard
          label="Check-outs hoje" value={kpisQ.data?.checkoutsToday} icon={LogOut} tone="primary"
          loading={kpisQ.isLoading}
          listQuery={kpiCoTodayQ} kind="checkout"
          rangeLabel="Hoje"
        />
        <KpiCard
          label="Check-outs amanhã" value={kpisQ.data?.checkoutsTomorrow} icon={LogOut} tone="primary-soft"
          loading={kpisQ.isLoading}
          listQuery={kpiCoTomorrowQ} kind="checkout"
          rangeLabel="Amanhã"
        />
      </section>

      {/* Engagement */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/[0.04] via-transparent to-primary/[0.02] p-4 sm:p-6 space-y-4 shadow-sm">
        <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <div className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0 ring-1 ring-primary/15">
              <TrendingUp className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold flex items-center gap-1">
                Engajamento do guia
                <InfoHint title="Engajamento do guia">
                  Compara quantos hóspedes com check-in no período efetivamente acessaram o guia e abriram a aba <b>Chegada</b>.
                </InfoHint>
              </div>
              <div className="text-xs text-muted-foreground">Comparativo com os check-ins do período</div>
            </div>
          </div>
          <RangeDropdown
            value={engRange}
            onChange={setEngRange}
            options={[["today", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"]]}
          />
        </div>
        <EngagementBars
          loading={engQ.isLoading}
          checkins={engQ.data?.checkinsInPeriod ?? 0}
          guideOpens={engQ.data?.guideOpens ?? 0}
          checkinTabOpens={engQ.data?.checkinTabOpens ?? 0}
        />
      </section>

      {/* Arrivals */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/[0.03] via-transparent to-transparent p-4 sm:p-6 space-y-4 shadow-sm">
        <div className="pointer-events-none absolute -bottom-32 -left-24 size-72 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl border border-primary/15 bg-primary/[0.03] overflow-hidden text-sm">
            <TabBtn active={kind === "checkin"} onClick={() => setKind("checkin")} icon={CalendarCheck}>Check-ins</TabBtn>
            <TabBtn active={kind === "checkout"} onClick={() => setKind("checkout")} icon={CalendarX}>Check-outs</TabBtn>
          </div>
          <RangeDropdown
            value={range}
            onChange={setRange}
            options={[["today", "Hoje"], ["tomorrow", "Amanhã"], ["7d", "7 dias"], ["all", "Todos"]]}
          />
          <InfoHint title="Fila de chegadas / saídas">
            Cada card representa uma reserva. Marque <b>Realizado</b> para tirar da fila; use <b>WhatsApp</b> para falar direto; a <b>Nota</b> fica visível só para sua equipe. Reservas sem formulário preenchido aparecem como <i>Hóspede pendente</i>.
          </InfoHint>
          <div className="ml-auto text-xs text-muted-foreground tabular-nums">{rangeLabel[range]} · {rows.length} registro{rows.length !== 1 ? "s" : ""}</div>
        </div>

        {listQ.isLoading ? (
          <div className="py-12 grid place-items-center text-muted-foreground text-sm">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum {kind === "checkin" ? "check-in" : "check-out"} no período.
          </div>
        ) : (
          <div className="relative space-y-6">
            <ArrivalGroup
              title={`Pendentes (${pending.length})`}
              rows={pending}
              kind={kind}
              onMark={(row) => upsert.mutate({ logId: row.logId, kind, status: "done" })}
              onSyncIcal={(row) => {
                const t = kind === "checkin" ? "15:00" : "11:00";
                upsert.mutate({ logId: row.logId, kind, arrivalTimeOverride: t });
                toast.success(`Horário alinhado ao iCal (${t}).`);
              }}
              onNote={(row, note) => upsert.mutate({ logId: row.logId, kind, note })}
              onEditDates={(row, dates) => updateDates.mutate({ logId: row.logId, ...dates })}
              busy={upsert.isPending || updateDates.isPending}
            />
            {done.length > 0 && (
              <ArrivalGroup
                title={`Realizados (${done.length})`}
                rows={done}
                kind={kind}
                onMark={(row) => upsert.mutate({ logId: row.logId, kind, status: "pending" })}
                onSyncIcal={() => {}}
                onNote={(row, note) => upsert.mutate({ logId: row.logId, kind, note })}
                onEditDates={(row, dates) => updateDates.mutate({ logId: row.logId, ...dates })}
                busy={upsert.isPending || updateDates.isPending}
                muted
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------- UI Building Blocks ------------------------- */

function KpiCard({ label, value, icon: Icon, tone, loading, listQuery, kind, rangeLabel }: {
  label: string; value: number | undefined; icon: React.ElementType;
  tone: "primary" | "primary-soft"; loading: boolean;
  listQuery: ReturnType<typeof useQuery<{ rows: ArrivalRow[] } | undefined>>;
  kind: "checkin" | "checkout"; rangeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const toneClass = tone === "primary"
    ? "bg-gradient-to-br from-primary/95 via-primary to-primary/80 text-primary-foreground border-primary/40 shadow-lg shadow-primary/15"
    : "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_14%,transparent)_0%,color-mix(in_oklab,var(--primary)_4%,transparent)_100%)] text-primary border-primary/20";
  const rows = listQuery.data?.rows ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) listQuery.refetch(); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${toneClass}`}
        >
          <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-px h-px bg-white/25" />
          <span aria-hidden className="pointer-events-none absolute -top-8 -right-8 size-28 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-90">
            <Icon className="size-4" /> <span className="truncate">{label}</span>
          </div>
          <div className="relative mt-2 text-3xl sm:text-4xl font-display leading-none tabular-nums">
            {loading ? "—" : value ?? 0}
          </div>
          <div className="relative mt-2 text-[10px] uppercase tracking-wider opacity-70">Toque para detalhes</div>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/60">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Icon className="size-4 text-primary" />
            {label} <span className="text-muted-foreground font-normal">· {rangeLabel}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto">
          {listQuery.isFetching ? (
            <div className="py-12 grid place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Nenhum registro.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Hóspede</th>
                  <th className="text-left px-4 py-2 font-semibold">Unidade</th>
                  <th className="text-left px-4 py-2 font-semibold">Reserva</th>
                  <th className="text-left px-4 py-2 font-semibold">Horário</th>
                  <th className="text-right px-4 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const time = r.arrivalTimeOverride ?? r.guestArrivalTime ?? "—";
                  const done = r.status === "done";
                  return (
                    <tr key={r.logId} className="border-t border-border/40 hover:bg-secondary/30">
                      <td className="px-4 py-2.5">
                        <div className={`font-medium truncate max-w-[180px] ${r.pendingFill ? "text-muted-foreground italic" : ""}`}>{r.guestName}</div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[160px]">{r.propertyName ?? "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">{r.reservationCode ?? "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums">{time}</td>
                      <td className="px-4 py-2.5 text-right">
                        {done ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs">
                            <Check className="size-3.5" /> Realizado
                          </span>
                        ) : r.pendingFill ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs">
                            <UserPlus className="size-3.5" /> Pendente
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                            <Clock className="size-3.5" /> Aguardando
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RangeDropdown<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: Array<[T, string]>;
}) {
  const current = options.find((o) => o[0] === value)?.[1] ?? "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs font-medium text-foreground/80 hover:bg-primary/[0.08] transition-colors"
        >
          {current} <ChevronDown className="size-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-[8rem]">
        {options.map(([v, label]) => (
          <DropdownMenuItem
            key={v}
            onClick={() => onChange(v)}
            className={value === v ? "bg-primary/10 text-primary font-medium" : ""}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 inline-flex items-center gap-2 transition-colors text-sm ${active ? "bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-inner shadow-black/10" : "hover:bg-primary/[0.06] text-foreground/70"}`}
    >
      <Icon className="size-4" /> {children}
    </button>
  );
}

function EngagementBars({ loading, checkins, guideOpens, checkinTabOpens }: {
  loading: boolean; checkins: number; guideOpens: number; checkinTabOpens: number;
}) {
  const base = Math.max(checkins, 1);
  const bar = (num: number) => Math.min(100, Math.round((num / base) * 100));
  if (loading) return <div className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="size-4 inline animate-spin" /></div>;
  return (
    <div className="relative space-y-4">
      <BarRow label="Acessos ao guia" value={guideOpens} total={checkins} pct={bar(guideOpens)} />
      <BarRow label="Abriram aba Chegada" value={checkinTabOpens} total={checkins} pct={bar(checkinTabOpens)} />
    </div>
  );
}
function BarRow({ label, value, total, pct }: { label: string; value: number; total: number; pct: number }) {
  const health = pct >= 80 ? "from-emerald-500 to-emerald-400" : pct >= 50 ? "from-primary to-primary/80" : "from-amber-500 to-amber-400";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground text-xs">{value} / {total} check-ins</span>
      </div>
      <div className="h-2.5 rounded-full bg-secondary/60 overflow-hidden">
        <div className={`h-full bg-gradient-to-r ${health} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ArrivalGroup({ title, rows, kind, onMark, onSyncIcal, onNote, onEditDates, busy, muted }: {
  title: string;
  rows: ArrivalRow[];
  kind: "checkin" | "checkout";
  onMark: (r: ArrivalRow) => void;
  onSyncIcal: (r: ArrivalRow) => void;
  onNote: (r: ArrivalRow, note: string | null) => void;
  onEditDates: (r: ArrivalRow, dates: { checkinDate?: string; checkoutDate?: string | null }) => void;
  busy: boolean;
  muted?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold flex items-center gap-2">
        <span className="h-px w-6 bg-border" />
        {title}
      </div>
      <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 ${muted ? "opacity-70" : ""}`}>
        {rows.map((r) => (
          <ArrivalCard key={r.logId} row={r} kind={kind} onMark={onMark} onSyncIcal={onSyncIcal} onNote={onNote} onEditDates={onEditDates} busy={busy} />
        ))}
      </div>
    </div>
  );
}

function ArrivalCard({ row, kind, onMark, onSyncIcal, onNote, onEditDates, busy }: {
  row: ArrivalRow; kind: "checkin" | "checkout";
  onMark: (r: ArrivalRow) => void;
  onSyncIcal: (r: ArrivalRow) => void;
  onNote: (r: ArrivalRow, note: string | null) => void;
  onEditDates: (r: ArrivalRow, dates: { checkinDate?: string; checkoutDate?: string | null }) => void;
  busy: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(row.note ?? "");
  const guestTime = row.arrivalTimeOverride ?? row.guestArrivalTime;
  const stdWindow = row.standardTime
    ? row.standardTimeMax ? `${row.standardTime} – ${row.standardTimeMax}` : row.standardTime
    : null;
  const divergent =
    !!guestTime && !!row.standardTime &&
    !isTimeWithin(guestTime, row.standardTime, row.standardTimeMax);
  const wa = waLink(row.guestPhone, row.guestPhoneCountry);
  const done = row.status === "done";
  const isPendingFill = row.pendingFill;

  return (
    <div className={`group relative overflow-hidden rounded-2xl border p-4 space-y-3 transition-all ${
      done
        ? "bg-secondary/30 border-border/50"
        : isPendingFill
        ? "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_6%,transparent),transparent_60%)] border-primary/15 border-dashed"
        : "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_5%,transparent),color-mix(in_oklab,var(--primary)_1%,transparent))] border-primary/15 shadow-sm hover:shadow-md hover:-translate-y-0.5"
    }`}>
      {!done && (
        <>
          <span aria-hidden className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r bg-gradient-to-b from-primary/70 to-primary/30" />
          <span aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-primary/[0.06] blur-2xl" />
        </>
      )}

      {/* Header: avatar + name centered vertically with date; CHECK-IN label right-aligned below */}
      <div className="flex items-center gap-3">
        <div className={`size-11 rounded-xl grid place-items-center font-semibold shrink-0 ring-1 ${
          isPendingFill
            ? "bg-primary/5 text-primary/70 ring-primary/10"
            : "bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-primary/15"
        }`}>
          {isPendingFill ? <UserPlus className="size-5" /> : initials(row.guestName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold truncate ${isPendingFill ? "italic text-foreground/80" : ""}`}>{row.guestName}</div>
          <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
            <Home className="size-3 shrink-0" /> {row.propertyName ?? "Sem nome"}
          </div>
          {row.reservationCode && (
            <div className="text-[11px] text-muted-foreground/90 mt-0.5 inline-flex items-center gap-1 font-mono">
              <Hash className="size-3" /> {row.reservationCode}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <input
            type="date"
            value={row.date}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              if (!v || v === row.date) return;
              onEditDates(row, kind === "checkin" ? { checkinDate: v } : { checkoutDate: v });
            }}
            className="text-base font-semibold tabular-nums leading-tight bg-transparent border-0 p-0 text-right w-[112px] cursor-pointer hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded"
            title="Clique para corrigir a data"
          />
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{kind === "checkin" ? "Check-in" : "Check-out"}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-background/50 border border-border/40 p-2 backdrop-blur-sm">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
            <span>Padrão</span>
            <InfoHint title="Horário padrão">Janela configurada na propriedade. Base para detectar divergências.</InfoHint>
          </div>
          <div className="mt-0.5 tabular-nums">{stdWindow ?? "—"}</div>
        </div>
        <div className={`rounded-lg p-2 backdrop-blur-sm ${divergent ? "bg-amber-500/10 border border-amber-500/30" : "bg-background/50 border border-border/40"}`}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
            <span>Previsto</span>
            <InfoHint title="Horário previsto">Horário informado pelo hóspede — ou ajustado ao alinhar com o iCal.</InfoHint>
          </div>
          <div className="mt-0.5 tabular-nums flex items-center gap-1">
            <Clock className="size-3" /> {guestTime ?? "—"}
          </div>
        </div>
      </div>

      {row.ical.hasIcal && !isPendingFill && (() => {
        const icalRef = kind === "checkin" ? row.ical.icalCheckin : row.ical.icalCheckout;
        const dateDivergent = row.ical.matched && icalRef && icalRef !== row.date;
        return (
          <div className={`text-xs rounded-lg px-2 py-1.5 flex items-center gap-2 ${
            dateDivergent
              ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
              : row.ical.matched
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          }`}>
            {dateDivergent ? <AlertTriangle className="size-3.5 shrink-0" /> : row.ical.matched ? <Check className="size-3.5 shrink-0" /> : <AlertTriangle className="size-3.5 shrink-0" />}
            <span className="min-w-0 truncate">
              {dateDivergent
                ? `Data divergente do iCal — hóspede: ${fmtDateBR(row.date)} · iCal: ${fmtDateBR(icalRef!)}`
                : row.ical.matched
                  ? `Confirmado no iCal Airbnb (${row.ical.icalCheckin ? fmtDateBR(row.ical.icalCheckin) : "?"} → ${row.ical.icalCheckout ? fmtDateBR(row.ical.icalCheckout) : "?"})`
                  : "Sem reserva correspondente no iCal Airbnb"}
            </span>
          </div>
        );
      })()}

      {isPendingFill && (
        <div className="text-xs rounded-lg bg-primary/[0.06] border border-primary/15 px-2 py-1.5 flex items-center gap-2 text-foreground/70">
          <UserPlus className="size-3.5 shrink-0" />
          <span>Reserva iCal · aguardando preenchimento do formulário de acesso</span>
        </div>
      )}

      {divergent && !isPendingFill && (
        <div className="text-xs rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5"><AlertTriangle className="size-3.5" /> Horário divergente do padrão</span>
          <button
            onClick={() => onSyncIcal(row)}
            className="text-xs underline underline-offset-2 hover:no-underline"
            disabled={busy}
          >Alinhar</button>
        </div>
      )}

      {row.note && (
        <div className="text-xs rounded-lg bg-secondary/40 px-2 py-1.5 flex items-start gap-1.5">
          <StickyNote className="size-3.5 mt-0.5 shrink-0" /> <span className="whitespace-pre-wrap">{row.note}</span>
        </div>
      )}

      {noteOpen && !isPendingFill && (
        <div className="space-y-2">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Nota interna (visível só para sua equipe)"
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setNoteOpen(false)} className="text-xs px-2 py-1 rounded-md hover:bg-secondary">Cancelar</button>
            <button
              onClick={() => { onNote(row, noteText.trim() || null); setNoteOpen(false); }}
              className="text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground"
              disabled={busy}
            >Salvar</button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {!isPendingFill && (
          <button
            onClick={() => onMark(row)}
            disabled={busy}
            aria-label={done ? "Reabrir" : "Marcar como realizado"}
            title={done ? "Reabrir" : "Marcar como realizado"}
            className={`size-9 grid place-items-center rounded-lg transition-colors ${done ? "bg-secondary hover:bg-secondary/80" : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20"}`}
          >
            <Check className="size-4" />
          </button>
        )}
        {wa && (
          <a
            href={wa} target="_blank" rel="noreferrer"
            aria-label="WhatsApp" title="WhatsApp"
            className="size-9 grid place-items-center rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08]"
          >
            <MessageCircle className="size-4" />
          </a>
        )}
        {!isPendingFill && (
          <button
            onClick={() => setNoteOpen((v) => !v)}
            aria-label={row.note ? "Editar nota" : "Adicionar nota"}
            title={row.note ? "Editar nota" : "Nota interna"}
            className="size-9 grid place-items-center rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08]"
          >
            <StickyNote className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function isTimeWithin(t: string, min: string, max: string | null): boolean {
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const v = toMin(t);
  const a = toMin(min);
  const b = max ? toMin(max) : a + 60;
  return v >= a - 30 && v <= b + 30;
}
