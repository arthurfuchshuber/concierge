import { PhoneActionButton } from "@/components/PhoneActionButton";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CalendarCheck,
  CalendarX,
  LogIn,
  LogOut,
  StickyNote,
  Check,
  AlertTriangle,
  Loader2,
  Home,
  Info,
  Sparkles,
  TrendingUp,
  Bell,
  BellOff,
  ChevronDown,
  UserPlus,
  MapPin,
  Link as LinkIcon,
  KeyRound,
  Eye,
  ListChecks,
  Trash2,
  BedDouble,
  CheckCircle2,
  Undo2,
  Filter,
  LayoutGrid,
  MoreVertical,
} from "lucide-react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CopyButton } from "@/components/CopyButton";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { useImpersonation } from "@/hooks/useImpersonation";
import { ConfirmActionDialog } from "@/components/permissions/ConfirmActionDialog";

function PhoneLink({ phone, country }: { phone: string | null; country: string | null }) {
  return <PhoneActionButton phone={phone} country={country} size={12} />;
}

/**
 * Acompanhantes da mesma reserva: mostramos apenas "+N" clicável; ao expandir,
 * a lista completa com nome e telefone de cada hóspede.
 */
function ExtraGuests({
  guests,
}: {
  guests: Array<{ logId: string; name: string; phone: string | null; phoneCountry: string | null }>;
}) {
  const [open, setOpen] = useState(false);
  if (!guests || guests.length === 0) return null;
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="shrink-0 inline-flex items-center border-0 bg-transparent p-0 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
        title={`${guests.length} outro(s) hóspede(s) nesta reserva`}
      >
        +{guests.length}
      </button>
      {open && (
        <ul className="absolute left-0 top-full z-30 mt-1 min-w-[180px] space-y-0.5 rounded-lg border border-border/50 bg-popover px-2 py-1.5 shadow-lg">
          {guests.map((g) => (
            <li key={g.logId} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-1 rounded-full bg-muted-foreground/60 shrink-0" />
              <span className="min-w-0 truncate" title={g.name}>
                {g.name}
              </span>
              <PhoneLink phone={g.phone} country={g.phoneCountry} />
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

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
        className="w-64 max-w-[calc(100vw-2rem)] rounded-lg border-border/70 bg-popover/95 backdrop-blur p-3 text-xs leading-relaxed shadow-xl"
      >
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</div>
        <div className="text-foreground/90">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

export type OperationView = "resumo" | "kanban" | "calendario";

export function OperationWorkspace({ view }: { view: OperationView }) {
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

  const [range, setRange] = useState<"today" | "tomorrow" | "7d" | "all">("today");
  // Qual coluna do Kanban está ativa no mobile (lá o quadro vira abas — não
  // cabem as 5 colunas lado a lado). No desktop não é usado; as 5 colunas
  // aparecem todas ao mesmo tempo.
  const [mobileTab, setMobileTab] = useState<BoardMode>("checkin");
  // Largura das colunas do Kanban (desktop) — calculada de verdade a partir
  // do espaço disponível, não um número fixo. Cabe quantas colunas couberem
  // numa largura mínima confortável (240px), e essas colunas esticam pra
  // preencher o espaço TODO, sem sobrar vão nem cortar a próxima coluna pela
  // metade — reage ao recolher/expandir o menu lateral e a mudanças de tela.
  const kanbanRowRef = useRef<HTMLDivElement>(null);
  const [kanbanColWidth, setKanbanColWidth] = useState(262);
  useLayoutEffect(() => {
    const el = kanbanRowRef.current;
    if (!el) return;
    const GAP = 12; // gap-3
    const MIN_COL = 240;
    const TOTAL_COLS = 5;
    function recalc() {
      const containerWidth = el!.clientWidth;
      if (containerWidth <= 0) return;
      let n = Math.floor((containerWidth + GAP) / (MIN_COL + GAP));
      n = Math.max(1, Math.min(TOTAL_COLS, n));
      const w = (containerWidth - (n - 1) * GAP) / n;
      setKanbanColWidth(Math.floor(w));
    }
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // "Detalhes da operação" aberto — UM ESTADO POR COLUNA, não compartilhado.
  // Se fosse um estado só pro quadro inteiro: rolar a coluna "Em Limpeza"
  // fecharia um card aberto em "Check-ins", mesmo sendo hóspedes e colunas
  // totalmente diferentes (ex.: mesmo imóvel com um hóspede saindo — em
  // limpeza — e outro chegando — em check-in — ao mesmo tempo). Cada coluna
  // só fecha o que está aberto NELA MESMA ao rolar.
  const [expandedByColumn, setExpandedByColumn] = useState<Record<BoardMode, string | null>>({
    checkin: null,
    checkout: null,
    stay: null,
    cleaning: null,
    done: null,
  });
  // Card em ação (para feedback imediato no toque, sem travar o quadro inteiro).
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  // Confirmação de antecipação (card com data futura).
  const [confirmAdvance, setConfirmAdvance] = useState<{
    row: ArrivalRow;
    from: "checkin" | "stay" | "checkout" | "cleaning";
  } | null>(null);
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

  // Uma única rotina de recarga, com "debounce": evita disparar 4-5 requisições
  // seguidas (mutação + eventos em tempo real) — o que deixava o app lento no celular.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshDashboard = useCallback(
    (delay = 600) => {
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
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

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
    mutationFn: (v: { logId?: string; reservationId?: string; from: "checkout" | "stay" | "cleaning" | "done" }) =>
      revertFn({ data: v }),
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

  /**
   * Atualização otimista: o card muda de coluna instantaneamente no cache,
   * antes do servidor responder. O refresh em segundo plano corrige depois.
   */
  const patchList = useCallback(
    (listKind: "checkin" | "checkout", patch: (rows: ArrivalRow[]) => ArrivalRow[]) => {
      qc.setQueriesData<{ rows: ArrivalRow[] } | undefined>(
        { predicate: (q) => q.queryKey[0] === "dash-list" && q.queryKey[1] === listKind },
        (old) => (old?.rows ? { ...old, rows: patch(old.rows) } : old),
      );
    },
    [qc],
  );

  const optimisticMove = useCallback(
    (row: ArrivalRow, from: "checkin" | "stay" | "checkout" | "cleaning" | "done") => {
      const id = row.logId;
      const setStatus = (rows: ArrivalRow[], status: "pending" | "done") =>
        rows.map((r) => (r.logId === id ? { ...r, status } : r));
      if (from === "checkin") patchList("checkin", (rows) => setStatus(rows, "done"));
      else if (from === "stay") patchList("checkin", (rows) => setStatus(rows, "pending"));
      else if (from === "checkout") patchList("checkout", (rows) => setStatus(rows, "done"));
      else if (from === "cleaning") patchList("checkout", (rows) => rows.filter((r) => r.logId !== id));
    },
    [patchList],
  );

  function runAdvance(row: ArrivalRow, from: "checkin" | "stay" | "checkout" | "cleaning") {
    const target = statusTarget(row);
    if (!target.logId && !target.reservationId) {
      toast.error("Não foi possível identificar esse card. Atualize a página e tente novamente.");
      return;
    }
    setBusyRowId(row.logId);
    optimisticMove(row, from);
    if (from === "stay") {
      revert.mutate({ ...target, from });
      return;
    }
    advance.mutate({ ...target, from });
  }

  /**
   * Antecipar um card com data futura (ex.: "Checkouts amanhã") é uma ação
   * fora do fluxo normal — antes ela acontecia no primeiro clique e o card
   * simplesmente sumia da tela. Agora pede confirmação explícita e, ao
   * confirmar, o card segue para o status correto (Em Limpeza).
   */
  function handleAdvance(row: ArrivalRow, from: "checkin" | "stay" | "checkout" | "cleaning") {
    if ((from === "checkout" || from === "checkin") && row.date > todayISO) {
      setConfirmAdvance({ row, from });
      return;
    }
    runAdvance(row, from);
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
  const rawCheckinPendingRows = useMemo(() => ciRows.filter((r) => r.status === "pending"), [ciRows]);
  const checkoutPendingRows = useMemo(() => coRows.filter((r) => r.status === "pending"), [coRows]);
  const rawTomorrowCheckinPendingRows = useMemo(
    () => (tomorrowCheckinListQ.data?.rows ?? []).filter((r) => r.status === "pending"),
    [tomorrowCheckinListQ.data?.rows],
  );
  const tomorrowCheckoutPendingRows = useMemo(
    () => (tomorrowCheckoutListQ.data?.rows ?? []).filter((r) => r.status === "pending"),
    [tomorrowCheckoutListQ.data?.rows],
  );
  /**
   * "Em Limpeza" precisa incluir também o checkout ANTECIPADO de um card de
   * amanhã: ele sai da lista de amanhã (deixa de ser pendente) e, sem isso,
   * não apareceria em lugar nenhum.
   */
  const cleaningRows = useMemo(() => {
    const done = coRows.filter((r) => r.status === "done");
    const seen = new Set(done.map((r) => r.logId));
    const early = (tomorrowCheckoutListQ.data?.rows ?? []).filter((r) => r.status === "done" && !seen.has(r.logId));
    return [...done, ...early];
  }, [coRows, tomorrowCheckoutListQ.data?.rows]);

  const concludedRows = concludedQ.data?.rows ?? [];
  const counts = {
    checkin: rawCheckinPendingRows.length,
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

  /**
   * Ordenação dos cards de chegada:
   * 1) horário previsto de chegada (mais cedo primeiro; sem horário vai por último)
   * 2) imóveis já liberados para check-in acima (sem checkout/limpeza pendente)
   * 3) proprietário A→Z
   * 4) nome do anúncio A→Z
   */
  const sortCheckinRows = useCallback(
    (rows: ArrivalRow[]) => {
      const txt = (a?: string | null, b?: string | null) =>
        (a ?? "").localeCompare(b ?? "", "pt-BR", { sensitivity: "base" });
      const time = (r: ArrivalRow) => r.arrivalTimeOverride ?? r.guestArrivalTime ?? null;
      const blockedRank = (r: ArrivalRow) => (cleaningPendingPropIds.has(r.propertyId) ? 1 : 0);
      return [...rows].sort((a, b) => {
        const ta = time(a);
        const tb = time(b);
        if (ta && tb && ta !== tb) return ta.localeCompare(tb);
        if (!!ta !== !!tb) return ta ? -1 : 1;
        return blockedRank(a) - blockedRank(b) || txt(a.ownerName, b.ownerName) || txt(a.propertyName, b.propertyName);
      });
    },
    [cleaningPendingPropIds],
  );
  const checkinPendingRows = useMemo(
    () => sortCheckinRows(rawCheckinPendingRows),
    [rawCheckinPendingRows, sortCheckinRows],
  );
  const tomorrowCheckinPendingRows = useMemo(
    () => sortCheckinRows(rawTomorrowCheckinPendingRows),
    [rawTomorrowCheckinPendingRows, sortCheckinRows],
  );
  // Imóvel com check-out pendente ou limpeza em andamento não é "livre".
  const freeProperties = useMemo(
    () => (occupancyQ.data?.freeToday ?? []).filter((p) => !cleaningPendingPropIds.has(p.id)),
    [occupancyQ.data?.freeToday, cleaningPendingPropIds],
  );

  // Check-ins de hoje já marcados como concluídos → agenda mostra "ocupado".
  const checkedInPropertyIds = useMemo(
    () => new Set(ciRows.filter((r) => r.status === "done" && r.guestCheckin === todayISO).map((r) => r.propertyId)),
    [ciRows, todayISO],
  );

  const rangeLabel: Record<typeof range, string> = {
    today: "Hoje",
    tomorrow: "Amanhã",
    "7d": "7 dias",
    all: "Todos",
  };

  function arrivalGroupPropsFor(colMode: BoardMode, rows: ArrivalRow[]) {
    const colKind: "checkin" | "checkout" =
      colMode === "checkout" || colMode === "cleaning" || colMode === "done" ? "checkout" : "checkin";
    return {
      rows,
      kind: colKind,
      mode: colMode,
      onMark: (row: ArrivalRow) => {
        if (colMode === "done") return;
        handleAdvance(row, colMode as "checkin" | "stay" | "checkout" | "cleaning");
      },
      onRevert:
        colMode === "checkin"
          ? undefined
          : (row: ArrivalRow) => {
              const target = statusTarget(row);
              if (!target.logId && !target.reservationId) {
                toast.error("Não foi possível identificar esse card.");
                return;
              }
              setBusyRowId(row.logId);
              if (colMode === "stay")
                patchList("checkin", (rows) =>
                  rows.map((r) => (r.logId === row.logId ? { ...r, status: "pending" } : r)),
                );
              else if (colMode === "checkout" || colMode === "cleaning")
                patchList("checkout", (rows) =>
                  rows.map((r) => (r.logId === row.logId ? { ...r, status: "pending" } : r)),
                );
              revert.mutate({ ...target, from: colMode as "checkout" | "stay" | "cleaning" | "done" });
            },
      onSyncIcal: (row: ArrivalRow) => {
        const t = colKind === "checkin" ? "15:00" : "11:00";
        setBusyRowId(row.logId);
        upsert.mutate({ ...statusTarget(row), kind: colKind, arrivalTimeOverride: t });
        toast.success(`Horário alinhado ao iCal (${t}).`);
      },
      onNote: (row: ArrivalRow, note: string | null) => {
        setBusyRowId(row.logId);
        upsert.mutate({ ...statusTarget(row), kind: colKind, note });
      },
      onEditDates: (row: ArrivalRow, dates: { checkinDate?: string; checkoutDate?: string | null }) => {
        setBusyRowId(row.logId);
        updateDates.mutate({ logId: row.logId, ...dates });
      },
      onEditTime: (row: ArrivalRow, time: string | null) => handleEditTime(row, colKind, time),
      busyRowId,
      // Antes "Em Estadia"/"Em Limpeza" ficavam com opacity-70 (pra parecer
      // menos urgente) — só que isso também fazia o card parecer menos card,
      // sem o mesmo peso visual dos outros. Agora todos têm o mesmo layout.
      muted: false,
      cleaningPendingPropIds,
      expandedId: expandedByColumn[colMode],
      onExpandedChange: (id: string | null) => setExpandedByColumn((prev) => ({ ...prev, [colMode]: id })),
    };
  }

  // Extraído como função pra poder aparecer em dois lugares diferentes (ao
  // lado dos pendentes no desktop, embaixo no mobile) sem duplicar o JSX de
  // verdade — os dois pontos de chamada leem o mesmo engQ/range do
  // componente pai, então nunca ficam dessincronizados entre si.
  function renderEngagementPanel(wrapperClassName: string) {
    // Só aparece quando existe informação de visualização; sem dados, some.
    const hasData = (engQ.data?.checkinsInPeriod ?? 0) > 0 || (engQ.data?.checkinsWithCodes ?? 0) > 0;
    if (!engQ.isLoading && !hasData) return null;

    return (
      <section className={`rounded-[0.3rem] border-0 bg-card p-4 sm:p-5 ds-3d ${wrapperClassName}`}>
        <EngagementBars
          loading={engQ.isLoading}
          checkins={engQ.data?.checkinsInPeriod ?? 0}
          checkinsWithCodes={engQ.data?.checkinsWithCodes ?? 0}
          checkinBreakdown={engQ.data?.checkinBreakdown}
          codesBreakdown={engQ.data?.codesBreakdown}
        />
      </section>
    );
  }

  return (
    // Alinhado à esquerda (sem mx-auto): com o menu recolhido a área fica mais
    // larga e o centramento aumentava a margem esquerda.
    <div className="px-2.5 sm:px-5 lg:px-8 py-5 lg:py-8 max-w-[1440px] w-full space-y-1.5">
      <OperationShell view={view} />

      {view === "resumo" ? (
        <>
          {/* KPIs — mesmo espaçamento de 6px do cabeçalho acima, replicado para
              linha↔linha, linha↔card e card↔card em toda a página. */}
          <section className="space-y-1.5">
            <div className="grid grid-cols-2 gap-1.5">
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
              // Sem o shimmer/glow âmbar (amber-mirror) — menos "colorido",
              // mais executivo; o card já sinaliza com o pontinho âmbar.
              <div>
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

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
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
                allProperties={occupancyQ.data?.properties ?? []}
                onRefresh={() => occupancyQ.refetch()}
              />
            </div>
          </section>

          {/* Engajamento do guia — volta a aparecer aqui embaixo, sempre, em
              largura total (mobile e desktop). Versão discreta, sem cabeçalho. */}
          {renderEngagementPanel("")}
        </>
      ) : null}

      {view === "kanban" ? (
        <>
          {/* Quadro de operação — Kanban por status, colunas lado a lado (estilo
              Jira). Antes era uma lista só com um dropdown pra trocar de status;
              agora todos os status ficam visíveis ao mesmo tempo, e "puxar" um
              card de um status pro outro fica visual, não escondido atrás de um
              menu. */}
          <section className="rounded-none bg-transparent p-0 space-y-4">
            {/* Título "Quadro de operação" — redundante no mobile, onde as
                próprias abas logo abaixo (Check-ins, Checkouts...) já deixam
                claro do que se trata; mantido no desktop, onde a visão é de
                colunas lado a lado sem essa legenda textual. O filtro "Hoje"
                também só aparece aqui no desktop — no mobile ele migra pra
                dentro da linha de abas, ver abaixo. */}
            <div className="hidden sm:flex items-center gap-3">
              <h2 className="ds-section-title mb-0 flex items-center gap-2">
                <LayoutGrid className="size-4.5 text-muted-foreground" /> Quadro de operação
              </h2>
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

            {/* Mobile: abas roláveis, uma coluna ativa por vez — 5 colunas lado a
                lado não cabem numa tela estreita. O item ativo usa sempre o
                gradiente da marca (mesmo tratamento de toda aba/badge ativo do
                app), não uma cor diferente por aba. O filtro "Hoje" fica fixo
                no fim dessa mesma linha, não numa linha própria acima. */}
            <div className="sm:hidden space-y-3">
              <div className="space-y-2">
                <div className="ds-scroll-x w-full min-w-0 gap-1.5 snap-x pb-1 -mx-1 px-1">

                  {(
                    [
                      { key: "checkin", label: "Check-ins", icon: CalendarCheck, count: counts.checkin },
                      { key: "checkout", label: "Checkouts", icon: CalendarX, count: counts.checkout },
                      { key: "stay", label: "Estadia", icon: BedDouble, count: counts.stay },
                      { key: "cleaning", label: "Limpeza", icon: Sparkles, count: counts.cleaning },
                      { key: "done", label: "Concluídos", icon: CheckCircle2, count: counts.done },
                    ] as const
                  ).map((t) => {
                    const Icon = t.icon;
                    const active = mobileTab === t.key;
                    // Cor por status: só aparece no item selecionado, e apenas
                    // como borda inferior (sem fundo, sem borda ao redor).
                    const toneByKey: Record<string, string> = {
                      checkin: "border-b-emerald-500 text-emerald-500",
                      checkout: "border-b-orange-500 text-orange-500",
                      stay: "border-b-violet-400 text-violet-400",
                      cleaning: "border-b-sky-400 text-sky-400",
                      done: "border-b-muted-foreground text-muted-foreground",
                    };
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setMobileTab(t.key)}
                        className={`h-9 box-border shrink-0 snap-start inline-flex items-center gap-1.5 rounded-none border-0 border-b-2 bg-transparent px-3.5 text-xs font-medium leading-none whitespace-nowrap transition-colors ${
                          active ? `${toneByKey[t.key]} border-b-current` : "border-b-transparent text-muted-foreground"
                        }`}
                      >
                        <Icon className="size-3.5" />
                        {t.label}
                        <span className="opacity-75 tabular-nums">{t.count}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-start">
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


              {mobileTab === "checkin" &&
                (checkinListQ.isLoading ? (
                  <ColumnLoading />
                ) : checkinPendingRows.length === 0 ? (
                  <ColumnEmpty />
                ) : (
                  <ArrivalGroup title="" {...arrivalGroupPropsFor("checkin", checkinPendingRows)} />
                ))}
              {mobileTab === "checkout" &&
                (checkoutListQ.isLoading ? (
                  <ColumnLoading />
                ) : checkoutPendingRows.length === 0 ? (
                  <ColumnEmpty />
                ) : (
                  <ArrivalGroup title="" {...arrivalGroupPropsFor("checkout", checkoutPendingRows)} />
                ))}
              {mobileTab === "stay" &&
                (checkinListQ.isLoading ? (
                  <ColumnLoading />
                ) : stayRows.length === 0 ? (
                  <ColumnEmpty />
                ) : (
                  <ArrivalGroup title="" {...arrivalGroupPropsFor("stay", stayRows)} />
                ))}
              {mobileTab === "cleaning" &&
                (checkoutListQ.isLoading ? (
                  <ColumnLoading />
                ) : cleaningRows.length === 0 ? (
                  <ColumnEmpty />
                ) : (
                  <ArrivalGroup title="" {...arrivalGroupPropsFor("cleaning", cleaningRows)} />
                ))}
              {mobileTab === "done" &&
                (concludedQ.isLoading ? (
                  <ColumnLoading />
                ) : concludedRows.length === 0 ? (
                  <ColumnEmpty />
                ) : (
                  <ArrivalGroup title="" {...arrivalGroupPropsFor("done", concludedRows)} />
                ))}
            </div>

            {/* Desktop/tablet: colunas com largura fixa e confortável, com
                rolagem horizontal quando não couberem todas — igual Jira/Trello
                de verdade. Antes o grid forçava sempre 5 colunas na mesma
                largura da tela toda, então ficava ruim ou bom dependendo de
                quanto espaço sobrava (ex.: menu recolhido ou não). Agora cada
                coluna tem sempre a mesma largura confortável, não importa o
                espaço disponível. */}
            <div ref={kanbanRowRef} className="hidden sm:flex gap-3 items-start overflow-x-auto snap-x pb-2 -mx-1 px-1">
              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, checkin: null }))}
                  title="Check-ins"
                  icon={CalendarCheck}
                  count={counts.checkin}
                  tone="emerald"
                >
                  {checkinListQ.isLoading ? (
                    <ColumnLoading />
                  ) : checkinPendingRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup title="" {...arrivalGroupPropsFor("checkin", checkinPendingRows)} />
                  )}
                </KanbanColumn>
              </div>

              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, checkout: null }))}
                  title="Checkouts"
                  icon={CalendarX}
                  count={counts.checkout}
                  tone="amber"
                >
                  {checkoutListQ.isLoading ? (
                    <ColumnLoading />
                  ) : checkoutPendingRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup title="" {...arrivalGroupPropsFor("checkout", checkoutPendingRows)} />
                  )}
                </KanbanColumn>
              </div>

              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, stay: null }))}
                  title="Em Estadia"
                  icon={BedDouble}
                  count={counts.stay}
                  tone="sky"
                >
                  {checkinListQ.isLoading ? (
                    <ColumnLoading />
                  ) : stayRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup title="" {...arrivalGroupPropsFor("stay", stayRows)} />
                  )}
                </KanbanColumn>
              </div>

              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, cleaning: null }))}
                  title="Em Limpeza"
                  icon={Sparkles}
                  count={counts.cleaning}
                  tone="violet"
                >
                  {checkoutListQ.isLoading ? (
                    <ColumnLoading />
                  ) : cleaningRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup title="" {...arrivalGroupPropsFor("cleaning", cleaningRows)} />
                  )}
                </KanbanColumn>
              </div>

              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, done: null }))}
                  title="Concluídos"
                  icon={CheckCircle2}
                  count={counts.done}
                  tone="zinc"
                >
                  {concludedQ.isLoading ? (
                    <ColumnLoading />
                  ) : concludedRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup title="" {...arrivalGroupPropsFor("done", concludedRows)} />
                  )}
                </KanbanColumn>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {view === "calendario" ? (
        <>
          {/* Agenda macro de ocupação — abaixo do quadro, como no mockup. */}
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
        </>
      ) : null}

      <ConfirmActionDialog
        open={!!confirmAdvance}
        onOpenChange={(v) => {
          if (!v) setConfirmAdvance(null);
        }}
        title={confirmAdvance?.from === "checkin" ? "Antecipar check-in?" : "Antecipar checkout?"}
        destructive={false}
        confirmLabel="Sim, antecipar"
        description={
          confirmAdvance ? (
            <>
              {confirmAdvance.from === "checkin" ? "O check-in de " : "O checkout de "}
              <strong className="text-foreground">{confirmAdvance.row.guestName}</strong>
              {confirmAdvance.row.propertyName ? ` (${confirmAdvance.row.propertyName})` : ""} está previsto para{" "}
              <strong className="text-foreground">
                {new Date(`${confirmAdvance.row.date}T12:00:00`).toLocaleDateString("pt-BR")}
              </strong>
              . Confirmar agora move o card para{" "}
              <strong className="text-foreground">
                {confirmAdvance.from === "checkin" ? "Em Estadia" : "Em Limpeza"}
              </strong>{" "}
              hoje.
            </>
          ) : null
        }
        onConfirm={() => {
          if (confirmAdvance) runAdvance(confirmAdvance.row, confirmAdvance.from);
          setConfirmAdvance(null);
        }}
      />
    </div>
  );
}

/* --------- Cabeçalho compartilhado das 3 telas de operação --------- */

const OPERATION_TABS = [
  { view: "resumo" as const, label: "Dashboard", to: "/admin/dashboard" },
  { view: "kanban" as const, label: "Kanban", to: "/admin/dashboard/kanban" },
  { view: "calendario" as const, label: "Calendário", to: "/admin/dashboard/calendario" },
];

const OPERATION_COPY: Record<OperationView, { title: string; subtitle: string }> = {
  resumo: { title: "Operação", subtitle: "Sua rotina diária: check-ins, checkouts e senhas." },
  kanban: { title: "Kanban", subtitle: "Cada reserva na etapa em que ela realmente está." },
  calendario: { title: "Calendário", subtitle: "Ocupação dos imóveis dia a dia." },
};

function OperationShell({ view }: { view: OperationView }) {
  const copy = OPERATION_COPY[view];
  return (
    <div className="space-y-3">
      <div>
        <h1 className="ds-page-title truncate">{copy.title}</h1>
        <p className="ds-page-subtitle mt-1.5">{copy.subtitle}</p>
      </div>

      {/* Segmented control — Dashboard / Kanban / Calendário (largura da página) */}
      <nav className="mb-5 flex w-full overflow-hidden rounded-[0.3rem] bg-foreground/5">
        {OPERATION_TABS.map((t) => {
          const active = t.view === view;
          return (
            <Link
              key={t.view}
              to={t.to}
              className={`flex-1 px-3 py-2.5 text-center text-xs font-semibold transition-colors ${
                active
                  ? "bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/* ------------------------- UI Building Blocks ------------------------- */

const KANBAN_TONE: Record<string, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 ring-emerald-500/20",
  amber: "text-amber-600 dark:text-amber-400 bg-amber-500/10 ring-amber-500/20",
  sky: "text-sky-600 dark:text-sky-400 bg-sky-500/10 ring-sky-500/20",
  violet: "text-violet-600 dark:text-violet-400 bg-violet-500/10 ring-violet-500/20",
  zinc: "text-muted-foreground bg-muted ring-border",
};

// Mesmo mapa de cor das colunas do desktop, só que como aba ativa (borda +
// fundo sólido leve) — usa os tokens de tema do próprio Tailwind
// (emerald/amber/sky/violet + text-muted-foreground), não cor fixa.
const KANBAN_TONE_ACTIVE: Record<string, string> = {
  emerald: "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  sky: "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  zinc: "border-primary bg-primary/10 text-primary",
};

/** Uma coluna do quadro Kanban — cabeçalho fixo (título + contagem) e corpo
 * com rolagem própria, adaptando a altura ao que a tela do usuário permitir. */
function KanbanColumn({
  title,
  icon: Icon,
  count,
  tone,
  children,
  onScroll,
}: {
  title: string;
  icon: React.ElementType;
  count: number;
  tone: "emerald" | "amber" | "sky" | "violet" | "zinc";
  children: React.ReactNode;
  /** Dispara ao rolar o corpo da coluna — usado pra recolher "Detalhes da
   * operação" sozinho, de forma sutil, acompanhando a rolagem do usuário. */
  onScroll?: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  // Mede os cards DE VERDADE em vez de supor uma altura fixa — assim o
  // limite acompanha um card que cresce ao abrir "Detalhes da operação", e
  // com 3 cards ou menos a coluna fica livre (nunca corta nada). Reage tanto
  // a mudança na quantidade de cards quanto ao tamanho de qualquer um deles.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    function recalc() {
      const cards = Array.from(body!.querySelectorAll<HTMLElement>(":scope .snap-start"));
      if (cards.length <= 3) {
        setMaxHeight(undefined);
        return;
      }
      const first = cards[0].getBoundingClientRect();
      const third = cards[2].getBoundingClientRect();
      const PADDING_Y = 20; // p-2.5 em cima + embaixo
      setMaxHeight(Math.ceil(third.bottom - first.top) + PADDING_Y);
    }

    recalc();
    const ro = new ResizeObserver(recalc);
    for (const card of body.querySelectorAll<HTMLElement>(":scope .snap-start")) ro.observe(card);
    return () => ro.disconnect();
  }, [count, children]);

  return (
    <div className="flex flex-col min-w-0 rounded-[0.3rem]">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/60 shrink-0 bg-background/40 rounded-t-[0.3rem]">
        <div className={`size-7 rounded-lg grid place-items-center ring-1 shrink-0 ${KANBAN_TONE[tone]}`}>
          <Icon className="size-3.5" />
        </div>
        <span className="ds-card-title truncate">{title}</span>
        <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums shrink-0">{count}</span>
      </div>
      <div
        ref={bodyRef}
        onScroll={onScroll}
        style={maxHeight !== undefined ? { maxHeight } : undefined}
        className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory p-2.5 space-y-1.5"
      >
        {children}
      </div>
    </div>
  );
}

/** Limita a altura de uma lista em N cards INTEIROS — nunca corta um card ao
 * meio. Mede os itens de verdade e escolhe o maior corte que caiba na tela. */
function useWholeCardsMaxHeight(visible: number, key: unknown) {
  // Callback ref em state: o conteúdo vive num portal (Dialog) e só monta
  // quando abre — assim o cálculo dispara exatamente quando o nó aparece.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!node) {
      setMaxHeight(undefined);
      return;
    }
    let raf = 0;
    let tries = 0;

    const recalc = () => {
      const items = Array.from(node.querySelectorAll<HTMLElement>("[data-whole-card]"));
      if (items.length === 0) {
        setMaxHeight(undefined);
        // O diálogo anima ao abrir; tenta de novo nos primeiros frames.
        if (tries++ < 20) raf = requestAnimationFrame(recalc);
        return;
      }
      // Mede na mesma coordenada absoluta para incluir qualquer gap ou título
      // anterior ao item. A altura termina exatamente na borda inferior do
      // card escolhido, sem depender do offsetParent de listas aninhadas.
      // Medimos por rect (imune a offsetParent de listas aninhadas/portais)
      // e compensamos o scroll atual do container.
      const absoluteTop = (element: HTMLElement) => element.getBoundingClientRect().top;
      const base = node.getBoundingClientRect().top - node.scrollTop;
      const cap = Math.round(window.innerHeight * 0.7);
      const tops = items.map((i) => absoluteTop(i) - base);
      const bottoms = items.map((i) => absoluteTop(i) + i.offsetHeight - base);
      const total = bottoms[bottoms.length - 1];
      if (items.length <= visible && total <= cap) {
        setMaxHeight(undefined);
        return;
      }
      let height = bottoms[Math.min(visible, bottoms.length) - 1];
      if (height > cap) {
        // Recua somente para um card COMPLETO. Mesmo se o primeiro for mais
        // alto que o limite visual, nunca o corta ao meio.
        height = bottoms.filter((b) => b <= cap).pop() ?? bottoms[0];
      }
      const selectedIndex = bottoms.findIndex((bottom) => bottom === height);
      const nextTop = tops[selectedIndex + 1];
      // Reserva até 2px para que sombra/borda arredondada do último card não
      // pareça cortada, mas sempre encerra antes do primeiro pixel do próximo.
      const visualClearance = nextTop === undefined ? 0 : Math.max(0, Math.min(2, nextTop - height - 0.5));
      setMaxHeight(Math.ceil(height + visualClearance));
    };

    raf = requestAnimationFrame(recalc);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      tries = 0;
      raf = requestAnimationFrame(recalc);
    });
    ro.observe(node);
    for (const item of node.querySelectorAll("[data-whole-card]")) ro.observe(item);
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      tries = 0;
      raf = requestAnimationFrame(recalc);
    });
    mo.observe(node, { childList: true, subtree: true });
    window.addEventListener("resize", recalc);
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", recalc);
    };
  }, [visible, key, node]);

  return { ref: setNode, maxHeight };
}

function ColumnLoading() {
  return (
    <div className="py-8 grid place-items-center text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
    </div>
  );
}

function ColumnEmpty() {
  return <div className="py-8 text-center text-xs text-muted-foreground">Nada por aqui.</div>;
}

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
  const list = useWholeCardsMaxHeight(2, `${open}:${rows.length}:${loading}`);
  const valueTone = tone === "primary" ? "text-accent" : "text-foreground";
  const valueColor =
    shadowTone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : shadowTone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : valueTone;
  // Refinamento executivo (só nesta página): removido o glow colorido
  // (shadow grande em rgba emerald/amber) — mantém a sombra neutra e fina
  // que já era usada nos cards sem cor, pra reduzir o "volume" visual.
  const shadowClass = "ds-3d ds-3d-hover";
  const dotClass =
    shadowTone === "emerald" ? "bg-emerald-500" : shadowTone === "amber" ? "bg-amber-500" : "bg-muted-foreground/50";

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
            className={`w-full flex items-center gap-2 rounded-[0.3rem] border-0 bg-card px-3.5 py-3 text-left transition hover:bg-secondary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${shadowClass}`}
          >
            <Icon className={`size-3.5 shrink-0 ${dotClass.replace("bg-", "text-")}`} />
            <span className="ds-eyebrow truncate">{label}</span>
            <span className={`ml-auto text-base font-display tabular-nums ${valueColor}`}>
              {loading ? "—" : rows.length}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className={`w-full h-full rounded-[0.3rem] border-0 bg-card px-3.5 py-5 min-h-[96px] flex flex-col justify-between text-left transition hover:bg-secondary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${shadowClass}`}
          >
            <div className="flex items-center gap-2 ds-eyebrow min-w-0">
              <Icon className="size-3.5 shrink-0" />
              {/* Uma única linha — sempre reticências, nunca quebra. */}
              <span className="min-w-0 flex-1 truncate leading-none" title={label}>
                {label}
              </span>
            </div>

            <div
              className={`font-display font-bold mt-1.5 tabular-nums leading-none ${valueColor} ${
                shadowTone ? "text-[30px] sm:text-[32px]" : "text-[28px] sm:text-[30px]"
              }`}
            >
              {loading ? "—" : rows.length}
            </div>
          </button>
        )}
      </DialogTrigger>

      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-lg border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        <div
          className={`absolute inset-x-0 top-0 h-px ${shadowTone === "emerald" ? "bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" : shadowTone === "amber" ? "bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" : "bg-gradient-to-r from-transparent via-primary/50 to-transparent"}`}
        />
        <DialogHeader className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div
              className={`grid place-items-center size-10 rounded-xl ${shadowTone === "emerald" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : shadowTone === "amber" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-accent/10 text-accent"}`}
            >
              <Icon className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-display leading-tight truncate">{label}</DialogTitle>
              <div className="ds-meta mt-0.5">
                {rangeLabel} · {rows.length} {rows.length === 1 ? "hóspede" : "hóspedes"}
              </div>
            </div>
          </div>
        </DialogHeader>
        <div
          ref={list.ref}
          style={list.maxHeight !== undefined ? { maxHeight: list.maxHeight } : undefined}
          className="sg-elegant-scroll max-h-[70vh] overflow-y-auto px-3"
        >
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
                    data-whole-card
                    className="group flex items-start gap-2 rounded-lg border border-border/50 bg-background/40 px-2.5 py-2 transition hover:border-border hover:bg-secondary/40"
                  >
                    <div
                      className={`grid place-items-center size-8 rounded-full text-xs font-semibold shrink-0 ${r.pendingFill ? "bg-muted text-muted-foreground" : "bg-accent/10 text-accent"}`}
                    >
                      {r.pendingFill ? <UserPlus className="size-4" /> : initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <OwnerLine
                        name={r.ownerName}
                        phone={r.ownerPhone}
                        country={r.ownerPhoneCountry}
                        phonePosition="adjacent"
                      />
                      <div
                        className="text-sm font-semibold leading-tight truncate text-foreground"
                        title={r.propertyName ?? undefined}
                      >
                        {r.propertyName ?? "Sem nome"}
                      </div>

                      <div
                        className={`text-xs flex items-center gap-1 mt-0.5 ${r.pendingFill || !r.guestName || r.guestName === r.reservationCode ? "text-orange-500 font-medium" : "text-muted-foreground"}`}
                      >
                        {r.pendingFill || !r.guestName || r.guestName === r.reservationCode ? (
                          <>
                            <UserPlus className="size-3 shrink-0" />
                            <span className="truncate">Hóspede Pendente</span>
                          </>
                        ) : (
                          <>
                            <ExtraGuests guests={r.additionalGuests ?? []} />
                            <span className="min-w-0 truncate">{r.guestName}</span>
                            <PhoneLink phone={r.guestPhone} country={r.guestPhoneCountry} />
                          </>
                        )}
                      </div>

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
                      <EngagementFlags
                        openedGuide={r.openedGuide}
                        readInstructions={r.readInstructions}
                        hasPasswords={r.hasPasswords}
                        viewedPasswords={r.viewedPasswords}
                      />
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

/**
 * Pendências de engajamento do hóspede — só mostramos o que está em falta:
 * 1) não acessou o guia · 2) não leu as instruções (menos de 5s na Chegada)
 * 3) não viu as senhas.
 */
function EngagementFlags({
  openedGuide,
  readInstructions,
  hasPasswords,
  viewedPasswords,
  variant = "text",
}: {
  openedGuide?: boolean;
  readInstructions?: boolean;
  hasPasswords?: boolean;
  viewedPasswords?: boolean;
  variant?: "text" | "pills";
}) {
  // "Não acessou o guia" foi removido a pedido: mostramos apenas instruções e senhas.
  const flags: Array<{ icon: typeof Eye; label: string }> = [];
  if (!readInstructions) flags.push({ icon: ListChecks, label: "Não leu as instruções" });
  if (hasPasswords && !viewedPasswords) flags.push({ icon: KeyRound, label: "Não viu as senhas" });
  if (flags.length === 0) return null;
  if (variant === "pills") {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {flags.map((f) => (
          <span
            key={f.label}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25"
          >
            <f.icon className="size-3" /> {f.label}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {flags.map((f) => (
        <div
          key={f.label}
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-amber-600 dark:text-amber-400"
        >
          <f.icon className="size-3 shrink-0" /> {f.label}
        </div>
      ))}
    </div>
  );
}

/** Imóveis sem ninguém hospedado hoje. */
function FreePropertiesCard({
  loading,
  properties,
  allProperties,
  onRefresh,
}: {
  loading: boolean;
  properties: Array<{ id: string; name: string }>;
  allProperties?: Array<{ id: string; name: string }>;
  onRefresh: () => void;
}) {
  const freeIds = new Set(properties.map((p) => p.id));
  const occupied = (allProperties ?? []).filter((p) => !freeIds.has(p.id));
  const [open, setOpen] = useState(false);
  const list = useWholeCardsMaxHeight(2, `${open}:${properties.length}:${loading}`);
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
          className="w-full h-full rounded-[0.3rem] border-0 bg-card px-3.5 py-5 min-h-[96px] flex flex-col justify-between text-left transition hover:bg-secondary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ds-3d ds-3d-hover"
        >
          <div className="flex items-center gap-2 ds-eyebrow min-w-0">
            <Home className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate leading-none" title="Imóveis livres">
              Imóveis livres
            </span>
          </div>
          <div className="text-[28px] sm:text-[30px] font-display font-bold mt-1.5 tabular-nums leading-none text-foreground">
            {loading ? "—" : properties.length}
          </div>
        </button>

      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-lg">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-display">Imóveis livres hoje</DialogTitle>
        </DialogHeader>
        <div
          ref={list.ref}
          style={list.maxHeight !== undefined ? { maxHeight: list.maxHeight } : undefined}
          className="sg-elegant-scroll max-h-[70vh] overflow-y-auto px-4"
        >
          {loading ? (
            <div className="py-10 grid place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : properties.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Nenhum imóvel livre hoje.</div>
          ) : (
            <ul className="space-y-1.5 pb-2">
              {properties.map((p) => (
                <li
                  key={p.id}
                  data-whole-card
                  className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-sm truncate"
                  title={p.name}
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
  const [ownerFilter, setOwnerFilter] = useState<string>("");

  const [cityFilter, setCityFilter] = useState<string>("");

  /**
   * Mobile: exatamente 5 dias inteiros no visor.
   * Desktop: o máximo de dias inteiros que couber na largura do quadrante,
   * sem nunca cortar a bolinha do último dia.
   */
  const NAME_COL = 130;
  const MOBILE_DAYS = 5;
  const MIN_DAY_W = 38; // largura mínima por coluna no desktop
  const outerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dayW, setDayW] = useState(40);
  const [visibleDays, setVisibleDays] = useState(MOBILE_DAYS);
  const dotSize = Math.max(18, Math.min(28, dayW - 6));
  // largura exata do "visor": nome + N colunas inteiras (sem sobra de coluna cortada)
  const viewportW = NAME_COL + visibleDays * dayW;

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (!w) return;
      const usable = w - NAME_COL;
      const isDesktop = w >= 768;
      const count = isDesktop ? Math.max(1, Math.min(days, Math.floor(usable / MIN_DAY_W))) : MOBILE_DAYS;
      setVisibleDays(count);
      // Colunas compactas: nunca mais largas que 46px (desktop) / 40px (mobile).
      const maxW = isDesktop ? 46 : 40;
      setDayW(Math.min(maxW, Math.max(MIN_DAY_W, Math.floor(usable / count))));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [days]);

  const todayISO = todayISOSaoPaulo();

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
    () =>
      [...new Set(properties.map((p) => p.ownerName).filter((o): o is string => !!o))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [properties],
  );
  const cities = useMemo(
    () =>
      [...new Set(properties.map((p) => p.city).filter((c): c is string => !!c))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
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

  const clsOf = (s: CellPart) =>
    s === "in" ? "bg-emerald-500" : s === "out" ? "bg-amber-500" : s === "busy" ? "bg-primary/35" : "bg-transparent";

  return (
    <section className="relative rounded-[0.3rem] border-0 bg-card ds-3d">
      <div className="flex items-center justify-end px-2 pt-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Filter className="size-3.5 opacity-70" /> Filtros
              {activeFilters > 0 ? (
                <span className="ml-0.5 grid size-4 place-items-center rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-[9px] font-semibold text-white">
                  {activeFilters}
                </span>
              ) : null}
            </button>
          </PopoverTrigger>

          <PopoverContent align="end" className="w-64 space-y-4 p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
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
      </div>

      <div className="px-4 sm:px-5 pb-5">
        {loading ? (
          <div className="py-10 grid place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : properties.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Nenhum imóvel para exibir.</div>
        ) : (
          <>
            <div ref={outerRef} className="w-full">
              <div
                ref={scrollRef}
                style={{ scrollPaddingLeft: NAME_COL, width: viewportW, maxWidth: "100%" }}
                className="sg-elegant-scroll max-h-[22rem] overflow-auto snap-x snap-mandatory"
              >
                <table
                  className="table-fixed border-separate border-spacing-x-0 border-spacing-y-1 text-xs"
                  style={{ width: NAME_COL + dayList.length * dayW, minWidth: NAME_COL + dayList.length * dayW }}
                >
                  <thead>
                    <tr>
                      <th
                        className="sticky left-0 top-0 z-20 bg-card pb-2 pr-3 text-left"
                        style={{ width: NAME_COL, minWidth: NAME_COL }}
                      >
                        <span className="ds-eyebrow block pl-[10px]">Imóvel</span>
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
                            className="sticky top-0 z-10 snap-start bg-card px-0 pb-2 font-medium tabular-nums"
                          >
                            <div
                              className={`mx-auto flex w-full flex-col items-center rounded-md py-1 ${
                                isToday ? "bg-primary/10 text-primary" : "text-muted-foreground"
                              }`}
                            >
                              <span className="text-[9px] uppercase tracking-wide opacity-70">
                                {wd.replace(".", "")}
                              </span>
                              <span className="text-[11px] font-semibold leading-tight">{d.slice(8, 10)}</span>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProperties.map((p) => {
                      const halves = dayList.flatMap((d) => cellHalves(p.id, d));
                      const occ = halves.map((h) => h !== "free");
                      return (
                        <tr key={p.id} className="group">
                          <td
                            className="sticky left-0 z-10 bg-card py-1 pr-3 align-middle"
                            style={{ width: NAME_COL, minWidth: NAME_COL }}
                          >
                            <div className="min-w-0 max-w-full border-l-2 border-border/60 pl-2 group-hover:border-primary/50">
                              {p.ownerName ? (
                                <div className="truncate text-[9.5px] font-semibold uppercase tracking-wide text-accent/80">
                                  {p.ownerName}
                                </div>
                              ) : null}
                              <div className="truncate text-[11.5px] font-semibold leading-tight" title={p.name}>
                                {p.name}
                              </div>
                              {p.city ? (
                                <div className="truncate text-[10px] leading-tight text-muted-foreground">{p.city}</div>
                              ) : null}
                            </div>
                          </td>
                          {dayList.map((d, i) => {
                            const a = halves[i * 2] as CellPart;
                            const b = halves[i * 2 + 1] as CellPart;
                            const labelOf = (s: CellPart) =>
                              s === "in" ? "Check-in" : s === "out" ? "Checkout" : s === "busy" ? "Ocupado" : "Livre";
                            const title =
                              a === b
                                ? `${labelOf(a)} · ${fmtDateBR(d)}`
                                : `${labelOf(a)} → ${labelOf(b)} · ${fmtDateBR(d)}`;
                            const idxA = i * 2;
                            const idxB = i * 2 + 1;
                            const round = (idx: number) =>
                              [
                                occ[idx] && !occ[idx - 1] ? "rounded-l-full" : "",
                                occ[idx] && !occ[idx + 1] ? "rounded-r-full" : "",
                              ].join(" ");
                            return (
                              <td
                                key={d}
                                style={{ width: dayW, minWidth: dayW }}
                                className="px-0 py-1 snap-start"
                                title={title}
                              >
                                <div className="relative flex h-6 w-full items-center">
                                  <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/50" />
                                  <div className={`relative z-10 h-full w-1/2 ${clsOf(a)} ${round(idxA)}`} />
                                  <div className={`relative z-10 h-full w-1/2 ${clsOf(b)} ${round(idxB)}`} />
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10.5px] font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-emerald-500" /> Check-in
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-amber-500" /> Checkout
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-primary/35" /> Ocupado
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-px w-4 bg-border" /> Livre
              </span>
            </div>
          </>
        )}
      </div>
    </section>
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
          className="h-9 box-border shrink-0 inline-flex items-center gap-1.5 rounded-none border-0 bg-secondary/50 px-3.5 text-xs font-medium leading-none text-foreground/80 hover:bg-secondary transition-colors"
        >
          {current} <ChevronDown className="size-3.5 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-[8rem]">
        {options.map(([v, label]) => (
          <DropdownMenuItem
            key={v}
            onClick={() => onChange(v)}
            className={value === v ? "bg-accent/10 text-accent font-medium" : ""}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
    <div className="relative space-y-1.5">
      {checkins > 0 && (
        <BarRow
          label="Viram instruções de check-in"
          value={checkinViewed}
          total={checkins}
          pct={pctOf(checkinViewed, checkins)}
          breakdown={checkinBreakdown}
          hint={
            'Hóspedes com check-in no período que já abriram as "Instruções" apresentadas na sessão "Chegada" pelo menos uma vez.'
          }
        />
      )}
      {checkinsWithCodes > 0 && (
        <BarRow
          label="Viram senha de acesso"
          value={codesViewed}
          total={checkinsWithCodes}
          pct={pctOf(codesViewed, checkinsWithCodes)}
          breakdown={codesBreakdown}
          hint={"Hóspedes com check-in no período que já visualizaram as senhas de acesso no guia pelo menos uma vez."}
        />
      )}
    </div>
  );
}

/** Mesma lógica dos cards: hóspede principal (1º a acessar) + "+N" expansível. */
function GuestMarkGroup({ group, tone }: { group: GuestMark[]; tone: "ok" | "off" }) {
  const [open, setOpen] = useState(false);
  const [main, ...rest] = group;
  return (
    <li data-whole-card className="flex items-start gap-1.5">
      <span className={`mt-1 size-1.5 shrink-0 rounded-full ${tone === "ok" ? "bg-emerald-500" : "bg-rose-500"}`} />
      <span className="min-w-0">
        <span className="font-medium text-foreground/90">{main.name}</span>
        {main.property ? <span className="text-muted-foreground"> · {main.property}</span> : null}
        {rest.length > 0 && (
          <>
            {" "}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/50 px-1.5 py-0.5 align-middle text-[11px] font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
              title={`${rest.length} outro(s) hóspede(s) nesta reserva`}
            >
              +{rest.length}
              <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <ul className="mt-1 space-y-0.5 rounded-lg border border-border/50 bg-background/60 px-2 py-1.5">
                {rest.map((g, i) => (
                  <li key={`${g.name}-${i}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                    <span className="min-w-0 truncate">{g.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </span>
    </li>
  );
}

function GuestMarkList({ items, tone }: { items: GuestMark[]; tone: "ok" | "off" }) {
  if (items.length === 0) return <div className="text-muted-foreground text-[11px]">Ninguém</div>;
  const groups: GuestMark[][] = [];
  const index = new Map<string, number>();
  for (const it of items) {
    const key = it.property || it.name;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, groups.length);
      groups.push([it]);
    } else groups[at].push(it);
  }
  return (
    <ul className="space-y-0.5">
      {groups.slice(0, 12).map((g, i) => (
        <GuestMarkGroup key={`${g[0].name}-${i}`} group={g} tone={tone} />
      ))}
      {groups.length > 12 && <li className="text-muted-foreground text-[11px]">+{groups.length - 12} outros</li>}
    </ul>
  );
}

function BarRow({
  label,
  value,
  total,
  pct,
  breakdown,
  hint,
}: {
  label: string;
  value: number;
  total: number;
  pct: number;
  breakdown?: Breakdown;
  /** Texto explicativo do que a métrica mede (ícone "i" ao lado do valor). */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const list = useWholeCardsMaxHeight(
    2,
    `${open}:${breakdown?.viewed.length ?? 0}:${breakdown?.notViewed.length ?? 0}`,
  );
  const track = (
    <div className="h-1 rounded-full bg-rose-500/60 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
  const header = (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="font-medium truncate whitespace-nowrap min-w-0">{label}</span>
      <span className="tabular-nums text-muted-foreground text-xs whitespace-nowrap shrink-0 inline-flex items-center gap-1">
        {value} de {total}
        {hint ? <InfoHint title={label}>{hint}</InfoHint> : null}
      </span>
    </div>
  );
  if (!breakdown) {
    return (
      <div className="space-y-1.5">
        {header}
        {track}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {header}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={`Detalhes: ${label}`}
            className="w-full text-left rounded-lg transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring px-1 -mx-1 py-1"
          >
            {track}
          </button>
        </DialogTrigger>
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-lg border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
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
          <div
            ref={list.ref}
            style={list.maxHeight !== undefined ? { maxHeight: list.maxHeight } : undefined}
            className="sg-elegant-scroll max-h-[70vh] overflow-y-auto px-5 space-y-4 text-sm"
          >
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
    </div>
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
  expandedId: expandedIdProp,
  onExpandedChange,
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
  /** Controlado de fora (pela coluna do Kanban) quando presente — permite
   * recolher os "Detalhes da operação" ao rolar a coluna. Sem isso, cai de
   * volta pro estado local de sempre. */
  expandedId?: string | null;
  onExpandedChange?: (id: string | null) => void;
}) {
  // Somente UM card pode ficar com o quadro de detalhes aberto por vez.
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const openId = onExpandedChange ? (expandedIdProp ?? null) : localOpenId;
  const setOpenId = onExpandedChange ?? setLocalOpenId;
  // Antes esta lista ocupava a largura inteira da seção (fazia sentido um
  // grid responsivo de 2-3 colunas). Agora ArrivalGroup só é usado dentro de
  // colunas estreitas do Kanban (desktop) ou das abas (mobile) — nunca mais
  // com espaço de sobra — por isso virou uma pilha vertical simples. O grid
  // antigo, baseado na largura da JANELA (não do container), fazia os cards
  // se espremerem em várias colunas dentro de uma coluna de ~220px.
  if (rows.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1.5 ${muted ? "opacity-70" : ""}`}>
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

  // Silenciar alertas de atraso desta reserva (1h a 24h) — vale para a conta toda.
  const qcCard = useQueryClient();
  const muteFn = useServerFn(upsertArrivalStatus);
  const isMutedNow = !!row.mutedUntil && new Date(row.mutedUntil).getTime() > Date.now();
  const mute = useMutation({
    mutationFn: (hours: number | null) => {
      const logId = /^[0-9a-f-]{36}$/i.test(row.logId) ? row.logId : undefined;
      const reservationId = row.reservationId ?? (row.logId.startsWith("ical:") ? row.logId.slice(5) : null);
      return muteFn({
        data: {
          ...(logId ? { logId } : {}),
          ...(reservationId ? { reservationId } : {}),
          kind,
          mutedUntil: hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null,
        },
      });
    },
    onSuccess: (_d, hours) => {
      toast.success(hours ? `Alertas silenciados por ${hours}h.` : "Alertas reativados.");
      qcCard.invalidateQueries({ predicate: (q) => q.queryKey[0] === "dash-list", refetchType: "active" });
    },
    onError: () => toast.error("Não foi possível alterar o silenciamento."),
  });

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
      className={`group relative snap-start flex flex-col rounded-[0.3rem] bg-secondary/70 hover:bg-secondary/90 p-3 gap-2.5 transition-colors ${
        isOverdue && !visualDone
          ? "border-l-[3px] border-l-red-500"
          : isFuture && !visualDone
            ? "border-l-[3px] border-l-amber-500"
            : ""
      }`}
    >
      {(isOverdue || isFuture) && !visualDone && (
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              isOverdue
                ? "bg-red-500/15 text-red-600 dark:text-red-400"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            }`}
          >
            <AlertTriangle className="size-2.5" /> {isOverdue ? "Atrasado" : "Data futura"}
          </span>
        </div>
      )}

      {/* Header: nome + imóvel + data — sem avatar (ocupava espaço demais
          numa coluna estreita de Kanban; o nome já identifica o hóspede). */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <OwnerLine
            name={row.ownerName}
            phone={row.ownerPhone}
            country={row.ownerPhoneCountry}
            phonePosition="adjacent"
          />
          <div className="ds-card-title truncate" title={row.propertyName ?? undefined}>
            {row.propertyName ?? "Sem nome"}
          </div>

          <div
            className={`text-xs flex items-center gap-1 ${isPendingFill ? "text-orange-500 font-medium" : "text-muted-foreground"}`}
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
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <ExtraGuests guests={row.additionalGuests ?? []} />
                <span className="min-w-0 truncate">{row.guestName}</span>
                <PhoneLink phone={row.guestPhone} country={row.guestPhoneCountry} />
              </span>
            )}
          </div>

          {/* Período + código da reserva na mesma linha — "17/08 → 21/08  HMSFBXFHYX" */}
          <div className="mt-1 flex items-center gap-1.5 text-xs tabular-nums text-foreground/80 flex-wrap">
            <DateEditor
              value={row.guestCheckin}
              disabled={busy || isPendingFill}
              onChange={(v) => onEditDates(row, { checkinDate: v })}
            />
            {row.guestCheckout && (
              <>
                <span className="text-muted-foreground">→</span>
                <DateEditor
                  value={row.guestCheckout}
                  disabled={busy || isPendingFill}
                  onChange={(v) => onEditDates(row, { checkoutDate: v })}
                />
              </>
            )}
            {row.reservationCode && (isPendingFill || (row.guestName && row.guestName !== row.reservationCode)) && (
              <span className="ds-meta inline-flex items-center gap-0.5 rounded-md bg-secondary px-1.5 py-0.5">
                <span className="truncate max-w-[160px]">{row.reservationCode}</span>
                <CopyButton value={row.reservationCode} size={10} className="p-0.5" />
              </span>
            )}
          </div>
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
              {/* Padrão / Previsto — cada um em uma linha só, rótulo à
                  esquerda e valor à direita, bem mais compacto que os dois
                  quadrados empilhados de antes. */}
              {mode !== "cleaning" && (
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-background/50 border border-border/40 px-2.5 py-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                      Padrão
                      <InfoHint title="Horário padrão">
                        Janela configurada na propriedade. Base para detectar divergências.
                      </InfoHint>
                    </span>
                    <span className="tabular-nums font-medium truncate">{stdWindow ?? "—"}</span>
                  </div>
                  <div
                    className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 ${divergent ? "bg-amber-500/10 border border-amber-500/30" : "bg-background/50 border border-border/40"}`}
                  >
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
                      Previsto
                      <InfoHint title="Horário previsto">
                        Selecione o horário (30 em 30 min). A alteração reordena o kanban imediatamente.
                      </InfoHint>
                    </span>
                    <span className="w-24 shrink-0">
                      <TimeDropdown value={guestTime ?? null} disabled={busy} onChange={(v) => onEditTime(row, v)} />
                    </span>
                  </div>
                </div>
              )}

              {/* Engagement — só mostra pendências (fatos negativos). */}
              {mode !== "cleaning" && !isPendingFill && (
                <EngagementFlags
                  openedGuide={row.openedGuide}
                  readInstructions={row.readInstructions}
                  hasPasswords={row.hasPasswords}
                  viewedPasswords={row.viewedPasswords}
                  variant="pills"
                />
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
                className="text-xs px-3 py-1 rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
                disabled={busy}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action row: botão principal em largura total; Maps + menu à direita */}
      <div className="mt-auto flex flex-nowrap items-center gap-2 pt-1">
        {mode === "done" ? (
          <span
            title="Esteira concluída"
            aria-label="Esteira concluída"
            className="inline-flex flex-1 min-w-0 h-9 items-center justify-center gap-2 px-3 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-xs font-semibold"
          >
            <CheckCircle2 className="size-4 shrink-0" />
            <span className="truncate">Concluído</span>
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
            className={`flex-1 min-w-0 h-9 max-h-9 min-h-9 self-center box-border leading-none inline-flex items-center justify-center gap-2 px-3 text-[12.5px] font-semibold tracking-tight rounded-lg transition-all active:scale-[0.99] ${
              cleaningBlock
                ? "bg-orange-500/25 text-orange-700 dark:text-orange-400 border border-orange-500/50 cursor-not-allowed"
                : blockCheck
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/40 cursor-not-allowed"
                  : mode === "cleaning"
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : done
                      ? "bg-secondary text-foreground/80 hover:bg-secondary/80"
                      : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            <Check className="size-4 shrink-0" />
            <span className="truncate">
              {mode === "cleaning"
                ? "Limpeza concluída!"
                : mode === "checkout"
                  ? "Check-out realizado!"
                  : done
                    ? "Reabrir"
                    : "Check-in realizado!"}
            </span>
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
            className="size-9 shrink-0 grid place-items-center rounded-lg bg-secondary hover:bg-secondary/80 border border-border/60 transition-colors"
          >
            <Undo2 className="size-4" />
          </button>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {mapsHref && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Opções do Maps"
                  title={row.garageMapsUrl ? "Garagem no Maps" : "Endereço no Maps"}
                  className="size-9 grid place-items-center rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08]"
                >
                  <MapPin className="size-4" />
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
          )}

          {/* Nota + Silenciar juntos num só botão de menu, agora ao lado
                direito do Maps. O menu principal mostra só 2 opções —
                "Adicionar nota" e "Silenciar notificações" — e as 24 opções
                de período ficam escondidas num submenu, só aparecendo ao
                passar/tocar em "Silenciar notificações". */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Mais opções"
                title="Nota interna e alertas"
                className={`size-9 grid place-items-center rounded-lg border ${
                  isMutedNow
                    ? "bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400"
                    : "bg-background/60 border-border/50 hover:bg-primary/[0.08]"
                }`}
              >
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[13rem]">
              <DropdownMenuItem onClick={() => setNoteOpen((v) => !v)}>
                <StickyNote className="size-3.5 shrink-0" /> {row.note ? "Editar nota" : "Adicionar nota"}
              </DropdownMenuItem>
              {isMutedNow ? (
                <DropdownMenuItem onClick={() => mute.mutate(null)}>
                  <Bell className="size-3.5 shrink-0" /> Reativar alertas
                </DropdownMenuItem>
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <BellOff className="size-3.5 shrink-0" /> Silenciar notificações
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto min-w-[10rem]">
                    {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                      <DropdownMenuItem key={h} onClick={() => mute.mutate(h)}>
                        <BellOff className="size-3.5 shrink-0" /> Por {h}h
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
              className="text-xs px-3 py-2 rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
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
            className={`tabular-nums text-xs justify-center ${value === t ? "bg-accent/10 text-accent font-medium" : ""}`}
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
