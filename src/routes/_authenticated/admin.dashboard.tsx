import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarCheck, CalendarX, LogIn, LogOut, MessageCircle, StickyNote, Check,
  AlertTriangle, Clock, Loader2, Home, Info, Sparkles, TrendingUp, Bell,
  ChevronDown, UserPlus, MapPin, Link as LinkIcon, KeyRound, Eye, Trash2, BedDouble,
} from "lucide-react";
import { toast } from "sonner";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CopyButton } from "@/components/CopyButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  getDashboardKpis, getGuideEngagement, listDashboardArrivals, upsertArrivalStatus, updateGuestStayDates, updateGuestArrivalTime, advanceArrival,
  type ArrivalRow,
} from "@/lib/dashboard.functions";
import { useImpersonation } from "@/hooks/useImpersonation";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Operação — ConciergeIA" },
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
  const { impersonation } = useImpersonation();
  const activeOwnerId = impersonation?.userId ?? null;

  const [mode, setMode] = useState<"checkin" | "checkout" | "stay" | "cleaning">("checkin");
  const kind: "checkin" | "checkout" = mode === "checkout" || mode === "cleaning" ? "checkout" : "checkin";
  const [range, setRange] = useState<"today" | "tomorrow" | "7d" | "all">("today");
  // Engagement window follows the kanban range: tomorrow/all map to 7d/30d.
  const engRange: "today" | "7d" | "30d" =
    range === "today" ? "today" : range === "all" ? "30d" : "7d";

  const kpisQ = useQuery({ queryKey: ["dash-kpis", activeOwnerId ?? "self"], queryFn: () => kpisFn({ data: { ownerId: activeOwnerId } }), staleTime: 60_000 });
  const engQ = useQuery({
    queryKey: ["dash-eng", engRange, activeOwnerId ?? "self"],
    queryFn: () => engFn({ data: { range: engRange, ownerId: activeOwnerId } }),
    staleTime: 60_000,
  });
  const checkinListQ = useQuery({
    queryKey: ["dash-list", "checkin", range, activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkin", range, ownerId: activeOwnerId } }),
    staleTime: 30_000,
  });
  const checkoutListQ = useQuery({
    queryKey: ["dash-list", "checkout", range, activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkout", range, ownerId: activeOwnerId } }),
    staleTime: 30_000,
  });
  const listQ = kind === "checkin" ? checkinListQ : checkoutListQ;

  // KPI drill-down data (loaded on demand)
  const kpiTodayQ = useQuery({
    queryKey: ["dash-list", "checkin", "today", activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkin", range: "today", ownerId: activeOwnerId } }),
    staleTime: 30_000,
  });
  const kpiTomorrowQ = useQuery({
    queryKey: ["dash-list", "checkin", "tomorrow", activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkin", range: "tomorrow", ownerId: activeOwnerId } }),
    staleTime: 30_000,
  });
  const kpiCoTodayQ = useQuery({
    queryKey: ["dash-list", "checkout", "today", activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkout", range: "today", ownerId: activeOwnerId } }),
    staleTime: 30_000,
  });
  const kpiCoTomorrowQ = useQuery({
    queryKey: ["dash-list", "checkout", "tomorrow", activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkout", range: "tomorrow", ownerId: activeOwnerId } }),
    staleTime: 30_000,
  });

  type UpsertPayload = {
    logId?: string;
    reservationId?: string;
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

  function statusTarget(row: ArrivalRow): Pick<UpsertPayload, "logId" | "reservationId"> {
    const logId = /^[0-9a-f-]{36}$/i.test(row.logId) ? row.logId : undefined;
    return { ...(logId ? { logId } : {}), ...(row.reservationId ? { reservationId: row.reservationId } : {}) };
  }

  function handleMark(row: ArrivalRow, nextStatus: "pending" | "done") {
    upsert.mutate({ ...statusTarget(row), kind, status: nextStatus });
  }

  function handleEditTime(row: ArrivalRow, k: "checkin" | "checkout", time: string | null) {
    upsert.mutate({ ...statusTarget(row), kind: k, arrivalTimeOverride: time });
  }

  // Realtime — sincroniza kanban e KPIs sem precisar recarregar a página quando
  // horários, notas ou reservas mudam (via outro membro da equipe, iCal etc).
  useEffect(() => {
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["dash-list"] });
      qc.invalidateQueries({ queryKey: ["dash-kpis"] });
      qc.invalidateQueries({ queryKey: ["dash-eng"] });
    };
    const ch = supabase
      .channel("dash-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "guide_access_logs" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_arrival_status" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "property_reservations" }, invalidate)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);



  const rows = listQ.data?.rows ?? [];
  const pending = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  const done = useMemo(() => rows.filter((r) => r.status === "done"), [rows]);
  const boardRows = mode === "stay" || mode === "cleaning" ? done : pending;

  const ciRows = checkinListQ.data?.rows ?? [];
  const coRows = checkoutListQ.data?.rows ?? [];
  const counts = {
    checkin: ciRows.filter((r) => r.status === "pending").length,
    checkout: coRows.filter((r) => r.status === "pending").length,
    stay: ciRows.filter((r) => r.status === "done").length,
    cleaning: coRows.filter((r) => r.status === "done").length,
  };

  /* ---------- Attention alerts ---------- */
  const alerts = useMemo(() => {
    const list: Array<{ tone: "warn" | "info" | "success"; icon: React.ElementType; text: React.ReactNode }> = [];
    const k = kpisQ.data;
    const e = engQ.data;

    if (e && e.checkinsInPeriod > 0) {
      const gap = e.checkinsInPeriod - e.checkinTabOpens;
      if (gap > 0) {
        const plural = gap > 1;
        list.push({
          tone: "warn", icon: AlertTriangle,
          text: <><b className="tabular-nums">{gap}</b> {plural ? "hóspedes" : "hóspede"} ainda {plural ? "não abriram" : "não abriu"} a aba <i>Chegada</i>.</>,
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
      const plural = pendingFillCount > 1;
      list.push({
        tone: "warn", icon: UserPlus,
        text: <><b className="tabular-nums">{pendingFillCount}</b> {plural ? "reservas" : "reserva"} sem {plural ? "formulários preenchidos" : "formulário preenchido"} de acesso.</>,
      });
    }
    const overdueCount = rows.filter((r) => {
      const today = new Date().toLocaleDateString("sv-SE");
      return r.date < today;
    }).length;
    if (overdueCount > 0) {
      const plural = overdueCount > 1;
      list.push({
        tone: "warn", icon: AlertTriangle,
        text: <><b className="tabular-nums">{overdueCount}</b> {plural ? "cards atrasados" : "card atrasado"} — {plural ? "aguardam" : "aguarda"} check.</>,
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
          <TrendingUp className="size-7 text-muted-foreground" /> Operação
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
          onEditTime={handleEditTime}
        />
        <KpiCard
          label="Check-outs hoje" value={kpisQ.data?.checkoutsToday} icon={LogOut} tone="primary"
          loading={kpisQ.isLoading}
          listQuery={kpiCoTodayQ} kind="checkout"
          rangeLabel="Hoje"
          shadowTone="amber"
          onEditTime={handleEditTime}
        />
        <KpiCard
          label="Check-ins amanhã" value={kpisQ.data?.checkinsTomorrow} icon={LogIn} tone="primary-soft"
          loading={kpisQ.isLoading}
          listQuery={kpiTomorrowQ} kind="checkin"
          rangeLabel="Amanhã"
          onEditTime={handleEditTime}
        />
        <KpiCard
          label="Check-outs amanhã" value={kpisQ.data?.checkoutsTomorrow} icon={LogOut} tone="primary-soft"
          loading={kpisQ.isLoading}
          listQuery={kpiCoTomorrowQ} kind="checkout"
          rangeLabel="Amanhã"
          onEditTime={handleEditTime}
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
              <div className="text-sm font-semibold">
                Engajamento do guia
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
        <div className="flex items-center gap-3">
          <ModeDropdown
            value={mode}
            onChange={setMode}
            options={[
              { value: "checkin", label: "Check-ins", icon: CalendarCheck, count: counts.checkin },
              { value: "checkout", label: "Check-outs", icon: CalendarX, count: counts.checkout },
              { value: "stay", label: "Em Estadia", icon: BedDouble, count: counts.stay },
              { value: "cleaning", label: "Em Limpeza", icon: Sparkles, count: counts.cleaning },
            ]}
          />
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
        ) : boardRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Nenhum registro no período.
          </div>
        ) : (
          <div className="relative space-y-6">
            <ArrivalGroup
              title=""
              rows={boardRows}
              kind={kind}
              onMark={(row) => handleMark(row, mode === "stay" || mode === "cleaning" ? "pending" : "done")}
              onSyncIcal={(row) => {
                const t = kind === "checkin" ? "15:00" : "11:00";
                upsert.mutate({ ...statusTarget(row), kind, arrivalTimeOverride: t });
                toast.success(`Horário alinhado ao iCal (${t}).`);
              }}
              onNote={(row, note) => upsert.mutate({ ...statusTarget(row), kind, note })}
              onEditDates={(row, dates) => updateDates.mutate({ logId: row.logId, ...dates })}
              onEditTime={(row, time) => handleEditTime(row, kind, time)}
              busy={upsert.isPending || updateDates.isPending || updateTime.isPending}
              muted={mode === "stay" || mode === "cleaning"}
            />
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------- UI Building Blocks ------------------------- */

function KpiCard({ label, value, icon: Icon, tone, loading, listQuery, kind, rangeLabel, shadowTone, onEditTime }: {
  label: string; value: number | undefined; icon: React.ElementType;
  tone: "primary" | "primary-soft"; loading: boolean;
  listQuery: ReturnType<typeof useQuery<{ rows: ArrivalRow[] } | undefined>>;
  kind: "checkin" | "checkout"; rangeLabel: string;
  shadowTone?: "emerald" | "amber";
  onEditTime: (row: ArrivalRow, kind: "checkin" | "checkout", time: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const valueTone = tone === "primary" ? "text-primary" : "text-foreground";
  const rows = listQuery.data?.rows ?? [];
  const valueColor =
    shadowTone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
      : shadowTone === "amber" ? "text-amber-600 dark:text-amber-400"
      : valueTone;
  const shadowClass =
    shadowTone === "emerald"
      ? "shadow-[0_18px_42px_-18px_rgba(16,185,129,0.85),0_0_0_1px_rgba(16,185,129,0.10)] hover:shadow-[0_22px_52px_-18px_rgba(16,185,129,0.95),0_0_0_1px_rgba(16,185,129,0.16)]"
      : shadowTone === "amber"
      ? "shadow-[0_18px_42px_-18px_rgba(245,158,11,0.85),0_0_0_1px_rgba(245,158,11,0.10)] hover:shadow-[0_22px_52px_-18px_rgba(245,158,11,0.95),0_0_0_1px_rgba(245,158,11,0.16)]"
      : "shadow-sm hover:shadow-md";

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) listQuery.refetch(); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`w-full h-full rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-primary/40 hover:bg-secondary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${shadowClass}`}
        >
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
            <Icon className="size-3.5" /> <span className="truncate">{label}</span>
          </div>
          <div className={`text-2xl font-display mt-1 tabular-nums ${valueColor}`}>
            {loading ? "—" : value ?? 0}
          </div>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-2xl border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        <div className={`absolute inset-x-0 top-0 h-px ${shadowTone === "emerald" ? "bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" : shadowTone === "amber" ? "bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" : "bg-gradient-to-r from-transparent via-primary/50 to-transparent"}`} />
        <DialogHeader className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className={`grid place-items-center size-10 rounded-xl ${shadowTone === "emerald" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : shadowTone === "amber" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-primary/10 text-primary"}`}>
              <Icon className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-display leading-tight truncate">{label}</DialogTitle>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mt-0.5">
                {rangeLabel} · {rows.length} {rows.length === 1 ? "hóspede" : "hóspedes"}
              </div>
            </div>
          </div>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-3 pb-4">
          {listQuery.isFetching ? (
            <div className="py-14 grid place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Nenhum registro no período.</div>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((r) => {
                const time = r.arrivalTimeOverride ?? r.guestArrivalTime ?? null;
                const done = r.status === "done";
                const initials = (r.guestName || "?")
                  .split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
                return (
                  <li
                    key={r.logId}
                    className="group flex items-center gap-2 rounded-xl border border-border/50 bg-background/40 px-2.5 py-2 transition hover:border-border hover:bg-secondary/40"
                  >
                    <div className={`grid place-items-center size-8 rounded-full text-xs font-semibold shrink-0 ${r.pendingFill ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                      {r.pendingFill ? <UserPlus className="size-4" /> : initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium leading-tight truncate flex items-center gap-1.5 ${r.pendingFill ? "text-muted-foreground italic" : ""}`}>
                        {r.pendingFill || !r.guestName || r.guestName === r.reservationCode ? (
                          r.reservationCode ? (
                            <span className="inline-flex items-center gap-0.5 text-foreground font-semibold not-italic shrink-0">
                              <span className="truncate max-w-[140px]">{r.reservationCode}</span>
                              <CopyButton value={r.reservationCode} size={11} className="p-0.5" />
                            </span>
                          ) : (
                            <span className="truncate font-semibold not-italic text-foreground">{r.guestName}</span>
                          )
                        ) : (
                          <>
                            <span className="truncate">{r.guestName}</span>
                            {r.reservationCode && (
                              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground font-normal not-italic shrink-0">
                                <span className="truncate max-w-[90px]">{r.reservationCode}</span>
                                <CopyButton value={r.reservationCode} size={10} className="p-0.5" />
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {r.propertyName ?? "—"}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <TimeDropdown
                        value={time}
                        onChange={(v) => onEditTime(r, kind, v)}
                        size="xs"
                      />
                      {done ? (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                          <Check className="size-3" /> Feito
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Aguardando</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
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

function ModeDropdown<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon: React.ElementType; count: number }>;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const CurrentIcon = current.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs font-medium text-foreground/80 hover:bg-primary/[0.08] transition-colors"
        >
          <CurrentIcon className="size-3.5 shrink-0" />
          <span>{current.label}</span>
          <span className="tabular-nums text-muted-foreground">({current.count})</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem]">
        {options.map((o) => {
          const Icon = o.icon;
          const active = o.value === value;
          return (
            <DropdownMenuItem
              key={o.value}
              onClick={() => onChange(o.value)}
              className={active ? "bg-primary/10 text-primary font-medium" : ""}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="flex-1">{o.label}</span>
              <span className="tabular-nums text-muted-foreground">({o.count})</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SegBtn({ active, onClick, icon: Icon, count, children }: { active: boolean; onClick: () => void; icon: React.ElementType; count?: number; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-1.5 inline-flex items-center justify-start gap-1.5 rounded-lg border text-xs transition-colors font-medium ${
        active
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : "bg-primary/[0.04] text-foreground/75 border-primary/20 hover:text-foreground hover:bg-primary/[0.08]"
      }`}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
      {typeof count === "number" && (
        <span className={`ml-1 tabular-nums ${active ? "opacity-90" : "text-muted-foreground"}`}>({count})</span>
      )}
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
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground text-xs">{value} / {total} check-ins</span>
      </div>
      {/* Battery: red base, green fill overlay */}
      <div className="h-2.5 rounded-full bg-rose-500/70 overflow-hidden ring-1 ring-rose-500/20">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-700"
          style={{ width: `${pct}%` }}
        />
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
    <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch ${muted ? "opacity-70" : ""}`}>
      {rows.map((r) => (
        <ArrivalCard key={r.logId} row={r} kind={kind} onMark={onMark} onSyncIcal={onSyncIcal} onNote={onNote} onEditDates={onEditDates} onEditTime={onEditTime} busy={busy} />
      ))}
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
  const isOverdue = row.date < todayISO;

  // Prefer garage address when available for logistics
  const mapsHref = row.garageMapsUrl ?? row.mapsUrl ?? (row.propertyAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.propertyAddress)}` : null);
  const copyText = mapsHref ?? row.propertyAddress ?? "";
  const copyLink = async () => {
    if (!copyText) return;
    try { await navigator.clipboard.writeText(copyText); toast.success("Link copiado."); }
    catch { toast.error("Não foi possível copiar."); }
  };

  return (
    <div className={`group relative h-full flex flex-col overflow-hidden rounded-2xl border p-4 gap-3 transition-all ${
      done
        ? "bg-secondary/30 border-border/50"
        : isOverdue
        ? "bg-[linear-gradient(135deg,color-mix(in_oklab,#ef4444_10%,transparent),color-mix(in_oklab,#ef4444_2%,transparent))] border-red-500/40 shadow-[0_10px_28px_-16px_rgba(239,68,68,0.35)]"
        : isToday
        ? "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_7%,transparent),color-mix(in_oklab,var(--primary)_2%,transparent))] border-primary/25 shadow-[0_10px_28px_-16px_color-mix(in_oklab,var(--primary)_28%,transparent),0_1px_4px_-2px_color-mix(in_oklab,var(--primary)_14%,transparent)] hover:shadow-[0_12px_32px_-16px_color-mix(in_oklab,var(--primary)_36%,transparent)] hover:-translate-y-0.5"
        : "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_5%,transparent),color-mix(in_oklab,var(--primary)_1%,transparent))] border-primary/15 shadow-sm hover:shadow-md hover:-translate-y-0.5"
    }`}>
      {isOverdue && !done && (
        <div className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/40">
          <AlertTriangle className="size-3" /> Atrasado
        </div>
      )}

      {!done && (
        <>
          <span aria-hidden className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r bg-gradient-to-b from-primary/70 to-primary/30" />
          <span aria-hidden className={`pointer-events-none absolute top-0 right-0 -translate-y-1/3 translate-x-1/3 rounded-full blur-2xl ${isToday ? "size-40 bg-primary/[0.14]" : "size-32 bg-primary/[0.07]"}`} />
        </>
      )}

      {/* Header: avatar + name + property + inline date range */}
      <div className="flex items-center gap-3">
        <div className={`size-11 rounded-xl grid place-items-center font-semibold shrink-0 ring-1 ${
          isPendingFill
            ? "bg-primary/5 text-primary/70 ring-primary/10"
            : "bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-primary/15"
        }`}>
          {isPendingFill ? <UserPlus className="size-5" /> : initials(row.guestName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold truncate flex items-center gap-2 ${isPendingFill ? "italic text-foreground/80" : ""}`}>
            {isPendingFill || !row.guestName || row.guestName === row.reservationCode ? (
              row.reservationCode ? (
                <span className="inline-flex items-center gap-1 text-foreground font-semibold not-italic shrink-0">
                  <span className="truncate max-w-[180px]">{row.reservationCode}</span>
                  <CopyButton value={row.reservationCode} size={12} className="p-0.5" />
                </span>
              ) : (
                <span className="truncate font-semibold not-italic text-foreground">{row.guestName}</span>
              )
            ) : (
              <span className="truncate">{row.guestName}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
            <Home className="size-3 shrink-0" /> {row.propertyName ?? "Sem nome"}
          </div>
          {/* Período: "dd/mm/aaaa a dd/mm/aaaa", editável inline, alinhado à esquerda */}
          <div className="mt-1 flex items-center gap-1 text-xs tabular-nums text-foreground/80">
            <DateEditor
              value={row.guestCheckin}
              disabled={busy || isPendingFill}
              onChange={(v) => onEditDates(row, { checkinDate: v })}
            />
            {row.guestCheckout && (
              <>
                <span className="text-muted-foreground">a</span>
                <DateEditor
                  value={row.guestCheckout}
                  disabled={busy || isPendingFill}
                  onChange={(v) => onEditDates(row, { checkoutDate: v })}
                />
              </>
            )}
          </div>
          {/* Código da reserva abaixo do período quando há nome do hóspede */}
          {!isPendingFill && row.guestName && row.guestName !== row.reservationCode && row.reservationCode && (
            <div className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground font-normal tabular-nums">
              <span className="truncate max-w-[160px]">{row.reservationCode}</span>
              <CopyButton value={row.reservationCode} size={10} className="p-0.5" />
            </div>
          )}
        </div>
      </div>


      {/* Engagement — só mostra pendências (fatos negativos). Estados positivos são omitidos. */}
      {!isPendingFill && (!row.openedCheckin || (row.hasPasswords && !row.viewedPasswords)) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {!row.openedCheckin && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25">
              <Eye className="size-3" /> Não abriu Chegada
            </span>
          )}
          {row.hasPasswords && !row.viewedPasswords && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25">
              <KeyRound className="size-3" /> Não viu senhas
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
            <InfoHint title="Horário previsto">Selecione o horário (30 em 30 min). A alteração reordena o kanban imediatamente.</InfoHint>
          </div>
          <div className="mt-0.5">
            <TimeDropdown
              value={guestTime ?? null}
              disabled={busy}
              onChange={(v) => onEditTime(row, v)}
            />
          </div>
        </div>
      </div>

      {row.ical.hasIcal && !isPendingFill && (() => {
        const gIn = row.guestCheckin;
        const gOut = row.guestCheckout;
        const iIn = row.ical.icalCheckin;
        const iOut = row.ical.icalCheckout;
        const anyDivergent = row.ical.matched && ((iIn && iIn !== gIn) || (iOut && gOut && iOut !== gOut));
        if (!anyDivergent && row.ical.matched) return null;
        const fmtRange = (a: string | null, b: string | null) =>
          `${a ? fmtDateBR(a) : "?"} a ${b ? fmtDateBR(b) : "?"}`;
        return (
          <div className="w-full text-xs rounded-lg px-2 py-1.5 flex items-start gap-2 bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/40">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 leading-snug">
              {anyDivergent ? (
                <>
                  <div className="font-semibold">Data Divergente Hóspede-Airbnb</div>
                  <div className="tabular-nums">Informada: {fmtRange(gIn, gOut)}</div>
                  <div className="tabular-nums">Correta: {fmtRange(iIn, iOut)}</div>
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
        <div className="w-full text-xs rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <UserPlus className="size-3.5 shrink-0" />
          <span>Reserva iCal · aguardando preenchimento do formulário de acesso</span>
        </div>
      )}

      {divergent && !isPendingFill && !done && (
        <div className="w-full text-xs rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 flex items-center justify-between gap-2">
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

      {noteOpen && (
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

      {/* Action row: ícones à esquerda; Copiar + Maps agrupados à direita */}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() => onMark(row)}
          disabled={busy}
          aria-label={done ? "Reabrir" : "Marcar como realizado"}
          title={done ? "Reabrir" : "Marcar como realizado"}
          className={`size-9 grid place-items-center rounded-lg transition-colors ${done ? "bg-secondary hover:bg-secondary/80" : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20"}`}
        >
          <Check className="size-4" />
        </button>
        {wa && (
          <a
            href={wa} target="_blank" rel="noreferrer"
            aria-label="WhatsApp" title="WhatsApp"
            className="size-9 grid place-items-center rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08]"
          >
            <MessageCircle className="size-4" />
          </a>
        )}
        <button
          onClick={() => setNoteOpen((v) => !v)}
          aria-label={row.note ? "Editar nota" : "Adicionar nota"}
          title={row.note ? "Editar nota" : "Nota interna"}
          className="size-9 grid place-items-center rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08]"
        >
          <StickyNote className="size-4" />
        </button>
        {mapsHref && (
          <div className="ml-auto flex items-center gap-1.5">
            {copyText && (
              <button
                type="button"
                onClick={copyLink}
                aria-label="Copiar link do endereço"
                title="Copiar link do endereço"
                className="size-9 grid place-items-center rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08]"
              >
                <LinkIcon className="size-4" />
              </button>
            )}
            <a
              href={mapsHref} target="_blank" rel="noreferrer"
              aria-label="Abrir no Google Maps"
              title={row.garageMapsUrl ? "Ver garagem no Maps" : "Ver endereço no Maps"}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08] text-sm font-medium"
            >
              <MapPin className="size-4" /> Maps
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function DateEditor({ value, disabled, onChange }: {
  value: string; disabled: boolean; onChange: (v: string) => void;
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
      className="relative inline-flex items-center cursor-pointer rounded hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:hover:text-inherit"
      title="Clique para corrigir a data"
    >
      <span className="tabular-nums">{fmtDateBR(value)}</span>
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
        aria-label="Data"
        className="absolute inset-0 opacity-0 cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
      />
    </button>
  );
}

export const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

function TimeDropdown({ value, disabled, onChange, size = "sm" }: {
  value: string | null;
  disabled?: boolean;
  onChange: (v: string | null) => void;
  size?: "sm" | "xs";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
          title={disabled ? "Indisponível" : "Selecionar horário previsto"}
          className={`inline-flex items-center gap-1 tabular-nums rounded hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:hover:text-inherit ${size === "xs" ? "text-xs" : "text-sm"}`}
        >
          <Clock className="size-3" />
          <span>{value ?? "—"}</span>
          <ChevronDown className="size-3 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto min-w-[6rem] p-1">
        {value && (
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="text-xs text-muted-foreground justify-center"
          >
            Limpar
          </DropdownMenuItem>
        )}
        {TIME_SLOTS.map((t) => (
          <DropdownMenuItem
            key={t}
            onClick={(e) => { e.stopPropagation(); onChange(t); }}
            className={`tabular-nums text-xs justify-center ${value === t ? "bg-primary/10 text-primary font-medium" : ""}`}
          >
            {t}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
