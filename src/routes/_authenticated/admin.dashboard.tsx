import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  CalendarCheck, CalendarX, LogIn, LogOut, MessageCircle, StickyNote, Check,
  AlertTriangle, Clock, Loader2, Home, Info, Sparkles, TrendingUp, Bell,
  ChevronDown, UserPlus, MapPin, Link as LinkIcon, KeyRound, Eye, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  getDashboardKpis, getGuideEngagement, listDashboardArrivals, upsertArrivalStatus, updateGuestStayDates, updateGuestArrivalTime,
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
  const updateTimeFn = useServerFn(updateGuestArrivalTime);
  const qc = useQueryClient();

  const [kind, setKind] = useState<"checkin" | "checkout">("checkin");
  const [range, setRange] = useState<"today" | "tomorrow" | "7d" | "all">("today");
  // Engagement window follows the kanban range: tomorrow/all map to 7d/30d.
  const engRange: "today" | "7d" | "30d" =
    range === "today" ? "today" : range === "all" ? "30d" : "7d";

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

  const updateTime = useMutation({
    mutationFn: (v: { logId: string; time: string | null }) => updateTimeFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dash-list"] });
      toast.success("Horário atualizado.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar horário."),
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
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-7xl mx-auto w-full space-y-6">
      <header>
        <h1 className="font-display text-3xl md:text-4xl flex items-center gap-2.5">
          <TrendingUp className="size-7 text-muted-foreground" /> Dashboard operacional
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Sua rotina diária: check-ins, check-outs e engajamento do guia.
        </p>
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
          shadowTone="emerald"
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
          shadowTone="amber"
        />
        <KpiCard
          label="Check-outs amanhã" value={kpisQ.data?.checkoutsTomorrow} icon={LogOut} tone="primary-soft"
          loading={kpisQ.isLoading}
          listQuery={kpiCoTomorrowQ} kind="checkout"
          rangeLabel="Amanhã"
        />
      </section>

      {/* Engagement */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4 shadow-sm">

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
          <div className="text-xs text-muted-foreground tabular-nums">
            {engRange === "today" ? "Hoje" : engRange === "7d" ? "7 dias" : "30 dias"}
          </div>
        </div>
        <EngagementBars
          loading={engQ.isLoading}
          checkins={engQ.data?.checkinsInPeriod ?? 0}
          guideOpens={engQ.data?.guideOpens ?? 0}
          checkinTabOpens={engQ.data?.checkinTabOpens ?? 0}
        />
      </section>

      {/* Arrivals */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">

          <div className="inline-flex rounded-lg border border-primary/20 bg-primary/[0.04] p-0.5 text-xs">
            <SegBtn active={kind === "checkin"} onClick={() => setKind("checkin")} icon={CalendarCheck}>Check-ins</SegBtn>
            <SegBtn active={kind === "checkout"} onClick={() => setKind("checkout")} icon={CalendarX}>Check-outs</SegBtn>
          </div>
          <div className="ml-auto">
            <RangeDropdown
              value={range}
              onChange={setRange}
              options={[["today", "Hoje"], ["tomorrow", "Amanhã"], ["7d", "7 dias"], ["all", "Todos"]]}
            />
          </div>
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
              onEditTime={(row, time) => updateTime.mutate({ logId: row.logId, time })}
              busy={upsert.isPending || updateDates.isPending || updateTime.isPending}
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
                onEditTime={(row, time) => updateTime.mutate({ logId: row.logId, time })}
                busy={upsert.isPending || updateDates.isPending || updateTime.isPending}
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

function KpiCard({ label, value, icon: Icon, tone, loading, listQuery, kind, rangeLabel, shadowTone }: {
  label: string; value: number | undefined; icon: React.ElementType;
  tone: "primary" | "primary-soft"; loading: boolean;
  listQuery: ReturnType<typeof useQuery<{ rows: ArrivalRow[] } | undefined>>;
  kind: "checkin" | "checkout"; rangeLabel: string;
  shadowTone?: "emerald" | "amber";
}) {
  const [open, setOpen] = useState(false);
  const valueTone = tone === "primary" ? "text-primary" : "text-foreground";
  const rows = listQuery.data?.rows ?? [];
  const shadowClass =
    shadowTone === "emerald"
      ? "shadow-[0_14px_44px_-14px_rgb(16_185_129_/_0.55),0_2px_8px_-2px_rgb(16_185_129_/_0.25)] hover:shadow-[0_18px_54px_-14px_rgb(16_185_129_/_0.65)] border-emerald-500/30"
      : shadowTone === "amber"
        ? "shadow-[0_14px_44px_-14px_rgb(245_158_11_/_0.55),0_2px_8px_-2px_rgb(245_158_11_/_0.25)] hover:shadow-[0_18px_54px_-14px_rgb(245_158_11_/_0.65)] border-amber-500/30"
        : "";
  const valueColor =
    shadowTone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
      : shadowTone === "amber" ? "text-amber-600 dark:text-amber-400"
      : valueTone;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) listQuery.refetch(); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-primary/40 hover:bg-secondary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${shadowClass}`}
        >
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
            <Icon className="size-3.5" /> <span className="truncate">{label}</span>
          </div>
          <div className={`text-2xl font-display mt-1 tabular-nums ${valueColor}`}>
            {loading ? "—" : value ?? 0}
          </div>
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

function SegBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 inline-flex items-center gap-1.5 rounded-md transition-colors font-medium ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-foreground/70 hover:text-foreground hover:bg-primary/[0.06]"
      }`}
    >
      <Icon className="size-3.5" /> {children}
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

function ArrivalGroup({ title, rows, kind, onMark, onSyncIcal, onNote, onEditDates, onEditTime, busy, muted }: {
  title: string;
  rows: ArrivalRow[];
  kind: "checkin" | "checkout";
  onMark: (r: ArrivalRow) => void;
  onSyncIcal: (r: ArrivalRow) => void;
  onNote: (r: ArrivalRow, note: string | null) => void;
  onEditDates: (r: ArrivalRow, dates: { checkinDate?: string; checkoutDate?: string | null }) => void;
  onEditTime: (r: ArrivalRow, time: string | null) => void;
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
          <ArrivalCard key={r.logId} row={r} kind={kind} onMark={onMark} onSyncIcal={onSyncIcal} onNote={onNote} onEditDates={onEditDates} onEditTime={onEditTime} busy={busy} />
        ))}
      </div>
    </div>
  );
}

function ArrivalCard({ row, kind, onMark, onSyncIcal, onNote, onEditDates, onEditTime, busy }: {
  row: ArrivalRow; kind: "checkin" | "checkout";
  onMark: (r: ArrivalRow) => void;
  onSyncIcal: (r: ArrivalRow) => void;
  onNote: (r: ArrivalRow, note: string | null) => void;
  onEditDates: (r: ArrivalRow, dates: { checkinDate?: string; checkoutDate?: string | null }) => void;
  onEditTime: (r: ArrivalRow, time: string | null) => void;
  busy: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(row.note ?? "");
  const [editingTime, setEditingTime] = useState(false);
  const [timeVal, setTimeVal] = useState(row.arrivalTimeOverride ?? row.guestArrivalTime ?? "");
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
  const todayISO = new Date().toLocaleDateString("sv-SE");
  const isToday = row.date === todayISO;

  // Prefer garage address when available for logistics
  const mapsHref = row.garageMapsUrl ?? row.mapsUrl ?? (row.propertyAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.propertyAddress)}` : null);
  const copyText = mapsHref ?? row.propertyAddress ?? "";
  const copyLink = async () => {
    if (!copyText) return;
    try { await navigator.clipboard.writeText(copyText); toast.success("Link copiado."); }
    catch { toast.error("Não foi possível copiar."); }
  };

  const commitTime = () => {
    setEditingTime(false);
    const v = timeVal.trim();
    if (!v) { onEditTime(row, null); return; }
    if (!/^\d{2}:\d{2}$/.test(v)) { toast.error("Use o formato HH:mm."); return; }
    if (v !== (row.arrivalTimeOverride ?? row.guestArrivalTime ?? "")) onEditTime(row, v);
  };

  return (
    <div className={`group relative overflow-hidden rounded-2xl border p-4 space-y-3 transition-all ${
      done
        ? "bg-secondary/30 border-border/50"
        : isPendingFill
        ? "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_6%,transparent),transparent_60%)] border-primary/15 border-dashed"
        : isToday
        ? "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_7%,transparent),color-mix(in_oklab,var(--primary)_2%,transparent))] border-primary/30 shadow-[0_14px_44px_-14px_color-mix(in_oklab,var(--primary)_55%,transparent),0_2px_8px_-2px_color-mix(in_oklab,var(--primary)_25%,transparent)] hover:shadow-[0_18px_54px_-14px_color-mix(in_oklab,var(--primary)_65%,transparent),0_2px_10px_-2px_color-mix(in_oklab,var(--primary)_30%,transparent)] hover:-translate-y-0.5"
        : "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_5%,transparent),color-mix(in_oklab,var(--primary)_1%,transparent))] border-primary/15 shadow-sm hover:shadow-md hover:-translate-y-0.5"
    }`}>
      {!done && (
        <>
          <span aria-hidden className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r bg-gradient-to-b from-primary/70 to-primary/30" />
          {/* Contained decorative glow — no bleed */}
          <span aria-hidden className={`pointer-events-none absolute top-0 right-0 -translate-y-1/3 translate-x-1/3 rounded-full blur-2xl ${isToday ? "size-40 bg-primary/[0.14]" : "size-32 bg-primary/[0.07]"}`} />
        </>
      )}

      {/* Top-left location actions */}
      {(mapsHref || row.propertyAddress) && !done && (
        <div className="absolute top-3 left-3 flex items-center gap-1 z-10">
          {copyText && (
            <button
              type="button"
              onClick={copyLink}
              title="Copiar link do endereço"
              aria-label="Copiar link do endereço"
              className="size-7 grid place-items-center rounded-md bg-background/70 backdrop-blur border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/40"
            >
              <LinkIcon className="size-3.5" />
            </button>
          )}
          {mapsHref && (
            <a
              href={mapsHref} target="_blank" rel="noreferrer"
              title={row.garageMapsUrl ? "Ver garagem no Maps" : "Ver endereço no Maps"}
              aria-label="Abrir no Google Maps"
              className="inline-flex items-center gap-1 rounded-md bg-background/70 backdrop-blur border border-border/50 px-2 h-7 text-[11px] font-medium text-foreground/80 hover:text-primary hover:border-primary/40"
            >
              <MapPin className="size-3.5" /> Maps
            </a>
          )}
        </div>
      )}

      {/* Header: name + dates */}
      <div className={`flex items-start gap-3 ${!done && (mapsHref || row.propertyAddress) ? "pt-8" : ""}`}>
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
        </div>
        {/* Stacked check-in / check-out dates, both editable */}
        <div className="text-right shrink-0 space-y-1">
          <DateEditor
            label="Check-in"
            value={row.guestCheckin}
            disabled={busy}
            onChange={(v) => onEditDates(row, { checkinDate: v })}
          />
          {row.guestCheckout && (
            <DateEditor
              label="Check-out"
              value={row.guestCheckout}
              disabled={busy}
              onChange={(v) => onEditDates(row, { checkoutDate: v })}
            />
          )}
        </div>
      </div>

      {/* Engagement badges */}
      {!isPendingFill && (row.openedCheckin || (row.hasPasswords && row.viewedPasswords) || row.hasPasswords) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
            row.openedCheckin
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25"
              : "bg-muted/40 text-muted-foreground border-border/60"
          }`}>
            <Eye className="size-3" /> {row.openedCheckin ? "Abriu Chegada" : "Não abriu Chegada"}
          </span>
          {row.hasPasswords && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
              row.viewedPasswords
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25"
            }`}>
              <KeyRound className="size-3" /> {row.viewedPasswords ? "Viu senhas" : "Não viu senhas"}
            </span>
          )}
        </div>
      )}

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
            <InfoHint title="Horário previsto">Clique no horário para ajustar. A correção atualiza todas as demais telas.</InfoHint>
          </div>
          <div className="mt-0.5 tabular-nums flex items-center gap-1">
            <Clock className="size-3" />
            {editingTime && !isPendingFill ? (
              <input
                type="time"
                autoFocus
                value={timeVal}
                onChange={(e) => setTimeVal(e.target.value)}
                onBlur={commitTime}
                onKeyDown={(e) => { if (e.key === "Enter") commitTime(); if (e.key === "Escape") setEditingTime(false); }}
                className="bg-transparent border-b border-primary/40 focus:outline-none w-16 tabular-nums"
              />
            ) : (
              <button
                type="button"
                disabled={busy || isPendingFill}
                onClick={() => { setTimeVal(guestTime ?? ""); setEditingTime(true); }}
                className="tabular-nums hover:text-primary disabled:cursor-not-allowed disabled:hover:text-inherit"
                title={isPendingFill ? "Aguarde o hóspede preencher" : "Clique para editar"}
              >
                {guestTime ?? "—"}
              </button>
            )}
          </div>
        </div>
      </div>

      {row.ical.hasIcal && !isPendingFill && (() => {
        const gIn = row.guestCheckin;
        const gOut = row.guestCheckout;
        const iIn = row.ical.icalCheckin;
        const iOut = row.ical.icalCheckout;
        const anyDivergent = row.ical.matched && ((iIn && iIn !== gIn) || (iOut && gOut && iOut !== gOut));
        const fmtRange = (a: string | null, b: string | null) =>
          `${a ? fmtDateBR(a) : "?"} a ${b ? fmtDateBR(b) : "?"}`;
        return (
          <div className={`text-xs rounded-lg px-2 py-1.5 flex items-start gap-2 ${
            anyDivergent
              ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
              : row.ical.matched
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          }`}>
            {anyDivergent ? <AlertTriangle className="size-3.5 shrink-0 mt-0.5" /> : row.ical.matched ? <Check className="size-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />}
            <div className="min-w-0 flex-1 leading-snug">
              {anyDivergent ? (
                <>
                  <div className="font-semibold">Data Divergente Hóspede-Airbnb</div>
                  <div className="tabular-nums">Informada: {fmtRange(gIn, gOut)}</div>
                  <div className="tabular-nums">Correta: {fmtRange(iIn, iOut)}</div>
                </>
              ) : row.ical.matched ? (
                <>
                  <div className="font-semibold">Confirmado no Airbnb</div>
                  <div className="tabular-nums">{fmtRange(iIn, iOut)}</div>
                </>
              ) : (
                <div>Sem reserva correspondente no iCal Airbnb</div>
              )}
            </div>
            {anyDivergent && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onEditDates(row, {
                  ...(iIn && iIn !== gIn ? { checkinDate: iIn } : {}),
                  ...(iOut && gOut && iOut !== gOut ? { checkoutDate: iOut } : {}),
                })}
                className="text-xs underline underline-offset-2 hover:no-underline shrink-0 mt-0.5"
              >Usar Airbnb</button>
            )}
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

      {row.note && !noteOpen && (
        <button
          type="button"
          onClick={() => { setNoteText(row.note ?? ""); setNoteOpen(true); }}
          className="w-full text-left text-xs rounded-lg bg-secondary/40 hover:bg-secondary/60 px-2 py-1.5 flex items-start gap-1.5 transition-colors"
          title="Clique para editar a nota"
        >
          <StickyNote className="size-3.5 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap flex-1">{row.note}</span>
        </button>
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
          <div className="flex items-center justify-between gap-2">
            {row.note ? (
              <button
                onClick={() => { onNote(row, null); setNoteOpen(false); setNoteText(""); }}
                className="text-xs px-2 py-1 rounded-md text-rose-600 hover:bg-rose-500/10 inline-flex items-center gap-1"
                disabled={busy}
                title="Excluir nota"
              ><Trash2 className="size-3.5" /> Excluir</button>
            ) : <span />}
            <div className="flex gap-2">
              <button onClick={() => setNoteOpen(false)} className="text-xs px-2 py-1 rounded-md hover:bg-secondary">Cancelar</button>
              <button
                onClick={() => { onNote(row, noteText.trim() || null); setNoteOpen(false); }}
                className="text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground"
                disabled={busy}
              >Salvar</button>
            </div>
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

function DateEditor({ label, value, disabled, onChange }: {
  label: string; value: string; disabled: boolean; onChange: (v: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        const input = e.currentTarget.querySelector("input") as HTMLInputElement | null;
        if (input && typeof input.showPicker === "function") input.showPicker();
        else input?.focus();
      }}
      className="relative inline-block text-right cursor-pointer rounded hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      title={`Clique para corrigir ${label.toLowerCase()}`}
    >
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (!v || v === value) return;
          onChange(v);
        }}
        onClick={(e) => e.stopPropagation()}
        className="text-sm font-semibold tabular-nums leading-tight bg-transparent border-0 p-0 text-right w-[100px] cursor-pointer focus:outline-none [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-inner-spin-button]:hidden"
      />
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground -mt-0.5">{label}</div>
    </button>
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
