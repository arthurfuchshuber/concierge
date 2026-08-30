import { PhoneActionButton } from "@/components/PhoneActionButton";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";
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
  Bell,
  BellOff,
  ChevronDown,
  UserPlus,
  MapPin,
  Link as LinkIcon,
  Copy,
  Share2,
  KeyRound,
  Eye,
  ListChecks,
  Trash2,
  BedDouble,
  CheckCircle2,
  Undo2,
  MoreVertical,
  Banknote,
  CalendarRange,
  User,
  Eraser,
  Filter,
  ChevronRight,
  ChevronLeft,
  Camera,
  LayoutList,
  LayoutGrid,
  Navigation,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { format, parse, isValid, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { toBlob } from "html-to-image";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar as RangeCalendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
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
  getCleaningStats,
  type ArrivalRow,
  type CleaningBreakdownItem,
  type CleaningDailyPoint,
} from "@/lib/dashboard.functions";
import {
  listTaskLinkOptions,
  listTasks,
  createTask,
  setTaskStatus,
  toggleCleaningCompletion,
} from "@/lib/tasks.functions";
import type { TaskRow, TaskCompletion, TaskLinkProperty, TaskLinkOwner, TaskCategory, TaskPriority } from "@/lib/tasks-types";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
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

/**
 * ISO "YYYY-MM-DD" → Date ao meio-dia LOCAL (não UTC) — evita cair no dia
 * errado perto da meia-noite dependendo do fuso do navegador. Mesma
 * convenção já usada alhures neste arquivo (ex.: `${row.date}T12:00:00`).
 */
function parseISODateLocal(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}
/** Date (fuso local) → ISO "YYYY-MM-DD". */
function dateToISOLocal(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Centavos → "R$ X,XX" (mesma convenção usada para hourly_rate_cents). */
function centsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/* ---------- Ordenação de checkouts (pedido explícito) ---------- */

/** Distância em metros entre duas coordenadas (fórmula de haversine). */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * Mapa `propriedade|data` → horário previsto do check-in daquele dia (ou
 * `null` se houver check-in sem horário definido) — usado só pra decidir se
 * um checkout "cruza" com uma chegada no mesmo imóvel no mesmo dia (giro).
 * Quando há mais de um check-in no mesmo imóvel/dia (raro), fica o mais cedo.
 */
function buildSameDayCheckinLookup(checkinRowSources: ArrivalRow[][]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const rows of checkinRowSources) {
    for (const r of rows) {
      const key = `${r.propertyId}|${r.date}`;
      const t = r.arrivalTimeOverride ?? r.guestArrivalTime ?? null;
      if (!map.has(key)) {
        map.set(key, t);
      } else {
        const cur = map.get(key) ?? null;
        if (t && (!cur || t < cur)) map.set(key, t);
      }
    }
  }
  return map;
}

/**
 * Encadeia os itens de um grupo empatado pelo vizinho mais próximo (rota
 * curta): parte do primeiro item do grupo e, a cada passo, escolhe entre os
 * restantes aquele que está mais perto do ÚLTIMO item já encadeado — não do
 * primeiro. Pedido explícito, com exemplo real: "casa da Patrícia" → o
 * próximo deve ser quem está mais perto DELA (ex.: "casa do Arthur"), e o
 * seguinte, mais perto do Arthur (ex.: "studio da Eliete") — não uma
 * propriedade distante só porque pertence a um grupo com mais unidades
 * (ex.: vários "studios do Clayton" longe dali). Isso também garante que
 * imóveis no mesmo endereço apareçam juntos (distância ~0 = sempre o
 * próximo escolhido). Imóveis sem coordenada cadastrada não competem nesse
 * critério; ficam ao final do grupo, na ordem que já tinham.
 */
function clusterByProximity(group: ArrivalRow[]): ArrivalRow[] {
  if (group.length <= 2) return group;
  const withCoords = group.filter((r) => r.lat != null && r.lng != null);
  const withoutCoords = group.filter((r) => r.lat == null || r.lng == null);
  if (withCoords.length <= 1) return group;

  const remaining = [...withCoords];
  const chain: ArrivalRow[] = [remaining.shift() as ArrivalRow];
  while (remaining.length > 0) {
    const last = chain[chain.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const cand = remaining[k];
      const d = haversineMeters({ lat: last.lat as number, lng: last.lng as number }, { lat: cand.lat as number, lng: cand.lng as number });
      if (d < bestDist) {
        bestDist = d;
        bestIdx = k;
      }
    }
    chain.push(remaining.splice(bestIdx, 1)[0]);
  }
  return [...chain, ...withoutCoords];
}

/**
 * Ordenação dos checkouts (pedido explícito), em ordem de prioridade:
 * 1) imóvel com check-in previsto no MESMO dia (giro) sobe pro topo;
 * 2) dentro do giro, pelo horário previsto do check-in que está chegando
 *    (mais cedo primeiro);
 * 3) o que sobrar (inclusive quem não tem giro) pelo horário previsto do
 *    próprio checkout (mais cedo primeiro);
 * 4) o que ainda estiver empatado, por proximidade de endereço — encadeado
 *    pelo vizinho mais próximo do ÚLTIMO imóvel já ordenado (rota curta),
 *    não pelo tamanho do grupo de imóveis vizinhos.
 * `checkinRowSources` recebe TODAS as fontes de check-in relevantes pro
 * mesmo período das linhas de checkout (não só as pendentes: um giro conta
 * mesmo que o check-in já tenha sido marcado feito).
 */
function sortCheckoutRows(rows: ArrivalRow[], checkinRowSources: ArrivalRow[][]): ArrivalRow[] {
  const sameDayCheckin = buildSameDayCheckinLookup(checkinRowSources);
  const ownTime = (r: ArrivalRow) => r.arrivalTimeOverride ?? r.guestArrivalTime ?? null;
  const turnoverKey = (r: ArrivalRow) => `${r.propertyId}|${r.date}`;
  const hasTurnover = (r: ArrivalRow) => sameDayCheckin.has(turnoverKey(r));
  const turnoverTime = (r: ArrivalRow) => sameDayCheckin.get(turnoverKey(r)) ?? null;
  const compareTimes = (ta: string | null, tb: string | null) => {
    if (ta === tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return ta.localeCompare(tb);
  };
  const cmp = (a: ArrivalRow, b: ArrivalRow) => {
    const ga = hasTurnover(a) ? 0 : 1;
    const gb = hasTurnover(b) ? 0 : 1;
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      const c = compareTimes(turnoverTime(a), turnoverTime(b));
      if (c !== 0) return c;
    }
    return compareTimes(ownTime(a), ownTime(b));
  };
  const sorted = [...rows].sort(cmp);
  const result: ArrivalRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && cmp(sorted[i], sorted[j]) === 0) j++;
    result.push(...clusterByProximity(sorted.slice(i, j)));
    i = j;
  }
  return result;
}

/* ---------- Info tooltip ---------- */
function InfoHint({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={title ? `Sobre: ${title}` : "Mais informações"}
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
        {title && (
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</div>
        )}
        <div className="text-foreground/90">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Alterna "Completo" / "Lista" — pedido explícito para facilitar a
 * visualização dentro dos popups de card (4 KPIs do Dashboard) e do
 * tooltip "quais imóveis" da Limpeza. Puramente visual: quem controla o
 * estado é o componente pai (via `value`/`onChange`).
 */
function ViewModeToggle({
  value,
  onChange,
}: {
  value: "full" | "list";
  onChange: (v: "full" | "list") => void;
}) {
  return (
    // Mesma curva padrão (0.3rem) usada nos demais cards/quadrantes do app
    // (pedido explícito) — antes era rounded-md (6px), destoando do resto.
    <div className="inline-flex items-center rounded-[0.3rem] border border-border/60 bg-secondary/30 p-0.5 text-[11px]">
      <button
        type="button"
        onClick={() => onChange("full")}
        className={`inline-flex items-center gap-1 rounded-[0.2rem] px-2 py-1 transition-colors ${
          value === "full" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <LayoutGrid className="size-3" />
        Completo
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        className={`inline-flex items-center gap-1 rounded-[0.2rem] px-2 py-1 transition-colors ${
          value === "list" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <LayoutList className="size-3" />
        Lista
      </button>
    </div>
  );
}

/**
 * Botão "tirar um print" (pedido explícito) — captura o container apontado
 * por `targetRef` como PNG. Ao clicar, abre um menu com duas opções:
 * "Salvar Imagem" (baixa o PNG) e "Copiar Imagem" (vai pra área de
 * transferência, pra colar direto em outro lugar). Usa `html-to-image`
 * (já não existia nenhuma lib de captura no projeto).
 */
function ScreenshotButton({
  targetRef,
  fileName,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  fileName: string;
}) {
  const [busy, setBusy] = useState(false);
  const captureBlob = useCallback(async (): Promise<Blob | null> => {
    const node = targetRef.current;
    if (!node) return null;
    return await toBlob(node, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0a",
    });
  }, [targetRef]);
  const handleSave = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await captureBlob();
      if (!blob) throw new Error("sem conteúdo");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `${fileName}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Não foi possível salvar a imagem. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }, [captureBlob, fileName, busy]);
  const handleCopy = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = await captureBlob();
      if (!blob) throw new Error("sem conteúdo");
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("Área de transferência não suportada");
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast.success("Imagem copiada — já pode colar em outro lugar.");
    } catch {
      toast.error("Não foi possível copiar a imagem. Tente 'Salvar Imagem'.");
    } finally {
      setBusy(false);
    }
  }, [captureBlob, busy]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          title="Tirar um print"
          aria-label="Tirar um print"
          // Mesma curva padrão (0.3rem) do quadrante Completo/Lista ao lado.
          className="inline-flex items-center justify-center rounded-[0.3rem] border border-border/60 bg-secondary/30 p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[10rem]">
        <DropdownMenuItem onClick={handleSave}>
          <Download className="size-3.5 shrink-0" /> Salvar Imagem
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopy}>
          <Copy className="size-3.5 shrink-0" /> Copiar Imagem
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// O calendário de ocupação (antes uma aba própria, "calendario") passou a
// viver dentro do "resumo" (Dashboard) — ver <OccupancyPanel> logo abaixo
// dos cards, no bloco "view === 'resumo'". A rota /admin/dashboard/calendario
// agora só redireciona pra lá; não existe mais uma tela própria pra ela.
export type OperationView = "resumo" | "kanban" | "limpeza";

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
  const cleaningStatsFn = useServerFn(getCleaningStats);
  const taskLinkOptionsFn = useServerFn(listTaskLinkOptions);
  const listTasksFn = useServerFn(listTasks);
  const createTaskFn = useServerFn(createTask);
  const setTaskStatusFn = useServerFn(setTaskStatus);
  const toggleCleaningFn = useServerFn(toggleCleaningCompletion);

  const [range, setRange] = useState<"today" | "tomorrow" | "7d" | "all">("today");
  // Qual coluna do Kanban está ativa no mobile (lá o quadro vira abas — não
  // cabem as 5 colunas lado a lado). No desktop não é usado; as 5 colunas
  // aparecem todas ao mesmo tempo.
  const [mobileTab, setMobileTab] = useState<BoardMode>("checkin");
  // Largura das colunas do Kanban (desktop) — calculada de verdade a partir
  // do espaço disponível, não um número fixo. Cabe quantas colunas couberem
  // numa largura mínima confortável, e essas colunas esticam pra preencher o
  // espaço TODO, sem sobrar vão nem cortar a próxima coluna pela metade —
  // reage ao recolher/expandir o menu lateral e a mudanças de tela.
  // Mínima elevada de 240px para 320px (240 + 1/3 dela) — com 240px os cards
  // ficavam espremidos quando cabiam 5 colunas lado a lado; agora, se não
  // houver espaço pras 5 nessa largura, menos colunas aparecem (com scroll
  // horizontal), mas nenhuma fica mais estreita que 320px.
  const kanbanRowRef = useRef<HTMLDivElement>(null);
  const [kanbanColWidth, setKanbanColWidth] = useState(320);
  useLayoutEffect(() => {
    const el = kanbanRowRef.current;
    if (!el) return;
    const GAP = 12; // gap-3
    const MIN_COL = 320;
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
  // Pergunta obrigatória ao concluir uma limpeza: qual tipo foi realizado
  // (normal/completa) — feita no momento do avanço, nunca configurada antes.
  // O valor escolhido é gravado (snapshot do preço vigente do imóvel) e
  // alimenta os cards "Limpezas Realizadas"/"Custo Total Limpeza".
  const [cleaningTypePrompt, setCleaningTypePrompt] = useState<{ row: ArrivalRow } | null>(null);
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
  // Pedido explícito: no Kanban, o antigo seletor "Hoje/Amanhã/7 dias/Todos"
  // virou o mesmo botão "Filtros" (Período/Cidade/Proprietário) do
  // Dashboard/Limpeza — só que aqui ele filtra as LISTAS do próprio quadro,
  // não o `range` acima (que continua fixo em "hoje" e só alimenta os
  // cards do Dashboard, como confirmado explicitamente — o Dashboard deve
  // manter só as informações que já estão nos cards, sem o seletor).
  // Por isso o Kanban busca TODAS as reservas (sem janela de tempo) e
  // filtra no cliente por período/cidade/proprietário mais abaixo.
  const kanbanCheckinListQ = useQuery({
    queryKey: ["dash-list", "checkin", "all", activeOwnerId ?? "self", "kanban-filtros"],
    queryFn: () => listFn({ data: { kind: "checkin", range: "all", ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: view === "kanban",
  });
  const kanbanCheckoutListQ = useQuery({
    queryKey: ["dash-list", "checkout", "all", activeOwnerId ?? "self", "kanban-filtros"],
    queryFn: () => listFn({ data: { kind: "checkout", range: "all", ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: view === "kanban",
  });
  const concludedQ = useQuery({
    queryKey: ["dash-list", "concluded", activeOwnerId ?? "self"],
    queryFn: () => concludedFn({ data: { ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  // Filtros de Período/Proprietário/Cidade — controlam TANTO a agenda de
  // ocupação quanto os cards "Limpezas Realizadas"/"Custo Total Limpeza"
  // logo acima dela (pedido explícito: os filtros afetam os dois). Sem
  // período escolhido (null), cada um usa seu próprio padrão: a agenda
  // mostra os 21 dias a partir de hoje (como sempre foi) e os cards de
  // limpeza somam só "Hoje" (mesmo padrão "tempo real" dos outros KPIs) —
  // só divergem quando o usuário escolhe um período explícito, aí os dois
  // passam a usar exatamente o intervalo escolhido.
  const [periodRange, setPeriodRange] = useState<{ start: string; end: string } | null>(null);
  const [ownerFilters, setOwnerFilters] = useState<string[]>([]);
  const [cityFilters, setCityFilters] = useState<string[]>([]);
  const hasCustomFilters = !!periodRange || ownerFilters.length > 0 || cityFilters.length > 0;
  function clearAllFilters() {
    setPeriodRange(null);
    setOwnerFilters([]);
    setCityFilters([]);
  }

  const occStart = periodRange?.start ?? todayISOSaoPaulo();
  const occDays = periodRange
    ? Math.min(90, Math.max(3, differenceInCalendarDays(parseISODateLocal(periodRange.end), parseISODateLocal(periodRange.start)) + 1))
    : 21;
  const occupancyQ = useQuery({
    queryKey: ["dash-occupancy", activeOwnerId ?? "self", occStart, occDays],
    queryFn: () => occupancyFn({ data: { ownerId: activeOwnerId, days: occDays, start: occStart } }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // Propriedades (id/nome/cidade/proprietário) já vêm da própria agenda —
  // reaproveitadas aqui pra montar as opções dos filtros e resolver quais
  // property_id batem com Proprietário/Cidade selecionados (pra filtrar
  // tanto a tabela da agenda quanto os cards de limpeza abaixo).
  const occupancyProperties: Array<{ id: string; name: string; city: string | null; ownerName?: string | null }> =
    occupancyQ.data?.properties ?? [];
  const ownerOptions = useMemo(() => {
    const names: string[] = occupancyProperties
      .map((p) => p.ownerName)
      .filter((v): v is string => !!v);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [occupancyProperties]);
  const cityOptions = useMemo(() => {
    const names: string[] = occupancyProperties.map((p) => p.city).filter((v): v is string => !!v);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [occupancyProperties]);
  const matchesOwnerCity = useCallback(
    (p: { ownerName?: string | null; city?: string | null }) =>
      (ownerFilters.length === 0 || (p.ownerName && ownerFilters.includes(p.ownerName))) &&
      (cityFilters.length === 0 || (p.city && cityFilters.includes(p.city))),
    [ownerFilters, cityFilters],
  );
  const filteredOccupancyProperties = useMemo(
    () => occupancyProperties.filter(matchesOwnerCity),
    [occupancyProperties, matchesOwnerCity],
  );
  // ids que batem com Proprietário/Cidade — só enviado ao servidor quando
  // algum desses 2 filtros está ativo (sem filtro, o servidor já usa todos
  // os imóveis acessíveis da conta, sem precisar listar id por id).
  const cleaningStatsPropertyIds = useMemo(
    () => (ownerFilters.length > 0 || cityFilters.length > 0 ? filteredOccupancyProperties.map((p) => p.id) : undefined),
    [ownerFilters, cityFilters, filteredOccupancyProperties],
  );
  const cleaningStatsRange = periodRange ?? { start: todayISOSaoPaulo(), end: todayISOSaoPaulo() };
  const cleaningStatsQ = useQuery({
    queryKey: [
      "dash-cleaning-stats",
      activeOwnerId ?? "self",
      cleaningStatsRange.start,
      cleaningStatsRange.end,
      cleaningStatsPropertyIds?.join(",") ?? "",
    ],
    queryFn: () =>
      cleaningStatsFn({
        data: {
          ownerId: activeOwnerId,
          rangeStart: cleaningStatsRange.start,
          rangeEnd: cleaningStatsRange.end,
          propertyIds: cleaningStatsPropertyIds,
        },
      }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  // Gráficos da aba Limpeza (pedido explícito): usam o MESMO endpoint acima,
  // mas com uma janela própria — os cards de estatística mostram "Hoje" por
  // padrão (número em tempo real), enquanto os gráficos de tendência
  // precisam de vários dias pra fazer sentido. Sem período customizado, cai
  // nos últimos 7 dias; com período escolhido, os dois passam a usar
  // exatamente o mesmo intervalo (mesmo racional do cleaningStatsRange).
  const cleaningTrendRange = periodRange ?? {
    start: addDaysISO(todayISOSaoPaulo(), -6) ?? todayISOSaoPaulo(),
    end: todayISOSaoPaulo(),
  };
  const cleaningTrendQ = useQuery({
    queryKey: [
      "dash-cleaning-stats",
      activeOwnerId ?? "self",
      cleaningTrendRange.start,
      cleaningTrendRange.end,
      cleaningStatsPropertyIds?.join(",") ?? "",
    ],
    queryFn: () =>
      cleaningStatsFn({
        data: {
          ownerId: activeOwnerId,
          rangeStart: cleaningTrendRange.start,
          rangeEnd: cleaningTrendRange.end,
          propertyIds: cleaningStatsPropertyIds,
        },
      }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: view === "limpeza",
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
            return (
              k === "dash-list" ||
              k === "dash-kpis" ||
              k === "dash-eng" ||
              k === "dash-occupancy" ||
              k === "dash-cleaning-stats"
            );
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
    arrivalDateOverride?: string | null;
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
    mutationFn: (v: {
      logId?: string;
      reservationId?: string;
      from: "checkin" | "stay" | "checkout" | "cleaning";
      cleaningType?: "normal" | "completa";
    }) => advanceFn({ data: v }),
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
      // "Em Estadia" → confirma o check-out: o card sai da lista de chegadas e
      // passa a viver na esteira de saída/limpeza.
      else if (from === "stay") patchList("checkin", (rows) => rows.filter((r) => r.logId !== id));
      else if (from === "checkout") patchList("checkout", (rows) => setStatus(rows, "done"));
      else if (from === "cleaning") patchList("checkout", (rows) => rows.filter((r) => r.logId !== id));
    },
    [patchList],
  );

  function runAdvance(
    row: ArrivalRow,
    from: "checkin" | "stay" | "checkout" | "cleaning",
    cleaningType?: "normal" | "completa",
  ) {
    const target = statusTarget(row);
    if (!target.logId && !target.reservationId) {
      toast.error("Não foi possível identificar esse card. Atualize a página e tente novamente.");
      return;
    }
    setBusyRowId(row.logId);
    optimisticMove(row, from);
    advance.mutate({ ...target, from, ...(cleaningType ? { cleaningType } : {}) });
  }

  /**
   * Antecipar um card com data futura (ex.: "Checkouts amanhã") é uma ação
   * fora do fluxo normal — antes ela acontecia no primeiro clique e o card
   * simplesmente sumia da tela. Agora pede confirmação explícita e, ao
   * confirmar, o card segue para o status correto (Em Limpeza).
   */
  function handleAdvance(row: ArrivalRow, from: "checkin" | "stay" | "checkout" | "cleaning") {
    // Concluir uma limpeza sempre pergunta qual tipo foi realizado (normal ou
    // completa) — a escolha é feita NESTE momento, nunca antes, e alimenta o
    // snapshot de preço gravado no servidor.
    if (from === "cleaning") {
      setCleaningTypePrompt({ row });
      return;
    }
    // O card já pede confirmação de antecipação de check-out; aqui só o
    // check-in em data futura precisa do diálogo do quadro.
    if (from === "checkin" && row.date > todayISO) {
      setConfirmAdvance({ row, from });
      return;
    }
    runAdvance(row, from);
  }

  function handleEditTime(row: ArrivalRow, k: "checkin" | "checkout", time: string | null) {
    setBusyRowId(row.logId);
    // Otimista: o campo já mostra o novo horário na hora — o servidor só
    // confirma em segundo plano (mesmo racional do optimisticMove acima).
    patchList(k, (rows: ArrivalRow[]) =>
      rows.map((r) => (r.logId === row.logId ? { ...r, arrivalTimeOverride: time } : r)),
    );
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
  // Fonte de check-ins pro critério de "giro" (regras 1-2 da ordenação de
  // checkouts) — TODOS os check-ins do período (pendentes ou já feitos: o
  // giro conta mesmo que o check-in já tenha sido marcado), cobrindo tanto o
  // período do `range` atual quanto amanhã (usado pelos checkouts antecipados
  // de "Em Limpeza").
  const turnoverCheckinSources = useMemo(
    () => [ciRows, tomorrowCheckinListQ.data?.rows ?? []],
    [ciRows, tomorrowCheckinListQ.data?.rows],
  );
  const checkoutPendingRows = useMemo(
    () => sortCheckoutRows(coRows.filter((r) => r.status === "pending"), turnoverCheckinSources),
    [coRows, turnoverCheckinSources],
  );
  const rawTomorrowCheckinPendingRows = useMemo(
    () => (tomorrowCheckinListQ.data?.rows ?? []).filter((r) => r.status === "pending"),
    [tomorrowCheckinListQ.data?.rows],
  );
  const tomorrowCheckoutPendingRows = useMemo(
    () =>
      sortCheckoutRows(
        (tomorrowCheckoutListQ.data?.rows ?? []).filter((r) => r.status === "pending"),
        turnoverCheckinSources,
      ),
    [tomorrowCheckoutListQ.data?.rows, turnoverCheckinSources],
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
    return sortCheckoutRows([...done, ...early], turnoverCheckinSources);
  }, [coRows, tomorrowCheckoutListQ.data?.rows, turnoverCheckinSources]);

  const concludedRows = concludedQ.data?.rows ?? [];
  // Imóveis com check-out pendente OU limpeza em andamento bloqueiam novos
  // check-ins até serem concluídos (evita liberar hóspede em imóvel ainda
  // ocupado pelo hóspede anterior ou ainda sujo).
  const cleaningPendingPropIds = useMemo(() => {
    const blocked = new Map<string, "checkout" | "cleaning">();
    for (const r of coRows) {
      if (r.status === "pending") blocked.set(r.propertyId, "checkout");
      else if (r.status === "done" && !blocked.has(r.propertyId)) blocked.set(r.propertyId, "cleaning");
    }
    // Imóvel com hóspede ainda "Em Estadia" também não libera novo check-in:
    // a esteira é sequencial (chegada → estadia → saída → limpeza → concluído).
    for (const r of stayRows) {
      if (!blocked.has(r.propertyId)) blocked.set(r.propertyId, "checkout");
    }
    // Checkouts antecipados (vindos da lista de amanhã) ficam em "Em Limpeza"
    // e não aparecem em coRows — sem isso o imóvel liberava check-in mesmo com
    // a limpeza da estadia anterior em aberto.
    for (const r of cleaningRows) {
      if (!blocked.has(r.propertyId)) blocked.set(r.propertyId, "cleaning");
    }
    return blocked;
  }, [coRows, cleaningRows, stayRows]);

  /**
   * Ordenação dos cards de chegada:
   * 1) imóveis já liberados para check-in acima de qualquer um ainda com
   *    checkout/limpeza pendente — bloqueado NUNCA compete por horário, fica
   *    sempre abaixo dos liberados (mesmo racional do botão bloqueado no
   *    Kanban: enquanto o imóvel não libera, o check-in nem entra na
   *    "disputa" de prioridade).
   * 2) horário previsto de chegada (mais cedo primeiro; sem horário vai por último)
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
        const rankDiff = blockedRank(a) - blockedRank(b);
        if (rankDiff !== 0) return rankDiff;
        const ta = time(a);
        const tb = time(b);
        if (ta && tb && ta !== tb) return ta.localeCompare(tb);
        if (!!ta !== !!tb) return ta ? -1 : 1;
        return txt(a.ownerName, b.ownerName) || txt(a.propertyName, b.propertyName);
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

  /**
   * Listas do Kanban, filtradas pelo botão "Filtros" (Período/Cidade/
   * Proprietário) — ver kanbanCheckinListQ/kanbanCheckoutListQ acima.
   * `cleaningPendingPropIds` (bloqueio de check-in) continua vindo do
   * `coRows`/`stayRows` de HOJE, de propósito: reflete o estado ATUAL do
   * imóvel, não deve mudar só porque a pessoa navegou pra outro período no
   * Kanban.
   */
  const propertyCityById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const p of occupancyProperties) map.set(p.id, p.city ?? null);
    return map;
  }, [occupancyProperties]);

  const matchesKanbanOwnerCity = useCallback(
    (r: ArrivalRow) => {
      if (ownerFilters.length > 0 && !(r.ownerName && ownerFilters.includes(r.ownerName))) return false;
      if (cityFilters.length > 0) {
        const city = propertyCityById.get(r.propertyId);
        if (!city || !cityFilters.includes(city)) return false;
      }
      return true;
    },
    [ownerFilters, cityFilters, propertyCityById],
  );

  /**
   * "Limpeza Prevista 7d" (pedido explícito) — diferente do histórico
   * (`getCleaningStats`, baseado em `concluded_at`), aqui a base são os
   * CHECKOUTS AGENDADOS (ainda pendentes) pros próximos 7 dias: cada
   * checkout previsto vira uma limpeza esperada naquele dia. Reaproveita a
   * mesma lista/lógica de "Checkouts" (iCal, gating etc.) via `listFn`, só
   * que com `range: "7d"` (hoje → hoje+6).
   * Custo: como o tipo de limpeza (normal/completa) só é escolhido na hora
   * de concluir, o valor aqui é uma ESTIMATIVA usando o preço da limpeza
   * normal de cada imóvel (pedido explícito) — nunca um valor fechado.
   */
  const cleaningForecastListQ = useQuery({
    queryKey: ["dash-list", "checkout", "7d-forecast", activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkout", range: "7d", ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: view === "limpeza",
  });
  const cleaningForecast = useMemo(() => {
    const today = todayISOSaoPaulo();
    const daily: CleaningDailyPoint[] = Array.from({ length: 7 }, (_, i) => ({
      date: addDaysISO(today, i) ?? today,
      count: 0,
      totalCents: 0,
    }));
    const dailyByDate = new Map(daily.map((p) => [p.date, p]));
    const lastDate = daily[daily.length - 1]?.date ?? today;
    const rows = (cleaningForecastListQ.data?.rows ?? []).filter(
      (r) => r.status === "pending" && r.date >= today && r.date <= lastDate && matchesKanbanOwnerCity(r),
    );
    const byProperty = new Map<string, CleaningBreakdownItem>();
    for (const r of rows) {
      const estimate = r.cleaningPriceNormalCents ?? 0;
      const point = dailyByDate.get(r.date);
      if (point) {
        point.count += 1;
        point.totalCents += estimate;
      }
      const cur = byProperty.get(r.propertyId) ?? {
        propertyId: r.propertyId,
        propertyName: r.propertyName ?? "Imóvel",
        ownerName: r.ownerName ?? null,
        propertyAddress: r.propertyAddress ?? null,
        mapsUrl: r.mapsUrl ?? null,
        garageMapsUrl: r.garageMapsUrl ?? null,
        count: 0,
        totalCents: 0,
      };
      cur.count += 1;
      cur.totalCents += estimate;
      byProperty.set(r.propertyId, cur);
    }
    const breakdown = Array.from(byProperty.values()).sort(
      (a, b) => b.count - a.count || a.propertyName.localeCompare(b.propertyName, "pt-BR"),
    );
    return {
      daily,
      breakdown,
      cleaningsExpected: rows.length,
      estimatedTotalCents: rows.reduce((sum: number, r: ArrivalRow) => sum + (r.cleaningPriceNormalCents ?? 0), 0),
    };
  }, [cleaningForecastListQ.data?.rows, matchesKanbanOwnerCity]);
  const [forecastOpen, setForecastOpen] = useState(false);

  // ---------------------------------------------------------------------
  // Tarefas/Pendências — botão "PENDÊNCIAS" (Kanban, ao lado de "Filtros")
  // + checklist no card de Limpeza. Uma única query serve os dois usos:
  // o dialog usa a lista inteira; o checklist do card filtra client-side
  // pelas marcadas "aparece na limpeza".
  // ---------------------------------------------------------------------
  const [pendenciasOpen, setPendenciasOpen] = useState(false);
  const tasksQ = useQuery({
    queryKey: ["dash-tasks", activeOwnerId ?? "self"],
    queryFn: () => listTasksFn({ data: { ownerId: activeOwnerId } }),
    staleTime: 15_000,
  });
  const openTasksCount = useMemo(
    () => (tasksQ.data?.tasks ?? []).filter((t) => t.status === "pending").length,
    [tasksQ.data],
  );
  const taskLinkOptionsQ = useQuery({
    queryKey: ["dash-task-link-options", activeOwnerId ?? "self"],
    queryFn: () => taskLinkOptionsFn({ data: { ownerId: activeOwnerId } }),
    staleTime: 60_000,
    enabled: pendenciasOpen,
  });
  const invalidateTasks = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["dash-tasks", activeOwnerId ?? "self"] });
  }, [qc, activeOwnerId]);
  const createTaskMutation = useMutation({
    mutationFn: (v: {
      title: string;
      description?: string | null;
      category: TaskCategory;
      priority: TaskPriority;
      dueDate?: string | null;
      showInCleaning: boolean;
      propertyId?: string | null;
      ownerContactId?: string | null;
    }) => createTaskFn({ data: { ownerId: activeOwnerId, ...v } }),
    onSuccess: () => {
      invalidateTasks();
      toast.success("Pendência criada.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao criar pendência."),
  });
  const setTaskStatusMutation = useMutation({
    mutationFn: (v: { taskId: string; status: "pending" | "done" | "canceled" }) => setTaskStatusFn({ data: v }),
    onSuccess: invalidateTasks,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar pendência."),
  });
  const toggleCleaningTaskMutation = useMutation({
    mutationFn: (v: { taskId: string; logId?: string | null; reservationId?: string | null }) =>
      toggleCleaningFn({ data: v }),
    onSuccess: invalidateTasks,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar checklist."),
  });

  // Sem período escolhido, mantém o padrão de "hoje" (mesma convenção já
  // usada pela agenda/cards de limpeza quando nenhum período é escolhido).
  // O período usado é sempre o da PRÓPRIA reserva (`row.date` já é a data
  // de check-in/checkout relevante pra cada lista), nunca a data em que o
  // registro foi criado ou editado.
  const kanbanPeriodStart = periodRange?.start ?? todayISO;
  const kanbanPeriodEnd = periodRange?.end ?? todayISO;

  const kanbanCiRowsAll = kanbanCheckinListQ.data?.rows ?? [];
  const kanbanCoRowsAll = kanbanCheckoutListQ.data?.rows ?? [];

  const kanbanCheckinPendingRows = useMemo(
    () =>
      sortCheckinRows(
        kanbanCiRowsAll.filter(
          (r) =>
            r.status === "pending" &&
            matchesKanbanOwnerCity(r) &&
            r.date >= kanbanPeriodStart &&
            r.date <= kanbanPeriodEnd,
        ),
      ),
    [kanbanCiRowsAll, matchesKanbanOwnerCity, kanbanPeriodStart, kanbanPeriodEnd, sortCheckinRows],
  );
  const kanbanCheckoutPendingRows = useMemo(
    () =>
      sortCheckoutRows(
        kanbanCoRowsAll.filter(
          (r) =>
            r.status === "pending" &&
            matchesKanbanOwnerCity(r) &&
            r.date >= kanbanPeriodStart &&
            r.date <= kanbanPeriodEnd,
        ),
        // "all" range já cobre o período inteiro — inclusive giros com
        // check-in fora da janela filtrada no momento.
        [kanbanCiRowsAll],
      ),
    [kanbanCoRowsAll, matchesKanbanOwnerCity, kanbanPeriodStart, kanbanPeriodEnd, kanbanCiRowsAll],
  );
  // "Em Estadia" é sobre quem está hospedado AGORA — o período filtra pela
  // SOBREPOSIÇÃO da estadia com o intervalo escolhido (não só a data de
  // check-in), senão um período futuro nunca mostraria quem já está
  // hospedado desde antes.
  const kanbanStayRows = useMemo(
    () =>
      kanbanCiRowsAll.filter(
        (r) =>
          r.status === "done" &&
          (!r.guestCheckout || r.guestCheckout > todayISO) &&
          matchesKanbanOwnerCity(r) &&
          r.guestCheckin <= kanbanPeriodEnd &&
          (r.guestCheckout ?? r.guestCheckin) >= kanbanPeriodStart,
      ),
    [kanbanCiRowsAll, matchesKanbanOwnerCity, kanbanPeriodStart, kanbanPeriodEnd, todayISO],
  );
  const kanbanCleaningRows = useMemo(
    () =>
      kanbanCoRowsAll.filter(
        (r) => r.status === "done" && matchesKanbanOwnerCity(r) && r.date >= kanbanPeriodStart && r.date <= kanbanPeriodEnd,
      ),
    [kanbanCoRowsAll, matchesKanbanOwnerCity, kanbanPeriodStart, kanbanPeriodEnd],
  );
  // "Concluídos" nunca foi limitado por Hoje/Amanhã/7 dias/Todos (a busca de
  // concluídos já ignorava esse seletor antes) — só ganha os filtros de
  // Cidade/Proprietário agora, mantendo o mesmo comportamento de período.
  const kanbanConcludedRows = useMemo(
    () => concludedRows.filter(matchesKanbanOwnerCity),
    [concludedRows, matchesKanbanOwnerCity],
  );
  const kanbanCounts = {
    checkin: kanbanCheckinPendingRows.length,
    checkout: kanbanCheckoutPendingRows.length,
    stay: kanbanStayRows.length,
    cleaning: kanbanCleaningRows.length,
    done: kanbanConcludedRows.length,
  };

  const rangeLabel: Record<typeof range, string> = {
    today: "Hoje",
    tomorrow: "Amanhã",
    "7d": "7 dias",
    all: "Todos",
  };

  // Nome do hóspede de uma pendência "pontual" (vinculada a log/reserva) —
  // as pendências não guardam o nome, então cruzamos com as listas de
  // chegadas/saídas já carregadas no Kanban (best-effort: some se nenhuma
  // dessas listas tiver aquele log/reserva no momento).
  const guestNameByStayRef = useMemo(() => {
    const map = new Map<string, string>();
    const sources: ArrivalRow[][] = [
      kanbanCiRowsAll,
      kanbanCoRowsAll,
      concludedRows,
      tomorrowCheckinPendingRows,
      tomorrowCheckoutPendingRows,
    ];
    for (const rows of sources) {
      for (const r of rows) {
        if (r.logId) map.set(`log:${r.logId}`, r.guestName || "Hóspede");
        if (r.reservationId) map.set(`res:${r.reservationId}`, r.guestName || "Hóspede");
      }
    }
    return map;
  }, [kanbanCiRowsAll, kanbanCoRowsAll, concludedRows, tomorrowCheckinPendingRows, tomorrowCheckoutPendingRows]);
  function guestNameForTask(t: TaskRow): string {
    if (t.logId) return guestNameByStayRef.get(`log:${t.logId}`) ?? "Hóspede";
    if (t.reservationId) return guestNameByStayRef.get(`res:${t.reservationId}`) ?? "Hóspede";
    return "Hóspede";
  }
  // Tarefas que aparecem no checklist do card de Limpeza — repassadas pra
  // ArrivalGroup/ArrivalCard só quando colMode === "cleaning" (única coluna
  // que usa isso; as outras ignoram por completo).
  const cleaningTasksData = useMemo(
    () => ({ tasks: tasksQ.data?.tasks ?? [], completions: tasksQ.data?.completions ?? [] }),
    [tasksQ.data],
  );
  function handleToggleCleaningTask(task: TaskRow, row: ArrivalRow) {
    if (task.logId || task.reservationId) {
      // Pontual: o próprio status da pendência representa esta estadia.
      setTaskStatusMutation.mutate({ taskId: task.id, status: task.status === "done" ? "pending" : "done" });
    } else {
      // Recorrente: marca só esta ocorrência (log/reserva do card) — a
      // pendência em si continua ativa e volta pendente na próxima limpeza.
      toggleCleaningTaskMutation.mutate({ taskId: task.id, logId: row.logId, reservationId: row.reservationId });
    }
  }

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
      onEditPredictedDate: (row: ArrivalRow, date: string | null) => {
        setBusyRowId(row.logId);
        // Otimista, mesmo racional do handleEditTime/optimisticMove.
        patchList(colKind, (rows: ArrivalRow[]) =>
          rows.map((r) => (r.logId === row.logId ? { ...r, arrivalDateOverride: date } : r)),
        );
        upsert.mutate({ ...statusTarget(row), kind: colKind, arrivalDateOverride: date });
      },
      onEditTime: (row: ArrivalRow, time: string | null) => handleEditTime(row, colKind, time),
      // Limpa os dois campos (Data + Horário previstos) de uma vez —
      // botão só aparece quando pelo menos um dos dois estiver preenchido.
      onClearPredicted: (row: ArrivalRow) => {
        setBusyRowId(row.logId);
        patchList(colKind, (rows: ArrivalRow[]) =>
          rows.map((r) =>
            r.logId === row.logId ? { ...r, arrivalDateOverride: null, arrivalTimeOverride: null } : r,
          ),
        );
        upsert.mutate({
          ...statusTarget(row),
          kind: colKind,
          arrivalDateOverride: null,
          arrivalTimeOverride: null,
        });
      },
      busyRowId,
      // Antes "Estadia"/"Limpeza" ficavam com opacity-70 (pra parecer
      // menos urgente) — só que isso também fazia o card parecer menos card,
      // sem o mesmo peso visual dos outros. Agora todos têm o mesmo layout.
      muted: false,
      cleaningPendingPropIds,
      expandedId: expandedByColumn[colMode],
      onExpandedChange: (id: string | null) => setExpandedByColumn((prev) => ({ ...prev, [colMode]: id })),
      // Checklist de pendências — só a coluna de Limpeza usa isso de fato
      // (ArrivalCard ignora fora do modo "cleaning").
      cleaningTasks: colMode === "cleaning" ? cleaningTasksData : undefined,
      onToggleCleaningTask: colMode === "cleaning" ? handleToggleCleaningTask : undefined,
    };
  }

  // Painel de engajamento, agora no TOPO da página (antes dos cards de
  // check-ins/checkouts) — mesmo tratamento visual do mockup aprovado
  // (borda + gradiente radial roxo/rosa + acento lateral + rótulo com
  // ícone), só sem negrito nas frases. Some quando não há dado, igual já
  // era. No mobile continua sendo 1 card só com as 2 métricas juntas
  // (EngagementBars não muda por dentro) — só reposicionado. No desktop
  // quebra em 2 cards, um por métrica, lado a lado.
  const engagementCardBg =
    "radial-gradient(120% 140% at 0% 0%, rgba(168,85,247,0.16), transparent 55%), radial-gradient(120% 140% at 100% 100%, rgba(236,72,153,0.12), transparent 55%)";
  const engagementAccentBar = (
    <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-purple-500 to-pink-500" />
  );
  function renderEngagementTop() {
    const hasData = (engQ.data?.checkinsInPeriod ?? 0) > 0 || (engQ.data?.checkinsWithCodes ?? 0) > 0;
    if (!engQ.isLoading && !hasData) return null;

    const loading = engQ.isLoading;
    const pctOf = (num: number, total: number) => Math.min(100, Math.round((num / Math.max(total, 1)) * 100));
    const checkins = engQ.data?.checkinsInPeriod ?? 0;
    const checkinsWithCodes = engQ.data?.checkinsWithCodes ?? 0;
    const checkinBreakdown = engQ.data?.checkinBreakdown;
    const codesBreakdown = engQ.data?.codesBreakdown;
    const checkinViewed = checkinBreakdown?.viewed.length ?? 0;
    const codesViewed = codesBreakdown?.viewed.length ?? 0;
    const showCheckin = checkins > 0;
    const showCodes = checkinsWithCodes > 0;

    return (
      <>
        {/* Mobile: 1 card só, as 2 métricas juntas — estrutura interna
            idêntica à de sempre (EngagementBars não muda), só reposicionado
            pro topo e com o destaque do mockup. */}
        <div
          className="lg:hidden relative overflow-hidden rounded-lg border border-purple-300/30 bg-card p-4 shadow-[0_8px_24px_-12px_rgba(168,85,247,0.35)]"
          style={{ backgroundImage: engagementCardBg }}
        >
          {engagementAccentBar}
          <EngagementBars
            loading={loading}
            checkins={checkins}
            checkinsWithCodes={checkinsWithCodes}
            checkinBreakdown={checkinBreakdown}
            codesBreakdown={codesBreakdown}
          />
        </div>

        {/* Desktop: 2 cards separados, um por métrica, lado a lado. */}
        <div className="hidden lg:block">
          {loading ? (
            <div
              className="relative overflow-hidden rounded-lg border border-purple-300/30 bg-card py-6 text-center text-sm text-muted-foreground shadow-[0_8px_24px_-12px_rgba(168,85,247,0.35)]"
              style={{ backgroundImage: engagementCardBg }}
            >
              {engagementAccentBar}
              <Loader2 className="size-4 inline animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {showCheckin && (
                <div className={showCodes ? "col-span-2" : "col-span-4"}>
                  <EngagementCard
                    icon={ListChecks}
                    label="Viram instruções de check-in"
                    value={checkinViewed}
                    total={checkins}
                    pct={pctOf(checkinViewed, checkins)}
                    breakdown={checkinBreakdown}
                    hint='Hóspedes com check-in no período que já abriram as "Instruções" apresentadas na sessão "Chegada" pelo menos uma vez.'
                  />
                </div>
              )}
              {showCodes && (
                <div className={showCheckin ? "col-span-2" : "col-span-4"}>
                  <EngagementCard
                    icon={KeyRound}
                    label="Viram senha de acesso"
                    value={codesViewed}
                    total={checkinsWithCodes}
                    pct={pctOf(codesViewed, checkinsWithCodes)}
                    breakdown={codesBreakdown}
                    hint="Hóspedes com check-in no período que já visualizaram as senhas de acesso no guia pelo menos uma vez."
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    // Alinhado à esquerda (sem mx-auto): com o menu recolhido a área fica mais
    // larga e o centramento aumentava a margem esquerda.
    <div className="px-2.5 sm:px-5 lg:px-8 py-5 lg:py-8 max-w-[1440px] w-full space-y-1.5">
      <OperationShell view={view} />

      {view === "resumo" ? (
        <>
          {/* Engajamento do guia — fica no topo, antes de tudo (pedido
              explícito), com destaque. Ver renderEngagementTop acima. */}
          {renderEngagementTop()}

          {/* Grade única dos KPIs — a ordem visual diverge entre mobile e
              desktop (pedido explícito), então cada card carrega sua própria
              posição via classes "order" (mobile) e "lg:order" (desktop) em
              vez de duplicar o JSX.
              Pedido explícito (mais recente): os botões de filtro (Período,
              Cidade, Proprietário, limpar) saíram desta grade — viraram UM
              botão só (`CalendarFiltersButton`), ao lado do título
              "Calendário de ocupação" (ver dentro de `OccupancyPanel`
              abaixo). Isso também resolveu o pedido de trocar a ordem de
              "Em Estadia"/"Imóveis livres" com o calendário: agora o
              calendário vem ANTES desses dois cards, não depois.
              Mobile (grid-cols-2): pendentes → amanhã → liberado p/ limpeza
              → calendário → em estadia → imóveis livres. "Liberado para
              Limpeza" mantém o destaque âmbar (compact + `highlight="amber"`).
              "Limpezas Realizadas"/"Custo Total Limpeza" se mudaram pra aba
              própria "Limpeza" (não aparecem mais aqui).
              Desktop (lg:grid-cols-4): os 4 cards de pendentes/amanhã numa
              única linha → liberado p/ limpeza (faixa cheia) → calendário →
              em estadia e imóveis livres na linha seguinte. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
            <div className="order-1 lg:order-1">
              <KpiCard
                label="Check-ins Pendentes"
                rows={checkinPendingRows}
                icon={LogIn}
                tone="primary"
                loading={checkinListQ.isLoading}
                onRefresh={() => checkinListQ.refetch()}
                rangeLabel={rangeLabel[range]}
                // Azul claro enquanto houver pendência, verde quando zerar —
                // mesmo tom "in"/"in-pending" usado no calendário.
                shadowTone={checkinPendingRows.length > 0 ? "sky" : "emerald"}
                cardProps={arrivalGroupPropsFor("checkin", checkinPendingRows)}
              />
            </div>
            <div className="order-2 lg:order-2">
              <KpiCard
                label="Checkouts Pendentes"
                rows={checkoutPendingRows}
                icon={LogOut}
                tone="primary"
                loading={checkoutListQ.isLoading}
                onRefresh={() => checkoutListQ.refetch()}
                rangeLabel={rangeLabel[range]}
                // Laranja (mesmo tom do "out" no calendário) enquanto houver
                // pendência, verde quando zerar.
                shadowTone={checkoutPendingRows.length > 0 ? "amber" : "emerald"}
                cardProps={arrivalGroupPropsFor("checkout", checkoutPendingRows)}
              />
            </div>
            <div className="order-3 lg:order-3">
              <KpiCard
                label="Check-ins amanhã"
                rows={tomorrowCheckinPendingRows}
                icon={CalendarCheck}
                tone="primary-soft"
                loading={tomorrowCheckinListQ.isLoading}
                onRefresh={() => tomorrowCheckinListQ.refetch()}
                rangeLabel="Amanhã"
                cardProps={arrivalGroupPropsFor("checkin", tomorrowCheckinPendingRows)}
              />
            </div>
            <div className="order-4 lg:order-4">
              <KpiCard
                label="Checkouts amanhã"
                rows={tomorrowCheckoutPendingRows}
                icon={CalendarX}
                tone="primary-soft"
                loading={tomorrowCheckoutListQ.isLoading}
                onRefresh={() => tomorrowCheckoutListQ.refetch()}
                rangeLabel="Amanhã"
                cardProps={arrivalGroupPropsFor("checkout", tomorrowCheckoutPendingRows)}
              />
            </div>

            {/* Liberado para Limpeza — faixa fina, largura total (só quando
                houver 1+), mantendo o destaque âmbar (borda + gradiente +
                acento lateral). Fica logo depois dos 4 KPIs do topo. */}
            {cleaningRows.length > 0 ? (
              <div className="order-5 lg:order-5 col-span-2 lg:col-span-4">
                <KpiCard
                  label="Liberado para Limpeza"
                  rows={cleaningRows}
                  icon={Sparkles}
                  tone="primary-soft"
                  loading={checkoutListQ.isLoading}
                  onRefresh={() => checkoutListQ.refetch()}
                  rangeLabel={rangeLabel[range]}
                  compact
                  highlight="amber"
                  cardProps={arrivalGroupPropsFor("cleaning", cleaningRows)}
                />
              </div>
            ) : null}

            {/* Calendário de ocupação — pedido explícito: agora vem ANTES de
                "Em Estadia"/"Imóveis livres" (antes vinha depois). Os
                filtros (Período/Cidade/Proprietário/limpar) não ficam mais
                numa linha própria aqui — viraram o botão único
                `CalendarFiltersButton` dentro do cabeçalho do próprio
                `OccupancyPanel`, ao lado do título. No desktop, largura de
                2 colunas (`lg:col-span-2`); `lg:col-start-1` garante que ele
                sempre abre uma linha nova própria (cols 3-4 dessa linha
                ficam livres para nada, já que não há mais nenhum outro item
                com esse mesmo order). No mobile não muda (col-span-2 =
                largura cheia da grade de 2 colunas). */}
            <div className="order-6 lg:order-6 col-span-2 lg:col-start-1 lg:col-span-2">
              <OccupancyPanel
                loading={occupancyQ.isLoading}
                start={occupancyQ.data?.start ?? occStart}
                days={occupancyQ.data?.days ?? occDays}
                properties={filteredOccupancyProperties}
                stays={occupancyQ.data?.stays ?? []}
                checkedInPropertyIds={checkedInPropertyIds}
                periodRange={periodRange}
                onPeriodRangeChange={setPeriodRange}
                cityFilters={cityFilters}
                onCityFiltersChange={setCityFilters}
                cityOptions={cityOptions}
                ownerFilters={ownerFilters}
                onOwnerFiltersChange={setOwnerFilters}
                ownerOptions={ownerOptions}
                hasCustomFilters={hasCustomFilters}
                onClearAllFilters={clearAllFilters}
              />
            </div>

            {/* "Limpezas Realizadas" e "Custo Total Limpeza" se mudaram pra
                aba própria "Limpeza" (pedido explícito) — ver
                view === "limpeza" mais abaixo. Pedido explícito: agora vêm
                DEPOIS do calendário (antes vinham antes) — `lg:col-start-1`
                em "Em Estadia" força os dois pra uma linha nova própria,
                mesma técnica usada acima pelo calendário. */}
            <div className="order-7 lg:order-7 col-span-1 lg:col-start-1">
              <KpiCard
                label="Em Estadia"
                rows={stayRows}
                icon={BedDouble}
                tone="primary-soft"
                loading={checkinListQ.isLoading}
                onRefresh={() => checkinListQ.refetch()}
                rangeLabel={rangeLabel[range]}
                cardProps={arrivalGroupPropsFor("stay", stayRows)}
              />
            </div>
            <div className="order-8 lg:order-8 col-span-1">
              <FreePropertiesCard
                loading={occupancyQ.isLoading}
                properties={freeProperties}
                onRefresh={() => occupancyQ.refetch()}
              />
            </div>
          </div>

          {/* Espaço extra abaixo do último card (mesmo tom de 6px usado entre
              todos os outros) — sem isso, no mobile os últimos cards ficavam
              colados na barra de navegação inferior fixa. */}
          <div className="h-1.5" />
        </>
      ) : null}

      {view === "limpeza" ? (
        <>
          {/* Aba nova (pedido explícito): "Limpezas Realizadas" e "Custo
              Total Limpeza" saíram do Dashboard e vieram morar aqui, junto
              com as próximas métricas de limpeza que ainda vamos adicionar.
              Pedido explícito (mais recente): os 3 botões de filtro
              separados (que já eram uma cópia independente dos do
              Dashboard) viraram o MESMO botão único `CalendarFiltersButton`
              usado lá — mesmo estado (período/cidade/proprietário), só que
              aqui só afeta os cards desta aba. */}
          <div className="flex justify-start items-center gap-1">
            <CalendarFiltersButton
              periodRange={periodRange}
              onPeriodRangeChange={setPeriodRange}
              cityFilters={cityFilters}
              onCityFiltersChange={setCityFilters}
              cityOptions={cityOptions}
              ownerFilters={ownerFilters}
              onOwnerFiltersChange={setOwnerFilters}
              ownerOptions={ownerOptions}
              hasCustomFilters={hasCustomFilters}
              onClearAll={clearAllFilters}
            />
            {/* Abre a previsão de limpeza dos próximos 7 dias, baseada nos
                checkouts já agendados. Pedido explícito: mesmo
                formato/alinhamento do botão "Filtros" ao lado — sem
                quadrante (fundo/borda), só ícone + texto soltos. */}
            <button
              type="button"
              onClick={() => setForecastOpen(true)}
              className="relative h-8 shrink-0 inline-flex items-center gap-1.5 rounded-[0.3rem] border-0 bg-transparent px-1.5 text-xs font-medium leading-none text-foreground/70 hover:text-foreground transition-colors"
            >
              <Sparkles className="size-3.5 opacity-60" />
              TENDÊNCIA 7D
            </button>
          </div>

          {/* Cards de limpeza — mais métricas chegam aqui conforme forem
              implementadas. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 mt-1.5">
            <div className="col-span-1">
              <StatDisplayCard
                label="Limpezas Realizadas"
                value={cleaningStatsQ.data?.cleaningsDone ?? 0}
                icon={CheckCircle2}
                loading={cleaningStatsQ.isLoading}
              />
            </div>
            <div className="col-span-1">
              <StatDisplayCard
                label="Custo Total Limpeza"
                value={centsToBRL(cleaningStatsQ.data?.totalCents ?? 0)}
                icon={Banknote}
                loading={cleaningStatsQ.isLoading}
              />
            </div>
          </div>

          {/* Gráficos de tendência (pedido explícito, combinando as opções A
              e C dos mockups aprovados) — sem mexer no layout dos cards
              acima, só adicionando estes logo abaixo. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 mt-1.5">
            <CleaningDailyBarChart data={cleaningTrendQ.data?.daily} loading={cleaningTrendQ.isLoading} />
            <CleaningDailyAreaChart data={cleaningTrendQ.data?.daily} loading={cleaningTrendQ.isLoading} />
          </div>
          <div className="mt-1.5">
            <CleaningTopProperties items={cleaningTrendQ.data?.breakdown} loading={cleaningTrendQ.isLoading} />
          </div>

          <CleaningForecastDialog
            open={forecastOpen}
            onOpenChange={setForecastOpen}
            data={cleaningForecast}
            loading={cleaningForecastListQ.isLoading}
          />

          <div className="h-1.5" />
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
            {/* Sem título: as próprias abas/colunas já identificam o quadro.
                Pedido explícito: o antigo dropdown "Hoje/Amanhã/7 dias/Todos"
                foi substituído pelo mesmo botão "Filtros" (Período/Cidade/
                Proprietário) do Dashboard/Limpeza — fica à direita no
                desktop; no mobile ele migra pra dentro da linha de abas, ver
                abaixo. */}
            <div className="hidden sm:flex items-center gap-3">
              <div className="ml-auto flex items-center gap-1">
                <CalendarFiltersButton
                  periodRange={periodRange}
                  onPeriodRangeChange={setPeriodRange}
                  cityFilters={cityFilters}
                  onCityFiltersChange={setCityFilters}
                  cityOptions={cityOptions}
                  ownerFilters={ownerFilters}
                  onOwnerFiltersChange={setOwnerFilters}
                  ownerOptions={ownerOptions}
                  hasCustomFilters={hasCustomFilters}
                  onClearAll={clearAllFilters}
                />
                <PendenciasButton count={openTasksCount} onClick={() => setPendenciasOpen(true)} />
              </div>
            </div>

            {/* Mobile: abas roláveis, uma coluna ativa por vez — 5 colunas lado a
                lado não cabem numa tela estreita. O item ativo usa sempre o
                gradiente da marca (mesmo tratamento de toda aba/badge ativo do
                app), não uma cor diferente por aba. O botão "Filtros" fica
                fixo no fim dessa mesma linha, não numa linha própria acima. */}
            <div className="sm:hidden space-y-3">
              <div className="space-y-2">
                <div
                  // scroll-px-3.5 (14px) = os mesmos 10px de margem da página
                  // (px-2.5 no mobile) + os 4px do próprio px-1 desta barra —
                  // sem isso, ao selecionar uma aba perto do fim o
                  // `scrollIntoView` colava o botão rente na borda da tela
                  // (0px), enquanto a 1ª aba (que nunca precisa rolar) ficava
                  // com a margem cheia. Mesma regra de "scroll-padding" já
                  // usada no calendário de ocupação (scrollPaddingLeft), só
                  // que aqui nos dois lados — pedido explícito: as duas pontas
                  // com o mesmo espaçamento da borda da tela.
                  className="ds-scroll-x w-full min-w-0 gap-1.5 snap-x scroll-px-3.5 pb-1 -mx-1 px-1"
                >
                  {(
                    [
                      { key: "checkin", label: "Check-ins", icon: CalendarCheck, count: kanbanCounts.checkin },
                      { key: "checkout", label: "Checkouts", icon: CalendarX, count: kanbanCounts.checkout },
                      { key: "stay", label: "Estadia", icon: BedDouble, count: kanbanCounts.stay },
                      { key: "cleaning", label: "Limpeza", icon: Sparkles, count: kanbanCounts.cleaning },
                      { key: "done", label: "Concluídos", icon: CheckCircle2, count: kanbanCounts.done },
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
                        onClick={(e) => {
                          setMobileTab(t.key);
                          // Regra "anti-corte": ao selecionar uma aba, ela
                          // precisa ficar totalmente visível — sem isso, uma
                          // aba no meio/fim da lista (ex.: "Limpeza") podia
                          // continuar parcialmente cortada na borda da tela
                          // mesmo depois de virar a aba ativa.
                          e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
                        }}
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
                <div className="flex items-center gap-1">
                  <CalendarFiltersButton
                    periodRange={periodRange}
                    onPeriodRangeChange={setPeriodRange}
                    cityFilters={cityFilters}
                    onCityFiltersChange={setCityFilters}
                    cityOptions={cityOptions}
                    ownerFilters={ownerFilters}
                    onOwnerFiltersChange={setOwnerFilters}
                    ownerOptions={ownerOptions}
                    hasCustomFilters={hasCustomFilters}
                    onClearAll={clearAllFilters}
                  />
                  <PendenciasButton count={openTasksCount} onClick={() => setPendenciasOpen(true)} />
                </div>
              </div>

              {mobileTab === "checkin" &&
                (kanbanCheckinListQ.isLoading ? (
                  <ColumnLoading />
                ) : kanbanCheckinPendingRows.length === 0 ? (
                  <ColumnEmpty />
                ) : (
                  <ArrivalGroup title="" {...arrivalGroupPropsFor("checkin", kanbanCheckinPendingRows)} />
                ))}
              {mobileTab === "checkout" &&
                (kanbanCheckoutListQ.isLoading ? (
                  <ColumnLoading />
                ) : kanbanCheckoutPendingRows.length === 0 ? (
                  <ColumnEmpty />
                ) : (
                  <ArrivalGroup title="" {...arrivalGroupPropsFor("checkout", kanbanCheckoutPendingRows)} />
                ))}
              {mobileTab === "stay" &&
                (kanbanCheckinListQ.isLoading ? (
                  <ColumnLoading />
                ) : kanbanStayRows.length === 0 ? (
                  <ColumnEmpty />
                ) : (
                  <ArrivalGroup title="" {...arrivalGroupPropsFor("stay", kanbanStayRows)} />
                ))}
              {mobileTab === "cleaning" &&
                (kanbanCheckoutListQ.isLoading ? (
                  <ColumnLoading />
                ) : kanbanCleaningRows.length === 0 ? (
                  <ColumnEmpty />
                ) : (
                  <ArrivalGroup title="" {...arrivalGroupPropsFor("cleaning", kanbanCleaningRows)} />
                ))}
              {mobileTab === "done" &&
                (concludedQ.isLoading ? (
                  <ColumnLoading />
                ) : kanbanConcludedRows.length === 0 ? (
                  <ColumnEmpty />
                ) : (
                  <ArrivalGroup title="" {...arrivalGroupPropsFor("done", kanbanConcludedRows)} />
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
                  count={kanbanCounts.checkin}
                  tone="emerald"
                >
                  {kanbanCheckinListQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanCheckinPendingRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup title="" {...arrivalGroupPropsFor("checkin", kanbanCheckinPendingRows)} />
                  )}
                </KanbanColumn>
              </div>

              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, checkout: null }))}
                  title="Checkouts"
                  icon={CalendarX}
                  count={kanbanCounts.checkout}
                  tone="amber"
                >
                  {kanbanCheckoutListQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanCheckoutPendingRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup title="" {...arrivalGroupPropsFor("checkout", kanbanCheckoutPendingRows)} />
                  )}
                </KanbanColumn>
              </div>

              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, stay: null }))}
                  title="Em Estadia"
                  icon={BedDouble}
                  count={kanbanCounts.stay}
                  tone="sky"
                >
                  {kanbanCheckinListQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanStayRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup title="" {...arrivalGroupPropsFor("stay", kanbanStayRows)} />
                  )}
                </KanbanColumn>
              </div>

              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, cleaning: null }))}
                  title="Liberado para Limpeza"
                  icon={Sparkles}
                  count={kanbanCounts.cleaning}
                  tone="violet"
                >
                  {kanbanCheckoutListQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanCleaningRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup title="" {...arrivalGroupPropsFor("cleaning", kanbanCleaningRows)} />
                  )}
                </KanbanColumn>
              </div>

              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, done: null }))}
                  title="Concluídos"
                  icon={CheckCircle2}
                  count={kanbanCounts.done}
                  tone="zinc"
                >
                  {concludedQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanConcludedRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup title="" {...arrivalGroupPropsFor("done", kanbanConcludedRows)} />
                  )}
                </KanbanColumn>
              </div>
            </div>

            <TasksDialog
              open={pendenciasOpen}
              onOpenChange={setPendenciasOpen}
              tasks={tasksQ.data?.tasks ?? []}
              loading={tasksQ.isLoading}
              linkProperties={taskLinkOptionsQ.data?.properties ?? []}
              linkOwners={taskLinkOptionsQ.data?.owners ?? []}
              guestNameForTask={guestNameForTask}
              onCreate={(v) => createTaskMutation.mutateAsync(v)}
              creating={createTaskMutation.isPending}
              onSetStatus={(taskId, status) => setTaskStatusMutation.mutate({ taskId, status })}
            />
          </section>
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

      {/* Pergunta obrigatória ao concluir a limpeza: qual tipo foi realizado.
          Sem essa escolha o card não avança — precisa saber o valor a
          registrar (ver getCleaningStats/advanceArrival). */}
      <Dialog
        open={!!cleaningTypePrompt}
        onOpenChange={(v) => {
          if (!v) setCleaningTypePrompt(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-display">Qual limpeza foi realizada?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground -mt-2">
            {cleaningTypePrompt ? (
              <>
                Confirme o tipo de limpeza concluída em{" "}
                <strong className="text-foreground">
                  {cleaningTypePrompt.row.propertyName ?? cleaningTypePrompt.row.guestName}
                </strong>
                .
              </>
            ) : null}
          </div>
          {(() => {
            const row = cleaningTypePrompt?.row;
            if (!row) return null;
            // Pedido explícito: só mostra a opção "normal"/"completa" quando o
            // imóvel tem um preço configurado ACIMA de 0 para aquele tipo —
            // preço em branco ou igual a zero não aparece como opção.
            const hasNormal = (row.cleaningPriceNormalCents ?? 0) > 0;
            const hasCompleta = (row.cleaningPriceFullCents ?? 0) > 0;
            const showBoth = hasNormal && hasCompleta;
            if (!hasNormal && !hasCompleta) {
              // Nenhum dos dois preços está configurado — sem valor pra
              // diferenciar, não faz sentido perguntar o tipo. Conclui direto
              // (mesmo fallback que o servidor já usa quando nenhum tipo é
              // enviado), pra não travar a esteira do imóvel.
              return (
                <div className="pt-1">
                  <Button
                    type="button"
                    className="h-auto w-full py-3"
                    onClick={() => {
                      runAdvance(row, "cleaning");
                      setCleaningTypePrompt(null);
                    }}
                  >
                    <span className="font-medium">Concluir limpeza</span>
                  </Button>
                </div>
              );
            }
            return (
              <div className={`grid gap-2 pt-1 ${showBoth ? "grid-cols-2" : "grid-cols-1"}`}>
                {hasNormal && (
                  <Button
                    type="button"
                    variant={showBoth ? "outline" : "default"}
                    className="h-auto py-3 flex-col gap-0.5"
                    onClick={() => {
                      runAdvance(row, "cleaning", "normal");
                      setCleaningTypePrompt(null);
                    }}
                  >
                    <span className="font-medium">Limpeza normal</span>
                  </Button>
                )}
                {hasCompleta && (
                  <Button
                    type="button"
                    className="h-auto py-3 flex-col gap-0.5"
                    onClick={() => {
                      runAdvance(row, "cleaning", "completa");
                      setCleaningTypePrompt(null);
                    }}
                  >
                    <span className="font-medium">Limpeza completa</span>
                  </Button>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* --------- Cabeçalho compartilhado das telas de operação --------- */

const OPERATION_TABS = [
  { view: "resumo" as const, label: "Operacional", to: "/admin/dashboard" },
  { view: "kanban" as const, label: "Kanban", to: "/admin/dashboard/kanban" },
  { view: "limpeza" as const, label: "Limpeza", to: "/admin/dashboard/limpeza" },
];

const OPERATION_COPY: Record<OperationView, { title: string; subtitle: string }> = {
  resumo: { title: "Dashboard Operacional", subtitle: "Sua rotina diária: check-ins, checkouts e senhas." },
  kanban: { title: "Kanban Operacional", subtitle: "Cada reserva na etapa em que ela realmente está." },
  limpeza: { title: "Limpeza", subtitle: "Histórico e custos das limpezas realizadas." },
};

function OperationShell({ view }: { view: OperationView }) {
  const copy = OPERATION_COPY[view];
  return (
    <div className="space-y-3">
      <div>
        <h1 className="ds-page-title truncate">{copy.title}</h1>
        <p className="ds-page-subtitle mt-1.5">{copy.subtitle}</p>
      </div>

      {/* Segmented control — Dashboard / Kanban (largura da página) */}
      <nav className="mb-5 flex w-full overflow-hidden rounded-[0.3rem] bg-foreground/5">
        {OPERATION_TABS.map((t) => {
          const active = t.view === view;
          return (
            <Link
              key={t.view}
              to={t.to}
              className={`flex-1 px-3 py-3.5 text-center text-sm font-semibold leading-none flex items-center justify-center min-h-[46px] transition-colors ${
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
      const PADDING_Y = 30; // pt-5 (20px, dá espaço pro badge de engajamento que corta a borda do card) + pb-2.5 (10px)
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
        className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory pt-5 px-2.5 pb-2.5 space-y-1.5"
      >
        {children}
      </div>
    </div>
  );
}

// Mede a largura real da scrollbar vertical do navegador (0 em iOS/Android
// e na maioria dos WebViews mobile, que usam scrollbar "overlay" sem
// reservar espaço; alguns pixels em navegadores desktop/emulação com
// scrollbar clássica). Truque padrão: um <div> escondido com overflow:scroll
// — a diferença entre a largura de fora e a de dentro É a scrollbar.
let cachedScrollbarWidth: number | null = null;
function measureScrollbarWidth(): number {
  if (cachedScrollbarWidth !== null) return cachedScrollbarWidth;
  if (typeof document === "undefined") return 0;
  const outer = document.createElement("div");
  outer.style.visibility = "hidden";
  outer.style.position = "absolute";
  outer.style.top = "-9999px";
  outer.style.width = "100px";
  outer.style.overflow = "scroll";
  const inner = document.createElement("div");
  inner.style.width = "100%";
  outer.appendChild(inner);
  document.body.appendChild(outer);
  const width = outer.offsetWidth - inner.clientWidth;
  outer.parentNode?.removeChild(outer);
  cachedScrollbarWidth = width;
  return width;
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
      // Reserva uma folga visível (pedido explícito: não pode parecer que o
      // último card foi cortado rente à borda do popup), mas sempre encerra
      // antes do primeiro pixel do próximo card — nunca revela uma tira dele.
      const visualClearance = nextTop === undefined ? 0 : Math.max(0, Math.min(14, nextTop - height - 0.5));
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
  rangeLabel,
  shadowTone,
  compact,
  highlight,
  cardProps,
}: {
  label: string;
  rows: ArrivalRow[];
  icon: React.ElementType;
  tone: "primary" | "primary-soft";
  loading: boolean;
  onRefresh: () => void;
  rangeLabel: string;
  shadowTone?: "emerald" | "amber" | "sky";
  /** Faixa fina (largura total) em vez de card quadrado. */
  compact?: boolean;
  /** Destaque visual opt-in (só usado hoje por "Liberado para Limpeza"): borda +
   * gradiente âmbar + acento lateral + ícone em caixinha, sem negrito.
   * Não afeta nenhum outro uso do KpiCard (compact ou não). */
  highlight?: "amber";
  /** Pedido explícito: os cards dentro do popup precisam ficar IDÊNTICOS ao
   * card do Kanban — em vez de manter uma segunda implementação (que já
   * divergiu do Kanban antes, ver o bug do bloqueio de check-in), o popup
   * agora renderiza o MESMO <ArrivalGroup>/<ArrivalCard> do Kanban, com os
   * MESMOS handlers. Vem de arrivalGroupPropsFor(colMode, rows) — a mesma
   * função que já alimenta as colunas do Kanban. */
  cardProps: Omit<React.ComponentProps<typeof ArrivalGroup>, "title">;
}) {
  const [open, setOpen] = useState(false);
  // Modo "Lista" (pedido explícito) — só afeta o conteúdo do popup, não o
  // gatilho (compact/highlight) do card em si, que já usa a prop `compact`
  // pra outra coisa (faixa fina vs. quadrado).
  const [listMode, setListMode] = useState<"full" | "list">("list");
  const list = useWholeCardsMaxHeight(2, `${open}:${rows.length}:${loading}:${listMode}`);
  const screenshotRef = useRef<HTMLDivElement | null>(null);
  const valueTone = tone === "primary" ? "text-accent" : "text-foreground";
  const valueColor =
    shadowTone === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : shadowTone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : shadowTone === "sky"
          ? "text-sky-600 dark:text-sky-400"
          : valueTone;
  // Refinamento executivo (só nesta página): removido o glow colorido
  // (shadow grande em rgba emerald/amber) — mantém a sombra neutra e fina
  // que já era usada nos cards sem cor, pra reduzir o "volume" visual.
  const shadowClass = "ds-3d ds-3d-hover";
  const dotClass =
    shadowTone === "emerald"
      ? "bg-emerald-500"
      : shadowTone === "amber"
        ? "bg-amber-500"
        : shadowTone === "sky"
          ? "bg-sky-400"
          : "bg-muted-foreground/50";

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
          highlight === "amber" ? (
            <button
              type="button"
              // Pedido explícito: arredondamento igual ao dos demais cards
              // (`rounded-[0.3rem]`, não o `rounded-lg` mais arredondado que
              // estava aqui) — só o raio das pontas mudou, resto do
              // destaque âmbar (borda/gradiente/acento) continua igual.
              className="relative w-full overflow-hidden flex items-center gap-2.5 rounded-[0.3rem] border border-amber-300/30 bg-card px-3.5 py-3 text-left transition hover:bg-secondary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 shadow-[0_8px_24px_-12px_rgba(245,158,11,0.30)]"
              style={{
                backgroundImage:
                  "radial-gradient(120% 160% at 0% 0%, rgba(245,158,11,0.16), transparent 55%), radial-gradient(120% 160% at 100% 100%, rgba(245,158,11,0.08), transparent 55%)",
              }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-amber-500 to-amber-300"
              />
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-amber-500/15 text-amber-500">
                <Icon className="size-[13px]" strokeWidth={2.5} />
              </span>
              <span className="min-w-0 truncate text-[10.5px] font-normal uppercase tracking-[0.08em] leading-[1.2] text-foreground">
                {label}
              </span>
              <span className="ml-auto shrink-0 text-base font-normal tabular-nums text-foreground">
                {loading ? "—" : rows.length}
              </span>
            </button>
          ) : (
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
          )
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
              // Pedido explícito: fonte um pouco menor que antes nos cards
              // numéricos da página Operacional — mantendo o negrito.
              className={`font-display font-bold mt-1.5 tabular-nums leading-none ${valueColor} ${
                shadowTone ? "text-[22px] sm:text-[24px]" : "text-[20px] sm:text-[22px]"
              }`}
            >
              {loading ? "—" : rows.length}
            </div>
          </button>
        )}
      </DialogTrigger>

      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-lg border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        <div
          className={`absolute inset-x-0 top-0 h-px ${shadowTone === "emerald" ? "bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" : shadowTone === "amber" ? "bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" : shadowTone === "sky" ? "bg-gradient-to-r from-transparent via-sky-400/60 to-transparent" : "bg-gradient-to-r from-transparent via-primary/50 to-transparent"}`}
        />
        <DialogHeader className="px-5 pt-5 pb-0">
          <div className="flex items-center gap-3">
            <div
              className={`grid place-items-center size-10 rounded-xl ${shadowTone === "emerald" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : shadowTone === "amber" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : shadowTone === "sky" ? "bg-sky-400/10 text-sky-600 dark:text-sky-400" : "bg-accent/10 text-accent"}`}
            >
              <Icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-display leading-tight truncate">{label}</DialogTitle>
              <div className="ds-meta mt-0.5">
                {rangeLabel} · {rows.length} {rows.length === 1 ? "hóspede" : "hóspedes"}
              </div>
            </div>
          </div>
          {rows.length > 0 && (
            <div className="flex items-center justify-end gap-1.5 mt-3">
              <ScreenshotButton targetRef={screenshotRef} fileName={`${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} />
              <ViewModeToggle value={listMode} onChange={setListMode} />
            </div>
          )}
        </DialogHeader>
        {/* pt-3 aqui (em vez do pb-3 que o header tinha antes) — mesmo
            espaçamento visual entre os botões e o 1º card, mas agora essa
            "folga" fica DENTRO da área rolável (px-3 pt-3), que é onde o
            navegador realmente clipa o overflow. Isso dá espaço pro badge de
            engajamento (absolute -top-2.5, cortando a borda do 1º card) sem
            cortar a etiqueta — pedido explícito: etiqueta nunca cortada, sem
            alterar o espaçamento visível. */}
        <div
          ref={(el) => {
            list.ref(el);
            screenshotRef.current = el;
          }}
          style={list.maxHeight !== undefined ? { maxHeight: list.maxHeight } : undefined}
          className="sg-elegant-scroll max-h-[70vh] overflow-y-auto px-3 pt-3"
        >
          {loading ? (
            <div className="py-14 grid place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Nenhum registro no período.</div>
          ) : (
            <div className="pb-3">
              <ArrivalGroup title="" {...cardProps} compact={listMode === "list"} />
            </div>
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
  return <EngagementAlertDropdown flags={flags} />;
}

/** Alertas agrupados num único acionador expansível (estilo "+N hóspedes"). */
function EngagementAlertDropdown({ flags }: { flags: Array<{ icon: typeof Eye; label: string }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      {/* Badge fica sobre a borda superior do card (pedido explícito) — por
          isso precisa de fundo próprio, sem a seta de expandir. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 dark:bg-amber-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-400 shadow-sm hover:bg-amber-500/25 transition-colors"
        title="Ver alertas de engajamento"
      >
        <AlertTriangle className="size-3 shrink-0" />
        Engajamento
      </button>
      {open && (
        <ul className="absolute right-0 top-full z-30 mt-1 min-w-[190px] space-y-1 rounded-lg border border-amber-500/25 bg-popover px-2 py-1.5 shadow-lg">
          {flags.map((f) => (
            <li key={f.label} className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              <f.icon className="size-3 shrink-0" />
              <span className="min-w-0">{f.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const list = useWholeCardsMaxHeight(2, `${open}:${properties.length}:${loading}`);
  // Vermelho claro quando há imóvel livre (chama atenção pra ociosidade);
  // sem cor especial quando zero.
  const hasFree = properties.length > 0;
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
            {/* Ícone neutro (mesma cor do texto do rótulo) — só o número
                grande é que muda de cor conforme o estado. */}
            <Home className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate leading-none" title="Imóveis livres">
              Imóveis livres
            </span>
          </div>
          <div
            className={`text-[24px] sm:text-[26px] font-display font-bold mt-1.5 tabular-nums leading-none ${hasFree ? "text-red-500 dark:text-red-400" : "text-foreground"}`}
          >
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

/**
 * Conteúdo do tooltip "quais imóveis" (Limpezas Realizadas / Custo Total
 * Limpeza). Pedido explícito: também ganha o alternador Completo/Lista e o
 * botão de print — no modo Lista mostra só proprietário + imóvel + um
 * atalho pro mapa (bem pequeno).
 */
function CleaningBreakdownContent({ label, breakdown }: { label: string; breakdown: CleaningBreakdownItem[] }) {
  const [listMode, setListMode] = useState<"full" | "list">("list");
  const screenshotRef = useRef<HTMLUListElement | null>(null);
  return (
    <>
      <div className="mb-1 text-foreground/90">Imóveis que entram nesta conta:</div>
      <div className="flex items-center justify-end gap-1.5 mb-1.5">
        <ScreenshotButton
          targetRef={screenshotRef}
          fileName={`${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-imoveis`}
        />
        <ViewModeToggle value={listMode} onChange={setListMode} />
      </div>
      <ul ref={screenshotRef} className="max-h-48 space-y-1 overflow-y-auto bg-popover">
        {breakdown.map((item) => {
          const mapsHref = item.mapsUrl || item.garageMapsUrl;
          return (
            <li key={item.propertyId} className="flex items-center justify-between gap-2 py-0.5">
              {listMode === "list" ? (
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{item.ownerName ?? "Sem proprietário"}</span>
                  <span className="text-foreground/60"> · </span>
                  <span className="text-foreground">{item.propertyName}</span>
                </span>
              ) : (
                <span className="min-w-0 truncate">
                  <span className="block truncate">{item.propertyName}</span>
                  {item.ownerName && (
                    <span className="block truncate text-[10px] text-muted-foreground">{item.ownerName}</span>
                  )}
                </span>
              )}
              <span className="shrink-0 flex items-center gap-1.5">
                {listMode === "full" && (
                  <span className="tabular-nums text-muted-foreground">
                    {item.count}× · {centsToBRL(item.totalCents)}
                  </span>
                )}
                {mapsHref && (
                  <a
                    href={mapsHref}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="Ver no mapa"
                    aria-label="Ver no mapa"
                    className="grid place-items-center size-5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
                  >
                    <Navigation className="size-3" />
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Card de estatística pura (sem lista/detalhe por trás) — usado para
 * "Limpezas Realizadas" e "Custo Total Limpeza". Mesmo visual dos KpiCards,
 * mas não abre popup: é só um número agregado, "Hoje" (fuso de São Paulo).
 * Quando `breakdown` vem preenchido, mostra o mesmo tooltip "i" usado na
 * visualização de engajamento, listando quais imóveis entraram na conta.
 */
function StatDisplayCard({
  label,
  value,
  icon: Icon,
  loading,
  breakdown,
  sparkline,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  loading: boolean;
  breakdown?: CleaningBreakdownItem[];
  /** Mini gráfico de tendência (pedido explícito: sem percentual comparativo por
      enquanto, só a linha). */
  sparkline?: { data: CleaningDailyPoint[]; metric: "count" | "totalCents"; color: string };
}) {
  return (
    <div className="w-full h-full rounded-[0.3rem] border-0 bg-card px-3.5 py-5 min-h-[96px] flex flex-col justify-between ds-3d">
      <div className="flex items-center gap-2 ds-eyebrow min-w-0">
        <Icon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate leading-none" title={label}>
          {label}
        </span>
        {breakdown && breakdown.length > 0 && (
          <InfoHint title={label}>
            <CleaningBreakdownContent label={label} breakdown={breakdown} />
          </InfoHint>
        )}
      </div>
      <div className="flex items-end justify-between gap-2 mt-1.5">
        {/* Mesmo ajuste dos KpiCards: fonte um pouco menor, negrito mantido. */}
        <div className="text-[20px] sm:text-[22px] font-display font-bold tabular-nums leading-none text-foreground">
          {loading ? "—" : value}
        </div>
        {sparkline && sparkline.data.length > 1 && !loading && (
          <div className="h-5 w-16 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline.data} margin={{ top: 2, right: 1, left: 1, bottom: 2 }}>
                <Line
                  type="monotone"
                  dataKey={sparkline.metric}
                  stroke={sparkline.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

/** Cor consistente com a identidade já usada pra "limpeza" no resto do app
    (aba/coluna do Kanban) e para custo/dinheiro (mesmo tom âmbar do destaque
    "Liberado para Limpeza"). */
const CLEANING_COUNT_COLOR = "#38bdf8"; // sky-400
const CLEANING_COST_COLOR = "#d97706"; // amber-600

function CleaningDailyBarChart({ data, loading }: { data: CleaningDailyPoint[] | undefined; loading: boolean }) {
  return (
    <div className="w-full rounded-[0.3rem] border-0 bg-card px-3.5 py-3.5 ds-3d">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="ds-eyebrow">Limpezas por dia</span>
        <span className="text-[10px] text-muted-foreground">{data && data.length > 0 ? `${data.length} dias` : ""}</span>
      </div>
      <div className="h-32">
        {loading || !data || data.length === 0 ? (
          <div className="h-full grid place-items-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => {
                  const [, m, d] = v.split("-");
                  return `${d}/${m}`;
                }}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={16}
              />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <RechartsTooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
                labelFormatter={(v: unknown) => fmtDateBR(String(v))}
                formatter={(value: number) => [`${value}`, "Limpezas"]}
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              />
              <Bar dataKey="count" fill={CLEANING_COUNT_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function CleaningDailyAreaChart({ data, loading }: { data: CleaningDailyPoint[] | undefined; loading: boolean }) {
  return (
    <div className="w-full rounded-[0.3rem] border-0 bg-card px-3.5 py-3.5 ds-3d">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="ds-eyebrow">Custo total por dia</span>
        <span className="text-[10px] text-muted-foreground">{data && data.length > 0 ? `${data.length} dias` : ""}</span>
      </div>
      <div className="h-32">
        {loading || !data || data.length === 0 ? (
          <div className="h-full grid place-items-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="cleaningCostArea" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={CLEANING_COST_COLOR} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={CLEANING_COST_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => {
                  const [, m, d] = v.split("-");
                  return `${d}/${m}`;
                }}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                width={46}
                // Formato compacto (sem centavos) — o valor cheio (com
                // centavos) já aparece no tooltip ao passar o mouse. O
                // "R$ 1.234,00" completo não cabia na largura do eixo e
                // ficava cortado, mostrando só ",00" em toda linha.
                tickFormatter={(v: number) => `R$${Math.round(v / 100).toLocaleString("pt-BR")}`}
              />
              <RechartsTooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)" }}
                labelFormatter={(v: unknown) => fmtDateBR(String(v))}
                formatter={(value: number) => [centsToBRL(value), "Custo"]}
                cursor={{ stroke: "var(--border)" }}
              />
              <Area
                type="monotone"
                dataKey="totalCents"
                stroke={CLEANING_COST_COLOR}
                strokeWidth={2}
                fill="url(#cleaningCostArea)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function CleaningTopProperties({ items, loading }: { items: CleaningBreakdownItem[] | undefined; loading: boolean }) {
  const top = (items ?? []).slice(0, 5);
  const maxCount = Math.max(1, ...top.map((i) => i.count));
  return (
    <div className="w-full rounded-[0.3rem] border-0 bg-card px-3.5 py-3.5 ds-3d">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="ds-eyebrow">Top 5 imóveis</span>
        <span className="text-[10px] text-muted-foreground">nº de limpezas</span>
      </div>
      {loading ? (
        <div className="py-6 grid place-items-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : top.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Nenhuma limpeza no período.</div>
      ) : (
        <ul className="space-y-1.5">
          {top.map((item) => (
            <li key={item.propertyId} className="flex items-center gap-2">
              <span className="w-20 shrink-0 truncate text-[10.5px] text-foreground" title={item.propertyName}>
                {item.propertyName}
              </span>
              <span className="h-2 flex-1 rounded-full bg-muted/50 overflow-hidden">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(item.count / maxCount) * 100}%`, backgroundColor: CLEANING_COUNT_COLOR }}
                />
              </span>
              <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{item.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "Limpeza Prevista 7d" (pedido explícito) — mesma linguagem visual dos
 * gráficos de histórico logo acima, só que olhando pra FRENTE: baseado nos
 * checkouts já agendados pros próximos 7 dias (hoje → hoje+6), não em
 * limpezas já concluídas. O custo é uma ESTIMATIVA (preço da limpeza
 * normal de cada imóvel — o tipo real só é escolhido na hora de concluir).
 */
function CleaningForecastDialog({
  open,
  onOpenChange,
  data,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: { daily: CleaningDailyPoint[]; breakdown: CleaningBreakdownItem[]; cleaningsExpected: number; estimatedTotalCents: number };
  loading: boolean;
}) {
  // Pedido explícito: nada de modal "tela cheia" nem cabeçalho com avatar
  // colorido (estilo dos popups de KPI) — o título/subtítulo visíveis usam
  // exatamente as mesmas classes (`ds-page-title`/`ds-page-subtitle`) da
  // página "Limpeza" de verdade. A área rolável usa no máximo 70% da tela
  // e a MESMA regra "anti-corte" dos popups de card (useWholeCardsMaxHeight):
  // nunca corta um bloco (cards, gráfico ou ranking) ao meio, e sempre deixa
  // uma folga visível antes da borda do modal.
  const scroll = useWholeCardsMaxHeight(99, `${open}:${loading}:${data.daily.length}:${data.breakdown.length}`);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2.5rem)] sm:w-full sm:max-w-lg p-0 overflow-hidden rounded-lg border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        {/* Título/descrição "de verdade" pro leitor de tela — o cabeçalho
            visível abaixo é só texto puro, sem papel semântico próprio. */}
        <DialogTitle className="sr-only">Limpeza Prevista 7d</DialogTitle>
        <DialogDescription className="sr-only">
          Previsão de limpezas para os próximos 7 dias, com base nos checkouts já agendados.
        </DialogDescription>
        <div className="px-5 pt-5 pb-3">
          <h2 className="ds-page-title truncate">Limpeza Prevista 7d</h2>
          {/* No máximo 1 linha (pedido explícito). */}
          <p className="ds-page-subtitle mt-1.5 truncate">Previsão para os próximos 7 dias, com base nos checkouts já agendados.</p>
        </div>
        <div
          ref={scroll.ref}
          style={scroll.maxHeight !== undefined ? { maxHeight: scroll.maxHeight } : undefined}
          className="sg-elegant-scroll max-h-[70vh] overflow-y-auto px-5 pb-5 space-y-1.5"
        >
          <div data-whole-card className="grid grid-cols-2 gap-1.5">
            <StatDisplayCard label="Limpezas Previstas" value={data.cleaningsExpected} icon={CheckCircle2} loading={loading} />
            <StatDisplayCard label="Custo Estimado" value={centsToBRL(data.estimatedTotalCents)} icon={Banknote} loading={loading} />
          </div>
          <div data-whole-card>
            <CleaningDailyBarChart data={data.daily} loading={loading} />
          </div>
          <div data-whole-card>
            <CleaningDailyAreaChart data={data.daily} loading={loading} />
          </div>
          <div data-whole-card>
            <CleaningTopProperties items={data.breakdown} loading={loading} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Botão "PENDÊNCIAS" — mesmo formato/alinhamento do "FILTROS" ao lado
// (pedido explícito, mesmo tratamento já dado ao "TENDÊNCIA 7D" da Limpeza).
function PendenciasButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative h-8 shrink-0 inline-flex items-center gap-1.5 rounded-[0.3rem] border-0 bg-transparent px-1.5 text-xs font-medium leading-none text-foreground/70 hover:text-foreground transition-colors"
    >
      <ListChecks className="size-3.5 opacity-60" />
      PENDÊNCIAS
      {count > 0 && (
        <span className="absolute -top-1 -right-1.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-rose-500 text-white text-[9px] font-bold leading-[15px] text-center">
          {count}
        </span>
      )}
    </button>
  );
}

const TASK_CATEGORY_LABEL: Record<TaskCategory, string> = {
  maintenance: "Manutenção",
  financial: "Financeiro",
  guest_request: "Solicitação do hóspede",
  purchase: "Compra",
  inspection: "Vistoria",
  cleaning: "Limpeza",
  other: "Outro",
};
const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const TASK_PRIORITY_DOT: Record<TaskPriority, string> = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-rose-500",
};

type TaskGroupBy = "owner" | "property" | "guest";

/** Dialog "PENDÊNCIAS" do Kanban — 3 agrupamentos (Por Proprietário / Por
 * Imóvel / Imóvel + Hóspede) + formulário de criação. Toda pendência é
 * obrigatoriamente vinculada a um imóvel e/ou a um proprietário (pedido
 * explícito) — nunca solta. */
function TasksDialog({
  open,
  onOpenChange,
  tasks,
  loading,
  linkProperties,
  linkOwners,
  guestNameForTask,
  onCreate,
  creating,
  onSetStatus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tasks: TaskRow[];
  loading: boolean;
  linkProperties: TaskLinkProperty[];
  linkOwners: TaskLinkOwner[];
  guestNameForTask: (t: TaskRow) => string;
  onCreate: (v: {
    title: string;
    description?: string | null;
    category: TaskCategory;
    priority: TaskPriority;
    dueDate?: string | null;
    showInCleaning: boolean;
    propertyId?: string | null;
    ownerContactId?: string | null;
  }) => Promise<{ id: string }>;
  creating: boolean;
  onSetStatus: (taskId: string, status: "pending" | "done" | "canceled") => void;
}) {
  const [groupBy, setGroupBy] = useState<TaskGroupBy>("owner");
  const [showForm, setShowForm] = useState(false);
  const scroll = useWholeCardsMaxHeight(99, `${open}:${loading}:${tasks.length}:${groupBy}:${showForm}`);
  const todayISO = todayISOSaoPaulo();

  const activeTasks = useMemo(() => tasks.filter((t) => t.status !== "canceled"), [tasks]);

  type Group = { key: string; label: string; items: TaskRow[] };
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const t of activeTasks) {
      if (groupBy === "guest") {
        if (!t.logId && !t.reservationId) continue;
        const label = `${t.propertyName ?? "Sem imóvel"} · ${guestNameForTask(t)}`;
        const key = `${t.propertyId ?? "?"}:${t.logId ?? t.reservationId}`;
        if (!map.has(key)) map.set(key, { key, label, items: [] });
        map.get(key)!.items.push(t);
      } else if (groupBy === "property") {
        if (!t.propertyName) continue;
        if (!map.has(t.propertyName)) map.set(t.propertyName, { key: t.propertyName, label: t.propertyName, items: [] });
        map.get(t.propertyName)!.items.push(t);
      } else {
        if (!t.ownerName) continue;
        if (!map.has(t.ownerName)) map.set(t.ownerName, { key: t.ownerName, label: t.ownerName, items: [] });
        map.get(t.ownerName)!.items.push(t);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [activeTasks, groupBy, guestNameForTask]);

  // ----- Formulário de criação -----
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TaskCategory>("other");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [showInCleaning, setShowInCleaning] = useState(false);
  const [propertyId, setPropertyId] = useState<string>("");
  const [ownerContactId, setOwnerContactId] = useState<string>("");
  const linkMissing = !propertyId && !ownerContactId;

  function resetForm() {
    setTitle("");
    setDescription("");
    setCategory("other");
    setPriority("medium");
    setDueDate("");
    setShowInCleaning(false);
    setPropertyId("");
    setOwnerContactId("");
  }

  async function handleSubmit() {
    if (!title.trim()) {
      toast.error("Dê um título pra pendência.");
      return;
    }
    if (linkMissing) {
      toast.error("Vincule a um imóvel ou a um proprietário.");
      return;
    }
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || null,
        category,
        priority,
        dueDate: dueDate || null,
        showInCleaning,
        propertyId: propertyId || null,
        ownerContactId: ownerContactId || null,
      });
      resetForm();
      setShowForm(false);
    } catch {
      // erro já mostrado via toast no onError da mutation
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2.5rem)] sm:w-full sm:max-w-lg p-0 overflow-hidden rounded-lg border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        <DialogTitle className="sr-only">Pendências</DialogTitle>
        <DialogDescription className="sr-only">
          Tarefas e pendências vinculadas a imóveis e proprietários.
        </DialogDescription>
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="ds-page-title truncate">Pendências</h2>
              <p className="ds-page-subtitle mt-1.5 truncate">
                {activeTasks.length} {activeTasks.length === 1 ? "aberta" : "abertas"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="shrink-0 h-8 inline-flex items-center gap-1.5 rounded-[0.3rem] px-2.5 text-xs font-semibold text-white bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] transition-opacity hover:opacity-90"
            >
              {showForm ? <ChevronRight className="size-3.5 rotate-90" /> : <UserPlus className="size-3.5" />}
              Nova
            </button>
          </div>

          {!showForm && (
            <div className="flex gap-1 mt-3 bg-foreground/5 p-1 rounded-[0.3rem]">
              {(
                [
                  { key: "owner", label: "Por Proprietário" },
                  { key: "property", label: "Por Imóvel" },
                  { key: "guest", label: "Imóvel + Hóspede" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setGroupBy(t.key)}
                  className={`flex-1 text-center text-[11px] font-semibold py-1.5 rounded-[0.2rem] transition-colors ${
                    groupBy === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {showForm ? (
          <div className="px-5 pb-5 space-y-2.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título da pendência"
              maxLength={200}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Descrição (opcional)"
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <Select value={category} onValueChange={(v) => setCategory(v as TaskCategory)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TASK_CATEGORY_LABEL) as TaskCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {TASK_CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TASK_PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {TASK_PRIORITY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={propertyId || "none"} onValueChange={(v) => setPropertyId(v === "none" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Imóvel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum imóvel</SelectItem>
                  {linkProperties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={ownerContactId || "none"} onValueChange={(v) => setOwnerContactId(v === "none" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Proprietário" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum proprietário</SelectItem>
                  {linkOwners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {linkMissing && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Vincule a um imóvel e/ou a um proprietário (obrigatório).
              </p>
            )}
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
            />
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={showInCleaning} onCheckedChange={(v) => setShowInCleaning(!!v)} />
              Aparece no checklist do card de Limpeza
            </label>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                className="text-xs px-2 py-1.5 rounded-md hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={creating}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white disabled:opacity-60"
              >
                {creating ? "Criando…" : "Criar pendência"}
              </button>
            </div>
          </div>
        ) : (
          <div
            ref={scroll.ref}
            style={scroll.maxHeight !== undefined ? { maxHeight: scroll.maxHeight } : undefined}
            className="sg-elegant-scroll max-h-[70vh] overflow-y-auto px-5 pb-5 space-y-3"
          >
            {loading ? (
              <div className="py-12 grid place-items-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : groups.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Nenhuma pendência por aqui.</div>
            ) : (
              groups.map((g) => (
                <div key={g.key} data-whole-card>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-bold text-pink-500 dark:text-pink-400 truncate">{g.label}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {g.items.length} {g.items.length === 1 ? "pendência" : "pendências"}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {g.items.map((t) => {
                      const isPontual = !!(t.logId || t.reservationId);
                      const late = !!t.dueDate && t.dueDate < todayISO && t.status === "pending";
                      return (
                        <div key={t.id} className="flex items-start gap-2 rounded-lg bg-secondary/40 px-2.5 py-2">
                          <span className={`mt-1 size-1.5 rounded-full shrink-0 ${TASK_PRIORITY_DOT[t.priority]}`} />
                          <div className="min-w-0 flex-1">
                            <div className={`text-xs font-semibold leading-snug ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                              {t.title}
                            </div>
                            <div className="text-[10.5px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span>{TASK_CATEGORY_LABEL[t.category]}</span>
                              {groupBy !== "property" && t.propertyName && <span>· {t.propertyName}</span>}
                              {t.dueDate && (
                                <span className={late ? "text-rose-500 font-semibold" : ""}>
                                  · {late ? "Atrasada" : fmtDateBR(t.dueDate)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {isPontual && (
                              <button
                                type="button"
                                onClick={() => onSetStatus(t.id, t.status === "done" ? "pending" : "done")}
                                title={t.status === "done" ? "Reabrir" : "Concluir"}
                                className="size-6 grid place-items-center rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
                              >
                                {t.status === "done" ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onSetStatus(t.id, "canceled")}
                              title="Arquivar"
                              className="size-6 grid place-items-center rounded-md hover:bg-secondary text-muted-foreground hover:text-rose-500"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Formatação ÚNICA compartilhada pelos botões de filtro (Período/Cidade/
// Proprietário + o ícone de "limpar"). bg-card (não bg-secondary, que
// destoava da cor padrão dos outros quadrantes da página) + a mesma sombra
// sutil (ds-3d) usada em todos os outros cards.
const FILTER_BUTTON_CLASS =
  "relative h-9 box-border shrink-0 inline-flex items-center gap-1.5 rounded-[0.3rem] border-0 bg-card ds-3d px-3.5 text-xs font-medium leading-none text-foreground/80 hover:bg-secondary/50 transition-colors";
const FILTER_DOT = (
  <span className="ml-0.5 size-1.5 shrink-0 rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE]" />
);

/** Filtro de período — calendário de início E fim (substitui o antigo campo de uma data só). */
function PeriodRangeFilterButton({
  value,
  onChange,
}: {
  value: { start: string; end: string } | null;
  onChange: (next: { start: string; end: string } | null) => void;
}) {
  const [draft, setDraft] = useState<DateRange | undefined>(
    value ? { from: parseISODateLocal(value.start), to: parseISODateLocal(value.end) } : undefined,
  );
  // Resincroniza o rascunho quando o valor muda por FORA deste popover (ex.:
  // o ícone de "limpar filtros" ao lado, que volta tudo pro dia atual).
  useEffect(() => {
    setDraft(value ? { from: parseISODateLocal(value.start), to: parseISODateLocal(value.end) } : undefined);
  }, [value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={FILTER_BUTTON_CLASS}>
          <CalendarRange className="size-3.5 opacity-60" />
          Período
          {value ? FILTER_DOT : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <RangeCalendar
          mode="range"
          numberOfMonths={1}
          locale={ptBR}
          selected={draft}
          onSelect={(nextRange) => {
            setDraft(nextRange);
            // Só propaga pro resto da página (agenda + cards de limpeza)
            // quando o intervalo estiver completo (início E fim) — o
            // primeiro clique sozinho ainda não é um período válido.
            if (nextRange?.from && nextRange?.to) {
              onChange({ start: dateToISOLocal(nextRange.from), end: dateToISOLocal(nextRange.to) });
            }
          }}
        />
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-2">
          <span className="text-[11px] text-muted-foreground">
            {draft?.from ? format(draft.from, "dd/MM", { locale: ptBR }) : "Início"}
            {" – "}
            {draft?.to ? format(draft.to, "dd/MM", { locale: ptBR }) : "Fim"}
          </span>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
            onClick={() => {
              setDraft(undefined);
              onChange(null);
            }}
          >
            Limpar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Filtro de seleção múltipla com busca (Cidade/Proprietário) — campo de
 * texto pra digitar, checkbox por item, "selecionar todos" e "limpar".
 */
function MultiSelectFilterButton({
  label,
  icon: Icon,
  options,
  selected,
  onChange,
  className,
}: {
  label: string;
  icon: React.ElementType;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  function toggle(o: string) {
    onChange(selected.includes(o) ? selected.filter((s) => s !== o) : [...selected, o]);
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(FILTER_BUTTON_CLASS, className)}>
          <Icon className="size-3.5 opacity-60 shrink-0" />
          <span className="truncate">{label}</span>
          {selected.length > 0 ? FILTER_DOT : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Command>
          <CommandInput placeholder={`Buscar ${label.toLowerCase()}...`} />
          <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
              onClick={() => onChange(options)}
            >
              Selecionar todos
            </button>
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
              onClick={() => onChange([])}
            >
              Limpar
            </button>
          </div>
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o} value={o} onSelect={() => toggle(o)} className="cursor-pointer gap-2">
                  <Checkbox checked={selected.includes(o)} className="pointer-events-none" />
                  <span className="truncate">{o}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Botão único que reúne Período + Cidade + Proprietário + "limpar todos" num
 * só painel — pedido explícito: no Dashboard, os 3 botões de filtro (que
 * antes ficavam numa linha própria acima do calendário) viraram só ESTE
 * botão, ao lado do título "Calendário de ocupação" (mesma ideia do botão
 * único "Hoje/Amanhã/7 dias/Todos" da visão Kanban). O estado
 * (periodRange/cityFilters/ownerFilters) continua vivendo no pai
 * (OperationWorkspace), porque também afeta os cards de limpeza acima —
 * este componente só desenha o painel e delega toda mudança pro pai.
 *
 * Layout escolhido pelo usuário entre 3 mockups (Opção C — "lista →
 * detalhe"): abre num resumo enxuto de 1 linha por filtro (com o valor
 * atual à direita); tocar numa linha entra no editor daquele filtro
 * específico, com "‹ Filtros" pra voltar. Pedido explícito: o editor de
 * "Período" é o MESMO calendário padrão (completo) que já era usado no
 * antigo botão "Período" sozinho — não uma versão reduzida.
 */
function CalendarFiltersButton({
  periodRange,
  onPeriodRangeChange,
  cityFilters,
  onCityFiltersChange,
  cityOptions,
  ownerFilters,
  onOwnerFiltersChange,
  ownerOptions,
  hasCustomFilters,
  onClearAll,
}: {
  periodRange: { start: string; end: string } | null;
  onPeriodRangeChange: (next: { start: string; end: string } | null) => void;
  cityFilters: string[];
  onCityFiltersChange: (next: string[]) => void;
  cityOptions: string[];
  ownerFilters: string[];
  onOwnerFiltersChange: (next: string[]) => void;
  ownerOptions: string[];
  hasCustomFilters: boolean;
  onClearAll: () => void;
}) {
  type Screen = "root" | "period" | "city" | "owner";
  const [screen, setScreen] = useState<Screen>("root");
  const [draft, setDraft] = useState<DateRange | undefined>(
    periodRange ? { from: parseISODateLocal(periodRange.start), to: parseISODateLocal(periodRange.end) } : undefined,
  );
  // Resincroniza quando o valor muda por FORA deste popover (ex.: "limpar
  // todos os filtros" no rodapé, ou o botão de limpar de outro lugar).
  useEffect(() => {
    setDraft(periodRange ? { from: parseISODateLocal(periodRange.start), to: parseISODateLocal(periodRange.end) } : undefined);
  }, [periodRange]);

  function toggle(list: string[], value: string, onChange: (next: string[]) => void) {
    onChange(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  const periodLabel = periodRange
    ? `${format(parseISODateLocal(periodRange.start), "dd/MM", { locale: ptBR })} – ${format(parseISODateLocal(periodRange.end), "dd/MM", { locale: ptBR })}`
    : "Todos";
  const cityLabel =
    cityFilters.length === 0 ? "Todas" : cityFilters.length === 1 ? cityFilters[0] : `${cityFilters.length} selecionadas`;
  const ownerLabel =
    ownerFilters.length === 0
      ? "Todos"
      : ownerFilters.length === 1
        ? ownerFilters[0]
        : `${ownerFilters.length} selecionados`;

  function BackRow({ label }: { label: string }) {
    return (
      <button
        type="button"
        onClick={() => setScreen("root")}
        className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" />
        {label}
      </button>
    );
  }

  return (
    <Popover
      onOpenChange={(open) => {
        // Sempre reabre no resumo — ninguém espera "continuar de onde
        // parou" dentro de um editor específico da última vez.
        if (!open) setScreen("root");
      }}
    >
      <PopoverTrigger asChild>
        {/* Pedido explícito: sem "quadrante" (fundo/borda) — igual ao
            tratamento da borracha de limpar filtros, só ícone + texto
            soltos, sem caixinha ao redor, e SEM fundo nem no hover. */}
        <button
          type="button"
          className="relative h-8 shrink-0 inline-flex items-center gap-1.5 rounded-[0.3rem] border-0 bg-transparent px-1.5 text-xs font-medium leading-none text-foreground/70 hover:text-foreground transition-colors"
        >
          <Filter className="size-3.5 opacity-60" />
          FILTROS
          {hasCustomFilters ? FILTER_DOT : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-64 p-0 max-h-[min(28rem,70vh)] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {screen === "root" ? (
          <>
            {/* Pedido explícito: sem o texto "Filtros" aqui dentro (o
                tooltip já abre a partir de um botão com esse nome, repetir
                era redundante) — só o link "Limpar" (sem "tudo"), alinhado à
                esquerda (mesma coluna dos rótulos Período/Cidade/
                Proprietário abaixo), usando text-foreground/70 (igual ao
                gatilho "Filtros") em vez de text-muted-foreground, que
                ficava escuro demais no tema escuro. */}
            <div className="flex items-center justify-start gap-2 px-3 py-2.5 border-b border-border">
              <button
                type="button"
                disabled={!hasCustomFilters}
                onClick={onClearAll}
                className="text-[11px] font-medium text-foreground/70 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                Limpar
              </button>
            </div>
            <button
              type="button"
              onClick={() => setScreen("period")}
              className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/30"
            >
              <span className="text-xs font-medium">Período</span>
              <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                <span className="truncate max-w-[7rem]">{periodLabel}</span>
                <ChevronRight className="size-3.5 shrink-0 opacity-60" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => setScreen("city")}
              className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/30"
            >
              <span className="text-xs font-medium">Cidade</span>
              <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                <span className="truncate max-w-[7rem]">{cityLabel}</span>
                <ChevronRight className="size-3.5 shrink-0 opacity-60" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => setScreen("owner")}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-secondary/30"
            >
              <span className="text-xs font-medium">Proprietário</span>
              <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                <span className="truncate max-w-[7rem]">{ownerLabel}</span>
                <ChevronRight className="size-3.5 shrink-0 opacity-60" />
              </span>
            </button>
          </>
        ) : null}

        {screen === "period" ? (
          <>
            <BackRow label="Filtros" />
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground">Período</p>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
                  onClick={() => {
                    setDraft(undefined);
                    onPeriodRangeChange(null);
                  }}
                >
                  Limpar
                </button>
              </div>
              {/* Calendário padrão (completo) — o MESMO componente/config
                  (mode="range", 1 mês) que já era usado no antigo botão
                  "Período" sozinho, não uma versão reduzida. */}
              <RangeCalendar
                mode="range"
                numberOfMonths={1}
                locale={ptBR}
                selected={draft}
                onSelect={(nextRange) => {
                  setDraft(nextRange);
                  // Só propaga quando o intervalo estiver completo (início E
                  // fim) — o primeiro clique sozinho ainda não é um período
                  // válido.
                  if (nextRange?.from && nextRange?.to) {
                    onPeriodRangeChange({ start: dateToISOLocal(nextRange.from), end: dateToISOLocal(nextRange.to) });
                  }
                }}
                className="p-0"
              />
              <div className="text-center text-[11px] text-muted-foreground">
                {draft?.from ? format(draft.from, "dd/MM", { locale: ptBR }) : "Início"}
                {" – "}
                {draft?.to ? format(draft.to, "dd/MM", { locale: ptBR }) : "Fim"}
              </div>
            </div>
          </>
        ) : null}

        {screen === "city" ? (
          <>
            <BackRow label="Filtros" />
            <Command>
              <CommandInput placeholder="Buscar cidade..." />
              <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
                  onClick={() => onCityFiltersChange(cityOptions)}
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
                  onClick={() => onCityFiltersChange([])}
                >
                  Limpar
                </button>
              </div>
              <CommandList className="max-h-52">
                <CommandEmpty>Nenhum resultado.</CommandEmpty>
                <CommandGroup>
                  {cityOptions.map((o) => (
                    <CommandItem
                      key={o}
                      value={o}
                      onSelect={() => toggle(cityFilters, o, onCityFiltersChange)}
                      className="cursor-pointer gap-2"
                    >
                      <Checkbox checked={cityFilters.includes(o)} className="pointer-events-none" />
                      <span className="truncate">{o}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </>
        ) : null}

        {screen === "owner" ? (
          <>
            <BackRow label="Filtros" />
            <Command>
              <CommandInput placeholder="Buscar proprietário..." />
              <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
                  onClick={() => onOwnerFiltersChange(ownerOptions)}
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
                  onClick={() => onOwnerFiltersChange([])}
                >
                  Limpar
                </button>
              </div>
              <CommandList className="max-h-52">
                <CommandEmpty>Nenhum resultado.</CommandEmpty>
                <CommandGroup>
                  {ownerOptions.map((o) => (
                    <CommandItem
                      key={o}
                      value={o}
                      onSelect={() => toggle(ownerFilters, o, onOwnerFiltersChange)}
                      className="cursor-pointer gap-2"
                    >
                      <Checkbox checked={ownerFilters.includes(o)} className="pointer-events-none" />
                      <span className="truncate">{o}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Agenda macro: ocupação de todos os imóveis nos próximos dias.
 *
 * Os filtros de Período/Proprietário/Cidade não vivem mais aqui como
 * botões separados — viraram um botão único (`CalendarFiltersButton`, ao
 * lado do título) dentro do cabeçalho deste painel. O ESTADO continua
 * vivendo no OperationWorkspace (o pai), porque também precisa afetar os
 * cards "Limpezas Realizadas"/"Custo Total Limpeza" (que são irmãos deste
 * painel, na aba "Limpeza") — por isso os valores/opções e os callbacks de
 * mudança chegam tudo via props. `properties` já chega FILTRADA.
 */
function OccupancyPanel({
  loading,
  start,
  days,
  properties,
  stays,
  checkedInPropertyIds,
  periodRange,
  onPeriodRangeChange,
  cityFilters,
  onCityFiltersChange,
  cityOptions,
  ownerFilters,
  onOwnerFiltersChange,
  ownerOptions,
  hasCustomFilters,
  onClearAllFilters,
}: {
  loading: boolean;
  start: string;
  days: number;
  properties: Array<{ id: string; name: string; city: string | null; ownerName?: string | null }>;
  stays: Array<{
    propertyId: string;
    checkin: string;
    checkout: string | null;
    guest: string | null;
    checkinDone: boolean;
    checkoutDone: boolean;
  }>;
  checkedInPropertyIds: Set<string>;
  /** Pedido explícito: os filtros (Período/Cidade/Proprietário) que antes
   * ficavam numa linha própria acima deste card viraram um botão único
   * (`CalendarFiltersButton`) dentro do cabeçalho, ao lado do título — por
   * isso o estado/opções continuam vindo do pai (`OperationWorkspace`),
   * que é quem também usa esses mesmos filtros pros cards de limpeza. */
  periodRange: { start: string; end: string } | null;
  onPeriodRangeChange: (next: { start: string; end: string } | null) => void;
  cityFilters: string[];
  onCityFiltersChange: (next: string[]) => void;
  cityOptions: string[];
  ownerFilters: string[];
  onOwnerFiltersChange: (next: string[]) => void;
  ownerOptions: string[];
  hasCustomFilters: boolean;
  onClearAllFilters: () => void;
}) {
  /**
   * Mobile: exatamente 5 dias inteiros no visor.
   * Desktop: o máximo de dias inteiros que couber na largura do quadrante,
   * sem nunca cortar a bolinha do último dia.
   */
  const NAME_COL_BASE = 130;
  const MOBILE_DAYS = 5;
  const MIN_DAY_W = 38; // largura mínima por coluna no desktop
  // Recolhido por padrão — reduz a poluição visual da tela; a pessoa expande
  // quando quiser ver a agenda.
  const [open, setOpen] = useState(false);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const scrollbarWRef = useRef<number | null>(null);
  const [dayW, setDayW] = useState(40);
  const [visibleDays, setVisibleDays] = useState(MOBILE_DAYS);
  // Largura da coluna do nome — normalmente NAME_COL_BASE, mas cresce pra
  // absorver a sobra do arredondamento (usable/count nem sempre é um número
  // inteiro exato). Sem isso, essa sobra virava um espaço vazio (ou uma
  // coluna de dia cortada pela metade) na margem direita do quadrante.
  const [nameColW, setNameColW] = useState(NAME_COL_BASE);
  const dotSize = Math.max(18, Math.min(28, dayW - 6));
  // largura exata do "visor": nome + N colunas inteiras (sem sobra de coluna cortada)
  const viewportW = nameColW + visibleDays * dayW;

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (!w) return;
      // A largura era medida no wrapper de FORA (`outerRef`), que não tem
      // scrollbar própria — mas quando há mais de 5 imóveis, o painel de
      // baixo (o mesmo elemento que rola os dias na horizontal) também rola
      // na vertical e ganha uma scrollbar real, que come uma fatia da
      // largura horizontal disponível. Sem descontar essa fatia aqui, o
      // cálculo achava que sobrava mais espaço do que realmente sobra depois
      // da scrollbar — cortando a última coluna de dia e, em alguns
      // navegadores, deixando a barra de dias "assentar" fora da posição 0,
      // empurrando o dia de hoje pra debaixo da coluna (fixa) dos nomes.
      // Medida uma vez só (o valor não muda em runtime) e sempre descontada,
      // mesmo quando a scrollbar não aparece — a sobra vai pra coluna do
      // nome, igual a qualquer outra sobra de arredondamento, então nunca
      // cria espaço em branco de verdade.
      if (scrollbarWRef.current === null) {
        scrollbarWRef.current = measureScrollbarWidth();
      }
      const usable = w - NAME_COL_BASE - scrollbarWRef.current;
      // 1024px pra bater exatamente com o breakpoint `lg:` do Tailwind — é o
      // MESMO breakpoint que este card usa pra virar `lg:col-span-4` (linha
      // do grid ~2320 abaixo). Antes usava 768px aqui, um valor DIFERENTE do
      // breakpoint real do layout: numa largura entre 768 e 1024 (tablet, ou
      // uma pré-visualização "mobile" mais larga), o grid de fora ainda tratava
      // a página como mobile (o card ocupa a largura toda, bem mais que
      // 768px), mas ESTE cálculo achava que já era desktop e tentava encaixar
      // o máximo de colunas de 38px que coubessem — muito mais que os 5 dias
      // pensados pra tela pequena, com cada coluna minúscula e a sobra de
      // arredondamento inchando a coluna do nome a ponto de invadir
      // visualmente o espaço dos primeiros dias.
      const isDesktop = w >= 1024;
      const count = isDesktop ? Math.max(1, Math.min(days, Math.floor(usable / MIN_DAY_W))) : MOBILE_DAYS;
      // Regra original: nome fixo (+ sobra) + N colunas INTEIRAS preenchendo
      // 100% da largura disponível — nunca deixar sobra vazia (barra cinza)
      // nem cortar coluna alguma na margem direita. A sobra do
      // arredondamento (usable não dividido perfeitamente por `count`) vai
      // pra coluna do NOME em vez de ficar de fora — é ela que cresce,
      // nunca uma coluna de dia cortada.
      const baseDayW = Math.max(MIN_DAY_W, Math.floor(usable / count));
      const leftover = Math.max(0, usable - baseDayW * count);
      setVisibleDays(count);
      setDayW(baseDayW);
      setNameColW(NAME_COL_BASE + leftover);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // `open` também entra nas deps: recolhido por padrão, este nó nem existe
    // (`el` fica null e o efeito sai cedo) até a pessoa expandir — precisa
    // rodar de novo nesse momento pra medir a largura real pela 1ª vez.
  }, [days, open]);

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

  // Proprietário/Cidade já vêm filtrados do pai — aqui só ordena pra
  // exibição (proprietário → nome → cidade), igual antes.
  const visibleProperties = useMemo(() => {
    const cmp = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });
    return properties
      .slice()
      .sort(
        (a, b) =>
          cmp(a.ownerName ?? "zzz", b.ownerName ?? "zzz") ||
          cmp(a.name, b.name) ||
          cmp(a.city ?? "zzz", b.city ?? "zzz"),
      );
  }, [properties]);

  // Mostra no máximo 5 imóveis SEM cortar nenhuma linha ao meio — mesma
  // lógica de "N itens inteiros" já usada nas listas do Kanban
  // (useWholeCardsMaxHeight): mede a altura real de cada linha e trava o
  // quadro exatamente no fim da 5ª, sobrando scroll pro resto.
  const list = useWholeCardsMaxHeight(5, `${visibleProperties.length}:${loading}:${dayW}`);

  const byProperty = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        checkin: string;
        checkout: string | null;
        guest: string | null;
        checkinDone: boolean;
        checkoutDone: boolean;
      }>
    >();
    for (const s of stays) {
      const arr = map.get(s.propertyId) ?? [];
      arr.push({
        checkin: s.checkin,
        checkout: s.checkout,
        guest: s.guest,
        checkinDone: s.checkinDone,
        checkoutDone: s.checkoutDone,
      });
      map.set(s.propertyId, arr);
    }
    return map;
  }, [stays]);

  // "in" = check-in confirmado (verde) · "in-pending" = check-in ainda não
  // confirmado (azul claro) · "in-late" = data de check-in já passou sem
  // confirmação (vermelho) — mesma regra do `isOverdue` dos cards do Kanban.
  // Idem para o checkout: "out-pending"/"out-done"/"out-late".
  type CellPart = "in" | "in-pending" | "in-late" | "out-pending" | "out-done" | "out-late" | "busy" | "free";

  /**
   * Cada dia é dividido em duas metades (manhã = saída, tarde = entrada),
   * que é a ordem natural do dia. Quando as duas metades são iguais o
   * desenho é renderizado inteiro.
   */
  function cellHalves(propertyId: string, day: string): [CellPart, CellPart] {
    const list = byProperty.get(propertyId) ?? [];
    const outStay = list.find((s) => s.checkout === day);
    const inStay = list.find((s) => s.checkin === day);
    const through = list.some((s) => s.checkin < day && (s.checkout ?? s.checkin) > day);

    // "Atrasado" = a data do checkout/check-in já passou e ainda não foi
    // confirmado — mesma regra do card (`row.date < todayISO && !done`).
    const first: CellPart = outStay
      ? day < todayISO && !outStay.checkoutDone
        ? "out-late"
        : outStay.checkoutDone
          ? "out-done"
          : "out-pending"
      : through
        ? "busy"
        : "free";
    // Depois que o check-in é marcado como concluído, a metade da tarde passa
    // a ser "ocupado" — a metade da manhã (checkout) permanece como estava.
    const second: CellPart = inStay
      ? day === todayISO && checkedInPropertyIds.has(propertyId)
        ? "busy"
        : day < todayISO && !inStay.checkinDone
          ? "in-late"
          : inStay.checkinDone
            ? "in"
            : "in-pending"
      : through
        ? "busy"
        : "free";
    return [first, second];
  }

  const clsOf = (s: CellPart) =>
    s === "in"
      ? "bg-emerald-500"
      : s === "in-pending"
        ? "bg-sky-400"
        : s === "in-late"
          ? "bg-red-500"
          : s === "out-pending"
            ? "bg-amber-400"
            : s === "out-done"
              ? "bg-orange-600"
              : s === "out-late"
                ? "bg-red-500"
                : s === "busy"
                  ? "bg-primary/35"
                  : "bg-transparent";

  // Legenda: só entram os estados que realmente aparecem no recorte atual do
  // calendário (imóveis + dias filtrados) — pedido explícito pra não poluir
  // a legenda com status que não têm nenhuma ocorrência na tela.
  const LEGEND_ITEMS: Array<{ state: CellPart; label: string }> = [
    { state: "out-pending", label: "Checkout Pendente" },
    { state: "out-done", label: "Checkout Confirmado" },
    { state: "out-late", label: "Checkout Atrasado" },
    { state: "in-pending", label: "Check-In Pendente" },
    { state: "in", label: "Check-In Confirmado" },
    { state: "in-late", label: "Check-In Atrasado" },
    { state: "busy", label: "Ocupado" },
    { state: "free", label: "Livre" },
  ];

  const presentStates = useMemo(() => {
    const set = new Set<CellPart>();
    for (const p of visibleProperties) {
      for (const d of dayList) {
        const [a, b] = cellHalves(p.id, d);
        set.add(a);
        set.add(b);
      }
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProperties, dayList, byProperty, checkedInPropertyIds, todayISO]);

  return (
      <section className="relative rounded-[0.3rem] border-0 bg-card ds-3d">
        {/* Pedido explícito: o botão único de filtros (Período/Cidade/
            Proprietário/limpar) fica AO LADO do título, entre o texto e a
            setinha de expandir/recolher — por isso o cabeçalho deixou de
            ser um único <button> cobrindo a linha toda e virou uma
            <div> com dois botões independentes (título+ícone / filtros),
            mais a setinha por último. Clicar no título OU na setinha
            expande/recolhe; clicar no botão de filtros não. */}
        <div className="flex w-full items-center gap-2 px-3.5 py-3.5 text-left">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            // Pedido explícito: sem fundo no ícone, alinhado à esquerda igual
            // ao ícone do card "Limpezas Realizadas" (mesmo padding px-3.5).
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <CalendarRange className="size-3.5 shrink-0 text-foreground/70" strokeWidth={2} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-snug text-foreground">
              Calendário de ocupação
            </span>
          </button>
          <CalendarFiltersButton
            periodRange={periodRange}
            onPeriodRangeChange={onPeriodRangeChange}
            cityFilters={cityFilters}
            onCityFiltersChange={onCityFiltersChange}
            cityOptions={cityOptions}
            ownerFilters={ownerFilters}
            onOwnerFiltersChange={onOwnerFiltersChange}
            ownerOptions={ownerOptions}
            hasCustomFilters={hasCustomFilters}
            onClearAll={onClearAllFilters}
          />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Recolher calendário de ocupação" : "Expandir calendário de ocupação"}
            className="shrink-0 p-0.5"
          >
            <ChevronDown
              className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
        {open && (
        <div className="border-t border-border/50 px-4 sm:px-5 pt-4 pb-5">
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
                  ref={list.ref}
                  style={{
                    scrollPaddingLeft: nameColW,
                    width: viewportW,
                    maxWidth: "100%",
                    ...(list.maxHeight !== undefined ? { maxHeight: list.maxHeight } : {}),
                  }}
                  className="sg-elegant-scroll max-h-[22rem] overflow-auto snap-x snap-mandatory"
                >
                  <table
                    className="table-fixed border-separate border-spacing-x-0 border-spacing-y-1 text-xs"
                    style={{ width: nameColW + dayList.length * dayW, minWidth: nameColW + dayList.length * dayW }}
                  >
                    <thead>
                      <tr>
                        <th
                          className="sticky left-0 top-0 z-20 bg-card pb-2 pr-3 text-left"
                          style={{ width: nameColW, minWidth: nameColW }}
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
                              className="sticky top-0 z-20 snap-start bg-card px-0 pb-2 font-medium tabular-nums"
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
                          <tr key={p.id} data-whole-card className="group">
                            <td
                              className="sticky left-0 z-10 bg-card py-1 pr-3 align-middle"
                              style={{ width: nameColW, minWidth: nameColW }}
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
                                  <div className="truncate text-[10px] leading-tight text-muted-foreground">
                                    {p.city}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            {dayList.map((d, i) => {
                              const a = halves[i * 2] as CellPart;
                              const b = halves[i * 2 + 1] as CellPart;
                              const labelOf = (s: CellPart) =>
                                s === "in"
                                  ? "Check-in confirmado"
                                  : s === "in-pending"
                                    ? "Check-in pendente"
                                    : s === "in-late"
                                      ? "Check-in atrasado"
                                      : s === "out-pending"
                                        ? "Checkout pendente"
                                        : s === "out-done"
                                          ? "Checkout confirmado"
                                          : s === "out-late"
                                            ? "Checkout atrasado"
                                            : s === "busy"
                                              ? "Ocupado"
                                              : "Livre";
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
                                  {/* Sem z-index explícito aqui: como os cabeçalhos
                                      "sticky" (topo/nome) usam z positivo, ficam
                                      sempre acima por padrão — antes as bolinhas
                                      coloridas tinham o MESMO z-10 dos cabeçalhos,
                                      e ao rolar a tela (empate de z-index resolvido
                                      pela ordem no DOM) elas passavam por cima dos
                                      dias fixos no topo. */}
                                  <div className="relative flex h-6 w-full items-center">
                                    <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/50" />
                                    <div className={`relative h-full w-1/2 ${clsOf(a)} ${round(idxA)}`} />
                                    <div className={`relative h-full w-1/2 ${clsOf(b)} ${round(idxB)}`} />
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
                {LEGEND_ITEMS.filter((item) => presentStates.has(item.state)).map((item) => (
                  <span key={item.state} className="inline-flex items-center gap-1.5">
                    {item.state === "free" ? (
                      <span className="h-px w-4 bg-border" />
                    ) : (
                      <span className={`h-2 w-4 rounded-full ${clsOf(item.state)}`} />
                    )}
                    {item.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
        )}
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
    // Grade de 4 colunas (barrinha | frase | espaço flexível | valor)
    // compartilhada pelas duas linhas. A barrinha fica na 1ª coluna, com
    // largura FIXA (mesma nas duas linhas, por definição, já que é a mesma
    // coluna da grade). A 2ª coluna (frase) usa "max-content" — do tamanho
    // exato do texto, SEM esticar — para que a 2ª coluna comece sempre no
    // mesmo X nas duas linhas sem sobrar espaço vazio depois da frase (com
    // "auto" simples, sem nenhuma coluna "1fr", a grade estica as colunas
    // "auto" para preencher o espaço livre do quadrante — é o que abria um
    // vão enorme entre a frase e o valor). A 3ª coluna ("1fr") absorve TODO
    // o espaço livre, empurrando a 4ª coluna (valor) para a borda direita do
    // quadrante — é assim que o "X de Y" fica sempre alinhado à direita,
    // não importa a largura do quadrante.
    <div
      className="relative grid items-center gap-x-2.5 gap-y-1.5 text-sm"
      style={{ gridTemplateColumns: "2.5rem max-content 1fr max-content" }}
    >
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

/**
 * Card individual do Engajamento (desktop) — exatamente o tratamento visual
 * do mockup aprovado (borda + fundo com gradiente radial roxo/rosa + acento
 * lateral + ícone em caixinha + valor em destaque), só sem negrito nas
 * frases (pedido explícito).
 */
function EngagementCard({
  icon: Icon,
  label,
  value,
  total,
  pct,
  breakdown,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  total: number;
  pct: number;
  breakdown?: Breakdown;
  hint?: string;
}) {
  const labelEl = breakdown ? (
    <EngagementBreakdownDialog
      label={label}
      value={value}
      total={total}
      breakdown={breakdown}
      trigger={
        <button
          type="button"
          aria-label={`Detalhes: ${label}`}
          className="min-w-0 truncate rounded px-1 -mx-1 py-0.5 text-left text-[13px] font-normal text-foreground transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </button>
      }
    />
  ) : (
    <span className="min-w-0 truncate text-[13px] font-normal text-foreground">{label}</span>
  );

  return (
    <div
      className="relative h-full overflow-hidden rounded-lg border border-purple-300/30 bg-card px-3.5 py-3 shadow-[0_8px_24px_-12px_rgba(168,85,247,0.35)]"
      style={{
        backgroundImage:
          "radial-gradient(120% 140% at 0% 0%, rgba(168,85,247,0.16), transparent 55%), radial-gradient(120% 140% at 100% 100%, rgba(236,72,153,0.12), transparent 55%)",
      }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-purple-500 to-pink-500" />
      <div className="mb-2 flex items-center justify-between gap-2">
        {labelEl}
        <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-purple-500/15 text-purple-600 dark:text-purple-300">
          <Icon className="size-3" strokeWidth={2.5} />
        </span>
      </div>
      <div className="mb-2 flex items-baseline gap-1.5">
        <span className="text-[22px] font-normal leading-none tabular-nums text-foreground">{value}</span>
        <span className="text-xs font-normal text-muted-foreground inline-flex items-center gap-1">
          de {total} ({pct}%)
          {hint ? <InfoHint title={label}>{hint}</InfoHint> : null}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-rose-500/60 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Mesma lógica dos cards: hóspede principal (1º a acessar) + "+N" expansível.
 * Layout em "linha-cartão" com avatar de iniciais (redesign aprovado do
 * tooltip de engajamento — Opção C: abas "Viram"/"Não viram" + linhas mais
 * espaçadas).
 */
function GuestMarkGroup({ group, tone }: { group: GuestMark[]; tone: "ok" | "off" }) {
  const [open, setOpen] = useState(false);
  const [main, ...rest] = group;
  const initial = (main.name.trim()[0] ?? "?").toUpperCase();
  return (
    <li data-whole-card className="rounded-lg bg-muted/30 px-2.5 py-2">
      <div className="flex items-center gap-2.5">
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
            tone === "ok"
              ? "bg-emerald-500/15 text-emerald-600 shadow-[inset_0_0_0_1.5px_rgba(16,185,129,0.4)] dark:text-emerald-400"
              : "bg-rose-500/15 text-rose-600 shadow-[inset_0_0_0_1.5px_rgba(244,63,94,0.4)] dark:text-rose-400"
          }`}
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-foreground/90">{main.name}</span>
          {main.property ? (
            <span className="block truncate text-[10.5px] text-muted-foreground">{main.property}</span>
          ) : null}
        </span>
        {rest.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-secondary/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
            title={`${rest.length} outro(s) hóspede(s) nesta reserva`}
          >
            +{rest.length}
            <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {open && rest.length > 0 && (
        <ul className="ml-9 mt-1.5 space-y-0.5 rounded-lg border border-border/50 bg-background/60 px-2 py-1.5">
          {rest.map((g, i) => (
            <li key={`${g.name}-${i}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-1 shrink-0 rounded-full bg-muted-foreground/60" />
              <span className="min-w-0 truncate">{g.name}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function GuestMarkList({ items, tone }: { items: GuestMark[]; tone: "ok" | "off" }) {
  if (items.length === 0)
    return (
      <div className="rounded-lg bg-muted/20 px-3 py-4 text-center text-[11px] text-muted-foreground">Ninguém</div>
    );
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
    <ul className="space-y-1.5">
      {groups.slice(0, 12).map((g, i) => (
        <GuestMarkGroup key={`${g[0].name}-${i}`} group={g} tone={tone} />
      ))}
      {groups.length > 12 && (
        <li className="text-center text-[11px] text-muted-foreground">+{groups.length - 12} outros</li>
      )}
    </ul>
  );
}

/**
 * Dialog de detalhe (quem viu / quem não viu) — extraído do BarRow original
 * pra poder ser reaproveitado também pelo EngagementCard (cards separados do
 * desktop), sem duplicar esse JSX nos dois lugares.
 */
/**
 * Redesign aprovado (Opção C): abas "Viram"/"Não viram" em vez das 2 listas
 * empilhadas — só um grupo por vez, com mais respiro por linha (avatar de
 * iniciais + nome + imóvel), melhor pra quando a lista de hóspedes cresce.
 */
function EngagementBreakdownDialog({
  label,
  value,
  total,
  breakdown,
  trigger,
}: {
  label: string;
  value: number;
  total: number;
  breakdown: Breakdown;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"viewed" | "notViewed">("viewed");
  // Sempre volta pra aba "Viram" ao reabrir — evita ficar preso numa aba de
  // uma consulta anterior (ex.: outro imóvel/período com "Não viram" vazio).
  useEffect(() => {
    if (open) setTab("viewed");
  }, [open]);
  const pct = Math.min(100, Math.round((value / Math.max(total, 1)) * 100));
  const activeItems = tab === "viewed" ? breakdown.viewed : breakdown.notViewed;
  // Mesmo racional dos quadrantes de check-in/check-out (useWholeCardsMaxHeight):
  // mostra sempre cards INTEIROS, nunca corta um no meio. Como agora só 1
  // lista ocupa o espaço por vez (abas), cabem mais itens inteiros do que
  // antes, quando as 2 listas dividiam a mesma altura.
  const list = useWholeCardsMaxHeight(5, `${open}:${tab}:${activeItems.length}`);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-lg border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" />
        <DialogHeader className="px-5 pt-5 pb-1 pr-14">
          {/* pr-14 no header: reserva espaço pro botão "X" de fechar do Dialog
              (absolute right-4 top-4, size-8), que senão fica por cima do
              badge de percentual quando o título é curto. */}
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="min-w-0 truncate text-base font-display leading-tight">{label}</DialogTitle>
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
              {pct}%
            </span>
          </div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mt-0.5">
            {value} de {total} check-ins
          </div>
        </DialogHeader>

        <div className="mx-5 mt-3.5 flex gap-1 rounded-lg bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => setTab("viewed")}
            className={`flex-1 rounded-md py-1.5 text-[11.5px] font-semibold transition-colors ${
              tab === "viewed" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Viram ({breakdown.viewed.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("notViewed")}
            className={`flex-1 rounded-md py-1.5 text-[11.5px] font-semibold transition-colors ${
              tab === "notViewed" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Não viram ({breakdown.notViewed.length})
          </button>
        </div>

        <div
          ref={list.ref}
          style={list.maxHeight !== undefined ? { maxHeight: list.maxHeight } : undefined}
          className="sg-elegant-scroll overflow-y-auto px-5 pb-5 pt-3"
        >
          <GuestMarkList items={activeItems} tone={tab === "viewed" ? "ok" : "off"} />
        </div>
      </DialogContent>
    </Dialog>
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
  // Cada BarRow devolve um FRAGMENT com 3 itens soltos, na ordem barrinha →
  // frase → valor — sem <div> envolvendo — assim eles caem como filhos
  // DIRETOS da grade de 3 colunas do EngagementBars (ver comentário lá): é
  // a grade (1ª coluna de largura fixa), e não este componente, quem faz a
  // barrinha bater na mesma largura e a frase começar sempre no mesmo X
  // entre as duas linhas.
  const barCell = (
    <div className="h-1.5 w-full rounded-full bg-rose-500/60 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
  const valueCell = (
    <span className="tabular-nums text-muted-foreground text-xs whitespace-nowrap inline-flex items-center gap-1">
      {value} de {total}
      {hint ? <InfoHint title={label}>{hint}</InfoHint> : null}
    </span>
  );
  // Espaçador vazio — 3ª coluna ("1fr") da grade em EngagementBars. Sem ele,
  // a grade não teria um item nessa coluna para "abrir espaço" antes do
  // valor, e o valor acabaria colado logo após a frase em vez de encostado
  // na borda direita do quadrante.
  const spacerCell = <span aria-hidden="true" />;
  if (!breakdown) {
    return (
      <>
        {barCell}
        <span className="whitespace-nowrap font-medium">{label}</span>
        {spacerCell}
        {valueCell}
      </>
    );
  }
  return (
    <>
      {barCell}
      <EngagementBreakdownDialog
        label={label}
        value={value}
        total={total}
        breakdown={breakdown}
        trigger={
          <button
            type="button"
            aria-label={`Detalhes: ${label}`}
            className="whitespace-nowrap rounded-lg px-1 -mx-1 py-0.5 text-left font-medium transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </button>
        }
      />
      {spacerCell}
      {valueCell}
    </>
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
  onEditPredictedDate,
  onClearPredicted,
  busyRowId,
  muted,
  cleaningPendingPropIds,
  expandedId: expandedIdProp,
  onExpandedChange,
  compact,
  cleaningTasks,
  onToggleCleaningTask,
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
  onEditPredictedDate?: (r: ArrivalRow, date: string | null) => void;
  /** Limpa Data + Horário previstos de uma vez (botão de limpar). */
  onClearPredicted?: (r: ArrivalRow) => void;
  /** Só o card em ação fica travado — o restante do quadro segue responsivo. */
  busyRowId?: string | null;
  muted?: boolean;
  cleaningPendingPropIds?: Map<string, "checkout" | "cleaning">;
  /** Controlado de fora (pela coluna do Kanban) quando presente — permite
   * recolher os "Detalhes da operação" ao rolar a coluna. Sem isso, cai de
   * volta pro estado local de sempre. */
  expandedId?: string | null;
  onExpandedChange?: (id: string | null) => void;
  /** Modo "Lista" (pedido explícito) — repassado pra cada ArrivalCard. */
  compact?: boolean;
  /** Pendências pra exibir como checklist no card (só a coluna de Limpeza
   * repassa isso — ver arrivalGroupPropsFor). */
  cleaningTasks?: { tasks: TaskRow[]; completions: TaskCompletion[] };
  onToggleCleaningTask?: (task: TaskRow, row: ArrivalRow) => void;
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
    // gap maior que o "gap-1.5" de antes: dá espaço pro badge de engajamento
    // (fixo no topo de cada card, cortando a borda) sem sobrepor o card
    // anterior.
    <div className={`flex flex-col gap-4 ${muted ? "opacity-70" : ""}`}>
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
          onEditPredictedDate={onEditPredictedDate}
          onClearPredicted={onClearPredicted}
          busy={busyRowId === r.logId}
          expanded={openId === r.logId}
          onToggleExpanded={(open) => setOpenId(open ? r.logId : null)}
          cleaningBlocked={mode === "checkin" ? (cleaningPendingPropIds?.get(r.propertyId) ?? null) : null}
          compact={compact}
          cleaningTasks={cleaningTasks}
          onToggleCleaningTask={onToggleCleaningTask}
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
  onEditPredictedDate,
  onClearPredicted,
  busy,
  expanded,
  onToggleExpanded,
  cleaningBlocked,
  compact,
  cleaningTasks,
  onToggleCleaningTask,
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
  onEditPredictedDate?: (r: ArrivalRow, date: string | null) => void;
  /** Limpa Data + Horário previstos de uma vez (botão de limpar). */
  onClearPredicted?: (r: ArrivalRow) => void;
  busy: boolean;
  expanded?: boolean;
  onToggleExpanded?: (open: boolean) => void;
  cleaningBlocked?: "checkout" | "cleaning" | null;
  /** Modo "Lista" (pedido explícito): mostra só proprietário, imóvel e os
      botões de ação (bem menores) — some com nome do hóspede, código,
      período, previsto e alertas de iCal. Reaproveita o mesmo card e os
      mesmos handlers; só a apresentação muda. */
  compact?: boolean;
  /** Checklist de pendências (só no modo "cleaning" — ver mais abaixo). */
  cleaningTasks?: { tasks: TaskRow[]; completions: TaskCompletion[] };
  onToggleCleaningTask?: (task: TaskRow, row: ArrivalRow) => void;
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

  // Checklist de pendências desta limpeza — só no modo "cleaning". Pontual
  // (log/reserva na própria pendência): o "feito" é o status da pendência.
  // Recorrente (sem log/reserva, permanente do imóvel): o "feito" é uma
  // marca separada (task_completions) pra ESTA ocorrência — a pendência
  // continua ativa e volta pendente na próxima limpeza.
  const cleaningChecklist = useMemo(() => {
    if (mode !== "cleaning" || !cleaningTasks) return [];
    const completedHere = new Set(
      cleaningTasks.completions
        .filter(
          (c) =>
            (!!row.logId && c.logId === row.logId) || (!!row.reservationId && c.reservationId === row.reservationId),
        )
        .map((c) => c.taskId),
    );
    return cleaningTasks.tasks
      .filter((t) => t.showInCleaning && t.status !== "canceled")
      .filter((t) =>
        t.logId || t.reservationId
          ? (!!t.logId && t.logId === row.logId) || (!!t.reservationId && !!row.reservationId && t.reservationId === row.reservationId)
          : t.propertyId === row.propertyId,
      )
      .map((t) => ({ task: t, done: t.logId || t.reservationId ? t.status === "done" : completedHere.has(t.id) }));
  }, [mode, cleaningTasks, row.logId, row.reservationId, row.propertyId]);

  const guestTime = row.arrivalTimeOverride ?? row.guestArrivalTime;
  // Horário padrão exibido ao lado do período. No check-in, standardTime é o
  // início e standardTimeMax o fim ("15:00 – 23:00"). No checkout os campos
  // são invertidos (standardTime = horário limite / checkout_time,
  // standardTimeMax = horário de abertura / checkout_time_min) — pedido
  // explícito: quando não há horário "a partir de" configurado, mostra
  // "ATÉ <horário limite>" em vez do horário limite sozinho.
  const stdWindow =
    kind === "checkout"
      ? row.standardTime && row.standardTimeMax
        ? `${row.standardTimeMax} – ${row.standardTime}`
        : row.standardTime
          ? `ATÉ ${row.standardTime}`
          : (row.standardTimeMax ?? null)
      : row.standardTime
        ? row.standardTimeMax
          ? `${row.standardTime} – ${row.standardTimeMax}`
          : row.standardTime
        : null;
  // Mesma informação do stdWindow acima, mas em frase — usada só no tooltip
  // "i" do campo Previsto (pedido explícito): "entre X e Y" quando há os dois
  // horários, "a partir de X" quando só há o inicial, "até Y" quando só há o
  // final.
  const stdWindowPhrase =
    kind === "checkout"
      ? row.standardTime && row.standardTimeMax
        ? `entre ${row.standardTimeMax} e ${row.standardTime}`
        : row.standardTime
          ? `até ${row.standardTime}`
          : row.standardTimeMax
            ? `a partir de ${row.standardTimeMax}`
            : null
      : row.standardTime
        ? row.standardTimeMax
          ? `entre ${row.standardTime} e ${row.standardTimeMax}`
          : `a partir de ${row.standardTime}`
        : row.standardTimeMax
          ? `até ${row.standardTimeMax}`
          : null;
  const divergent =
    !!guestTime && !!row.standardTime && !isTimeWithin(guestTime, row.standardTime, row.standardTimeMax);

  const done = row.status === "done";
  const visualDone = done && mode !== "cleaning" && mode !== "stay";
  const isPendingFill = row.pendingFill;
  // Janela permitida para a data prevista: da data original de check-in
  // (iCal quando existe) até 1 dia antes do check-out.
  // Sem iCal, congelamos a data original na primeira renderização — senão ela
  // acompanharia a data recém-escolhida e o campo voltaria a ficar em branco.
  const originalCheckinRef = useRef(row.guestCheckin);
  const predictedMinDate = row.ical.icalCheckin ?? originalCheckinRef.current;
  const predictedMaxDate = addDaysISO(row.ical.icalCheckout ?? row.guestCheckout, -1) ?? null;
  const todayISO = todayISOSaoPaulo();
  // "Atrasado" só faz sentido pra uma ação ainda PENDENTE cuja data já
  // passou (ex.: check-in que devia ter acontecido ontem e ninguém marcou).
  // Uma vez concluída (row.status === "done"), a data no passado é só
  // histórico — em "Em Estadia" o check-in sempre tem data passada (é assim
  // que o hóspede está hospedado agora) e isso não é atraso nenhum. Sem essa
  // checagem, todo card que entrava em "Em Estadia" (ou "Em Limpeza", que
  // também segue "ativo" com status done) ficava marcado como atrasado pra
  // sempre, mesmo já concluído. "Data futura" continua podendo aparecer
  // mesmo já concluído (ex.: check-in antecipado pra uma data que ainda não
  // chegou) — esse comportamento não muda.
  const isOverdue = row.date < todayISO && !done;
  const isFuture = row.date > todayISO;
  // Cor do período — substitui as antigas etiquetas "Atrasado"/"Data
  // futura" (removidas a pedido): atrasado sobrepõe qualquer outra cor;
  // fora isso, checkout é laranja, checkin confirmado (Em Estadia) é verde
  // e checkin pendente é azul.
  const periodoColorClass =
    isOverdue && !visualDone
      ? "text-red-800 dark:text-red-400"
      : kind === "checkout"
        ? "text-orange-600 dark:text-orange-400"
        : done
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-sky-700 dark:text-sky-300";
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
  const copyAddress = async () => {
    if (!row.propertyAddress) return;
    try {
      await navigator.clipboard.writeText(row.propertyAddress);
      toast.success("Endereço copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };
  // Código da reserva agora é clicável (sem o botão "copiar" ao lado,
  // pedido explícito) — mesmo texto de confirmação do antigo CopyButton.
  const copyReservationCode = async (e: React.MouseEvent, code: string) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Código copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };
  // "Abrir App": deixa o próprio sistema oferecer os apps instalados no
  // celular (Google Maps, Waze, Uber, 99 etc.) via o share sheet nativo —
  // pedido explícito, substitui o antigo "Abrir o Google Maps" fixo.
  // Sem suporte a Web Share (ex.: desktop), cai de volta pro Google Maps.
  const openWithApp = () => {
    if (!mapsHref) return;
    if (typeof navigator.share === "function") {
      navigator
        .share({ title: row.propertyName ?? "Endereço", text: row.propertyAddress ?? undefined, url: mapsHref })
        .catch(() => {
          // Cancelado pelo usuário ou não suportado neste contexto — sem fallback forçado.
        });
      return;
    }
    window.open(mapsHref, "_blank", "noopener,noreferrer");
  };

  // Botão "voltar para a etapa anterior" — no modo Completo é um botão
  // próprio na fileira de ações; no modo Lista (pedido explícito) vive
  // dentro do menu "⋮" em vez de ocupar mais um ícone.
  const canRevert = !!onRevert && mode !== "checkin";
  const showRevertButton = canRevert && !compact;
  const showRevertMenuItem = canRevert && compact;
  const revertConfirmLabel =
    mode === "stay" || mode === "checkout"
      ? "Desfazer o check-in e voltar este card para a lista de Check-ins?"
      : mode === "cleaning"
        ? "Desfazer o check-out e voltar este card para a lista de Checkouts?"
        : "Reabrir esta estadia e voltar o card para a lista Em Limpeza?";
  const revertTitle =
    mode === "stay" || mode === "checkout"
      ? "Voltar para a etapa anterior (lista de Check-ins)"
      : mode === "cleaning"
        ? "Voltar para a etapa anterior (lista de Checkouts)"
        : "Voltar para a etapa anterior (lista Em Limpeza)";
  const handleRevertClick = () => {
    if (window.confirm(revertConfirmLabel)) onRevert?.(row);
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
      // data-whole-card: usado pelo useWholeCardsMaxHeight quando este card
      // aparece dentro de um popup de indicador (KpiCard) — inofensivo aqui
      // no Kanban, que não usa esse hook.
      data-whole-card
      className={`group relative snap-start flex flex-col rounded-none bg-secondary/70 hover:bg-secondary/90 p-3 gap-2.5 transition-colors ${
        isOverdue && !visualDone
          ? "border-l-[3px] border-l-red-500"
          : isFuture && !visualDone
            ? "border-l-[3px] border-l-amber-500"
            : ""
      }`}
    >
      {/* Alerta de engajamento — badge fixo no topo do card, cortando a
          borda superior (pedido explícito), sem a seta de expandir. Some no
          modo "Lista" (pedido explícito: só proprietário/imóvel/botões). */}
      {!compact && mode !== "cleaning" && !isPendingFill && (
        <div className="absolute -top-2.5 right-3 z-10">
          <EngagementFlags
            openedGuide={row.openedGuide}
            readInstructions={row.readInstructions}
            hasPasswords={row.hasPasswords}
            viewedPasswords={row.viewedPasswords}
          />
        </div>
      )}

      {/* Header: nome + imóvel + data — sem avatar (ocupava espaço demais
          numa coluna estreita de Kanban; o nome já identifica o hóspede).
          No modo "Lista" só o proprietário e o imóvel ficam (pedido
          explícito) — nome do hóspede, código e período somem. */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {!compact && (
            <>
              {/* Nome do hóspede — movido para cima do código da reserva
                  (pedido explícito), sem alterar o conteúdo da linha. */}
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
                    <button
                      type="button"
                      onClick={(e) => copyReservationCode(e, row.reservationCode as string)}
                      title="Copiar código da reserva"
                      className="inline-flex items-center gap-1 min-w-0 hover:text-foreground transition-colors"
                    >
                      <span className="truncate">{row.reservationCode}</span>
                    </button>
                  ) : (
                    <span className="truncate uppercase">{row.guestName}</span>
                  )
                ) : (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {/* Pedido explícito: nome do hóspede SEMPRE em maiúsculo nos cards. */}
                    <span className="min-w-0 truncate uppercase">{row.guestName}</span>
                    <PhoneLink phone={row.guestPhone} country={row.guestPhoneCountry} />
                    {/* Pedido explícito: o "+N" (outros hóspedes) fica à direita
                        do ícone do chat, não mais antes do nome. */}
                    <ExtraGuests guests={row.additionalGuests ?? []} />
                  </span>
                )}
              </div>

              {/* Código da reserva — acima do proprietário, alinhado à esquerda.
                  Clicável para copiar; sem o botão "copiar" ao lado (pedido
                  explícito). */}
              {row.reservationCode && (isPendingFill || (row.guestName && row.guestName !== row.reservationCode)) && (
                <button
                  type="button"
                  onClick={(e) => copyReservationCode(e, row.reservationCode as string)}
                  title="Copiar código da reserva"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="truncate max-w-[160px]">{row.reservationCode}</span>
                </button>
              )}

              {/* Período — logo abaixo do código da reserva e acima do
                  proprietário (pedido explícito). Em vez das etiquetas
                  "Atrasado"/"Data futura" (removidas), a cor do próprio período
                  agora comunica o status: checkout = laranja; checkin pendente =
                  azul; checkin confirmado (Em Estadia) = verde; atrasado = vermelho
                  (sobrepõe as outras cores). */}
              <div className={`flex items-center gap-1.5 text-xs flex-wrap ${periodoColorClass}`}>
                <DateEditor
                  value={row.guestCheckin}
                  disabled={busy || isPendingFill}
                  onChange={(v) => onEditDates(row, { checkinDate: v })}
                />
                {row.guestCheckout && (
                  <>
                    <span>→</span>
                    <DateEditor
                      value={row.guestCheckout}
                      disabled={busy || isPendingFill}
                      onChange={(v) => onEditDates(row, { checkoutDate: v })}
                    />
                  </>
                )}
              </div>
            </>
          )}

          <OwnerLine
            name={row.ownerName}
            phone={row.ownerPhone}
            country={row.ownerPhoneCountry}
            phonePosition="adjacent"
          />
          <div className="ds-card-title truncate" title={row.propertyName ?? undefined}>
            {row.propertyName ?? "Sem nome"}
          </div>
        </div>
      </div>

      {/* Previsto — fixo, sem acordeon (mesmo espaçamento (zero) que existe
          entre o nome do hóspede e o período). O alerta de engajamento saiu
          daqui (agora é o badge fixo no topo do card, ver acima) — assim não
          sobra espaço vazio entre este campo e o botão de check-in.
          -mx-3 (cancela o p-3 do card) + px-3 (readiciona por dentro): a
          faixa de fundo agora corta o card de fora a fora (pedido
          explícito) e o texto continua alinhado com o nome do imóvel.
          No modo "Lista" só aparece quando já tem algo preenchido (data
          e/ou horário previstos) — pedido explícito; sem isso continua
          escondida, igual antes. */}
      {mode !== "cleaning" && (!compact || !!(row.arrivalDateOverride || guestTime)) && (
        <div
          className={`-mt-2.5 -mx-3 flex items-center justify-between gap-2 rounded-none px-3 py-1.5 text-xs ${divergent ? "bg-amber-500/10 border-y border-amber-500/30" : "bg-background/50 border-y border-border/40"}`}
        >
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
            Previsto {kind === "checkout" ? "Checkout" : "Check-in"}
            {/* Margem de horário — saiu da tela (pedido explícito) e virou
                tooltip, com o texto de acordo com check-in ou checkout.
                Sem título no tooltip (pedido explícito) — só a frase. */}
            <InfoHint>
              {stdWindowPhrase
                ? `O horário padrão de ${kind === "checkout" ? "checkout" : "check-in"} deste imóvel é ${stdWindowPhrase}.`
                : `Este imóvel não tem horário padrão de ${kind === "checkout" ? "checkout" : "check-in"} configurado.`}
            </InfoHint>
          </span>
          <span className="ml-auto flex items-center justify-end gap-3 shrink-0 text-xs font-medium">
            {/* Limpa Data + Horário previstos de uma vez — só aparece quando
                pelo menos um dos dois estiver preenchido (pedido explícito). */}
            {(row.arrivalDateOverride || row.arrivalTimeOverride) && onClearPredicted && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearPredicted(row);
                }}
                disabled={busy}
                title="Limpar data e horário previstos"
                aria-label="Limpar data e horário previstos"
                className="inline-flex items-center justify-center rounded text-muted-foreground/70 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Eraser className="size-3" />
              </button>
            )}
            <DateEditor
              /* Data prevista é um override próprio do card: fica em
                 branco até alguém registrar chegada em outro dia. */
              value={row.arrivalDateOverride ?? ""}
              disabled={busy || isPendingFill}
              placeholder="Data"
              min={predictedMinDate ?? undefined}
              max={kind === "checkout" ? undefined : (predictedMaxDate ?? undefined)}
              onChange={(v) => onEditPredictedDate?.(row, v)}
              // Mesma fonte do rótulo "Previsto Check-in/Checkout" (pedido
              // explícito) — a cor continua branca quando preenchido, pois
              // vem do texto ambiente; só o placeholder segue cinza (herdado
              // do botão, ver "blank" acima).
              valueClassName="text-[10px] uppercase tracking-wider font-normal"
            />
            {/* Horário só depois da data: a ordem é data → horário. */}
            <TimeDropdown
              value={guestTime ?? null}
              disabled={busy || !row.arrivalDateOverride}
              size="xs"
              onChange={(v) => onEditTime(row, v)}
            />
          </span>
        </div>
      )}

      {/* Alertas de conferência com o Airbnb (iCal) — divergência de datas,
          reserva não encontrada e horário fora da janela padrão, com correção
          em um clique. Some no modo "Lista" (pedido explícito). */}
      {!compact && mode !== "cleaning" && !isPendingFill && (() => {
        const iIn = row.ical.icalCheckin;
        const iOut = row.ical.icalCheckout;
        const dateMismatch =
          row.ical.hasIcal &&
          row.ical.matched &&
          !!iIn &&
          (iIn !== row.guestCheckin || (!!iOut && !!row.guestCheckout && iOut !== row.guestCheckout));
        if (!row.ical.hasIcal) return null;
        const noMatch = !row.ical.matched;
        // Pedido explícito: quando está tudo certo (reserva encontrada e
        // datas batendo) não mostra mais nenhum aviso — a antiga linha
        // "Confirmado via Airbnb" foi removida pra otimizar espaço nos
        // cards. Os alertas acionáveis abaixo continuam aparecendo
        // normalmente quando há algo a corrigir.
        if (!noMatch && !dateMismatch && !divergent) return null;
        return (
          <div className="flex flex-col gap-1.5">
            {noMatch ? (
              <div className="flex items-center gap-1.5 rounded-none border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-700 dark:text-red-400">
                <AlertTriangle className="size-3 shrink-0" />
                <span className="min-w-0">Sem reserva correspondente no iCal</span>
              </div>
            ) : dateMismatch ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-none border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                <span className="inline-flex items-center gap-1 font-medium">
                  <AlertTriangle className="size-3 shrink-0" />
                  Data Divergente Hóspede-Airbnb
                </span>
                <span className="tabular-nums">
                  Informada: {fmtDateBR(row.guestCheckin)}
                  {row.guestCheckout ? ` → ${fmtDateBR(row.guestCheckout)}` : ""} · Correta: {fmtDateBR(iIn)}
                  {iOut ? ` → ${fmtDateBR(iOut)}` : ""}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onEditDates(row, { checkinDate: iIn, ...(iOut ? { checkoutDate: iOut } : {}) })}
                  className="ml-auto rounded-md border border-amber-500/40 px-2 py-0.5 font-semibold hover:bg-amber-500/20 disabled:opacity-50"
                >
                  Usar Airbnb
                </button>
              </div>
            ) : null}

            {divergent && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-none border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle className="size-3 shrink-0" />
                  Horário divergente do padrão{stdWindow ? ` (${stdWindow})` : ""}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSyncIcal(row)}
                  className="ml-auto rounded-md border border-amber-500/40 px-2 py-0.5 font-semibold hover:bg-amber-500/20 disabled:opacity-50"
                >
                  Alinhar
                </button>
              </div>
            )}
          </div>
        );
      })()}


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

      {/* Checklist de pendências desta limpeza — só aparece quando existe
          pelo menos 1 pendência marcada "aparece na limpeza" pra este
          imóvel/estadia (pedido explícito). */}
      {cleaningChecklist.length > 0 && (
        <div className="rounded-lg border border-sky-400/25 bg-sky-400/[0.06] px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-sky-500 dark:text-sky-400">
            <span>Checklist desta limpeza</span>
            <span className="tabular-nums opacity-80">
              {cleaningChecklist.filter((c) => c.done).length}/{cleaningChecklist.length}
            </span>
          </div>
          {cleaningChecklist.map(({ task, done: taskDone }) => (
            <label
              key={task.id}
              className="flex items-start gap-2 cursor-pointer"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={taskDone}
                onCheckedChange={() => onToggleCleaningTask?.(task, row)}
                className="mt-0.5 shrink-0"
              />
              <span className={`text-xs leading-snug ${taskDone ? "text-muted-foreground line-through" : ""}`}>
                {task.title}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Action row: botão principal em largura total; Maps + menu à direita.
          No modo "Lista" (pedido explícito), os 3 botões encolhem ao máximo
          (altura/ícone reduzidos) sem deixar de funcionar — mesmos handlers,
          só o texto do botão principal some (fica só o ícone, com title). */}
      <div className={`mt-auto flex flex-nowrap items-center gap-2 ${compact ? "" : "pt-1"}`}>
        {mode === "done" ? (
          <span
            title="Esteira concluída"
            aria-label="Esteira concluída"
            className={`inline-flex flex-1 min-w-0 items-center justify-center gap-2 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 font-semibold ${compact ? "h-6 px-2 text-[10.5px]" : "h-9 px-3 text-xs"}`}
          >
            <CheckCircle2 className={compact ? "size-3 shrink-0" : "size-4 shrink-0"} />
            {!compact && <span className="truncate">Concluído</span>}
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
                    : mode === "stay"
                      ? "Confirmar check-out"
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
                    : mode === "stay"
                      ? "Confirmar check-out (envia o card para Em Limpeza)"
                      : done
                        ? "Reabrir (voltar para Pendente)"
                        : "Marcar como Concluído"
            }
            className={`flex-1 min-w-0 self-center box-border leading-none inline-flex items-center justify-center gap-2 font-semibold tracking-tight rounded-lg transition-all active:scale-[0.99] ${
              compact ? "h-6 max-h-6 min-h-6 px-2 text-[10.5px]" : "h-9 max-h-9 min-h-9 px-3 text-[12.5px]"
            } ${
              cleaningBlock
                ? "bg-orange-500/25 text-orange-700 dark:text-orange-400 border border-orange-500/50 cursor-not-allowed"
                : blockCheck
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/40 cursor-not-allowed"
                  : mode === "cleaning" || mode === "stay"
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : done
                      ? "bg-secondary text-foreground/80 hover:bg-secondary/80"
                      : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            <Check className={compact ? "size-3 shrink-0" : "size-4 shrink-0"} />
            {/* Modo "Lista": só o ícone, sem o texto (o title do botão acima
                já descreve a ação pra leitor de tela/tooltip nativo). */}
            {!compact && (
              <span className="truncate">
                {mode === "cleaning"
                  ? "Limpeza concluída!"
                  : mode === "checkout" || mode === "stay"
                    ? "Check-out realizado!"
                    : done
                      ? "Reabrir"
                      : "Check-in realizado!"}
              </span>
            )}
          </button>
        )}

        {/* No modo "Lista" (pedido explícito) o botão de voltar some da
            fileira de ações e passa a viver dentro do menu "⋮" — reduz mais
            um ícone da largura sem perder a função (ver showRevertButton /
            revertTitle / handleRevertClick, calculados mais abaixo). */}
        {showRevertButton && (
          <button
            type="button"
            onClick={handleRevertClick}
            disabled={busy}
            aria-label="Voltar para a etapa anterior"
            title={revertTitle}
            className="shrink-0 grid place-items-center rounded-lg bg-secondary hover:bg-secondary/80 border border-border/60 transition-colors size-9"
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
                  className={`grid place-items-center rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08] ${compact ? "size-6" : "size-9"}`}
                >
                  <MapPin className={compact ? "size-3.5" : "size-4"} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                <DropdownMenuItem onClick={copyLink} disabled={!copyText}>
                  <LinkIcon className="size-3.5 shrink-0" /> Copiar Link do Maps
                </DropdownMenuItem>
                <DropdownMenuItem onClick={copyAddress} disabled={!row.propertyAddress}>
                  <Copy className="size-3.5 shrink-0" /> Copiar Endereço
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openWithApp}>
                  <Share2 className="size-3.5 shrink-0" /> Abrir App
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
                className={`grid place-items-center rounded-lg border ${compact ? "size-6" : "size-9"} ${
                  isMutedNow
                    ? "bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-400"
                    : "bg-background/60 border-border/50 hover:bg-primary/[0.08]"
                }`}
              >
                <MoreVertical className={compact ? "size-3.5" : "size-4"} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[13rem]">
              {showRevertMenuItem && (
                <DropdownMenuItem onClick={handleRevertClick} disabled={busy}>
                  <Undo2 className="size-3.5 shrink-0" /> {revertTitle}
                </DropdownMenuItem>
              )}
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

/** Soma dias a uma data ISO (YYYY-MM-DD), sem fuso. */
function addDaysISO(iso: string | null | undefined, days: number): string | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function DateEditor({
  value,
  disabled,
  onChange,
  min,
  max,
  blankWhen,
  placeholder,
  valueClassName,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  /** Quando o valor for igual a esta data, o campo aparece em branco. */
  blankWhen?: string;
  placeholder?: string;
  /** Classes extras pro texto do valor — usado quando este campo precisa
      seguir a fonte de um rótulo específico (ex.: linha "Previsto"). */
  valueClassName?: string;
}) {
  const blank = !value || (!!blankWhen && value === blankWhen);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        const input = e.currentTarget.querySelector("input") as HTMLInputElement | null;
        if (input && typeof input.showPicker === "function") input.showPicker();
        else input?.focus();
      }}
      className={`relative inline-flex items-center cursor-pointer rounded hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:hover:text-inherit ${blank ? "text-muted-foreground" : ""}`}
      title="Clique para corrigir a data"
    >
      <span className={`tabular-nums ${valueClassName ?? ""}`}>{blank ? (placeholder ?? "—") : fmtDateBR(value)}</span>
      <input
        type="date"
        value={blank ? "" : value}
        disabled={disabled}
        min={min}
        max={max}
        onChange={(e) => {
          const v = e.target.value;
          if (!v || v === value) return;
          if (min && v < min) return;
          if (max && v > max) return;
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
          className={`inline-flex w-auto items-center gap-1 tabular-nums rounded cursor-pointer bg-transparent border-0 p-0 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:hover:text-inherit ${size === "xs" ? "text-[10px] uppercase tracking-wider" : "text-sm"}`}
        >
          {/* Mesma fonte do rótulo "Previsto Check-in/Checkout" (pedido
              explícito), mas mantendo a cor branca/foreground quando há
              valor selecionado — só o placeholder continua cinza. */}
          <span className={value ? "font-normal text-foreground" : "font-normal text-muted-foreground"}>
            {value ?? "Horário"}
          </span>
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
