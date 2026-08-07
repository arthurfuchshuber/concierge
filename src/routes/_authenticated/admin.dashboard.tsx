import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarCheck,
  CalendarX,
  LogIn,
  LogOut,
  MessageCircle,
  StickyNote,
  Check,
  AlertTriangle,
  Loader2,
  Home,
  Info,
  Sparkles,
  TrendingUp,
  Bell,
  ChevronDown,
  UserPlus,
  MapPin,
  Link as LinkIcon,
  KeyRound,
  Eye,
  Trash2,
  BedDouble,
  CheckCircle2,
  Undo2,
  Filter,

} from "lucide-react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CopyButton } from "@/components/CopyButton";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  getGuideEngagement,
  listDashboardArrivals,
  upsertArrivalStatus,
  updateGuestStayDates,
  updateGuestArrivalTime,
  advanceArrival,
  revertArrival,
  listConcludedArrivals,
  getOccupancyBoard,
  type ArrivalRow,
} from "@/lib/dashboard.functions";
import { openHandoffDock } from "@/lib/handoff-dock";
import { useImpersonation } from "@/hooks/useImpersonation";

function PhoneLink({ phone, country }: { phone: string | null; country: string | null }) {
  if (!phone) return null;
  const countryDigits = (country ?? "").replace(/\D/g, "");
  const phoneDigits = phone.replace(/\D/g, "");
  const digits = phone.trim().startsWith("+") || !countryDigits
    ? phoneDigits
    : `${countryDigits}${phoneDigits}`;
  if (!digits) return null;

  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-medium text-emerald-500 hover:text-emerald-400 hover:underline"
      title="Abrir conversa no WhatsApp"
    >
      <MessageCircle className="size-3 shrink-0" />
      <span className="tabular-nums">{phone}</span>
    </a>
  );
}

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Operação — ConciergeIA" },
      {
        name: "description",
        content: "Painel operacional diário do anfitrião: check-ins, checkouts e engajamento do guia.",
      },
    ],
  }),
  component: DashboardPage,
});

function fmtDateBR(iso: string) {
  try {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  } catch {
    return iso;
  }
}
function todayISOSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
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
  
  const engFn = useServerFn(getGuideEngagement);
  const listFn = useServerFn(listDashboardArrivals);
  const upsertFn = useServerFn(upsertArrivalStatus);
  const advanceFn = useServerFn(advanceArrival);
  const updateDatesFn = useServerFn(updateGuestStayDates);
  const updateTimeFn = useServerFn(updateGuestArrivalTime);
  const qc = useQueryClient();
  const { impersonation } = useImpersonation();
  const activeOwnerId = impersonation?.userId ?? null;

  const concludedFn = useServerFn(listConcludedArrivals);
  const occupancyFn = useServerFn(getOccupancyBoard);
  const [mode, setMode] = useState<BoardMode>("checkin");
  const kind: "checkin" | "checkout" =
    mode === "checkout" || mode === "cleaning" || mode === "done" ? "checkout" : "checkin";

  const [range, setRange] = useState<"today" | "tomorrow" | "7d" | "all">("today");
  // Card em ação (para feedback imediato no toque, sem travar o quadro inteiro).
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  // Engagement window follows the kanban range: tomorrow/all map to 7d/30d.
  const engRange: "today" | "tomorrow" | "7d" | "30d" =
    range === "today" ? "today" : range === "tomorrow" ? "tomorrow" : range === "all" ? "30d" : "7d";

  // KPIs derivam das mesmas listas do kanban para garantir sincronia visual.

  const engQ = useQuery({
    queryKey: ["dash-eng", engRange, activeOwnerId ?? "self"],
    queryFn: () => engFn({ data: { range: engRange, ownerId: activeOwnerId } }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const checkinListQ = useQuery({
    queryKey: ["dash-list", "checkin", range, activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkin", range, ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const checkoutListQ = useQuery({
    queryKey: ["dash-list", "checkout", range, activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkout", range, ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const tomorrowCheckinListQ = useQuery({
    queryKey: ["dash-list", "checkin", "tomorrow", activeOwnerId ?? "self", "top-card"],
    queryFn: () => listFn({ data: { kind: "checkin", range: "tomorrow", ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const tomorrowCheckoutListQ = useQuery({
    queryKey: ["dash-list", "checkout", "tomorrow", activeOwnerId ?? "self", "top-card"],
    queryFn: () => listFn({ data: { kind: "checkout", range: "tomorrow", ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const concludedQ = useQuery({
    queryKey: ["dash-list", "concluded", activeOwnerId ?? "self"],
    queryFn: () => concludedFn({ data: { ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const [agendaStart, setAgendaStart] = useState<string>(todayISOSaoPaulo);
  const occupancyQ = useQuery({
    queryKey: ["dash-occupancy", activeOwnerId ?? "self", agendaStart],
    queryFn: () => occupancyFn({ data: { ownerId: activeOwnerId, days: 21, start: agendaStart } }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const listQ = mode === "done" ? concludedQ : kind === "checkin" ? checkinListQ : checkoutListQ;


  // Uma única rotina de recarga, com "debounce": evita disparar 4-5 requisições
  // seguidas (mutação + eventos em tempo real) — o que deixava o app lento no celular.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshDashboard = useCallback(
    (delay = 250) => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        qc.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey[0];
            return k === "dash-list" || k === "dash-kpis" || k === "dash-eng" || k === "dash-occupancy";
          },
          refetchType: "active",
        });
      }, delay);
    },
    [qc],
  );
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

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
      refreshDashboard();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar."),
    onSettled: () => setBusyRowId(null),
  });

  const advance = useMutation({
    mutationFn: (v: { logId?: string; reservationId?: string; from: "checkin" | "stay" | "checkout" | "cleaning" }) =>
      advanceFn({ data: v }),
    onSuccess: () => {
      refreshDashboard();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao avançar card."),
    onSettled: () => setBusyRowId(null),
  });

  const revertFn = useServerFn(revertArrival);
  const revert = useMutation({
    mutationFn: (v: {
      logId?: string;
      reservationId?: string;
      from: "checkout" | "stay" | "cleaning" | "done";
    }) => revertFn({ data: v }),
    onSuccess: () => {
      refreshDashboard();
      toast.success("Check desfeito.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao desfazer."),
    onSettled: () => setBusyRowId(null),
  });

  const updateDates = useMutation({
    mutationFn: (v: { logId: string; checkinDate?: string; checkoutDate?: string | null }) =>
      updateDatesFn({ data: v }),
    onSuccess: () => {
      refreshDashboard();
      toast.success("Datas atualizadas.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar datas."),
    onSettled: () => setBusyRowId(null),
  });

  const updateTime = useMutation({
    mutationFn: (v: { logId: string; time: string | null }) => updateTimeFn({ data: v }),
    onSuccess: () => {
      refreshDashboard();
      toast.success("Horário atualizado.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar horário."),
    onSettled: () => setBusyRowId(null),
  });

  function statusTarget(row: ArrivalRow): Pick<UpsertPayload, "logId" | "reservationId"> {
    const logId = /^[0-9a-f-]{36}$/i.test(row.logId) ? row.logId : undefined;
    const reservationId = row.reservationId ?? (row.logId.startsWith("ical:") ? row.logId.slice(5) : null);
    return { ...(logId ? { logId } : {}), ...(reservationId ? { reservationId } : {}) };
  }

  function handleAdvance(row: ArrivalRow, from: "checkin" | "stay" | "checkout" | "cleaning") {
    const target = statusTarget(row);
    if (!target.logId && !target.reservationId) {
      toast.error("Não foi possível identificar esse card. Atualize a página e tente novamente.");
      return;
    }
    setBusyRowId(row.logId);
    if (from === "stay") {
      revert.mutate({ ...target, from });
      return;
    }
    advance.mutate({ ...target, from });
  }

  function handleEditTime(row: ArrivalRow, k: "checkin" | "checkout", time: string | null) {
    setBusyRowId(row.logId);
    upsert.mutate({ ...statusTarget(row), kind: k, arrivalTimeOverride: time });
  }

  // Realtime — sincroniza kanban e KPIs sem precisar recarregar a página quando
  // horários, notas ou reservas mudam (via outro membro da equipe, iCal etc).
  useEffect(() => {
    const invalidate = () => {
      refreshDashboard();
      qc.invalidateQueries({ queryKey: ["dash-eng"] });
      qc.invalidateQueries({ queryKey: ["dash-occupancy"] });
    };
    const ch = supabase
      .channel("dash-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "guide_access_logs" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_arrival_status" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "property_reservations" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refreshDashboard]);

  const todayISO = todayISOSaoPaulo();
  const ciRows = checkinListQ.data?.rows ?? [];
  const coRows = checkoutListQ.data?.rows ?? [];
  // Em Estadia → o hóspede sai automaticamente daqui e entra em Checkouts
  // quando a data de checkout chega (ordenação padrão: data → horário → nome).
  const stayRows = useMemo(
    () => ciRows.filter((r) => r.status === "done" && (!r.guestCheckout || r.guestCheckout > todayISO)),
    [ciRows, todayISO],
  );
  const checkinPendingRows = useMemo(() => ciRows.filter((r) => r.status === "pending"), [ciRows]);
  const checkoutPendingRows = useMemo(() => coRows.filter((r) => r.status === "pending"), [coRows]);
  const tomorrowCheckinPendingRows = useMemo(
    () => (tomorrowCheckinListQ.data?.rows ?? []).filter((r) => r.status === "pending"),
    [tomorrowCheckinListQ.data?.rows],
  );
  const tomorrowCheckoutPendingRows = useMemo(
    () => (tomorrowCheckoutListQ.data?.rows ?? []).filter((r) => r.status === "pending"),
    [tomorrowCheckoutListQ.data?.rows],
  );
  const cleaningRows = useMemo(() => coRows.filter((r) => r.status === "done"), [coRows]);
  const concludedRows = concludedQ.data?.rows ?? [];
  const counts = {
    checkin: checkinPendingRows.length,
    checkout: checkoutPendingRows.length,
    stay: stayRows.length,
    cleaning: cleaningRows.length,
    done: concludedRows.length,
  };
  // Imóveis com check-out pendente OU limpeza em andamento bloqueiam novos
  // check-ins até serem concluídos (evita liberar hóspede em imóvel ainda
  // ocupado pelo hóspede anterior ou ainda sujo).
  const cleaningPendingPropIds = useMemo(() => {
    const blocked = new Map<string, "checkout" | "cleaning">();
    for (const r of coRows) {
      if (r.status === "pending") blocked.set(r.propertyId, "checkout");
      else if (r.status === "done" && !blocked.has(r.propertyId)) blocked.set(r.propertyId, "cleaning");
    }
    return blocked;
  }, [coRows]);
  // Imóvel com check-out pendente ou limpeza em andamento não é "livre".
  const freeProperties = useMemo(
    () => (occupancyQ.data?.freeToday ?? []).filter((p) => !cleaningPendingPropIds.has(p.id)),
    [occupancyQ.data?.freeToday, cleaningPendingPropIds],
  );

  // Check-ins de hoje já marcados como concluídos → agenda mostra "ocupado".
  const checkedInPropertyIds = useMemo(
    () =>
      new Set(
        ciRows.filter((r) => r.status === "done" && r.guestCheckin === todayISO).map((r) => r.propertyId),
      ),
    [ciRows, todayISO],
  );

  const boardRows = useMemo(() => {
    if (mode === "checkin") return checkinPendingRows;
    if (mode === "checkout") return checkoutPendingRows;
    if (mode === "stay") return stayRows;
    if (mode === "done") return concludedRows;
    return cleaningRows;
  }, [mode, checkinPendingRows, checkoutPendingRows, stayRows, cleaningRows, concludedRows]);


  const rangeLabel: Record<typeof range, string> = {
    today: "Hoje",
    tomorrow: "Amanhã",
    "7d": "7 dias",
    all: "Todos",
  };

  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-7xl mx-auto w-full space-y-6">
      <header>
        <h1 className="font-display text-3xl md:text-4xl flex items-center gap-2.5">
          <TrendingUp className="size-7 text-muted-foreground" /> Operação
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Sua rotina diária: check-ins, checkouts e engajamento do guia.
        </p>
      </header>

      {/* KPIs */}
      <section className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <KpiCard
            label="Check-ins Pendentes"
            rows={checkinPendingRows}
            icon={LogIn}
            tone="primary"
            loading={checkinListQ.isLoading}
            onRefresh={() => checkinListQ.refetch()}
            kind="checkin"
            rangeLabel={rangeLabel[range]}
            shadowTone="emerald"
            onEditTime={handleEditTime}
            onAdvance={(r) => handleAdvance(r, "checkin")}
          />
          <KpiCard
            label="Checkouts Pendentes"
            rows={checkoutPendingRows}
            icon={LogOut}
            tone="primary"
            loading={checkoutListQ.isLoading}
            onRefresh={() => checkoutListQ.refetch()}
            kind="checkout"
            rangeLabel={rangeLabel[range]}
            shadowTone="amber"
            onEditTime={handleEditTime}
            onAdvance={(r) => handleAdvance(r, "checkout")}
          />
        </div>

        {/* Em Limpeza — faixa fina logo abaixo dos pendentes (só quando houver 1+) */}
        {cleaningRows.length > 0 ? (
          <div className="amber-mirror ring-1 ring-amber-500/25 shadow-[0_0_24px_-8px_oklch(0.83_0.16_85/0.45)]">
            <KpiCard
              label="Em Limpeza"
              rows={cleaningRows}
              icon={Sparkles}
              tone="primary-soft"
              loading={checkoutListQ.isLoading}
              onRefresh={() => checkoutListQ.refetch()}
              kind="checkout"
              rangeLabel={rangeLabel[range]}
              onEditTime={handleEditTime}
              onAdvance={(r) => handleAdvance(r, "cleaning")}
              compact
            />
          </div>
        ) : null}


        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Check-ins amanhã"
            rows={tomorrowCheckinPendingRows}
            icon={CalendarCheck}
            tone="primary-soft"
            loading={tomorrowCheckinListQ.isLoading}
            onRefresh={() => tomorrowCheckinListQ.refetch()}
            kind="checkin"
            rangeLabel="Amanhã"
            onEditTime={handleEditTime}
            onAdvance={(r) => handleAdvance(r, "checkin")}
          />
          <KpiCard
            label="Checkouts amanhã"
            rows={tomorrowCheckoutPendingRows}
            icon={CalendarX}
            tone="primary-soft"
            loading={tomorrowCheckoutListQ.isLoading}
            onRefresh={() => tomorrowCheckoutListQ.refetch()}
            kind="checkout"
            rangeLabel="Amanhã"
            onEditTime={handleEditTime}
            onAdvance={(r) => handleAdvance(r, "checkout")}
          />
          <KpiCard
            label="Em Estadia"
            rows={stayRows}
            icon={BedDouble}
            tone="primary-soft"
            loading={checkinListQ.isLoading}
            onRefresh={() => checkinListQ.refetch()}
            kind="checkin"
            rangeLabel={rangeLabel[range]}
            onEditTime={handleEditTime}
            onAdvance={(r) => handleAdvance(r, "stay")}
          />
          <FreePropertiesCard
            loading={occupancyQ.isLoading}
            properties={freeProperties}
            onRefresh={() => occupancyQ.refetch()}
          />

        </div>
      </section>


      {/* Engajamento — segue os check-ins PENDENTES do filtro atual; some quando zera */}
      {counts.checkin > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <div className="size-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0 ring-1 ring-primary/15">
                <TrendingUp className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">Engajamento do guia</div>
                <div className="text-xs text-muted-foreground">Comparativo com os check-ins do período</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">{rangeLabel[range]}</div>
          </div>
          <EngagementBars
            loading={engQ.isLoading}
            checkins={engQ.data?.checkinsInPeriod ?? 0}
            checkinsWithCodes={engQ.data?.checkinsWithCodes ?? 0}
            checkinBreakdown={engQ.data?.checkinBreakdown}
            codesBreakdown={engQ.data?.codesBreakdown}
          />

        </section>
      )}
      {/* Agenda macro de ocupação */}
      <OccupancyPanel
        loading={occupancyQ.isLoading}
        start={occupancyQ.data?.start ?? agendaStart}
        days={occupancyQ.data?.days ?? 21}
        properties={occupancyQ.data?.properties ?? []}
        stays={occupancyQ.data?.stays ?? []}
        checkedInPropertyIds={checkedInPropertyIds}
        onStartChange={setAgendaStart}
        defaultStart={todayISO}
      />

      {/* Arrivals */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-3">
          <ModeDropdown
            value={mode}
            onChange={setMode}
            options={[
              { value: "checkin", label: "Check-ins", icon: CalendarCheck, count: counts.checkin },
              { value: "checkout", label: "Checkouts", icon: CalendarX, count: counts.checkout },
              { value: "stay", label: "Em Estadia", icon: BedDouble, count: counts.stay },
              { value: "cleaning", label: "Em Limpeza", icon: Sparkles, count: counts.cleaning },
              { value: "done", label: "Concluídos", icon: CheckCircle2, count: counts.done },

            ]}
          />
          <div className="ml-auto">
            <RangeDropdown
              value={range}
              onChange={setRange}
              options={[
                ["today", "Hoje"],
                ["tomorrow", "Amanhã"],
                ["7d", "7 dias"],
                ["all", "Todos"],
              ]}
            />
          </div>
        </div>

        {listQ.isLoading ? (
          <div className="py-12 grid place-items-center text-muted-foreground text-sm">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : boardRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Nenhum registro no período.</div>
        ) : (
          <div className="relative space-y-6">
            <ArrivalGroup
              title=""
              rows={boardRows}
              kind={kind}
              mode={mode}
              onMark={(row) => {
                if (mode === "done") return;
                handleAdvance(row, mode);
              }}

              onRevert={
                mode === "checkin"
                  ? undefined
                  : (row: ArrivalRow) => {
                      const target = statusTarget(row);
                      if (!target.logId && !target.reservationId) {
                        toast.error("Não foi possível identificar esse card.");
                        return;
                      }
                      setBusyRowId(row.logId);
                      revert.mutate({ ...target, from: mode });
                    }
              }
              onSyncIcal={(row) => {
                const t = kind === "checkin" ? "15:00" : "11:00";
                setBusyRowId(row.logId);
                upsert.mutate({ ...statusTarget(row), kind, arrivalTimeOverride: t });
                toast.success(`Horário alinhado ao iCal (${t}).`);
              }}
              onNote={(row, note) => { setBusyRowId(row.logId); upsert.mutate({ ...statusTarget(row), kind, note }); }}
              onEditDates={(row, dates) => { setBusyRowId(row.logId); updateDates.mutate({ logId: row.logId, ...dates }); }}
              onEditTime={(row, time) => handleEditTime(row, kind, time)}
              busyRowId={busyRowId}
              muted={mode === "stay" || mode === "cleaning"}
              cleaningPendingPropIds={cleaningPendingPropIds}
            />
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------- UI Building Blocks ------------------------- */

function KpiCard({
  label,
  rows,
  icon: Icon,
  tone,
  loading,
  onRefresh,
  kind,
  rangeLabel,
  shadowTone,
  onEditTime,
  onAdvance,
  compact,
}: {
  label: string;
  rows: ArrivalRow[];
  icon: React.ElementType;
  tone: "primary" | "primary-soft";
  loading: boolean;
  onRefresh: () => void;
  kind: "checkin" | "checkout";
  rangeLabel: string;
  shadowTone?: "emerald" | "amber";
  onEditTime: (row: ArrivalRow, kind: "checkin" | "checkout", time: string | null) => void;
  /** Avança o card na esteira direto pelo popup do indicador. */
  onAdvance?: (row: ArrivalRow) => void;
  /** Faixa fina (largura total) em vez de card quadrado. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const valueTone = tone === "primary" ? "text-primary" : "text-foreground";
  const valueColor =
    shadowTone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : shadowTone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : valueTone;
  const shadowClass =
    shadowTone === "emerald"
      ? "shadow-[0_18px_42px_-18px_rgba(16,185,129,0.85),0_0_0_1px_rgba(16,185,129,0.10)] hover:shadow-[0_22px_52px_-18px_rgba(16,185,129,0.95),0_0_0_1px_rgba(16,185,129,0.16)]"
      : shadowTone === "amber"
        ? "shadow-[0_18px_42px_-18px_rgba(245,158,11,0.85),0_0_0_1px_rgba(245,158,11,0.10)] hover:shadow-[0_22px_52px_-18px_rgba(245,158,11,0.95),0_0_0_1px_rgba(245,158,11,0.16)]"
        : "shadow-sm hover:shadow-md";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) onRefresh();
      }}
    >
      <DialogTrigger asChild>
        {compact ? (
          <button
            type="button"
            className={`w-full flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-primary/40 hover:bg-secondary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${shadowClass}`}
          >
            <Icon className="size-3.5 text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold truncate">
              {label}
            </span>
            <span className={`ml-auto text-lg font-display tabular-nums ${valueColor}`}>
              {loading ? "—" : rows.length}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className={`w-full h-full rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-primary/40 hover:bg-secondary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${shadowClass}`}
          >
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
              <Icon className="size-3.5" /> <span className="truncate">{label}</span>
            </div>
            <div className={`text-2xl font-display mt-1 tabular-nums ${valueColor}`}>{loading ? "—" : rows.length}</div>
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-2xl border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        <div
          className={`absolute inset-x-0 top-0 h-px ${shadowTone === "emerald" ? "bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" : shadowTone === "amber" ? "bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" : "bg-gradient-to-r from-transparent via-primary/50 to-transparent"}`}
        />
        <DialogHeader className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div
              className={`grid place-items-center size-10 rounded-xl ${shadowTone === "emerald" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : shadowTone === "amber" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-primary/10 text-primary"}`}
            >
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
          {loading ? (
            <div className="py-14 grid place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Nenhum registro no período.</div>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((r) => {
                const time = r.arrivalTimeOverride ?? r.guestArrivalTime ?? null;
                const initials =
                  (r.guestName || "?")
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((s) => s[0]?.toUpperCase() ?? "")
                    .join("") || "?";
                return (
                  <li
                    key={r.logId}
                    className="group flex items-start gap-2 rounded-xl border border-border/50 bg-background/40 px-2.5 py-2 transition hover:border-border hover:bg-secondary/40"
                  >
                    <div
                      className={`grid place-items-center size-8 rounded-full text-xs font-semibold shrink-0 ${r.pendingFill ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}
                    >
                      {r.pendingFill ? <UserPlus className="size-4" /> : initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <OwnerLine name={r.ownerName} phone={r.ownerPhone} country={r.ownerPhoneCountry} phonePosition="adjacent" />
                      <div
                        className="text-sm font-semibold leading-tight truncate text-foreground"
                        title={r.propertyName ?? undefined}
                      >
                        {r.propertyName ?? "Sem nome"}
                      </div>

                      <div
                        className={`text-xs truncate flex items-center gap-1 mt-0.5 ${r.pendingFill || !r.guestName || r.guestName === r.reservationCode ? "text-orange-500 font-medium" : "text-muted-foreground"}`}
                      >
                        {r.pendingFill || !r.guestName || r.guestName === r.reservationCode ? (
                          <>
                            <UserPlus className="size-3 shrink-0" />
                            <span className="truncate">Hóspede Pendente</span>
                          </>
                        ) : (
                          <>
                            <span className="min-w-0 truncate">{r.guestName}</span>
                            <PhoneLink phone={r.guestPhone} country={r.guestPhoneCountry} />
                          </>
                        )}
                      </div>
                      {(r.additionalGuests?.length ?? 0) > 0 && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                          + {r.additionalGuests!.map((g) => g.name).join(", ")}
                        </div>
                      )}
                      {r.reservationCode && (
                        <div className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground font-normal tabular-nums">
                          <span className="truncate max-w-[160px]">{r.reservationCode}</span>
                          <CopyButton value={r.reservationCode} size={10} className="p-0.5" />
                        </div>
                      )}
                      {/* Previsão de horário — campo largo, logo abaixo do código da reserva */}
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                          Previsão
                        </span>
                        <div className="min-w-[104px]">
                          <TimeDropdown value={time} onChange={(v) => onEditTime(r, kind, v)} />
                        </div>
                      </div>
                      {!r.openedCheckin && (
                        <div className="mt-1 text-[10px] uppercase tracking-wider font-semibold text-amber-600 dark:text-amber-400">
                          Não Acessou o Guia
                        </div>
                      )}
                    </div>
                    {onAdvance && (
                      <div className="self-end shrink-0">
                        <button
                          type="button"
                          onClick={() => onAdvance(r)}
                          title="Marcar como concluído"
                          aria-label="Marcar como concluído"
                          className="size-8 grid place-items-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                        >
                          <Check className="size-4" />
                        </button>
                      </div>
                    )}
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

/** Imóveis sem ninguém hospedado hoje. */
function FreePropertiesCard({
  loading,
  properties,
  onRefresh,
}: {
  loading: boolean;
  properties: Array<{ id: string; name: string }>;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) onRefresh();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="w-full h-full rounded-xl border border-border bg-card px-4 py-3 text-left transition hover:border-primary/40 hover:bg-secondary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 shadow-sm hover:shadow-md"
        >
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-semibold">
            <Home className="size-3.5" /> <span className="truncate">Imóveis sem ninguém</span>
          </div>
          <div className="text-2xl font-display mt-1 tabular-nums text-foreground">
            {loading ? "—" : properties.length}
          </div>
        </button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-2xl">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-display">Imóveis sem ninguém hoje</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-4 pb-5">
          {loading ? (
            <div className="py-10 grid place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : properties.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Todos os imóveis estão ocupados hoje.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {properties.map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-sm truncate"
                >
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Agenda macro: ocupação de todos os imóveis nos próximos dias. */
function OccupancyPanel({
  loading,
  start,
  days,
  properties,
  stays,
  checkedInPropertyIds,
  onStartChange,
  defaultStart,
}: {
  loading: boolean;
  start: string;
  days: number;
  properties: Array<{ id: string; name: string; city: string | null; ownerName?: string | null }>;
  stays: Array<{ propertyId: string; checkin: string; checkout: string | null; guest: string | null }>;
  checkedInPropertyIds: Set<string>;
  onStartChange?: (v: string) => void;
  defaultStart?: string;
}) {
  const [openAgenda, setOpenAgenda] = useState<string>("agenda");
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [cityFilter, setCityFilter] = useState<string>("");

  /**
   * Mostramos sempre 5 dias inteiros na largura visível (o resto fica na
   * rolagem horizontal). A largura de cada coluna é calculada a partir do
   * espaço disponível para que nenhuma "bolinha" apareça cortada.
   */
  const NAME_COL = 130;
  const VISIBLE_DAYS = 5;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dayW, setDayW] = useState(40);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (!w) return;
      setDayW(Math.max(28, Math.floor((w - NAME_COL - 4) / VISIBLE_DAYS)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [openAgenda]);

  const todayISO = new Date().toISOString().slice(0, 10);

  const dayList = useMemo(() => {
    const out: string[] = [];
    const [y, m, d] = start.split("-").map(Number);
    for (let i = 0; i < days; i++) {
      const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d));
      dt.setUTCDate(dt.getUTCDate() + i);
      out.push(dt.toISOString().slice(0, 10));
    }
    return out;
  }, [start, days]);


  const owners = useMemo(
    () => [...new Set(properties.map((p) => p.ownerName).filter((o): o is string => !!o))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [properties],
  );
  const cities = useMemo(
    () => [...new Set(properties.map((p) => p.city).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [properties],
  );

  const visibleProperties = useMemo(() => {
    const cmp = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });
    return properties
      .filter((p) => (!ownerFilter || p.ownerName === ownerFilter) && (!cityFilter || p.city === cityFilter))
      .slice()
      .sort(
        (a, b) =>
          cmp(a.ownerName ?? "zzz", b.ownerName ?? "zzz") ||
          cmp(a.name, b.name) ||
          cmp(a.city ?? "zzz", b.city ?? "zzz"),
      );
  }, [properties, ownerFilter, cityFilter]);

  const startChanged = !!defaultStart && start !== defaultStart;
  const activeFilters = (ownerFilter ? 1 : 0) + (cityFilter ? 1 : 0) + (startChanged ? 1 : 0);

  const byProperty = useMemo(() => {
    const map = new Map<string, Array<{ checkin: string; checkout: string | null; guest: string | null }>>();
    for (const s of stays) {
      const arr = map.get(s.propertyId) ?? [];
      arr.push({ checkin: s.checkin, checkout: s.checkout, guest: s.guest });
      map.set(s.propertyId, arr);
    }
    return map;
  }, [stays]);

  type CellPart = "in" | "out" | "busy" | "free";

  /**
   * Cada dia é dividido em duas metades (manhã = saída, tarde = entrada),
   * que é a ordem natural do dia. Quando as duas metades são iguais o
   * desenho é renderizado inteiro.
   */
  function cellHalves(propertyId: string, day: string): [CellPart, CellPart] {
    const list = byProperty.get(propertyId) ?? [];
    const hasOut = list.some((s) => s.checkout === day);
    const hasIn = list.some((s) => s.checkin === day);
    const through = list.some((s) => s.checkin < day && (s.checkout ?? s.checkin) > day);

    const first: CellPart = hasOut ? "out" : through ? "busy" : "free";
    // Depois que o check-in é marcado como concluído, a metade da tarde passa
    // a ser "ocupado" — a metade da manhã (checkout) permanece como estava.
    const second: CellPart = hasIn
      ? day === todayISO && checkedInPropertyIds.has(propertyId)
        ? "busy"
        : "in"
      : through
        ? "busy"
        : "free";
    return [first, second];
  }


  return (
    <Accordion
      type="single"
      collapsible
      value={openAgenda}
      onValueChange={setOpenAgenda}
      className="rounded-2xl border border-border bg-card shadow-sm"
    >
      <AccordionItem value="agenda" className="border-0">
        <div className="flex w-full items-center gap-2 px-4 sm:px-5 py-4">
          <button
            type="button"
            onClick={() => setOpenAgenda((v) => (v ? "" : "agenda"))}
            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold"
          >
            <CalendarCheck className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Ocupação dos Imóveis</span>
          </button>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="relative ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2.5 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60"
              >
                <Filter className="size-3.5 opacity-70" /> Filtros
                {activeFilters > 0 ? (
                  <span className="ml-0.5 grid size-4 place-items-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
                    {activeFilters}
                  </span>
                ) : null}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-64 space-y-4 p-3"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              {onStartChange ? (
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Início do período ({days} dias)
                  </p>
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => e.target.value && onStartChange(e.target.value)}
                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs tabular-nums"
                  />
                </div>
              ) : null}
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Proprietário</p>
                <select
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                >
                  <option value="">Todos</option>
                  {owners.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Cidade</p>
                <select
                  value={cityFilter}
                  onChange={(e) => setCityFilter(e.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                >
                  <option value="">Todas</option>
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOwnerFilter("");
                  setCityFilter("");
                  if (defaultStart && onStartChange) onStartChange(defaultStart);
                }}
                className="w-full rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/60"
              >
                Limpar filtros
              </button>
            </PopoverContent>
          </Popover>
          <button
            type="button"
            aria-label={openAgenda ? "Recolher" : "Expandir"}
            onClick={() => setOpenAgenda((v) => (v ? "" : "agenda"))}
            className="shrink-0 text-muted-foreground transition-transform hover:text-foreground"
          >
            <ChevronDown className={`size-4 transition-transform ${openAgenda ? "rotate-180" : ""}`} />
          </button>
        </div>
        <AccordionContent className="px-4 sm:px-5 pb-5">
          {loading ? (
            <div className="py-10 grid place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : properties.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Nenhum imóvel para exibir.</div>
          ) : (
            <>

              <div ref={scrollRef} className="sg-elegant-scroll max-h-[18rem] overflow-auto snap-x snap-mandatory -mx-1 px-1">
                <table
                  className="w-full table-fixed border-separate border-spacing-x-0.5 border-spacing-y-1 text-xs"
                  style={{ minWidth: NAME_COL + dayList.length * dayW }}
                >
                  <thead>
                    <tr>
                      <th
                        className="sticky left-0 top-0 z-20 bg-card pr-2 text-left font-medium text-muted-foreground"
                        style={{ width: NAME_COL, minWidth: NAME_COL }}
                      >
                        Imóvel
                      </th>
                      {dayList.map((d) => {
                        const wd = new Date(`${d}T12:00:00Z`).toLocaleDateString("pt-BR", {
                          weekday: "short",
                          timeZone: "UTC",
                        });
                        const isToday = d === todayISO;
                        return (
                          <th
                            key={d}
                            style={{ width: dayW, minWidth: dayW }}
                            className={`sticky top-0 z-10 snap-start bg-card px-0 font-medium tabular-nums ${
                              isToday ? "text-emerald-500" : "text-muted-foreground"
                            }`}
                          >
                            <div className="text-[9px] uppercase tracking-wide opacity-70">{wd.replace(".", "")}</div>
                            <div className="text-[10px]">
                              {d.slice(8, 10)}/{d.slice(5, 7)}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProperties.map((p) => (
                      <tr key={p.id}>
                        <td className="sticky left-0 z-10 bg-card pr-2 align-middle" style={{ width: NAME_COL, minWidth: NAME_COL }}>
                          <div className="min-w-0 max-w-full">
                            {p.ownerName ? (
                              <div className="truncate text-[10px] font-semibold text-primary" title={p.ownerName}>
                                {p.ownerName}
                              </div>
                            ) : null}
                            <div className="truncate text-[11px] font-medium leading-tight" title={p.name}>
                              {p.name}
                            </div>
                            {p.city ? (
                              <div className="truncate text-[10px] text-muted-foreground">{p.city}</div>
                            ) : null}
                          </div>
                        </td>
                        {dayList.map((d) => {
                          const [a, b] = cellHalves(p.id, d);
                          const isToday = d === todayISO;
                          const clsOf = (s: CellPart) =>
                            s === "in"
                              ? "bg-emerald-500/85"
                              : s === "out"
                                ? "bg-amber-500/85"
                                : s === "busy"
                                  ? "bg-primary/45"
                                  : "bg-muted/60";
                          const labelOf = (s: CellPart) =>
                            s === "in" ? "Check-in" : s === "out" ? "Checkout" : s === "busy" ? "Ocupado" : "Livre";
                          const title =
                            a === b
                              ? `${labelOf(a)} · ${fmtDateBR(d)}`
                              : `${labelOf(a)} → ${labelOf(b)} · ${fmtDateBR(d)}`;
                          return (
                            <td key={d} style={{ width: dayW, minWidth: dayW }} className={`snap-start px-0 ${isToday ? "bg-emerald-500/10" : ""}`}>
                              {a === b ? (
                                <div className={`h-7 rounded-md ${clsOf(a)}`} title={title} />
                              ) : (
                                <div className="flex h-7 gap-px overflow-hidden rounded-md" title={title}>
                                  <div className={`h-full flex-1 rounded-l-md ${clsOf(a)}`} />
                                  <div className={`h-full flex-1 rounded-r-md ${clsOf(b)}`} />
                                </div>
                              )}
                            </td>
                          );
                        })}

                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-emerald-500/80" /> Check-in
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-amber-500/80" /> Checkout
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-primary/50" /> Ocupado
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm bg-muted" /> Livre
                </span>
              </div>
            </>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}



function RangeDropdown<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<[T, string]>;
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

function ModeDropdown<T extends string>({
  value,
  onChange,
  options,
}: {
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

function SegBtn({
  active,
  onClick,
  icon: Icon,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  count?: number;
  children: React.ReactNode;
}) {
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

type GuestMark = { name: string; property: string };
type Breakdown = { viewed: GuestMark[]; notViewed: GuestMark[] };

function EngagementBars({
  loading,
  checkins,
  checkinsWithCodes,
  checkinBreakdown,
  codesBreakdown,
}: {
  loading: boolean;
  checkins: number;
  checkinsWithCodes: number;
  checkinBreakdown?: Breakdown;
  codesBreakdown?: Breakdown;
}) {
  const pctOf = (num: number, total: number) => Math.min(100, Math.round((num / Math.max(total, 1)) * 100));
  if (loading)
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        <Loader2 className="size-4 inline animate-spin" />
      </div>
    );
  const checkinViewed = checkinBreakdown?.viewed.length ?? 0;
  const codesViewed = codesBreakdown?.viewed.length ?? 0;
  return (
    <div className="relative space-y-4">
      {checkins > 0 && (
        <BarRow
          label="Viram instruções de check-in"
          value={checkinViewed}
          total={checkins}
          pct={pctOf(checkinViewed, checkins)}
          breakdown={checkinBreakdown}
        />
      )}
      {checkinsWithCodes > 0 && (
        <BarRow
          label="Viram senha de acesso"
          value={codesViewed}
          total={checkinsWithCodes}
          pct={pctOf(codesViewed, checkinsWithCodes)}
          breakdown={codesBreakdown}
        />
      )}
    </div>
  );
}


function GuestMarkList({ items, tone }: { items: GuestMark[]; tone: "ok" | "off" }) {
  if (items.length === 0) return <div className="text-muted-foreground text-[11px]">Ninguém</div>;
  return (
    <ul className="space-y-0.5">
      {items.slice(0, 12).map((g, i) => (
        <li key={`${g.name}-${i}`} className="flex items-start gap-1.5">
          <span className={`mt-1 size-1.5 shrink-0 rounded-full ${tone === "ok" ? "bg-emerald-500" : "bg-rose-500"}`} />
          <span className="min-w-0">
            <span className="font-medium text-foreground/90">{g.name}</span>
            {g.property ? <span className="text-muted-foreground"> · {g.property}</span> : null}
          </span>
        </li>
      ))}
      {items.length > 12 && <li className="text-muted-foreground text-[11px]">+{items.length - 12} outros</li>}
    </ul>
  );
}

function BarRow({
  label,
  value,
  total,
  pct,
  breakdown,
}: {
  label: string;
  value: number;
  total: number;
  pct: number;
  breakdown?: Breakdown;
}) {
  const bar = (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium truncate whitespace-nowrap min-w-0">{label}</span>
        <span className="tabular-nums text-muted-foreground text-xs whitespace-nowrap shrink-0">
          {value} de {total} check-ins
        </span>
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
  if (!breakdown) return bar;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Detalhes: ${label}`}
          className="w-full text-left rounded-lg transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring px-1 -mx-1 py-1"
        >
          {bar}
        </button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-2xl border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" />
        <DialogHeader className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center size-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-display leading-tight">{label}</DialogTitle>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mt-0.5">
                {value} de {total} check-ins
              </div>

            </div>
          </div>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-5 pb-5 space-y-4 text-sm">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">
              Viram ({breakdown.viewed.length})
            </div>
            <GuestMarkList items={breakdown.viewed} tone="ok" />
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-400">
              Não viram ({breakdown.notViewed.length})
            </div>
            <GuestMarkList items={breakdown.notViewed} tone="off" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}



function ArrivalGroup({
  title,
  rows,
  kind,
  mode,
  onMark,
  onRevert,
  onSyncIcal,
  onNote,
  onEditDates,
  onEditTime,
  busyRowId,
  muted,
  cleaningPendingPropIds,
}: {
  title: string;
  rows: ArrivalRow[];
  kind: "checkin" | "checkout";
  mode: BoardMode;
  onMark: (r: ArrivalRow) => void;
  onRevert?: (r: ArrivalRow) => void;
  onSyncIcal: (r: ArrivalRow) => void;
  onNote: (r: ArrivalRow, note: string | null) => void;
  onEditDates: (r: ArrivalRow, dates: { checkinDate?: string; checkoutDate?: string | null }) => void;
  onEditTime: (r: ArrivalRow, time: string | null) => void;
  /** Só o card em ação fica travado — o restante do quadro segue responsivo. */
  busyRowId?: string | null;
  muted?: boolean;
  cleaningPendingPropIds?: Map<string, "checkout" | "cleaning">;
}) {
  // Somente UM card pode ficar com o quadro de detalhes aberto por vez.
  const [openId, setOpenId] = useState<string | null>(null);
  if (rows.length === 0) return null;
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch ${muted ? "opacity-70" : ""}`}>
      {rows.map((r) => (
        <ArrivalCard
          key={r.logId}
          row={r}
          kind={kind}
          mode={mode}
          onMark={onMark}
          onRevert={onRevert}
          onSyncIcal={onSyncIcal}
          onNote={onNote}
          onEditDates={onEditDates}
          onEditTime={onEditTime}
          busy={busyRowId === r.logId}
          expanded={openId === r.logId}
          onToggleExpanded={(open) => setOpenId(open ? r.logId : null)}
          cleaningBlocked={mode === "checkin" ? (cleaningPendingPropIds?.get(r.propertyId) ?? null) : null}
        />
      ))}
    </div>
  );
}


type BoardMode = "checkin" | "checkout" | "stay" | "cleaning" | "done";

function ArrivalCard({
  row,
  kind,
  mode,
  onMark,
  onRevert,
  onSyncIcal,
  onNote,
  onEditDates,
  onEditTime,
  busy,
  expanded,
  onToggleExpanded,
  cleaningBlocked,
}: {
  row: ArrivalRow;
  kind: "checkin" | "checkout";
  mode: BoardMode;
  onMark: (r: ArrivalRow) => void;
  onRevert?: (r: ArrivalRow) => void;
  onSyncIcal: (r: ArrivalRow) => void;
  onNote: (r: ArrivalRow, note: string | null) => void;
  onEditDates: (r: ArrivalRow, dates: { checkinDate?: string; checkoutDate?: string | null }) => void;
  onEditTime: (r: ArrivalRow, time: string | null) => void;
  busy: boolean;
  expanded?: boolean;
  onToggleExpanded?: (open: boolean) => void;
  cleaningBlocked?: "checkout" | "cleaning" | null;
}) {

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(row.note ?? "");
  const guestTime = row.arrivalTimeOverride ?? row.guestArrivalTime;
  const stdWindow = row.standardTime
    ? row.standardTimeMax
      ? `${row.standardTime} – ${row.standardTimeMax}`
      : row.standardTime
    : null;
  const divergent =
    !!guestTime && !!row.standardTime && !isTimeWithin(guestTime, row.standardTime, row.standardTimeMax);

  const done = row.status === "done";
  const visualDone = done && mode !== "cleaning";
  const isPendingFill = row.pendingFill;
  const todayISO = todayISOSaoPaulo();
  const isToday = row.date === todayISO;
  const isOverdue = row.date < todayISO;
  const isFuture = row.date > todayISO;
  const blockReason = kind === "checkin" && !done && !isFuture ? (cleaningBlocked ?? null) : null;
  const cleaningBlock = blockReason !== null;
  const blockCheck = (kind === "checkin" && !done && isFuture) || cleaningBlock;

  // Prefer garage address when available for logistics
  const mapsHref =
    row.garageMapsUrl ??
    row.mapsUrl ??
    (row.propertyAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.propertyAddress)}`
      : null);
  const copyText = mapsHref ?? row.propertyAddress ?? "";
  const copyLink = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  // Confirmação quando o check acontece fora do horário/data comum da esteira.
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  function earlyCheckMessage(): string | null {
    if (mode === "stay" && row.guestCheckout && row.guestCheckout > todayISO) {
      return `O checkout desta reserva está previsto para ${fmtDateBR(row.guestCheckout)}. Tem certeza que deseja antecipar o checkout?`;
    }
    if (mode === "checkout" && row.date > todayISO) {
      return `Este checkout está previsto para ${fmtDateBR(row.date)}. Tem certeza que deseja antecipá-lo?`;
    }
    if (mode === "cleaning" && row.guestCheckout && row.guestCheckout > todayISO) {
      return `A estadia só termina em ${fmtDateBR(row.guestCheckout)}. Confirma concluir a limpeza agora?`;
    }
    return null;
  }
  function runMark() {
    const msg = earlyCheckMessage();
    if (msg) {
      setConfirmMsg(msg);
      return;
    }
    onMark(row);
  }


  return (
    <div
      className={`group relative h-full flex flex-col rounded-2xl border p-4 gap-3 transition-all ${
        visualDone
          ? "bg-secondary/30 border-border/50"
          : isOverdue
            ? "bg-[linear-gradient(135deg,color-mix(in_oklab,#ef4444_28%,transparent),color-mix(in_oklab,#ef4444_12%,transparent))] border-red-500/70 shadow-[0_12px_32px_-14px_rgba(239,68,68,0.55)] ring-1 ring-red-500/30"
            : isFuture
              ? "bg-[linear-gradient(135deg,color-mix(in_oklab,#f59e0b_22%,transparent),color-mix(in_oklab,#f59e0b_8%,transparent))] border-amber-500/60 shadow-[0_10px_28px_-16px_rgba(245,158,11,0.55)] ring-1 ring-amber-500/25"
              : isToday
                ? "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_7%,transparent),color-mix(in_oklab,var(--primary)_2%,transparent))] border-primary/25 shadow-[0_10px_28px_-16px_color-mix(in_oklab,var(--primary)_28%,transparent),0_1px_4px_-2px_color-mix(in_oklab,var(--primary)_14%,transparent)] hover:shadow-[0_12px_32px_-16px_color-mix(in_oklab,var(--primary)_36%,transparent)] hover:-translate-y-0.5"
                : "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--primary)_5%,transparent),color-mix(in_oklab,var(--primary)_1%,transparent))] border-primary/15 shadow-sm hover:shadow-md hover:-translate-y-0.5"
      }`}
    >
      {isOverdue && !visualDone && (
        <div className="absolute -top-2.5 right-3 z-20 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-red-500 text-white border border-red-600 shadow-md">
          <AlertTriangle className="size-3" /> Atrasado
        </div>
      )}
      {isFuture && !done && (
        <div className="absolute -top-2.5 right-3 z-20 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-500 text-white border border-amber-600 shadow-md">
          <AlertTriangle className="size-3" /> Data Futura
        </div>
      )}

      {!done && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <span
            aria-hidden
            className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r bg-gradient-to-b from-primary/70 to-primary/30"
          />
          <span
            aria-hidden
            className={`absolute top-0 right-0 -translate-y-1/3 translate-x-1/3 rounded-full blur-2xl ${isToday ? "size-40 bg-primary/[0.14]" : "size-32 bg-primary/[0.07]"}`}
          />
        </div>
      )}


      {/* Header: avatar + name + property + inline date range */}
      <div className="flex items-center gap-3">
        <div
          className={`size-11 rounded-xl grid place-items-center font-semibold shrink-0 ring-1 ${
            isPendingFill
              ? "bg-primary/5 text-primary/70 ring-primary/10"
              : "bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-primary/15"
          }`}
        >
          {isPendingFill ? <UserPlus className="size-5" /> : initials(row.guestName)}
        </div>
        <div className="flex-1 min-w-0">
          <OwnerLine name={row.ownerName} phone={row.ownerPhone} country={row.ownerPhoneCountry} phonePosition="adjacent" />
          <div className="font-semibold truncate text-foreground" title={row.propertyName ?? undefined}>
            {row.propertyName ?? "Sem nome"}
          </div>

          <div
            className={`text-xs truncate flex items-center gap-1 ${isPendingFill ? "text-orange-500 font-medium" : "text-muted-foreground"}`}
          >
            {isPendingFill ? (
              <>
                <UserPlus className="size-3 shrink-0" />
                <span className="truncate">Hóspede Pendente</span>
              </>
            ) : !row.guestName || row.guestName === row.reservationCode ? (
              row.reservationCode ? (
                <span className="inline-flex items-center gap-1 min-w-0">
                  <span className="truncate">{row.reservationCode}</span>
                  <CopyButton value={row.reservationCode} size={10} className="p-0.5" />
                </span>
              ) : (
                <span className="truncate">{row.guestName}</span>
              )
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5 overflow-hidden">
                <span className="min-w-0 truncate">{row.guestName}</span>
                <PhoneLink phone={row.guestPhone} country={row.guestPhoneCountry} />
              </span>
            )}
          </div>
          {(row.additionalGuests?.length ?? 0) > 0 && (
            <ul className="mt-1 space-y-0.5">
              {row.additionalGuests!.map((g) => (
                <li
                  key={g.logId}
                  className="text-xs text-muted-foreground truncate flex items-center gap-1"
                  title={g.name}
                >
                  <span className="size-1 rounded-full bg-muted-foreground/60 shrink-0" />
                  <span className="truncate">{g.name}</span>
                </li>
              ))}
            </ul>
          )}
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
          {/* Código da reserva abaixo do período: sempre que houver código */}
          {row.reservationCode && (isPendingFill || (row.guestName && row.guestName !== row.reservationCode)) && (
            <div className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground font-normal tabular-nums">
              <span className="truncate max-w-[160px]">{row.reservationCode}</span>
              <CopyButton value={row.reservationCode} size={10} className="p-0.5" />
            </div>
          )}
        </div>
      </div>

      {/* Detalhes operacionais — expansivo, começa recolhido e só um card por vez */}
      <Accordion
        type="single"
        collapsible
        value={expanded ? "details" : ""}
        onValueChange={(v) => onToggleExpanded?.(v === "details")}
      >
        <AccordionItem value="details" className="border-0">
          <AccordionTrigger className="py-1.5 text-xs text-muted-foreground hover:no-underline">
            Detalhes da operação
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <div className="flex flex-col gap-3 pt-1">
              {/* Padrão / Previsto */}
              {mode !== "cleaning" && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-background/50 border border-border/40 p-2 backdrop-blur-sm">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                      <span>Padrão</span>
                      <InfoHint title="Horário padrão">
                        Janela configurada na propriedade. Base para detectar divergências.
                      </InfoHint>
                    </div>
                    <div className="mt-0.5 tabular-nums">{stdWindow ?? "—"}</div>
                  </div>
                  <div
                    className={`rounded-lg p-2 backdrop-blur-sm ${divergent ? "bg-amber-500/10 border border-amber-500/30" : "bg-background/50 border border-border/40"}`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                      <span>Previsto</span>
                      <InfoHint title="Horário previsto">
                        Selecione o horário (30 em 30 min). A alteração reordena o kanban imediatamente.
                      </InfoHint>
                    </div>
                    <div className="mt-0.5">
                      <TimeDropdown value={guestTime ?? null} disabled={busy} onChange={(v) => onEditTime(row, v)} />
                    </div>
                  </div>
                </div>
              )}

              {/* Engagement — só mostra pendências (fatos negativos). */}
              {mode !== "cleaning" &&
                !isPendingFill &&
                (!row.openedCheckin || (row.hasPasswords && !row.viewedPasswords)) && (
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

              {row.ical.hasIcal &&
                !isPendingFill &&
                (() => {
                  const gIn = row.guestCheckin;
                  const gOut = row.guestCheckout;
                  const iIn = row.ical.icalCheckin;
                  const iOut = row.ical.icalCheckout;
                  const anyDivergent = row.ical.matched && ((iIn && iIn !== gIn) || (iOut && gOut && iOut !== gOut));
                  if (!anyDivergent && row.ical.matched) {
                    return (
                      <div className="w-full text-xs rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-1.5 flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="size-3.5 shrink-0" />
                        <span>Confirmado via Airbnb</span>
                      </div>
                    );
                  }
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
                          onClick={() =>
                            onEditDates(row, {
                              ...(iIn && iIn !== gIn ? { checkinDate: iIn } : {}),
                              ...(iOut && gOut && iOut !== gOut ? { checkoutDate: iOut } : {}),
                            })
                          }
                          className="text-xs underline underline-offset-2 hover:no-underline shrink-0 mt-0.5"
                        >
                          Usar Airbnb
                        </button>
                      )}
                    </div>
                  );
                })()}

              {divergent && !isPendingFill && !done && (
                <div className="w-full text-xs rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1.5 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="size-3.5" /> Horário divergente do padrão
                  </span>
                  <button
                    onClick={() => onSyncIcal(row)}
                    className="text-xs underline underline-offset-2 hover:no-underline"
                    disabled={busy}
                  >
                    Alinhar
                  </button>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>


      {row.note && !noteOpen && (
        <button
          type="button"
          onClick={() => {
            setNoteText(row.note ?? "");
            setNoteOpen(true);
          }}
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
                onClick={() => {
                  onNote(row, null);
                  setNoteOpen(false);
                  setNoteText("");
                }}
                className="text-xs px-2 py-1 rounded-md text-rose-600 hover:bg-rose-500/10 inline-flex items-center gap-1"
                disabled={busy}
                title="Excluir nota"
              >
                <Trash2 className="size-3.5" /> Excluir
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button onClick={() => setNoteOpen(false)} className="text-xs px-2 py-1 rounded-md hover:bg-secondary">
                Cancelar
              </button>
              <button
                onClick={() => {
                  onNote(row, noteText.trim() || null);
                  setNoteOpen(false);
                }}
                className="text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground"
                disabled={busy}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action row: ícones à esquerda; Copiar + Maps agrupados à direita */}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {mode === "done" ? (
          <span
            title="Esteira concluída"
            aria-label="Esteira concluída"
            className="inline-flex items-center justify-center size-9 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
          >
            <CheckCircle2 className="size-4" />
          </span>
        ) : (
        <button

          onClick={() => {
            if (cleaningBlock) {
              const msg =
                blockReason === "checkout"
                  ? "Hóspede anterior ainda não fez check-out. Conclua o check-out e a limpeza para liberar o novo check-in."
                  : "Limpeza deste imóvel ainda não foi concluída. Finalize a limpeza para liberar o check-in.";
              toast.warning(msg);
              return;
            }
            if (blockCheck) {
              toast.warning(
                `Check-in previsto para ${fmtDateBR(row.date)}. Só é possível marcar a partir do dia da chegada.`,
              );
              return;
            }
            runMark();

          }}
          disabled={busy || blockCheck}
          aria-label={
            cleaningBlock
              ? blockReason === "checkout"
                ? "Check-out anterior pendente neste imóvel"
                : "Limpeza pendente neste imóvel"
              : blockCheck
                ? "Check-in em data futura"
                : mode === "cleaning"
                  ? "Concluir limpeza"
                  : done
                    ? "Reabrir (marcar pendente)"
                    : "Marcar como concluído"
          }
          title={
            cleaningBlock
              ? blockReason === "checkout"
                ? "Check-out anterior pendente — limpeza precisa ser concluída antes de liberar o check-in"
                : "Limpeza ainda em andamento — check-in bloqueado"
              : blockCheck
                ? `Só é possível marcar a partir de ${fmtDateBR(row.date)}`
                : mode === "cleaning"
                  ? "Concluir limpeza (finaliza a estadia)"
                  : done
                    ? "Reabrir (voltar para Pendente)"
                    : "Marcar como Concluído"
          }
          className={`size-9 grid place-items-center rounded-lg transition-colors ${
            cleaningBlock
              ? "bg-orange-500/25 text-orange-700 dark:text-orange-400 border border-orange-500/50 cursor-not-allowed"
              : blockCheck
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/40 cursor-not-allowed"
                : mode === "cleaning"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20"
                  : done
                    ? "bg-secondary hover:bg-secondary/80"
                    : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20"
          }`}
        >
          <Check className="size-4" />
        </button>
        )}

        {onRevert && mode !== "checkin" && (
          <button
            type="button"
            onClick={() => {
              const label =
                mode === "stay" || mode === "checkout"
                  ? "Desfazer o check-in e voltar este card para a lista de Check-ins?"
                  : mode === "cleaning"
                    ? "Desfazer o check-out e voltar este card para a lista de Checkouts?"
                    : "Reabrir esta estadia e voltar o card para a lista Em Limpeza?";
              if (window.confirm(label)) onRevert(row);
            }}
            disabled={busy}
            aria-label="Voltar para a etapa anterior"
            title={
              mode === "stay" || mode === "checkout"
                ? "Voltar para a etapa anterior (lista de Check-ins)"
                : mode === "cleaning"
                  ? "Voltar para a etapa anterior (lista de Checkouts)"
                  : "Voltar para a etapa anterior (lista Em Limpeza)"
            }
            className="size-9 grid place-items-center rounded-lg bg-secondary hover:bg-secondary/80 border border-border/60 transition-colors"
          >
            <Undo2 className="size-4" />
          </button>
        )}
        {(row.guestPhone || row.guestName) && !isPendingFill && (
          <button
            type="button"
            onClick={() =>
              openHandoffDock({
                propertyId: row.propertyId,
                phone: row.guestPhone,
                reservationCode: row.reservationCode,
                guestName: row.guestName,
              })
            }
            aria-label="Falar com hóspede"
            title="Falar com hóspede (chat + WhatsApp integrado)"
            className="size-9 grid place-items-center rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08]"
          >
            <MessageCircle className="size-4" />
          </button>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Opções do Maps"
                  title={row.garageMapsUrl ? "Garagem no Maps" : "Endereço no Maps"}
                  className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08] text-sm font-medium"
                >
                  <MapPin className="size-4" /> Maps
                  <ChevronDown className="size-3.5 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                <DropdownMenuItem onClick={copyLink} disabled={!copyText}>
                  <LinkIcon className="size-3.5 shrink-0" /> Copiar Link do Maps
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(mapsHref, "_blank", "noopener,noreferrer")}>
                  <MapPin className="size-3.5 shrink-0" /> Abrir o Google Maps
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Confirmação de check antecipado */}
      <Dialog open={!!confirmMsg} onOpenChange={(o) => !o && setConfirmMsg(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Confirmar antecipação</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{confirmMsg}</p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setConfirmMsg(null)}
              className="text-xs px-3 py-2 rounded-lg hover:bg-secondary"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmMsg(null);
                onMark(row);
              }}
              className="text-xs px-3 py-2 rounded-lg bg-primary text-primary-foreground"
            >
              Confirmar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function DateEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
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

function TimeDropdown({
  value,
  disabled,
  onChange,
  size = "sm",
}: {
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
          className={`inline-flex w-full items-center justify-between gap-1 tabular-nums rounded-md border border-border/60 bg-background/60 px-2 py-1 hover:text-primary hover:border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:hover:text-inherit ${size === "xs" ? "text-xs" : "text-sm"}`}
        >
          <span className="font-medium">{value ?? "—"}</span>
          <ChevronDown className="size-3 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto min-w-[6rem] p-1">
        {value && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="text-xs text-muted-foreground justify-center"
          >
            Limpar
          </DropdownMenuItem>
        )}
        {TIME_SLOTS.map((t) => (
          <DropdownMenuItem
            key={t}
            onClick={(e) => {
              e.stopPropagation();
              onChange(t);
            }}
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
