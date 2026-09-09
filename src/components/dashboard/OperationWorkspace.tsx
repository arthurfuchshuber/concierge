import { PhoneActionButton } from "@/components/PhoneActionButton";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAntiClipColumns } from "@/hooks/useAntiClipColumns";
import { useAntiClipBar } from "@/hooks/useAntiClipBar";
import {
  CARD_MUTED,
  CARD_PENDING_GUEST,
  periodColorClass,
  stageBarClass,
  type CardStage,
} from "@/components/dashboard/card-colors";
import { ReservationJourneyDialog } from "@/components/dashboard/ReservationJourneyDialog";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  LabelList,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";
import {
  Search,
  X,
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
  Repeat,
  UserX,
  Ban,
  History,
  Clock3,
} from "lucide-react";
import { toast } from "sonner";
import { notifyAction } from "@/components/UndoActionBar";
import { ReservationRecordsButton } from "@/components/dashboard/ReservationRecords";
import {
  AttachmentPicker,
  AttachmentsSending,
  uploadPendingAttachments,
  AudioAttachButton,
  type PendingAttachment,
} from "@/components/dashboard/TaskAttachments";
import { attachTaskRecord } from "@/lib/reservation-records.functions";
import { format, parse, isValid, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { toBlob } from "html-to-image";

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar as RangeCalendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { MoneyInput } from "@/components/ui/money-input";
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
  markNoShow,
  listNoShowArrivals,
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
  skipTaskOccurrence,
  toggleCleaningCompletion,
} from "@/lib/tasks.functions";
import { defaultShowInCleaning } from "@/lib/tasks-types";
import type {
  TaskRow,
  TaskCompletion,
  TaskLinkProperty,
  TaskLinkOwner,
  TaskLinkProvider,
  TaskCategory,
  TaskPriority,
} from "@/lib/tasks-types";
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
      const d = haversineMeters(
        { lat: last.lat as number, lng: last.lng as number },
        { lat: cand.lat as number, lng: cand.lng as number },
      );
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
 * Alterna "Completo" / "Lista" — usado no Kanban, nos popups dos 4 KPIs do
 * Dashboard e no tooltip "quais imóveis" da Limpeza. Puramente visual: quem
 * controla o estado é o componente pai (via `value`/`onChange`).
 *
 * Pedido explícito (07/09/2026): era um par de botões com rótulo
 * ("Completo" / "Lista"); virou UM botão só, com UM ícone, que alterna a
 * cada toque. O ícone mostrado é o do modo PARA ONDE o toque leva (em modo
 * Lista aparece a grade, e vice-versa), com o título explicando a ação —
 * assim o botão sempre responde "o que acontece se eu clicar", que é a
 * pergunta que importa num controle de estado único. Mesmo formato/curva do
 * botão de print ao lado, pra lerem como um par.
 */
function ViewModeToggle({ value, onChange }: { value: "full" | "list"; onChange: (v: "full" | "list") => void }) {
  const goingToList = value === "full";
  const Icon = goingToList ? LayoutList : LayoutGrid;
  const label = goingToList ? "Ver em modo lista" : "Ver em modo completo";
  return (
    <button
      type="button"
      onClick={() => onChange(goingToList ? "list" : "full")}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center rounded-[0.3rem] border border-border/60 bg-secondary/30 p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
    >
      <Icon className="size-3" />
    </button>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function nowLabelBR(): string {
  const now = new Date();
  const date = now.toLocaleDateString("pt-BR");
  const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

/**
 * Monta, fora da tela (position: fixed + offset negativo — nunca
 * display:none, que impediria a medição/captura), o layout "comprovante"
 * usado no print das listas de hóspedes (pedido explícito): largura sempre
 * fixa, uma linha compacta por hóspede (em vez do card grande da tela),
 * com um cabeçalho e um rodapé de recibo. Reaproveita as mesmas classes
 * Tailwind/tokens do resto do app — não é um estilo à parte.
 */
function buildReceiptNode(title: string, rows: ArrivalRow[]): HTMLDivElement {
  const RECEIPT_WIDTH = 340;
  const container = document.createElement("div");
  container.className = "bg-card border border-border/60 rounded-lg overflow-hidden text-foreground";
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.width = `${RECEIPT_WIDTH}px`;
  container.style.fontFamily = getComputedStyle(document.body).fontFamily;

  const head = document.createElement("div");
  head.className = "text-center px-3.5 py-2.5 border-b border-dashed border-border/60";
  head.innerHTML = `
    <div class="text-xs font-extrabold uppercase tracking-wide">${escapeHtml(title)}</div>
    <div class="text-[9.5px] text-muted-foreground mt-0.5">${escapeHtml(nowLabelBR())} · ${rows.length} ${rows.length === 1 ? "hóspede" : "hóspedes"}</div>
  `;
  container.appendChild(head);

  for (const row of rows) {
    const done = row.status === "done";
    const dotClass = done ? "bg-emerald-500" : "bg-amber-800";
    const tagClass = done ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-800/15 text-amber-700";
    const guestLabel =
      row.guestName && row.guestName !== row.reservationCode ? row.guestName : (row.reservationCode ?? "Hóspede");
    const dates = row.guestCheckin
      ? `${fmtDateBR(row.guestCheckin)}${row.guestCheckout ? ` → ${fmtDateBR(row.guestCheckout)}` : ""}`
      : fmtDateBR(row.date);
    const line = document.createElement("div");
    line.className = "flex items-start gap-2 px-3.5 py-2 border-b border-border/40 last:border-b-0";
    line.innerHTML = `
      <span class="mt-1 size-1.5 rounded-full shrink-0 ${dotClass}"></span>
      <div class="min-w-0 flex-1">
        <div class="text-[11px] font-bold uppercase truncate">${escapeHtml(guestLabel)}</div>
        <div class="text-[10.5px] text-muted-foreground truncate">${escapeHtml(row.propertyName ?? "Sem imóvel")}</div>
        <div class="text-[9px] text-muted-foreground mt-0.5 flex gap-1.5 flex-wrap">
          ${row.reservationCode ? `<span>${escapeHtml(row.reservationCode)}</span><span>·</span>` : ""}
          <span>${escapeHtml(dates)}</span>
        </div>
      </div>
      <span class="shrink-0 text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ${tagClass}">${done ? "Concluído" : "Pendente"}</span>
    `;
    container.appendChild(line);
  }

  const foot = document.createElement("div");
  foot.className = "text-center px-3.5 py-2 border-t border-dashed border-border/60 text-[9px] text-muted-foreground";
  foot.textContent = "Gerado pelo painel · SigmaGuide";
  container.appendChild(foot);

  return container;
}

/**
 * Botão "tirar um print" (pedido explícito) — captura o container apontado
 * por `targetRef` como PNG. Ao clicar, abre um menu com duas opções:
 * "Salvar Imagem" (baixa o PNG) e "Copiar Imagem" (vai pra área de
 * transferência, pra colar direto em outro lugar). Usa `html-to-image`
 * (já não existia nenhuma lib de captura no projeto).
 *
 * Quando `receiptRows` é passado (listas de hóspedes), o print NÃO captura
 * o card grande da tela — monta o layout "comprovante" compacto (pedido
 * explícito) num node à parte, fora da tela, só pra gerar a imagem; a tela
 * do usuário continua com os cards normais, clicáveis. Sem `receiptRows`
 * (ex.: lista de imóveis do tooltip de Limpeza), continua capturando o
 * `targetRef` como antes.
 */
function ScreenshotButton({
  targetRef,
  fileName,
  receiptRows,
  receiptTitle,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  fileName: string;
  receiptRows?: ArrivalRow[];
  receiptTitle?: string;
}) {
  const [busy, setBusy] = useState(false);
  const captureBlob = useCallback(async (): Promise<Blob | null> => {
    if (receiptRows) {
      const node = buildReceiptNode(receiptTitle ?? "Lista", receiptRows);
      document.body.appendChild(node);
      try {
        const fullWidth = node.scrollWidth;
        const fullHeight = node.scrollHeight;
        return await toBlob(node, {
          cacheBust: true,
          pixelRatio: 2,
          backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0a",
          width: fullWidth,
          height: fullHeight,
          canvasWidth: fullWidth,
          canvasHeight: fullHeight,
        });
      } finally {
        node.remove();
      }
    }
    const node = targetRef.current;
    if (!node) return null;
    // Pedido explícito: o print precisa sair "como um comprovante bancário"
    // — TODOS os cards, não só o que cabe na tela. O alvo é sempre um
    // container com scroll (overflow-y-auto + max-height); html-to-image
    // clona o node e renderiza usando o TAMANHO ATUAL dele, então sem isto
    // o print sairia cortado igual ao que já aparece na tela. `width`/
    // `height`/`style` abaixo são aplicados só no clone offscreen usado pra
    // gerar a imagem — a tela real do usuário não pisca nem muda.
    const fullWidth = node.scrollWidth;
    const fullHeight = node.scrollHeight;
    return await toBlob(node, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0a",
      width: fullWidth,
      height: fullHeight,
      canvasWidth: fullWidth,
      canvasHeight: fullHeight,
      style: {
        maxHeight: "none",
        height: `${fullHeight}px`,
        width: `${fullWidth}px`,
        overflow: "visible",
      },
    });
  }, [targetRef, receiptRows, receiptTitle]);
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
  const noShowFn = useServerFn(listNoShowArrivals);
  const markNoShowFn = useServerFn(markNoShow);
  const occupancyFn = useServerFn(getOccupancyBoard);
  const cleaningStatsFn = useServerFn(getCleaningStats);
  const taskLinkOptionsFn = useServerFn(listTaskLinkOptions);
  const listTasksFn = useServerFn(listTasks);
  const createTaskFn = useServerFn(createTask);
  const setTaskStatusFn = useServerFn(setTaskStatus);
  const skipTaskOccurrenceFn = useServerFn(skipTaskOccurrence);
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
  /** Barra de abas do Kanban no mobile — regra anti-corte (useAntiClipBar). */
  const kanbanTabsRef = useAntiClipBar<HTMLDivElement>();
  useLayoutEffect(() => {
    const el = kanbanRowRef.current;
    if (!el) return;
    const GAP = 12; // gap-3
    const MIN_COL = 320;
    const TOTAL_COLS = 6;
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
    no_show: null,
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

  // Rede de segurança contra divergência entre usuários: além do realtime
  // (canal "dash-live" abaixo), estas listas se atualizam sozinhas a cada 30s
  // e sempre que a aba volta ao foco — assim dois membros da equipe nunca
  // ficam vendo números diferentes por causa de um evento perdido.
  const liveSync = { refetchInterval: 30_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true } as const;
  const engQ = useQuery({
    queryKey: ["dash-eng", engRange, activeOwnerId ?? "self"],
    queryFn: () => engFn({ data: { range: engRange, ownerId: activeOwnerId } }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    ...liveSync,
  });
  const checkinListQ = useQuery({
    queryKey: ["dash-list", "checkin", range, activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkin", range, ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    ...liveSync,
  });
  const checkoutListQ = useQuery({
    queryKey: ["dash-list", "checkout", range, activeOwnerId ?? "self"],
    queryFn: () => listFn({ data: { kind: "checkout", range, ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    ...liveSync,
  });
  const tomorrowCheckinListQ = useQuery({
    queryKey: ["dash-list", "checkin", "tomorrow", activeOwnerId ?? "self", "top-card"],
    queryFn: () => listFn({ data: { kind: "checkin", range: "tomorrow", ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    ...liveSync,
  });
  const tomorrowCheckoutListQ = useQuery({
    queryKey: ["dash-list", "checkout", "tomorrow", activeOwnerId ?? "self", "top-card"],
    queryFn: () => listFn({ data: { kind: "checkout", range: "tomorrow", ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    ...liveSync,
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
    ...liveSync,
    enabled: view === "kanban",
  });
  const kanbanCheckoutListQ = useQuery({
    queryKey: ["dash-list", "checkout", "all", activeOwnerId ?? "self", "kanban-filtros"],
    queryFn: () => listFn({ data: { kind: "checkout", range: "all", ownerId: activeOwnerId } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    ...liveSync,
    enabled: view === "kanban",
  });
  // Busca de "Concluídos": por padrão o servidor só devolve os 200 cards
  // concluídos mais recentes (evita varrer a conta inteira sempre que a tela
  // abre). Isso faz um card concluído há mais tempo (ex.: um check dado por
  // engano, há dias) sumir da coluna sem aviso nenhum, mesmo continuando no
  // banco — daí essa busca: com um termo digitado, o servidor solta o limite
  // e procura por hóspede/imóvel/proprietário/código em tudo.
  const [concludedSearch, setConcludedSearch] = useState("");
  const [concludedSearchDebounced, setConcludedSearchDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setConcludedSearchDebounced(concludedSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [concludedSearch]);
  const concludedQ = useQuery({
    queryKey: ["dash-list", "concluded", activeOwnerId ?? "self", concludedSearchDebounced],
    queryFn: () => concludedFn({ data: { ownerId: activeOwnerId, q: concludedSearchDebounced || undefined } }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    ...liveSync,
  });
  // Busca de "Não Compareceu": mesmo racional de "Concluídos" acima (limite
  // padrão de 200, solto quando `q` vem preenchido) — coluna própria, depois
  // de "Concluídos" (pedido explícito, 05/09/2026).
  const [noShowSearch, setNoShowSearch] = useState("");
  const [noShowSearchDebounced, setNoShowSearchDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setNoShowSearchDebounced(noShowSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [noShowSearch]);
  const noShowQ = useQuery({
    queryKey: ["dash-list", "no_show", activeOwnerId ?? "self", noShowSearchDebounced],
    queryFn: () => noShowFn({ data: { ownerId: activeOwnerId, q: noShowSearchDebounced || undefined } }),
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
    ? Math.min(
        90,
        Math.max(
          3,
          differenceInCalendarDays(parseISODateLocal(periodRange.end), parseISODateLocal(periodRange.start)) + 1,
        ),
      )
    : 21;
  const occupancyQ = useQuery({
    queryKey: ["dash-occupancy", activeOwnerId ?? "self", occStart, occDays],
    queryFn: () => occupancyFn({ data: { ownerId: activeOwnerId, days: occDays, start: occStart } }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    ...liveSync,
  });

  // Propriedades (id/nome/cidade/proprietário) já vêm da própria agenda —
  // reaproveitadas aqui pra montar as opções dos filtros e resolver quais
  // property_id batem com Proprietário/Cidade selecionados (pra filtrar
  // tanto a tabela da agenda quanto os cards de limpeza abaixo).
  const occupancyProperties: Array<{ id: string; name: string; city: string | null; ownerName?: string | null }> =
    occupancyQ.data?.properties ?? [];
  const ownerOptions = useMemo(() => {
    const names: string[] = occupancyProperties.map((p) => p.ownerName).filter((v): v is string => !!v);
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
    () =>
      ownerFilters.length > 0 || cityFilters.length > 0 ? filteredOccupancyProperties.map((p) => p.id) : undefined,
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
      skipCleaning?: boolean;
    }) => advanceFn({ data: v }),
    // Sem debounce aqui: o card já se moveu de forma otimista no clique, e a
    // recarga acontece assim que o servidor confirma — esperar 600s+ dava a
    // impressão de que o botão "não respondia".
    onSuccess: () => {
      refreshDashboard(0);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Falha ao avançar card.");
      refreshDashboard(0);
    },
    onSettled: () => setBusyRowId(null),
  });

  const revertFn = useServerFn(revertArrival);
  const revert = useMutation({
    mutationFn: (v: {
      logId?: string;
      reservationId?: string;
      from: "checkout" | "stay" | "cleaning" | "done" | "no_show" | "skip_stay";
    }) => revertFn({ data: v }),
    onSuccess: () => {
      refreshDashboard();
      toast.success("Check desfeito.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao desfazer."),
    onSettled: () => setBusyRowId(null),
  });

  const noShow = useMutation({
    mutationFn: (v: { logId?: string; reservationId?: string }) => markNoShowFn({ data: v }),
    onSuccess: () => {
      refreshDashboard();
      toast.success('Marcado como "Não Compareceu".');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao marcar não compareceu."),
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

  /**
   * Cards "fixados" no popup aberto: SÓ ajustes de data/horário previsto
   * seguram o card na lista até o usuário fechar o popup no "X". Qualquer
   * outra ação (check, não compareceu, limpeza não será realizada, desfazer)
   * tira o card da tela na hora.
   */
  const [pinnedRowIds, setPinnedRowIds] = useState<ReadonlySet<string>>(() => new Set());
  const pinRow = useCallback((id: string) => {
    setPinnedRowIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const unpinRow = useCallback((id: string) => {
    setPinnedRowIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

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
    skipCleaning?: boolean,
  ) {
    const target = statusTarget(row);
    if (!target.logId && !target.reservationId) {
      toast.error("Não foi possível identificar esse card. Atualize a página e tente novamente.");
      return;
    }
    setBusyRowId(row.logId);
    // Ação de esteira: o card não fica mais preso na lista aberta.
    unpinRow(row.logId);

    // Cancela buscas em andamento ANTES do patch otimista: sem isso, uma
    // recarga já disparada (30s/foco) podia terminar depois do clique e
    // reescrever o cache com o estado antigo — o card "voltava" e só sumia na
    // próxima recarga, dando a sensação de lentidão.
    qc.cancelQueries({ predicate: (q) => q.queryKey[0] === "dash-list" });
    if (skipCleaning) {
      // "Limpeza não será realizada": sai da esteira na hora (vai direto pra
      // Concluídos, sem passar por Em Limpeza).
      patchList("checkout", (rows) => rows.filter((r) => r.logId !== row.logId));
      patchList("checkin", (rows) => rows.filter((r) => r.logId !== row.logId));
    } else {
      optimisticMove(row, from);
    }
    advance.mutate({
      ...target,
      from,
      ...(cleaningType ? { cleaningType } : {}),
      ...(skipCleaning ? { skipCleaning: true } : {}),
    });
    // Feedback padrão do produto: mensagem no topo + "Desfazer" por 5s.
    // Desfazer precisa devolver o card à coluna de ORIGEM. No atalho
    // "Limpeza não será realizada" o check-out é marcado como feito mesmo
    // quando o card ainda estava em Estadia/Checkouts pendentes — por isso o
    // undo é escolhido pela origem, e não sempre "done" (que deixava o card
    // em Em Limpeza).
    const stageAfter: "stay" | "checkout" | "cleaning" | "done" | "skip_stay" = skipCleaning
      ? from === "stay"
        ? "skip_stay"
        : from === "checkout"
          ? "cleaning"
          : "done"
      : from === "checkin"
        ? "stay"
        : from === "stay"
          ? "checkout"
          : from === "checkout"
            ? "cleaning"
            : "done";
    const message = skipCleaning
      ? "Limpeza não será realizada — card concluído."
      : from === "checkin"
        ? "Check-in confirmado."
        : from === "stay"
          ? "Check-out confirmado."
          : from === "checkout"
            ? "Liberado à limpeza."
            : "Limpeza concluída.";
    notifyAction(message, () => {
      setBusyRowId(row.logId);
      revert.mutate({ ...target, from: stageAfter });
    });
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
    const prev = row.arrivalTimeOverride ?? null;
    setBusyRowId(row.logId);
    // Só ajuste de horário/data previstos segura o card na lista aberta.
    pinRow(row.logId);

    // Otimista: o campo já mostra o novo horário na hora — o servidor só
    // confirma em segundo plano (mesmo racional do optimisticMove acima).
    patchList(k, (rows: ArrivalRow[]) =>
      rows.map((r) => (r.logId === row.logId ? { ...r, arrivalTimeOverride: time } : r)),
    );
    upsert.mutate({ ...statusTarget(row), kind: k, arrivalTimeOverride: time });
    notifyAction(time ? `Horário previsto atualizado para ${time}.` : "Horário previsto removido.", () => {
      setBusyRowId(row.logId);
      patchList(k, (rows: ArrivalRow[]) =>
        rows.map((r) => (r.logId === row.logId ? { ...r, arrivalTimeOverride: prev } : r)),
      );
      upsert.mutate({ ...statusTarget(row), kind: k, arrivalTimeOverride: prev });
    });
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
    () =>
      sortCheckoutRows(
        coRows.filter((r) => r.status === "pending"),
        turnoverCheckinSources,
      ),
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
   * "Fila de Limpeza" precisa incluir também o checkout ANTECIPADO de um
   * card de amanhã: ele sai da lista de amanhã (deixa de ser pendente) e,
   * sem isso, não apareceria em lugar nenhum.
   *
   * Pedido explícito (mesmo ajuste já feito no quadrante do Kanban): a faixa
   * espelha TODOS os checkouts do período, não só os já liberados — quem
   * ainda não fez check-out aparece também, bloqueado (ver `awaitingCheckout`
   * no ArrivalCard). Bloqueado nunca compete com quem já está liberado, por
   * isso vem sempre DEPOIS na lista (mesmo racional de sempre).
   */
  const cleaningRows = useMemo(() => {
    const done = coRows.filter((r) => r.status === "done");
    const seen = new Set(done.map((r) => r.logId));
    const early = (tomorrowCheckoutListQ.data?.rows ?? []).filter((r) => r.status === "done" && !seen.has(r.logId));
    const released = sortCheckoutRows([...done, ...early], turnoverCheckinSources);
    const awaiting = sortCheckoutRows(
      coRows.filter((r) => r.status === "pending"),
      turnoverCheckinSources,
    );
    return [...released, ...awaiting];
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
  /**
   * Imóveis livres do dia aberto — exatamente o que o servidor calculou.
   *
   * Antes o cliente ainda subtraía `cleaningPendingPropIds` daqui ("imóvel
   * com check-out pendente ou limpeza em andamento não é livre"). Isso
   * quebrava o indicador de duas formas ao mesmo tempo, e as duas foram
   * apontadas no pedido de 08/09/2026:
   *
   *   1. amarrava um número de DIA ao andamento dos checkouts/limpezas de
   *      HOJE — abrir outro dia no calendário mostrava um número contaminado
   *      pelo que está pendente agora;
   *   2. respondia a outra pergunta. "Livre" aqui é "não tem reserva com
   *      entrada nem estadia nesse dia". Uma limpeza pendente não é uma
   *      reserva: o imóvel continua sem ninguém dentro e disponível para
   *      receber, que é a informação que a pessoa procura ao abrir o dia.
   */
  const freeProperties = useMemo(() => occupancyQ.data?.freeToday ?? [], [occupancyQ.data?.freeToday]);

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
  /**
   * A tela de Limpeza tem DUAS janelas, e é a MESMA tela nas duas (pedido
   * explícito, 09/09/2026: "não quero que abra um tooltip ao clicar em
   * tendência; quero que a tela seja a mesma da visão oficial, mas que os
   * dados sejam mudados para os próximos 7 dias").
   *
   * Antes a previsão vivia num popup com layout próprio — outra moldura, outra
   * densidade, outro jeito de ler os mesmos gráficos. Agora só a FONTE dos
   * dados muda; cards, gráficos e ranking são os mesmos componentes.
   */
  const [cleaningWindow, setCleaningWindow] = useState<"past" | "next">("past");

  // ---------------------------------------------------------------------
  // Tarefas/Pendências — botão "PENDÊNCIAS" (Kanban, ao lado de "Filtros")
  // + checklist no card de Limpeza. Uma única query serve os dois usos:
  // o dialog usa a lista inteira; o checklist do card filtra client-side
  // pelas marcadas "aparece na limpeza".
  // ---------------------------------------------------------------------
  const [pendenciasOpen, setPendenciasOpen] = useState(false);
  // Alternador "Completo"/"Lista" do Kanban — mesmo padrão já usado nos
  // popups de KPI e no tooltip de Limpeza (ViewModeToggle). Pedido explícito
  // (07/09/2026): "Lista" é o padrão ao abrir o Kanban (mais compacto, cabe
  // mais cards por coluna sem rolar).
  const [kanbanListMode, setKanbanListMode] = useState<"full" | "list">("list");
  // Refs pro botão de print do Kanban: um alvo por layout (mobile mostra só a
  // aba ativa; desktop mostra as colunas todas lado a lado dentro do mesmo
  // container rolável já usado pra calcular a largura das colunas —
  // kanbanRowRef, declarado mais abaixo).
  const kanbanMobileScreenshotRef = useRef<HTMLDivElement | null>(null);
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
      amountSpentCents?: number | null;
      recurrenceDays?: number | null;
    }) => createTaskFn({ data: { ownerId: activeOwnerId, ...v } }),
    onSuccess: () => {
      invalidateTasks();
      toast.success("Pendência criada.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao criar pendência."),
  });
  const setTaskStatusMutation = useMutation({
    mutationFn: (v: {
      taskId: string;
      status: "pending" | "done" | "canceled";
      amountSpentCents?: number | null;
      /** Prestação de contas da conclusão (07/09/2026) — ambos opcionais. */
      resolvedByProviderId?: string | null;
      resolutionNote?: string | null;
    }) => setTaskStatusFn({ data: v }),
    onSuccess: invalidateTasks,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar pendência."),
  });
  // "Excluir só esta ocorrência" de uma pendência recorrente — ver
  // skipTaskOccurrence em tasks.functions.ts.
  const skipTaskOccurrenceMutation = useMutation({
    mutationFn: (v: { taskId: string }) => skipTaskOccurrenceFn({ data: v }),
    onSuccess: (res) => {
      invalidateTasks();
      toast.success(`Ocorrência pulada. Próximo prazo: ${fmtDateBR(res.dueDate)}.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao pular a ocorrência."),
  });
  const toggleCleaningTaskMutation = useMutation({
    mutationFn: (v: {
      taskId: string;
      logId?: string | null;
      reservationId?: string | null;
      amountSpentCents?: number | null;
      resolvedByProviderId?: string | null;
      resolutionNote?: string | null;
    }) => toggleCleaningFn({ data: v }),
    onSuccess: invalidateTasks,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao atualizar checklist."),
  });
  // Conclusão de pendência com prestação de contas (pedido explícito,
  // 07/09/2026): ao concluir, perguntamos QUEM resolveu, QUANTO custou e
  // deixamos anexar a comprovação. Antes isto era só um "teve gasto nessa
  // tarefa? Sim/Não". Tudo continua OPCIONAL — dá pra concluir sem preencher
  // nada. Substitui o antigo `expensePrompt`, mas mantém os dois gatilhos
  // que já existiam: concluir na lista de Pendências ("status") e marcar no
  // checklist do card de Limpeza ("cleaning", que fecha só a ocorrência).
  type ResolvePromptState = { kind: "status"; task: TaskRow } | { kind: "cleaning"; task: TaskRow; row: ArrivalRow };
  const [resolvePrompt, setResolvePrompt] = useState<ResolvePromptState | null>(null);
  const attachTaskRecordFn = useServerFn(attachTaskRecord);

  function closeResolvePrompt() {
    setResolvePrompt(null);
  }

  async function confirmResolve(v: {
    amountSpentCents: number | null;
    providerId: string | null;
    note: string | null;
    files: PendingAttachment[];
  }) {
    if (!resolvePrompt) return;
    const task = resolvePrompt.task;
    // Anexo precisa de um imóvel (é ele que define a pasta e a permissão do
    // arquivo). Sem imóvel os arquivos sumiriam em silêncio — melhor barrar
    // ANTES de gravar a conclusão e explicar o que fazer.
    if (v.files.length > 0 && !task.propertyId) {
      toast.error(
        "Para anexar fotos, vídeos ou áudios, a pendência precisa estar vinculada a um imóvel. Remova os anexos ou vincule um imóvel à pendência.",
      );
      return;
    }
    if (resolvePrompt.kind === "status") {
      await setTaskStatusMutation.mutateAsync({
        taskId: task.id,
        status: "done",
        amountSpentCents: v.amountSpentCents,
        resolvedByProviderId: v.providerId,
        resolutionNote: v.note,
      });
    } else {
      await toggleCleaningTaskMutation.mutateAsync({
        taskId: task.id,
        logId: resolvePrompt.row.logId,
        reservationId: resolvePrompt.row.reservationId,
        amountSpentCents: v.amountSpentCents,
        // A tela de conclusão é a mesma dos dois gatilhos: quem resolveu e
        // como foi resolvido também ficam gravados na ocorrência da limpeza.
        resolvedByProviderId: v.providerId,
        resolutionNote: v.note,
      });
    }

    // Comprovação sobe DEPOIS da conclusão gravada — se a pessoa desistir no
    // meio, nada de arquivo órfão no storage. Falha de anexo não desfaz a
    // conclusão, só avisa.
    if (v.files.length > 0 && task.propertyId) {
      const res = await uploadPendingAttachments(attachTaskRecordFn, v.files, {
        propertyId: task.propertyId,
        taskId: task.id,
        logId: task.logId ?? undefined,
        reservationId: task.reservationId ?? undefined,
        isResolution: true,
      });
      if (res.failed > 0) toast.error(`${res.failed} anexo(s) não subiram. A conclusão foi salva.`);
    }
    closeResolvePrompt();
  }

  function requestSetTaskStatus(taskId: string, status: "pending" | "done" | "canceled") {
    if (status === "done") {
      const task = (tasksQ.data?.tasks ?? []).find((t) => t.id === taskId);
      // Diferente do antigo prompt (que só aparecia quando o valor estava em
      // branco), a tela de conclusão sempre abre: ela não pergunta só o
      // gasto, pergunta a prestação de contas inteira.
      if (task) {
        setResolvePrompt({ kind: "status", task });
        return;
      }
    }
    setTaskStatusMutation.mutate({ taskId, status });
  }

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
  // Pedido explícito: a coluna espelha TODOS os checkouts do período, não só
  // os já liberados — quem ainda não fez check-out aparece aqui também
  // (bloqueado, ver `awaitingCheckout` no ArrivalCard), pra dar visibilidade
  // do que está por vir. Ordenação: mesmo racional já usado no resto do
  // Kanban (ex.: sortCheckinRows/cleaningPendingPropIds) — bloqueado nunca
  // compete por horário/giro com quem já está liberado, então primeiro TODOS
  // os liberados (na ordem de sempre, via sortCheckoutRows) e só depois os
  // que ainda aguardam check-out (mesma ordenação interna, só que atrás).
  const kanbanCleaningRows = useMemo(() => {
    const inWindow = kanbanCoRowsAll.filter(
      (r) => matchesKanbanOwnerCity(r) && r.date >= kanbanPeriodStart && r.date <= kanbanPeriodEnd,
    );
    const released = inWindow.filter((r) => r.status === "done");
    const awaitingCheckout = inWindow.filter((r) => r.status !== "done");
    return [...sortCheckoutRows(released, [kanbanCiRowsAll]), ...sortCheckoutRows(awaitingCheckout, [kanbanCiRowsAll])];
  }, [kanbanCoRowsAll, matchesKanbanOwnerCity, kanbanPeriodStart, kanbanPeriodEnd, kanbanCiRowsAll]);
  // "Concluídos" nunca foi limitado por Hoje/Amanhã/7 dias/Todos (a busca de
  // concluídos já ignorava esse seletor antes) — só ganha os filtros de
  // Cidade/Proprietário agora, mantendo o mesmo comportamento de período.
  const kanbanConcludedRows = useMemo(
    () => concludedRows.filter(matchesKanbanOwnerCity),
    [concludedRows, matchesKanbanOwnerCity],
  );
  // "Não Compareceu" segue o mesmo racional de "Concluídos" acima: nunca foi
  // limitado por Hoje/Amanhã/7 dias/Todos, só pelos filtros de Cidade/Proprietário.
  const noShowRows = noShowQ.data?.rows ?? [];
  const kanbanNoShowRows = useMemo(
    () => noShowRows.filter(matchesKanbanOwnerCity),
    [noShowRows, matchesKanbanOwnerCity],
  );
  const kanbanCounts = {
    checkin: kanbanCheckinPendingRows.length,
    checkout: kanbanCheckoutPendingRows.length,
    stay: kanbanStayRows.length,
    cleaning: kanbanCleaningRows.length,
    done: kanbanConcludedRows.length,
    no_show: kanbanNoShowRows.length,
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
      noShowRows,
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
  }, [
    kanbanCiRowsAll,
    kanbanCoRowsAll,
    concludedRows,
    noShowRows,
    tomorrowCheckinPendingRows,
    tomorrowCheckoutPendingRows,
  ]);
  function guestNameForTask(t: TaskRow): string {
    if (t.logId) return guestNameByStayRef.get(`log:${t.logId}`) ?? "Hóspede";
    if (t.reservationId) return guestNameByStayRef.get(`res:${t.reservationId}`) ?? "Hóspede";
    return "Hóspede";
  }
  // Tarefas que aparecem no checklist do card de Limpeza — repassadas pra
  // ArrivalGroup/ArrivalCard só quando colMode === "cleaning" (única coluna
  // que usa isso; as outras ignoram por completo).
  /**
   * Qual card de limpeza é a PRÓXIMA limpeza de cada imóvel (pedido
   * explícito, 07/09/2026): as pendências abertas do imóvel são exibidas no
   * card da limpeza mais próxima, e só nele.
   *
   * Isto é CALCULADO a cada render, nunca gravado: se entrar uma reserva
   * repentina com limpeza pro dia 8, ela simplesmente passa a ser a mais
   * próxima e as pendências aparecem lá — sem ninguém "mover" nada, sem
   * rotina de correção, sem estado que possa ficar errado. Se essa limpeza
   * do dia 8 for cancelada, tudo volta pro dia 10 pelo mesmo caminho.
   *
   * A base é `kanbanCoRowsAll` (checkouts com alcance "all", ver a query
   * acima) e NÃO a lista já filtrada por período/cidade/proprietário — senão
   * filtrar a tela por "Hoje" faria o sistema eleger a limpeza errada como
   * "próxima". Só cards ainda não concluídos entram na disputa.
   */
  const nextCleaningKeyByProperty = useMemo(() => {
    const best = new Map<string, { key: string; date: string }>();
    for (const r of kanbanCoRowsAll) {
      if (!r.propertyId) continue;
      const key = r.reservationId ?? r.logId;
      if (!key) continue;
      const current = best.get(r.propertyId);
      if (!current || r.date < current.date) best.set(r.propertyId, { key, date: r.date });
    }
    const out = new Map<string, string>();
    for (const [propertyId, v] of best) out.set(propertyId, v.key);
    return out;
  }, [kanbanCoRowsAll]);

  const cleaningTasksData = useMemo(
    () => ({
      tasks: tasksQ.data?.tasks ?? [],
      completions: tasksQ.data?.completions ?? [],
      nextCleaningKeyByProperty,
    }),
    [tasksQ.data, nextCleaningKeyByProperty],
  );
  function handleToggleCleaningTask(task: TaskRow, row: ArrivalRow) {
    if (task.logId || task.reservationId) {
      // Pontual: o próprio status da pendência representa esta estadia.
      const willComplete = task.status !== "done";
      if (willComplete) {
        setResolvePrompt({ kind: "status", task });
        return;
      }
      setTaskStatusMutation.mutate({ taskId: task.id, status: "pending" });
    } else {
      // Recorrente: marca só esta ocorrência (log/reserva do card) — a
      // pendência em si continua ativa e volta pendente na próxima limpeza.
      // Cada ocorrência é nova, então sempre abre a conclusão ao MARCAR
      // (nunca ao desmarcar, que só remove o registro).
      const completions = cleaningTasksData.completions;
      const already = completions.some(
        (c) =>
          c.taskId === task.id &&
          ((row.logId && c.logId === row.logId) || (row.reservationId && c.reservationId === row.reservationId)),
      );
      if (!already) {
        setResolvePrompt({ kind: "cleaning", task, row });
        return;
      }
      toggleCleaningTaskMutation.mutate({ taskId: task.id, logId: row.logId, reservationId: row.reservationId });
    }
  }

  /**
   * As linhas das duas esteiras indexadas pela ESTADIA, para um card de um
   * lado conseguir alcançar a previsão do outro.
   *
   * A chave `reservationId ?? logId` é a mesma que o resto do quadro já usa
   * para casar card com card. Ela é necessária porque o card de "Em Estadia"
   * nasce da lista de CHEGADAS e, por isso, não carrega o `arrival_*_override`
   * do lado da saída — que é justamente o que ele precisa mostrar.
   */
  const rowByStay = useMemo(() => {
    const checkin = new Map<string, ArrivalRow>();
    const checkout = new Map<string, ArrivalRow>();
    for (const r of [...ciRows, ...kanbanCiRowsAll]) checkin.set(r.reservationId ?? r.logId, r);
    for (const r of [...coRows, ...kanbanCoRowsAll]) checkout.set(r.reservationId ?? r.logId, r);
    return { checkin, checkout };
  }, [ciRows, coRows, kanbanCiRowsAll, kanbanCoRowsAll]);

  /**
   * Grava uma previsão. `side` decide EM QUAL LINHA do banco ela cai
   * (`guest_arrival_status.kind`), e `target` decide com quais identificadores
   * — os da linha daquele lado, nunca os do card que abriu o editor. As duas
   * previsões da mesma estadia vivem em registros diferentes: por construção,
   * não há como uma sobrescrever a outra.
   */
  const commitPrediction = useCallback(
    (side: "checkin" | "checkout", target: ArrivalRow, date: string | null, time: string | null) => {
      const key = target.reservationId ?? target.logId;
      // Mesma regra da leitura: sem linha DAQUELE lado, o valor anterior é
      // vazio — nunca o do outro lado (ver buildPredictionSide).
      const prev = rowByStay[side].get(key) ?? null;
      const prevTime = prev
        ? (prev.arrivalTimeOverride ?? (side === "checkin" ? prev.guestArrivalTime : null) ?? null)
        : null;
      const dateChanged = date !== (prev?.arrivalDateOverride ?? null);
      const timeChanged = time !== prevTime;
      if (!dateChanged && !timeChanged) return;
      setBusyRowId(target.logId);
      pinRow(target.logId);
      patchList(side, (rows: ArrivalRow[]) =>
        rows.map((r) =>
          (r.reservationId ?? r.logId) === key
            ? {
                ...r,
                ...(dateChanged ? { arrivalDateOverride: date } : {}),
                ...(timeChanged ? { arrivalTimeOverride: time } : {}),
              }
            : r,
        ),
      );
      upsert.mutate({
        ...statusTarget(target),
        kind: side,
        ...(dateChanged ? { arrivalDateOverride: date } : {}),
        ...(timeChanged ? { arrivalTimeOverride: time } : {}),
      });
      notifyAction("Previsão atualizada.", () => {
        setBusyRowId(target.logId);
        upsert.mutate({
          ...statusTarget(target),
          kind: side,
          ...(dateChanged ? { arrivalDateOverride: prev?.arrivalDateOverride ?? null } : {}),
          ...(timeChanged ? { arrivalTimeOverride: prev?.arrivalTimeOverride ?? null } : {}),
        });
      });
    },
    [rowByStay, patchList, upsert, pinRow],
  );

  /** Monta um lado da previsão a partir da linha daquele lado. */
  const buildPredictionSide = useCallback(
    (side: "checkin" | "checkout", fallbackRow: ArrivalRow): PredictionSide => {
      const key = fallbackRow.reservationId ?? fallbackRow.logId;
      /**
       * A linha DAQUELE lado, quando ela existe. Quando NÃO existe (a coluna
       * de Checkouts pode estar vazia, por exemplo), caímos na linha do card
       * só para as informações da RESERVA e do IMÓVEL — datas confirmadas,
       * horários padrão, identificadores. Nunca para a previsão.
       *
       * Bug real, corrigido em 08/09/2026: sem essa distinção, abrir o
       * editor num card de chegada mostrava a data e a hora da CHEGADA também
       * no bloco "Saída", porque o fallback era a própria linha de chegada e
       * ela carrega o override dela. Ficava parecendo que uma previsão tinha
       * sido copiada para a outra — e bastaria confirmar para que virasse
       * verdade no banco.
       */
      const own = rowByStay[side].get(key) ?? null;
      const src = own ?? fallbackRow;
      // O horário que o HÓSPEDE informou é de CHEGADA — não diz nada sobre a
      // saída. Foi essa confusão que fez o checkout automático confirmar na
      // hora errada (06/09/2026), e ela não pode voltar por aqui.
      const time = own ? (own.arrivalTimeOverride ?? (side === "checkin" ? own.guestArrivalTime : null)) : null;
      const date = own?.arrivalDateOverride ?? "";
      return {
        kind: side,
        label: side === "checkout" ? "Saída" : "Chegada",
        dateValue: date,
        timeValue: time,
        confirmedDate: (side === "checkout" ? src.guestCheckout : src.guestCheckin) ?? null,
        // Chegada: nunca antes da reserva, até um dia antes da saída
        // confirmada. Saída: até a data de saída confirmada — sair antes é
        // permitido, "esticar" a estadia por este campo não.
        dateMin: src.ical.icalCheckin ?? src.guestCheckin ?? undefined,
        dateMax:
          (side === "checkout"
            ? (src.ical.icalCheckout ?? src.guestCheckout)
            : addDaysISO(src.ical.icalCheckout ?? src.guestCheckout, -1)) ?? undefined,
        standardTime: src.standardTime,
        standardTimeMax: src.standardTimeMax,
        onCommit: (date, t) => commitPrediction(side, src, date, t),
      };
    },
    [rowByStay, commitPrediction],
  );

  function arrivalGroupPropsFor(colMode: BoardMode, rows: ArrivalRow[]) {
    const colKind: "checkin" | "checkout" =
      colMode === "checkout" || colMode === "cleaning" || colMode === "done" ? "checkout" : "checkin";
    /**
     * A previsão que a coluna mostra é a do que vem A SEGUIR — não a do lado
     * de onde a lista veio. "Em Estadia" é o caso que revela a diferença: o
     * card sai da lista de chegadas, mas a chegada já aconteceu; o que falta
     * prever ali é a saída.
     */
    const predKind: "checkin" | "checkout" =
      colMode === "stay" || colMode === "checkout" || colMode === "cleaning" || colMode === "done"
        ? "checkout"
        : "checkin";
    const otherKind: "checkin" | "checkout" = predKind === "checkout" ? "checkin" : "checkout";
    return {
      rows,
      kind: colKind,
      mode: colMode,
      getPrediction: (r: ArrivalRow): CardPrediction => ({
        primary: buildPredictionSide(predKind, r),
        // O outro lado vai junto, recolhido: quem já sabe a chegada E a saída
        // registra as duas sem sair do card (pedido explícito, 08/09/2026).
        secondary: buildPredictionSide(otherKind, r),
      }),
      onMark: (row: ArrivalRow) => {
        if (colMode === "done" || colMode === "no_show") return;
        handleAdvance(row, colMode as "checkin" | "stay" | "checkout" | "cleaning");
      },
      // "Limpeza não será realizada" — conclui a estadia sem contabilizar
      // nenhum valor de limpeza (só faz sentido na esteira de saída).
      onSkipCleaning:
        colMode === "checkout" || colMode === "stay" || colMode === "cleaning"
          ? (row: ArrivalRow) => {
              if (
                !window.confirm(
                  "Marcar que a limpeza NÃO será realizada? O card vai para Concluídos e o valor da limpeza não será contabilizado.",
                )
              )
                return;
              runAdvance(row, colMode as "stay" | "checkout" | "cleaning", undefined, true);
            }
          : undefined,
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
              unpinRow(row.logId);

              if (colMode === "stay")
                patchList("checkin", (rows) =>
                  rows.map((r) => (r.logId === row.logId ? { ...r, status: "pending" } : r)),
                );
              else if (colMode === "checkout" || colMode === "cleaning")
                patchList("checkout", (rows) =>
                  rows.map((r) => (r.logId === row.logId ? { ...r, status: "pending" } : r)),
                );
              // "done" e "no_show" não têm otimista aqui: a lista de origem
              // (Concluídos/Não Compareceu) é buscada à parte, não patcheada
              // no cache de checkin/checkout — o refetch do refreshDashboard
              // já resolve, mesmo racional que "done" sempre teve.
              revert.mutate({ ...target, from: colMode as "checkout" | "stay" | "cleaning" | "done" | "no_show" });
            },
      // Só a coluna de Check-ins oferece "Não Compareceu" (pedido explícito,
      // 05/09/2026: a opção vive no menu "⋮" do card de check-in pendente).
      onNoShow:
        colMode === "checkin"
          ? (row: ArrivalRow) => {
              const target = statusTarget(row);
              if (!target.logId && !target.reservationId) {
                toast.error("Não foi possível identificar esse card.");
                return;
              }
              if (
                !window.confirm(
                  `Marcar ${row.guestName || "este hóspede"} como "Não Compareceu"? O card sai da lista de Check-ins e o imóvel fica liberado para o próximo check-in imediatamente.`,
                )
              )
                return;
              setBusyRowId(row.logId);
              unpinRow(row.logId);

              // Otimista: some da coluna de Check-ins na hora — o refetch
              // (refreshDashboard, no onSuccess da mutation) traz de volta na
              // coluna "Não Compareceu".
              patchList("checkin", (rows) => rows.filter((r) => r.logId !== row.logId));
              noShow.mutate(target);
              notifyAction('Marcado como "Não Compareceu".', () => {
                setBusyRowId(row.logId);
                revert.mutate({ ...target, from: "no_show" });
              });
            }
          : undefined,
      onSyncIcal: (row: ArrivalRow) => {
        const t = colKind === "checkin" ? "15:00" : "11:00";
        const prev = row.arrivalTimeOverride ?? null;
        setBusyRowId(row.logId);
        pinRow(row.logId);

        upsert.mutate({ ...statusTarget(row), kind: colKind, arrivalTimeOverride: t });
        notifyAction(`Horário alinhado ao iCal (${t}).`, () => {
          setBusyRowId(row.logId);
          upsert.mutate({ ...statusTarget(row), kind: colKind, arrivalTimeOverride: prev });
        });
      },
      onNote: (row: ArrivalRow, note: string | null) => {
        const prev = row.note ?? null;
        setBusyRowId(row.logId);
        upsert.mutate({ ...statusTarget(row), kind: colKind, note });
        notifyAction(note ? "Observação salva." : "Observação removida.", () => {
          setBusyRowId(row.logId);
          upsert.mutate({ ...statusTarget(row), kind: colKind, note: prev });
        });
      },
      onEditDates: (row: ArrivalRow, dates: { checkinDate?: string; checkoutDate?: string | null }) => {
        const prev = { checkinDate: row.guestCheckin, checkoutDate: row.guestCheckout ?? null };
        setBusyRowId(row.logId);
        updateDates.mutate({ logId: row.logId, ...dates });
        notifyAction("Datas atualizadas.", () => {
          setBusyRowId(row.logId);
          updateDates.mutate({ logId: row.logId, ...prev });
        });
      },
      onEditPredictedDate: (row: ArrivalRow, date: string | null) => {
        const prev = row.arrivalDateOverride ?? null;
        setBusyRowId(row.logId);
        pinRow(row.logId);

        // Otimista, mesmo racional do handleEditTime/optimisticMove.
        patchList(colKind, (rows: ArrivalRow[]) =>
          rows.map((r) => (r.logId === row.logId ? { ...r, arrivalDateOverride: date } : r)),
        );
        upsert.mutate({ ...statusTarget(row), kind: colKind, arrivalDateOverride: date });
        notifyAction(date ? "Data prevista atualizada." : "Data prevista removida.", () => {
          setBusyRowId(row.logId);
          patchList(colKind, (rows: ArrivalRow[]) =>
            rows.map((r) => (r.logId === row.logId ? { ...r, arrivalDateOverride: prev } : r)),
          );
          upsert.mutate({ ...statusTarget(row), kind: colKind, arrivalDateOverride: prev });
        });
      },
      onEditTime: (row: ArrivalRow, time: string | null) => handleEditTime(row, colKind, time),
      // Limpa os dois campos (Data + Horário previstos) de uma vez —
      // botão só aparece quando pelo menos um dos dois estiver preenchido.
      onClearPredicted: (row: ArrivalRow) => {
        const prevDate = row.arrivalDateOverride ?? null;
        const prevTime = row.arrivalTimeOverride ?? null;
        setBusyRowId(row.logId);
        pinRow(row.logId);

        patchList(colKind, (rows: ArrivalRow[]) =>
          rows.map((r) => (r.logId === row.logId ? { ...r, arrivalDateOverride: null, arrivalTimeOverride: null } : r)),
        );
        upsert.mutate({
          ...statusTarget(row),
          kind: colKind,
          arrivalDateOverride: null,
          arrivalTimeOverride: null,
        });
        notifyAction("Previsão de data e horário removida.", () => {
          setBusyRowId(row.logId);
          patchList(colKind, (rows: ArrivalRow[]) =>
            rows.map((r) =>
              r.logId === row.logId ? { ...r, arrivalDateOverride: prevDate, arrivalTimeOverride: prevTime } : r,
            ),
          );
          upsert.mutate({
            ...statusTarget(row),
            kind: colKind,
            arrivalDateOverride: prevDate,
            arrivalTimeOverride: prevTime,
          });
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
    <span
      aria-hidden="true"
      className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-purple-500 to-pink-500"
    />
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
      <OperationShell
        view={view}
        title={
          view === "limpeza" ? (cleaningWindow === "past" ? "Limpeza Últimos 7d" : "Limpeza Próximos 7d") : undefined
        }
        subtitle={
          view === "limpeza"
            ? cleaningWindow === "past"
              ? "Histórico e custos das limpezas realizadas."
              : "Previsão de limpezas e custos dos próximos 7d."
            : undefined
        }
      />

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
                pinnedIds={pinnedRowIds}
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
                pinnedIds={pinnedRowIds}
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
                pinnedIds={pinnedRowIds}
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
                pinnedIds={pinnedRowIds}
                cardProps={arrivalGroupPropsFor("checkout", tomorrowCheckoutPendingRows)}
              />
            </div>

            {/* Fila de Limpeza — faixa fina, largura total (só quando houver
                1+), mantendo o destaque âmbar (borda + gradiente + acento
                lateral). Fica logo depois dos 4 KPIs do topo. */}
            {cleaningRows.length > 0 ? (
              <div className="order-5 lg:order-5 col-span-2 lg:col-span-4">
                <KpiCard
                  label="Fila de Limpeza"
                  rows={cleaningRows}
                  icon={Sparkles}
                  tone="primary-soft"
                  loading={checkoutListQ.isLoading}
                  onRefresh={() => checkoutListQ.refetch()}
                  rangeLabel={rangeLabel[range]}
                  compact
                  highlight="amber"
                  pinnedIds={pinnedRowIds}
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
                pinnedIds={pinnedRowIds}
                cardProps={arrivalGroupPropsFor("stay", stayRows)}
              />
            </div>
            <div className="order-8 lg:order-8 col-span-1">
              <FreePropertiesCard
                loading={occupancyQ.isLoading}
                properties={freeProperties}
                day={occStart}
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
            {/* Alternador entre as duas janelas. O rótulo é sempre o DESTINO,
                como um interruptor: estando nos últimos 7 dias ele oferece os
                próximos, e vice-versa. */}
            <button
              type="button"
              onClick={() => setCleaningWindow((w) => (w === "past" ? "next" : "past"))}
              className="relative h-8 shrink-0 inline-flex items-center gap-1.5 rounded-[0.3rem] border-0 bg-transparent px-1.5 text-xs font-medium leading-none text-foreground/70 hover:text-foreground transition-colors"
            >
              <Sparkles className="size-3.5 opacity-60" />
              {cleaningWindow === "past" ? "PRÓXIMOS 7D" : "ÚLTIMOS 7D"}
            </button>
          </div>

          {/* Cards de limpeza — mais métricas chegam aqui conforme forem
              implementadas. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 mt-1.5">
            <div className="col-span-1">
              <StatDisplayCard
                label={cleaningWindow === "past" ? "Limpezas Realizadas" : "Limpezas Previstas"}
                value={
                  cleaningWindow === "past"
                    ? (cleaningStatsQ.data?.cleaningsDone ?? 0)
                    : cleaningForecast.cleaningsExpected
                }
                icon={CheckCircle2}
                loading={cleaningWindow === "past" ? cleaningStatsQ.isLoading : cleaningForecastListQ.isLoading}
              />
            </div>
            <div className="col-span-1">
              <StatDisplayCard
                label={cleaningWindow === "past" ? "Custo Total Limpeza" : "Custo Estimado"}
                value={centsToBRL(
                  cleaningWindow === "past"
                    ? (cleaningStatsQ.data?.totalCents ?? 0)
                    : cleaningForecast.estimatedTotalCents,
                )}
                icon={Banknote}
                loading={cleaningWindow === "past" ? cleaningStatsQ.isLoading : cleaningForecastListQ.isLoading}
              />
            </div>
          </div>

          {/* Gráficos de tendência (pedido explícito, combinando as opções A
              e C dos mockups aprovados) — sem mexer no layout dos cards
              acima, só adicionando estes logo abaixo. */}
          {/* Os MESMOS componentes nas duas janelas — só a fonte muda. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5 mt-1.5">
            <CleaningDailyBarChart
              title={cleaningWindow === "past" ? "Limpezas por dia" : "Limpezas previstas por dia"}
              data={cleaningWindow === "past" ? cleaningTrendQ.data?.daily : cleaningForecast.daily}
              loading={cleaningWindow === "past" ? cleaningTrendQ.isLoading : cleaningForecastListQ.isLoading}
            />
            <CleaningDailyAreaChart
              title={cleaningWindow === "past" ? "Custo total por dia" : "Custo estimado por dia"}
              data={cleaningWindow === "past" ? cleaningTrendQ.data?.daily : cleaningForecast.daily}
              loading={cleaningWindow === "past" ? cleaningTrendQ.isLoading : cleaningForecastListQ.isLoading}
            />
          </div>
          <div className="mt-1.5">
            <CleaningTopProperties
              items={cleaningWindow === "past" ? cleaningTrendQ.data?.breakdown : cleaningForecast.breakdown}
              loading={cleaningWindow === "past" ? cleaningTrendQ.isLoading : cleaningForecastListQ.isLoading}
            />
          </div>

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
                {/* Pedido explícito (07/09/2026): alternador Completo/Lista e
                    print ficam à direita de Filtros/Pendências — mesmos
                    componentes já usados nos popups de KPI e no tooltip de
                    Limpeza. No desktop o alvo do print é o próprio container
                    rolável com as colunas do quadro (kanbanRowRef, abaixo). */}
                <ScreenshotButton targetRef={kanbanRowRef} fileName="kanban" />
                <ViewModeToggle value={kanbanListMode} onChange={setKanbanListMode} />
              </div>
            </div>

            {/* Mobile: abas roláveis, uma coluna ativa por vez — 5 colunas lado a
                lado não cabem numa tela estreita. O item ativo usa sempre o
                gradiente da marca (mesmo tratamento de toda aba/badge ativo do
                app), não uma cor diferente por aba. Filtros/Pendências ficam
                numa linha própria ACIMA da barra de abas — mesma posição que
                já usam na aba Limpeza (irmã desta, no mesmo header). */}
            <div className="sm:hidden space-y-3">
              <div className="space-y-2">
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
                  {/* Pedido explícito (07/09/2026): print e alternador ficam
                      encostados na BORDA DIREITA da linha (ml-auto), com
                      Filtros/Pendências à esquerda — antes os quatro ficavam
                      amontoados à esquerda. No mobile o print captura só a aba
                      ativa (kanbanMobileScreenshotRef, ancorado no wrapper do
                      conteúdo da aba, mais abaixo) — as outras colunas nem
                      estão montadas na tela pra fotografar. */}
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <ScreenshotButton targetRef={kanbanMobileScreenshotRef} fileName={`kanban-${mobileTab}`} />
                    <ViewModeToggle value={kanbanListMode} onChange={setKanbanListMode} />
                  </div>
                </div>
                {/* Wrapper relative só pra ancorar o degrade — regra
                    "anti-corte" (peek): a barra continua rolável igual antes,
                    mas agora com uma pista visual de que há mais abas pra
                    rolar (a última aba nunca fica com o corte seco na
                    borda). Degrade some sozinho quando a barra cabe inteira,
                    já que sem overflow não há nada mesmo pra "espiar". */}
                <div className="relative">
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
                    /* REGRA ANTI-CORTE (regra global do projeto): esta barra
                       passou a usar `useAntiClipBar`, o MESMO hook das outras
                       barras de abas do sistema. Antes ela tinha só um
                       `scrollIntoView` no clique — que conserta a aba que você
                       acabou de tocar, e não a barra: ao abrir a tela, a
                       próxima aba continuava aparecendo pela metade na borda
                       (print de 09/09/2026). O hook garante que nenhuma aba
                       apareça cortada em nenhuma largura, e que a sobra vire
                       espaçador invisível. */
                    ref={kanbanTabsRef}
                    className="ds-scroll-x w-full min-w-0 gap-1.5 pb-1 -mx-1 px-1"
                  >
                    {(
                      [
                        { key: "checkin", label: "Check-ins", icon: CalendarCheck, count: kanbanCounts.checkin },
                        { key: "checkout", label: "Checkouts", icon: CalendarX, count: kanbanCounts.checkout },
                        { key: "cleaning", label: "Fila Limpeza", icon: Sparkles, count: kanbanCounts.cleaning },
                        { key: "stay", label: "Estadia", icon: BedDouble, count: kanbanCounts.stay },
                        { key: "done", label: "Concluídos", icon: CheckCircle2, count: kanbanCounts.done },
                        { key: "no_show", label: "Não Compareceu", icon: UserX, count: kanbanCounts.no_show },
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
                        no_show: "border-b-rose-500 text-rose-500",
                      };
                      return (
                        <button
                          key={t.key}
                          type="button"
                          // O reencaixe da barra é do `useAntiClipBar`, que
                          // observa a mudança de aba ativa — um
                          // `scrollIntoView` aqui competiria com ele e traria
                          // de volta o corte que o hook acabou de resolver.
                          onClick={() => setMobileTab(t.key)}
                          data-state={active ? "active" : "inactive"}
                          className={`h-9 box-border shrink-0 snap-start inline-flex items-center gap-1.5 rounded-none border-0 border-b-2 bg-transparent px-3.5 text-xs font-medium leading-none whitespace-nowrap transition-colors ${
                            active
                              ? `${toneByKey[t.key]} border-b-current`
                              : "border-b-transparent text-muted-foreground"
                          }`}
                        >
                          <Icon className="size-3.5" />
                          {t.label}
                          <span className="opacity-75 tabular-nums">{t.count}</span>
                        </button>
                      );
                    })}
                  </div>
                  {/* O degradê que existia nesta borda foi REMOVIDO: a regra
                      anti-corte proíbe máscara/gradiente nas laterais (pedido
                      do cliente). Quem sinaliza que há mais abas agora é o
                      próprio hook, que nunca deixa uma aba pela metade. */}
                </div>
              </div>

              {/* Ref só pro print (ScreenshotButton acima) — captura sempre a
                  aba atualmente montada, seja qual for. */}
              <div ref={kanbanMobileScreenshotRef}>
                {mobileTab === "checkin" &&
                  (kanbanCheckinListQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanCheckinPendingRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("checkin", kanbanCheckinPendingRows)}
                      compact={kanbanListMode === "list"}
                    />
                  ))}
                {mobileTab === "checkout" &&
                  (kanbanCheckoutListQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanCheckoutPendingRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("checkout", kanbanCheckoutPendingRows)}
                      compact={kanbanListMode === "list"}
                    />
                  ))}
                {mobileTab === "stay" &&
                  (kanbanCheckinListQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanStayRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("stay", kanbanStayRows)}
                      compact={kanbanListMode === "list"}
                    />
                  ))}
                {mobileTab === "cleaning" &&
                  (kanbanCheckoutListQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanCleaningRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("cleaning", kanbanCleaningRows)}
                      compact={kanbanListMode === "list"}
                    />
                  ))}
                {mobileTab === "done" &&
                  (concludedQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanConcludedRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("done", kanbanConcludedRows)}
                      compact={kanbanListMode === "list"}
                    />
                  ))}
                {mobileTab === "no_show" &&
                  (noShowQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanNoShowRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("no_show", kanbanNoShowRows)}
                      compact={kanbanListMode === "list"}
                    />
                  ))}
              </div>
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
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("checkin", kanbanCheckinPendingRows)}
                      compact={kanbanListMode === "list"}
                    />
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
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("checkout", kanbanCheckoutPendingRows)}
                      compact={kanbanListMode === "list"}
                    />
                  )}
                </KanbanColumn>
              </div>

              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, cleaning: null }))}
                  title="Fila de Limpeza"
                  icon={Sparkles}
                  count={kanbanCounts.cleaning}
                  tone="violet"
                >
                  {kanbanCheckoutListQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanCleaningRows.length === 0 ? (
                    <ColumnEmpty />
                  ) : (
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("cleaning", kanbanCleaningRows)}
                      compact={kanbanListMode === "list"}
                    />
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
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("stay", kanbanStayRows)}
                      compact={kanbanListMode === "list"}
                    />
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
                  {/* Fora do limite padrão de 200 mais recentes: um card
                      concluído há mais tempo (ex.: um check dado por engano)
                      pode não estar nos 200 últimos e simplesmente não
                      aparecer — a busca soltra esse limite no servidor. */}
                  <div className="relative sticky top-0 z-10 -mt-0.5 mb-1">
                    <Search className="size-3.5 opacity-60 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      value={concludedSearch}
                      onChange={(e) => setConcludedSearch(e.target.value)}
                      placeholder="Buscar em concluídos…"
                      className="h-8 w-full box-border rounded-none border-0 bg-secondary/60 pl-8 pr-7 text-xs font-normal leading-none text-foreground/80 placeholder:text-muted-foreground focus:outline-none focus:bg-secondary transition-colors"
                    />
                    {concludedSearch && (
                      <button
                        type="button"
                        onClick={() => setConcludedSearch("")}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded-none text-muted-foreground hover:text-foreground"
                        aria-label="Limpar busca"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {concludedQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanConcludedRows.length === 0 ? (
                    concludedSearch ? (
                      <p className="ds-meta px-1 py-6 text-center">Nenhum resultado para "{concludedSearch}".</p>
                    ) : (
                      <ColumnEmpty />
                    )
                  ) : (
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("done", kanbanConcludedRows)}
                      compact={kanbanListMode === "list"}
                    />
                  )}
                </KanbanColumn>
              </div>

              {/* Coluna nova, depois de "Concluídos" (pedido explícito,
                  05/09/2026) — espelha a coluna de Concluídos (mesma busca,
                  mesmo limite de 200/3000 no servidor), só que pros cards
                  marcados como "Não Compareceu" pelo menu "⋮" da coluna de
                  Check-ins. */}
              <div style={{ width: kanbanColWidth }} className="shrink-0 snap-start">
                <KanbanColumn
                  onScroll={() => setExpandedByColumn((prev) => ({ ...prev, no_show: null }))}
                  title="Não Compareceu"
                  icon={UserX}
                  count={kanbanCounts.no_show}
                  tone="rose"
                >
                  <div className="relative sticky top-0 z-10 -mt-0.5 mb-1">
                    <Search className="size-3.5 opacity-60 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      value={noShowSearch}
                      onChange={(e) => setNoShowSearch(e.target.value)}
                      placeholder="Buscar em não compareceu…"
                      className="h-8 w-full box-border rounded-none border-0 bg-secondary/60 pl-8 pr-7 text-xs font-normal leading-none text-foreground/80 placeholder:text-muted-foreground focus:outline-none focus:bg-secondary transition-colors"
                    />
                    {noShowSearch && (
                      <button
                        type="button"
                        onClick={() => setNoShowSearch("")}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded-none text-muted-foreground hover:text-foreground"
                        aria-label="Limpar busca"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {noShowQ.isLoading ? (
                    <ColumnLoading />
                  ) : kanbanNoShowRows.length === 0 ? (
                    noShowSearch ? (
                      <p className="ds-meta px-1 py-6 text-center">Nenhum resultado para "{noShowSearch}".</p>
                    ) : (
                      <ColumnEmpty />
                    )
                  ) : (
                    <ArrivalGroup
                      title=""
                      {...arrivalGroupPropsFor("no_show", kanbanNoShowRows)}
                      compact={kanbanListMode === "list"}
                    />
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
              onSetStatus={requestSetTaskStatus}
              onSkipOccurrence={(taskId) => skipTaskOccurrenceMutation.mutate({ taskId })}
            />

            <TaskResolveDialog
              state={resolvePrompt}
              onOpenChange={(v) => !v && closeResolvePrompt()}
              providers={taskLinkOptionsQ.data?.providers ?? []}
              onConfirm={confirmResolve}
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

function OperationShell({
  view,
  title,
  subtitle,
}: {
  view: OperationView;
  /** A Limpeza tem DUAS janelas na MESMA tela (últimos 7d / próximos 7d) e o
   * título precisa dizer qual está no ar (pedido explícito). Só o texto muda;
   * o resto da página é idêntico. */
  title?: string;
  subtitle?: string;
}) {
  const copy = OPERATION_COPY[view];
  return (
    <div className="space-y-3">
      <div>
        <h1 className="ds-page-title truncate">{title ?? copy.title}</h1>
        <p className="ds-page-subtitle mt-1.5">{subtitle ?? copy.subtitle}</p>
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
  rose: "text-rose-600 dark:text-rose-400 bg-rose-500/10 ring-rose-500/20",
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
  rose: "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400",
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
  tone: "emerald" | "amber" | "sky" | "violet" | "zinc" | "rose";
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
        className="sg-elegant-scroll flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory pt-5 px-2.5 pb-2.5 space-y-1.5"
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

/**
 * A previsão que um card exibe e edita: o lado principal (o do que vem a
 * seguir) e o outro lado, que aparece recolhido dentro do mesmo tooltip.
 * Montada por coluna em `arrivalGroupPropsFor`.
 */
type CardPrediction = {
  primary: PredictionSide;
  secondary: PredictionSide | null;
};

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
  pinnedIds,
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
  /** Destaque visual opt-in (só usado hoje por "Fila de Limpeza"): borda +
   * gradiente âmbar + acento lateral + ícone em caixinha, sem negrito.
   * Não afeta nenhum outro uso do KpiCard (compact ou não). */
  highlight?: "amber";
  /** Cards que devem continuar visíveis no popup mesmo que já não pertençam
   * mais à lista — hoje só os que tiveram HORÁRIO/DATA PREVISTOS ajustados. */
  pinnedIds?: ReadonlySet<string>;
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
  // A lista do popup é AO VIVO: qualquer ação de esteira (check, "não
  // compareceu", "limpeza não será realizada", desfazer) tira o card da tela
  // na hora do clique.
  //
  // Única exceção (pedido explícito): ajustar DATA/HORÁRIO PREVISTOS não pode
  // fazer o card sumir no meio da edição — esses cards ficam "presos" na
  // lista (via `pinnedIds`, na mesma posição em que estavam quando o popup
  // abriu) até o usuário fechar o popup no "X".
  const [frozenSnapshot, setFrozenSnapshot] = useState<Map<string, ArrivalRow> | null>(null);
  useEffect(() => {
    if (!open) {
      // Fechou (ou ainda não abriu): solta a "foto", pra próxima abertura
      // tirar uma nova, já atualizada.
      setFrozenSnapshot(null);
      return;
    }
    if (!loading && frozenSnapshot === null) {
      setFrozenSnapshot(new Map(rows.map((r) => [r.logId, r] as const)));
    }
  }, [open, loading, rows, frozenSnapshot]);
  const displayRows = useMemo(() => {
    if (!frozenSnapshot || !pinnedIds || pinnedIds.size === 0) return rows;
    const liveIds = new Set(rows.map((r) => r.logId));
    const out = [...rows];
    let idx = 0;
    for (const id of frozenSnapshot.keys()) {
      if (!liveIds.has(id) && pinnedIds.has(id)) {
        out.splice(Math.min(idx, out.length), 0, frozenSnapshot.get(id)!);
      }
      idx++;
    }
    return out;
  }, [frozenSnapshot, rows, pinnedIds]);

  const list = useWholeCardsMaxHeight(2, `${open}:${displayRows.length}:${loading}:${listMode}`);
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
                {rangeLabel} · {displayRows.length} {displayRows.length === 1 ? "hóspede" : "hóspedes"}
              </div>
            </div>
          </div>
          {displayRows.length > 0 && (
            <div className="flex items-center justify-end gap-1.5 mt-3">
              <ScreenshotButton
                targetRef={screenshotRef}
                fileName={`${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                receiptRows={displayRows}
                receiptTitle={label}
              />
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
          ) : displayRows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Nenhum registro no período.</div>
          ) : (
            <div className="pb-3">
              <ArrivalGroup title="" {...cardProps} rows={displayRows} compact={listMode === "list"} />
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
        /* Sem borda e com o canto do card (pedido explícito, 08/09/2026): a
           etiqueta passou a usar o mesmo desenho do resto do sistema, em vez
           da pílula contornada que era o único objeto assim na tela. */
        className="inline-flex items-center gap-1 rounded-[0.3rem] border-0 bg-amber-500/20 dark:bg-amber-500/25 px-2 py-0.5 text-[9.5px] uppercase tracking-[0.1em] font-extrabold text-amber-700 dark:text-amber-300 shadow-sm transition-colors hover:bg-amber-500/30"
        title="Ver alertas"
      >
        <AlertTriangle className="size-3 shrink-0" />
        {/* "Engajamento" virou "ALERTA" (pedido explícito, 08/09/2026): a
            etiqueta nomeia o que ela FAZ — avisar — e não a métrica de onde
            os avisos saíram. Quem lê um card no meio da operação não precisa
            saber que a origem é o engajamento do hóspede. */}
        Alerta
      </button>
      {open && (
        <ul className="absolute left-1/2 top-full z-30 mt-1 min-w-[190px] -translate-x-1/2 space-y-1 rounded-[0.3rem] border border-amber-500/25 bg-popover px-2 py-1.5 shadow-lg">
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
  day,
}: {
  loading: boolean;
  properties: Array<{ id: string; name: string }>;
  onRefresh: () => void;
  /** Dia a que o número se refere (o primeiro do período aberto). */
  day: string;
}) {
  const [open, setOpen] = useState(false);
  const list = useWholeCardsMaxHeight(2, `${open}:${properties.length}:${loading}`);
  // O número sempre foi o do dia ABERTO, não necessariamente o de hoje — mas
  // o título dizia "hoje" em qualquer caso. Abrir outro dia no calendário e
  // ler "Imóveis livres hoje" com o número de outro dia é o tipo de erro que
  // ninguém percebe até tomar uma decisão errada por causa dele.
  const isToday = day === todayISOSaoPaulo();
  const dayLabel = isToday ? "hoje" : fmtDateBR(day);
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
            <span className="min-w-0 flex-1 truncate leading-none" title={`Imóveis livres ${dayLabel}`}>
              Imóveis livres {isToday ? "" : dayLabel}
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
          <DialogTitle className="text-base font-display">Imóveis livres {dayLabel}</DialogTitle>
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
            <div className="py-10 text-center text-sm text-muted-foreground">Nenhum imóvel livre {dayLabel}.</div>
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
      <ul ref={screenshotRef} className="sg-elegant-scroll max-h-48 space-y-1 overflow-y-auto bg-popover">
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
    "Fila de Limpeza"). */
const CLEANING_COUNT_COLOR = "#38bdf8"; // sky-400
const CLEANING_COST_COLOR = "#d97706"; // amber-600

/**
 * Largura mínima de UM dia nos gráficos de previsão. Escolhida pelo rótulo
 * mais largo que pode aparecer ("08/09" ou "R$1.234" em 9–10px, ~36px), mais
 * respiro dos dois lados. É esse número que garante que dois dias vizinhos
 * nunca fiquem "muito próximos um do outro" — a condição que o pedido usa
 * para acionar a rolagem.
 */
const CLEANING_DAY_MIN_PX = 56;

/** Rótulo curto do eixo horizontal: "08/09". */
function dayTick(v: string): string {
  const [, m, d] = v.split("-");
  return `${d}/${m}`;
}

/**
 * Moldura comum dos dois gráficos de previsão (pedido explícito, 08/09/2026).
 *
 * Duas decisões moram aqui:
 *
 *   · NÃO existe mais eixo vertical. A grandeza é lida no rótulo em cima de
 *     cada marca e no tooltip — a "legenda vertical" saiu a pedido, e sair
 *     sem colocar nada no lugar deixaria o gráfico ilegível.
 *
 *   · TODO dia do filtro aparece rotulado (`interval={0}`), nunca "um sim,
 *     outro não". Quando os dias não cabem, quem cede é a largura da vista,
 *     não o rótulo: a faixa passa a rolar para a direita e a janela visível
 *     encolhe até o último dia INTEIRO (regra anti-corte, ver
 *     useAntiClipColumns). Sem degradê nas bordas — proibido pelo cliente.
 */
function CleaningChartFrame({
  title,
  data,
  loading,
  children,
}: {
  title: string;
  data: CleaningDailyPoint[] | undefined;
  loading: boolean;
  children: (width: number) => React.ReactElement;
}) {
  const days = data?.length ?? 0;
  const anti = useAntiClipColumns(days, CLEANING_DAY_MIN_PX);
  return (
    <div className="w-full rounded-[0.3rem] border-0 bg-card px-3.5 py-3.5 ds-3d">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="ds-eyebrow">{title}</span>
        <span className="text-[10px] text-muted-foreground">
          {days > 0 ? `${days} dias${anti.scrolls ? " · role para o lado" : ""}` : ""}
        </span>
      </div>
      {loading || !data || days === 0 ? (
        <div className="h-32 grid place-items-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : (
        <div ref={anti.ref} className="flex w-full">
          <div className="sg-elegant-scroll overflow-x-auto overflow-y-hidden" style={{ width: anti.viewportWidth }}>
            <div className="h-32" style={{ width: anti.contentWidth }}>
              {anti.contentWidth ? children(anti.contentWidth) : null}
            </div>
          </div>
          {/* Espaçador INVISÍVEL: é a sobra que não dá para um dia inteiro.
              Sem ele, o dia seguinte apareceria pela metade na borda. */}
          {anti.spacer > 0 && <span aria-hidden className="shrink-0" style={{ width: anti.spacer }} />}
        </div>
      )}
    </div>
  );
}

const CLEANING_TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
} as const;

function CleaningDailyBarChart({
  data,
  loading,
  title = "Limpezas por dia",
}: {
  data: CleaningDailyPoint[] | undefined;
  loading: boolean;
  /** A mesma tela serve às duas janelas (últimos 7d / próximos 7d); só o
   * título muda. */
  title?: string;
}) {
  return (
    <CleaningChartFrame title={title} data={data} loading={loading}>
      {(width) => (
        <BarChart width={width} height={128} data={data} margin={{ top: 14, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={dayTick}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            // interval=0: todos os dias rotulados, sem exceção.
            interval={0}
          />
          <RechartsTooltip
            contentStyle={CLEANING_TOOLTIP_STYLE}
            labelFormatter={(v: unknown) => fmtDateBR(String(v))}
            formatter={(value: number) => [`${value}`, "Limpezas"]}
            cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          />
          <Bar
            dataKey="count"
            fill={CLEANING_COUNT_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
            isAnimationActive={false}
          >
            {/* Substitui o eixo vertical removido: o número fica em cima da
                própria barra, que é onde se olha. */}
            <LabelList
              dataKey="count"
              position="top"
              offset={4}
              style={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            />
          </Bar>
        </BarChart>
      )}
    </CleaningChartFrame>
  );
}

function CleaningDailyAreaChart({
  data,
  loading,
  title = "Custo total por dia",
}: {
  data: CleaningDailyPoint[] | undefined;
  loading: boolean;
  title?: string;
}) {
  return (
    <CleaningChartFrame title={title} data={data} loading={loading}>
      {(width) => (
        <AreaChart width={width} height={128} data={data} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="cleaningCostArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={CLEANING_COST_COLOR} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CLEANING_COST_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={dayTick}
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          <RechartsTooltip
            contentStyle={CLEANING_TOOLTIP_STYLE}
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
          >
            {/* Mesmo papel do rótulo das barras. Valor arredondado e sem
                centavos, como o eixo removido já fazia — o valor cheio
                continua no tooltip. Dia sem custo não ganha rótulo, para não
                encher o gráfico de "R$0". */}
            <LabelList
              dataKey="totalCents"
              position="top"
              offset={6}
              formatter={(v: number) => (v ? `R$${Math.round(v / 100).toLocaleString("pt-BR")}` : "")}
              style={{ fontSize: 9.5, fill: "var(--muted-foreground)" }}
            />
          </Area>
        </AreaChart>
      )}
    </CleaningChartFrame>
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
              <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                {item.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
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

/**
 * Conclusão de pendência com prestação de contas (pedido explícito,
 * 07/09/2026): quem resolveu, quanto custou e a comprovação. Os três são
 * OPCIONAIS — o botão "Concluir" funciona com tudo em branco, que é o
 * comportamento que existia antes.
 */
function TaskResolveDialog({
  state,
  onOpenChange,
  providers,
  onConfirm,
}: {
  state: { kind: "status" | "cleaning"; task: TaskRow } | null;
  onOpenChange: (v: boolean) => void;
  providers: TaskLinkProvider[];
  onConfirm: (v: {
    amountSpentCents: number | null;
    providerId: string | null;
    note: string | null;
    files: PendingAttachment[];
  }) => Promise<void>;
}) {
  const [providerId, setProviderId] = useState<string | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [cents, setCents] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const task = state?.task;

  // Reabrir o diálogo pra outra pendência não pode herdar o que foi digitado
  // na anterior.
  useEffect(() => {
    if (!state) return;
    setProviderId(null);
    setProviderOpen(false);
    setCents(state.task.amountSpentCents ?? null);
    setNote("");
    setFiles([]);
    setSaving(false);
  }, [state?.task.id, state?.kind]);

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm({
        amountSpentCents: cents,
        providerId,
        note: note.trim() || null,
        files,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui concluir a pendência.");
      setSaving(false);
    }
  }

  const selected = providers.find((p) => p.id === providerId) ?? null;

  return (
    <Dialog open={!!state} onOpenChange={onOpenChange}>
      {/* Mesmas classes do dialog de PENDÊNCIAS (largura, curva, borda,
          fundo, sombra) — pedido explícito (07/09/2026): esta tela destoava
          do padrão do resto do sistema. */}
      <DialogContent className="w-[calc(100vw-2.5rem)] sm:w-full sm:max-w-lg p-0 overflow-hidden rounded-lg border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        <DialogTitle className="sr-only">Concluir pendência</DialogTitle>
        <DialogDescription className="sr-only">
          Registre quem resolveu, quanto custou e a comprovação da resolução.
        </DialogDescription>

        {/* Cabeçalho no mesmo formato do de Pendências: ds-page-title +
            ds-page-subtitle, com pr-9 pra não passar por baixo do X. */}
        <div className="px-5 pt-5 pb-3">
          <h2 className="ds-page-title truncate pr-9">Concluir pendência</h2>
          <p className="ds-page-subtitle mt-1.5 truncate">{task?.title}</p>
          {(task?.propertyName || task?.ownerName) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {task?.propertyName && (
                <span className="inline-flex max-w-full items-center gap-1 rounded-[0.3rem] border border-border/60 bg-secondary/40 px-2 py-1 text-[10.5px] text-muted-foreground">
                  <Home className="size-3 shrink-0" />
                  <span className="truncate text-foreground/80">{task.propertyName}</span>
                </span>
              )}
              {task?.ownerName && (
                <span className="inline-flex max-w-full items-center gap-1 rounded-[0.3rem] border border-border/60 bg-secondary/40 px-2 py-1 text-[10.5px] text-muted-foreground">
                  <User className="size-3 shrink-0" />
                  <span className="truncate text-foreground/80">{task.ownerName}</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="sg-elegant-scroll max-h-[56vh] space-y-2.5 overflow-y-auto px-5 pb-4">
          <TaskFormGroup label="Quem resolveu" />
          {/* Dropdown buscável (pedido explícito): lista completa de
              prestadores + busca por nome, cidade ou tipo de serviço. Mesmo
              par Popover+Command já usado no título da nova pendência. */}
          <Popover open={providerOpen} onOpenChange={setProviderOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-[42px] w-full rounded-lg border border-border bg-background px-2.5 text-left"
              >
                <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Responsável (opcional)
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`min-w-0 flex-1 truncate text-xs ${selected ? "font-semibold" : "text-muted-foreground"}`}
                  >
                    {selected ? selected.name : "Selecione o Responsável"}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
              <Command>
                <CommandInput placeholder="Buscar por nome, cidade ou tipo…" />
                <CommandList className="sg-elegant-scroll max-h-56">
                  <CommandEmpty>Nenhum prestador encontrado.</CommandEmpty>
                  <CommandGroup>
                    {selected && (
                      <CommandItem
                        value="__limpar__ remover responsavel"
                        onSelect={() => {
                          setProviderId(null);
                          setProviderOpen(false);
                        }}
                        className="cursor-pointer text-muted-foreground"
                      >
                        <X className="size-3.5 shrink-0" /> Sem responsável
                      </CommandItem>
                    )}
                    {providers.map((p) => (
                      <CommandItem
                        key={p.id}
                        // O `value` é o que a busca do Command filtra: nome +
                        // cidade + categorias, atendendo os três critérios.
                        value={`${p.name} ${p.city ?? ""} ${p.categories.join(" ")}`}
                        onSelect={() => {
                          setProviderId(p.id);
                          setProviderOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border/60 bg-secondary/50 text-[9px] font-bold text-muted-foreground">
                          {p.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{p.name}</span>
                          {(p.city || p.categories.length > 0) && (
                            <span className="block truncate text-[10px] capitalize text-muted-foreground">
                              {[p.city, p.categories.join(" · ")].filter(Boolean).join(" — ")}
                            </span>
                          )}
                        </span>
                        {providerId === p.id && <Check className="size-3.5 shrink-0 text-emerald-500" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <TaskFormGroup label="Quanto custou" />
          <div className="flex h-[42px] flex-col justify-center rounded-lg border border-border bg-background px-2.5">
            <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              Valor (opcional)
            </span>
            <MoneyInput cents={cents} onChange={setCents} placeholder="0,00" />
          </div>

          <TaskFormGroup label="Comprovação" />
          <AttachmentPicker files={files} onChange={setFiles} disabled={saving} showAudio={false} />
          {/* Pedido explícito: o campo de texto ganha o microfone ao lado,
              pra quem prefere explicar falando. */}
          <div className="flex items-start gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Como foi resolvido…"
              className="w-full flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
            />
            <AudioAttachButton files={files} onChange={setFiles} disabled={saving} />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            {saving && <AttachmentsSending count={files.length} />}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="rounded-md px-2 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Concluindo…" : "Concluir"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Rótulo de seção do formulário de pendência — dá hierarquia ao que antes
 * era uma pilha de campos do mesmo tamanho (pedido explícito, 07/09/2026). */
/**
 * Título de seção do formulário de pendência. Usa `ds-eyebrow` — o rótulo
 * pequeno padrão do Design System, o mesmo dos cards de indicador — em vez de
 * um 9.5px extrabold inventado só aqui, que era o menor texto de toda a tela
 * e não existia em nenhum outro lugar do sistema.
 */
function TaskFormGroup({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="ds-eyebrow text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border/70" />
    </div>
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
  onSkipOccurrence,
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
    amountSpentCents?: number | null;
    recurrenceDays?: number | null;
  }) => Promise<{ id: string }>;
  creating: boolean;
  onSetStatus: (taskId: string, status: "pending" | "done" | "canceled") => void;
  /** Pula SÓ o ciclo atual de uma pendência recorrente (ver
   * skipTaskOccurrence). */
  onSkipOccurrence: (taskId: string) => void;
}) {
  const [groupBy, setGroupBy] = useState<TaskGroupBy>("owner");
  // Pedido explícito (09/09/2026): excluir uma pendência RECORRENTE pergunta
  // primeiro o alcance, como o Google Agenda faz com um evento que se repete.
  // Pendência sem recorrência continua sendo um clique só — perguntar ali
  // seria só um passo a mais sem escolha nenhuma pra fazer.
  const [deletePrompt, setDeletePrompt] = useState<TaskRow | null>(null);
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
        if (!map.has(t.propertyName))
          map.set(t.propertyName, { key: t.propertyName, label: t.propertyName, items: [] });
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
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  /** A chave "mostrar/ocultar na limpeza" segue o padrão da categoria até a
   * pessoa mexer nela — depois disso a escolha manual manda. */
  const [cleaningTouched, setCleaningTouched] = useState(false);
  const attachFn = useServerFn(attachTaskRecord);
  const [recurrenceOn, setRecurrenceOn] = useState(false);
  const [recurrenceDays, setRecurrenceDays] = useState(30);
  const [titleComboOpen, setTitleComboOpen] = useState(false);
  const [dueDatePopoverOpen, setDueDatePopoverOpen] = useState(false);
  const linkMissing = !propertyId && !ownerContactId;

  // Sugestões de título — os mais repetidos nesta conta, sem precisar de
  // uma consulta nova (já temos "tasks" carregado). O campo continua livre:
  // isto é só um atalho.
  const titleSuggestions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) {
      const key = t.title.trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
      .slice(0, 8)
      .map(([t]) => t);
  }, [tasks]);

  function resetForm() {
    setTitle("");
    setDescription("");
    setCategory("other");
    setPriority("medium");
    setDueDate("");
    setShowInCleaning(defaultShowInCleaning("other"));
    setCleaningTouched(false);
    setPropertyId("");
    setOwnerContactId("");
    setFiles([]);
    setRecurrenceOn(false);
    setRecurrenceDays(30);
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
    // Anexo precisa de imóvel (é ele que define a pasta e a permissão do
    // arquivo). Sem isso os arquivos sumiriam em silêncio.
    if (files.length > 0 && !propertyId) {
      toast.error(
        "Para anexar fotos, vídeos ou áudios, escolha um imóvel. Sem imóvel, só é possível salvar a pendência sem anexos.",
      );
      return;
    }
    try {
      const created = await onCreate({
        title: title.trim(),
        description: description.trim() || null,
        category,
        priority,
        dueDate: dueDate || null,
        showInCleaning,
        propertyId: propertyId || null,
        ownerContactId: ownerContactId || null,
        // "Valor" saiu da criação (pedido explícito): na hora de abrir quase
        // nunca se sabe quanto vai custar — ele é perguntado na conclusão.
        amountSpentCents: null,
        recurrenceDays: recurrenceOn ? recurrenceDays : null,
      });
      // Anexos só sobem depois que a pendência existe — antes disso não há
      // id pra vincular, e desistir no meio não pode deixar arquivo órfão.
      if (files.length > 0 && created?.id && propertyId) {
        const res = await uploadPendingAttachments(attachFn, files, {
          propertyId,
          taskId: created.id,
          isResolution: false,
        });
        if (res.failed > 0) toast.error(`${res.failed} anexo(s) não subiram. A pendência foi criada.`);
      }
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
          {/* Pedido explícito (07/09/2026): "Nova" sobe para a MESMA linha do
              título (antes ficava centralizado no bloco título+subtítulo) e
              ganha `pr-9` para caber à ESQUERDA do X de fechar — que é
              absoluto em right-4 com size-8, ou seja, ocupa até 48px da borda.
              Com os 20px do px-5 + 36px do pr-9, sobram 8px de respiro entre
              os dois; antes o X ficava sobreposto ao botão. */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 pr-9">
              <h2 className="ds-page-title min-w-0 flex-1 truncate">Pendências</h2>
              <button
                type="button"
                onClick={() => setShowForm((v) => !v)}
                className="shrink-0 h-8 inline-flex items-center gap-1.5 rounded-[0.3rem] px-2.5 text-xs font-semibold text-white bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] transition-opacity hover:opacity-90"
              >
                {showForm ? <ChevronRight className="size-3.5 rotate-90" /> : <UserPlus className="size-3.5" />}
                Nova
              </button>
            </div>
            <p className="ds-page-subtitle mt-1.5 truncate">
              {activeTasks.length} {activeTasks.length === 1 ? "aberta" : "abertas"}
            </p>
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
                    groupBy === t.key
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {showForm ? (
          /* REDESENHO DO FORMULÁRIO (pedido explícito, 08/09/2026: "está
             completamente fora do layout implementado em sistema e ainda bem
             DESORGANIZADO, DESESTRUTURADO... menos poluição visual e mais
             atratividade").
             O que estava errado era medível, não questão de gosto: nove
             controles com CINCO curvas diferentes (rounded-lg, rounded-md,
             rounded-full, rounded-[0.3rem] e o padrão do Select), TRÊS alturas
             (h-8, h-[42px] e "o que der" no textarea) e SEIS tamanhos de fonte
             (sm, xs, 11.5, 10.5, 9 e o do Select). Cada bloco parecia vir de
             uma tela diferente.
             A correção é usar o padrão que o sistema já tem: `ds-dense-fields`
             (styles.css) é a formatação de campo do Design System — mesma
             curva de 0.3rem, mesma fonte de 13px e mesma altura de 2.25rem já
             usadas no popup de edição em massa e no editor de guia. Tudo aqui
             passa a herdar dela; o que não é um <input>/<select> nativo (as
             pílulas de prioridade, o botão de prazo) repete a MESMA altura
             (h-9) e a MESMA curva à mão. */
          <div className="ds-dense-fields px-5 pb-5 space-y-3">
            <Popover open={titleComboOpen} onOpenChange={setTitleComboOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="ds-surface h-9 w-full flex items-center justify-between gap-2 border border-border bg-background px-2.5 text-[13px] text-left"
                >
                  <span className={`truncate ${title ? "" : "text-muted-foreground"}`}>
                    {title || "Título da pendência"}
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-0" style={{ width: "var(--radix-popover-trigger-width)" }}>
                <Command>
                  <CommandInput
                    value={title}
                    onValueChange={setTitle}
                    placeholder="Digite ou escolha um título…"
                    maxLength={200}
                  />
                  <CommandList className="sg-elegant-scroll max-h-40">
                    {titleSuggestions.length === 0 ? (
                      <CommandEmpty>Digite um título.</CommandEmpty>
                    ) : (
                      <CommandGroup heading="Já usados">
                        {titleSuggestions.map((s) => (
                          <CommandItem
                            key={s}
                            value={s}
                            onSelect={() => {
                              setTitle(s);
                              setTitleComboOpen(false);
                            }}
                            className="cursor-pointer"
                          >
                            <span className="truncate">{s}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Detalhes (opcional)"
              /* Sem altura fixa aqui: `ds-dense-fields` já dá a curva e a
                 fonte, e a regra de altura daquele bloco exclui textarea de
                 propósito (um campo de texto longo com 36px seria pior). */
              className="ds-surface w-full resize-none border border-border bg-background px-2.5 py-2 leading-snug"
            />
            {/* Pedido explícito (07/09/2026): abrir uma pendência de
                manutenção com a foto do problema junto era o que faltava —
                mesmos anexos dos registros da reserva. Os arquivos ficam
                retidos até a pendência existir (ver TaskAttachments). */}
            <AttachmentPicker files={files} onChange={setFiles} disabled={creating} />

            <TaskFormGroup label="Onde" />
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={propertyId || "none"}
                onValueChange={(v) => {
                  const id = v === "none" ? "" : v;
                  setPropertyId(id);
                  // Pedido explícito: escolher o imóvel já auto-seleciona o
                  // proprietário cadastrado dele (quando existir) — o
                  // usuário ainda pode trocar depois, se quiser.
                  if (id) {
                    const prop = linkProperties.find((p) => p.id === id);
                    if (prop?.ownerContactId) setOwnerContactId(prop.ownerContactId);
                  }
                }}
              >
                <SelectTrigger className="h-9">
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
                <SelectTrigger className="h-9">
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
            {/* O aviso só aparece depois que a pessoa desfaz os dois
                vínculos — antes ele nascia laranja na tela, parecendo erro
                antes de qualquer ação. Abrindo pelo card, imóvel e
                proprietário já vêm preenchidos. */}
            {/* Uma linha de apoio só, no lugar de duas: o aviso quando falta
                vínculo, a dica quando ainda não se escolheu nada, e NADA
                quando já está resolvido — texto permanente na tela é a
                poluição que o pedido menciona. */}
            {linkMissing && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Escolha um imóvel e/ou um proprietário — o imóvel já traz o proprietário cadastrado dele.
              </p>
            )}

            <TaskFormGroup label="Como tratar" />
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={category}
                onValueChange={(v) => {
                  const next = v as TaskCategory;
                  setCategory(next);
                  // Enquanto a pessoa não mexer na chave, ela segue o padrão
                  // da categoria (manutenção nasce visível pra limpeza).
                  if (!cleaningTouched) setShowInCleaning(defaultShowInCleaning(next));
                }}
              >
                <SelectTrigger className="h-9">
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
              <Popover open={dueDatePopoverOpen} onOpenChange={setDueDatePopoverOpen}>
                <PopoverTrigger asChild>
                  {/* Uma linha só, com ícone à esquerda — igual a um Select ao
                      lado. O rótulo "PRAZO" em 9px acima do valor era a única
                      coisa na tela inteira naquele tamanho, e o que obrigava
                      este campo a ser 6px mais alto que os vizinhos. */}
                  <button
                    type="button"
                    className={`ds-surface h-9 w-full flex items-center gap-2 border bg-background px-2.5 text-left text-[13px] ${
                      dueDate ? "border-[#a855f7]/60" : "border-border"
                    }`}
                  >
                    <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className={`truncate ${dueDate ? "" : "text-muted-foreground"}`}>
                      {dueDate ? fmtDateBR(dueDate) : "Sem prazo"}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <RangeCalendar
                    mode="single"
                    locale={ptBR}
                    selected={dueDate ? parseISODateLocal(dueDate) : undefined}
                    onSelect={(d) => {
                      setDueDate(d ? dateToISOLocal(d) : "");
                      setDueDatePopoverOpen(false);
                    }}
                    className="p-3"
                  />
                  {dueDate && (
                    <div className="border-t border-border p-2">
                      <button
                        type="button"
                        className="w-full text-[11px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
                        onClick={() => {
                          setDueDate("");
                          setDueDatePopoverOpen(false);
                        }}
                      >
                        Remover prazo
                      </button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            {/* Prioridade desceu para logo abaixo de categoria/prazo: as três
                pílulas coloridas eram a primeira coisa da seção e roubavam a
                atenção do que de fato define a pendência. Mesma altura (h-9)
                dos dois campos acima, para a seção inteira ler como uma grade
                de três linhas iguais. */}
            <div className="flex gap-1.5">
              {(Object.keys(TASK_PRIORITY_LABEL) as TaskPriority[]).map((p) => {
                const on = priority === p;
                const tone =
                  p === "low"
                    ? "border-emerald-500/50 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                    : p === "medium"
                      ? "border-amber-500/50 bg-amber-500/12 text-amber-600 dark:text-amber-400"
                      : "border-rose-500/50 bg-rose-500/12 text-rose-600 dark:text-rose-400";
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`ds-surface h-9 flex-1 border text-[12.5px] font-semibold transition-colors ${
                      on ? tone : "border-border/60 bg-card text-muted-foreground hover:bg-secondary/40"
                    }`}
                  >
                    {TASK_PRIORITY_LABEL[p]}
                  </button>
                );
              })}
            </div>

            <TaskFormGroup label="Opções" />
            {/* As duas opções agora vivem num PAINEL só, separadas por uma
                divisória — antes eram duas caixas soltas com bordas de
                opacidades diferentes, o que fazia parecer que uma pertencia à
                seção e a outra não. */}
            <div className="ds-surface overflow-hidden border border-border divide-y divide-border/60">
              {!showInCleaning && (
                <div className="px-2.5 py-2">
                  <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <Checkbox checked={recurrenceOn} onCheckedChange={(v) => setRecurrenceOn(!!v)} />
                    <Repeat className="size-3.5 shrink-0 text-muted-foreground" />
                    Repetir esta pendência
                  </label>
                  {recurrenceOn && (
                    <div className="mt-2 flex items-center gap-1.5 pl-6 text-[13px] text-muted-foreground">
                      <span>a cada</span>
                      <input
                        type="number"
                        min={1}
                        value={recurrenceDays}
                        onChange={(e) => setRecurrenceDays(Math.max(1, Number(e.target.value) || 1))}
                        className="ds-surface h-8 w-16 border border-border bg-background px-1.5 text-center"
                      />
                      <span>dias</span>
                    </div>
                  )}
                </div>
              )}
              {/* Pedido explícito (07/09/2026): MANUTENÇÃO já nasce visível
                  para a limpeza, e aí a chave serve pra OCULTAR; as demais
                  categorias nascem ocultas e a chave serve pra MOSTRAR. É a
                  mesma coluna no banco (`show_in_cleaning`) — o que muda é o
                  padrão e o sentido em que a pergunta é feita. */}
              {(() => {
                const isMaintenance = category === "maintenance";
                const checked = isMaintenance ? !showInCleaning : showInCleaning;
                return (
                  <label className="flex cursor-pointer items-start gap-2 px-2.5 py-2 text-[13px]">
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      onCheckedChange={(v) => {
                        setCleaningTouched(true);
                        setShowInCleaning(isMaintenance ? !v : !!v);
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block">{isMaintenance ? "Ocultar da limpeza" : "Mostrar na limpeza"}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">
                        {isMaintenance
                          ? "Manutenção vai sozinha para a próxima limpeza do imóvel. Marque para deixá-la fora do checklist."
                          : "Marque para esta pendência entrar no checklist da próxima limpeza do imóvel."}
                      </span>
                    </span>
                  </label>
                );
              })()}
            </div>

            {/* Rodapé com uma divisória acima: separa decisão de ação, e é o
                mesmo desenho do rodapé do diálogo de conclusão. As duas curvas
                (rounded-md no Cancelar e rounded-full no Criar) viraram a
                curva única do sistema. */}
            <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                className="ds-surface h-9 px-3 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={creating}
                className="ds-surface h-9 px-4 text-[13px] font-semibold bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white transition-opacity hover:opacity-90 disabled:opacity-60"
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
                          <div className="min-w-0 flex-1 ds-card-lines">
                            <div
                              className={`text-xs font-semibold leading-snug ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}
                            >
                              {t.title}
                            </div>
                            <div className="text-[10.5px] text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span>{TASK_CATEGORY_LABEL[t.category]}</span>
                              {groupBy !== "property" && t.propertyName && <span>· {t.propertyName}</span>}
                              {t.dueDate && (
                                <span className={late ? "text-rose-500 font-semibold" : ""}>
                                  · {late ? "Atrasada" : fmtDateBR(t.dueDate)}
                                </span>
                              )}
                              {t.amountSpentCents != null && <span>· {centsToBRL(t.amountSpentCents)}</span>}
                              {t.recurrenceDays != null && (
                                <span className="inline-flex items-center gap-0.5">
                                  · <Repeat className="size-2.5" /> {t.recurrenceDays}d
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
                              onClick={() => {
                                if (t.recurrenceDays != null) setDeletePrompt(t);
                                else onSetStatus(t.id, "canceled");
                              }}
                              title={t.recurrenceDays != null ? "Excluir recorrência" : "Arquivar"}
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

      {/* Excluir pendência RECORRENTE — o alcance, primeiro (pedido explícito:
          "tipo quando vai excluir uma agenda do Google"). Uma pendência
          recorrente é UMA linha que reaparece com um prazo novo, então as
          duas opções são de verdade diferentes: pular o ciclo atual mantém a
          rotina viva; encerrar a recorrência arquiva a pendência de vez. */}
      <Dialog
        open={!!deletePrompt}
        onOpenChange={(v) => {
          if (!v) setDeletePrompt(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-display">Excluir pendência recorrente</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">
            Escolha se a exclusão vale só para esta ocorrência ou para todas as futuras.
          </DialogDescription>
          {deletePrompt ? (
            <div className="-mt-2 space-y-3">
              <p className="text-sm text-muted-foreground ds-card-lines">
                <strong className="text-foreground">{deletePrompt.title}</strong> se repete a cada{" "}
                {deletePrompt.recurrenceDays} dias. O que você quer excluir?
              </p>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onSkipOccurrence(deletePrompt.id);
                    setDeletePrompt(null);
                  }}
                  className="ds-surface w-full bg-secondary/40 px-3 py-2.5 text-left hover:bg-secondary transition-colors"
                >
                  <span className="block text-[13px] font-semibold">Somente esta ocorrência</span>
                  <span className="block text-[11px] text-muted-foreground ds-card-lines">
                    O prazo pula {deletePrompt.recurrenceDays} dias à frente e a rotina continua ativa.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSetStatus(deletePrompt.id, "canceled");
                    setDeletePrompt(null);
                  }}
                  className="ds-surface w-full bg-secondary/40 px-3 py-2.5 text-left hover:bg-secondary transition-colors"
                >
                  <span className="block text-[13px] font-semibold text-rose-500">
                    Esta e todas as recorrências futuras
                  </span>
                  <span className="block text-[11px] text-muted-foreground ds-card-lines">
                    Encerra a recorrência e arquiva a pendência.
                  </span>
                </button>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setDeletePrompt(null)}
                  className="ds-surface h-9 px-3 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
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
          <CommandList className="sg-elegant-scroll">
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
    setDraft(
      periodRange ? { from: parseISODateLocal(periodRange.start), to: parseISODateLocal(periodRange.end) } : undefined,
    );
  }, [periodRange]);

  function toggle(list: string[], value: string, onChange: (next: string[]) => void) {
    onChange(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  const periodLabel = periodRange
    ? `${format(parseISODateLocal(periodRange.start), "dd/MM", { locale: ptBR })} – ${format(parseISODateLocal(periodRange.end), "dd/MM", { locale: ptBR })}`
    : "Todos";
  const cityLabel =
    cityFilters.length === 0
      ? "Todas"
      : cityFilters.length === 1
        ? cityFilters[0]
        : `${cityFilters.length} selecionadas`;
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
        className="sg-elegant-scroll w-64 p-0 max-h-[min(28rem,70vh)] overflow-y-auto"
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
              <CommandList className="sg-elegant-scroll max-h-52">
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
              <CommandList className="sg-elegant-scroll max-h-52">
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
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-purple-500 to-pink-500"
      />
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
  onNoShow,
  onSkipCleaning,
  onSyncIcal,
  onNote,
  onEditDates,
  onEditTime,
  getPrediction,
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
  /** Marca um card de Check-ins como "Não Compareceu" — só passado quando
   * mode === "checkin" (ver arrivalGroupPropsFor). */
  onNoShow?: (r: ArrivalRow) => void;
  /** "Limpeza não será realizada" — conclui a estadia sem contabilizar valor. */
  onSkipCleaning?: (r: ArrivalRow) => void;
  onSyncIcal: (r: ArrivalRow) => void;
  onNote: (r: ArrivalRow, note: string | null) => void;
  onEditDates: (r: ArrivalRow, dates: { checkinDate?: string; checkoutDate?: string | null }) => void;
  onEditTime: (r: ArrivalRow, time: string | null) => void;
  getPrediction?: (r: ArrivalRow) => CardPrediction | null;
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
  cleaningTasks?: {
    tasks: TaskRow[];
    completions: TaskCompletion[];
    /** propertyId -> chave do card que é a PRÓXIMA limpeza daquele imóvel. */
    nextCleaningKeyByProperty: Map<string, string>;
  };
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
          onNoShow={onNoShow}
          onSkipCleaning={onSkipCleaning}
          onSyncIcal={onSyncIcal}
          onNote={onNote}
          onEditDates={onEditDates}
          onEditTime={onEditTime}
          prediction={getPrediction ? getPrediction(r) : null}
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

type BoardMode = "checkin" | "checkout" | "stay" | "cleaning" | "done" | "no_show";

function ArrivalCard({
  row,
  kind,
  mode,
  onMark,
  onRevert,
  onNoShow,
  onSkipCleaning,
  onSyncIcal,
  onNote,
  onEditDates,
  onEditTime,
  prediction,
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
  /** Marca este card (Check-ins) como "Não Compareceu" — pedido explícito,
   * 05/09/2026: opção no menu "⋮", só nos cards de check-in ainda pendentes. */
  onNoShow?: (r: ArrivalRow) => void;
  /** "Limpeza não será realizada" — conclui sem contabilizar o valor. */
  onSkipCleaning?: (r: ArrivalRow) => void;
  onSyncIcal: (r: ArrivalRow) => void;
  onNote: (r: ArrivalRow, note: string | null) => void;
  onEditDates: (r: ArrivalRow, dates: { checkinDate?: string; checkoutDate?: string | null }) => void;
  onEditTime: (r: ArrivalRow, time: string | null) => void;
  /** A previsão que este card exibe/edita — ver CardPrediction. */
  prediction?: CardPrediction | null;
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
  cleaningTasks?: {
    tasks: TaskRow[];
    completions: TaskCompletion[];
    /** propertyId -> chave do card que é a PRÓXIMA limpeza daquele imóvel. */
    nextCleaningKeyByProperty: Map<string, string>;
  };
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
    // Pedido explícito (07/09/2026): as pendências abertas do imóvel vão
    // TODAS para a PRÓXIMA limpeza dele — não mais "cada uma na limpeza da
    // sua própria reserva" (que escondia a pendência de uma estadia já
    // encerrada) nem "em toda limpeza" (que repetia a mesma pendência em
    // vários cards ao mesmo tempo). Este card só mostra o checklist se ELE
    // for a próxima limpeza do imóvel; a eleição é recalculada a cada
    // carregamento (ver nextCleaningKeyByProperty), então uma reserva nova
    // com limpeza mais próxima puxa a lista pra ela sozinha.
    const thisKey = row.reservationId ?? row.logId;
    const nextKey = cleaningTasks.nextCleaningKeyByProperty.get(row.propertyId);
    if (!thisKey || !nextKey || thisKey !== nextKey) return [];

    // Uma pendência concluída não deve seguir ocupando espaço nas limpezas
    // seguintes, mas também não pode sumir no instante do clique — senão
    // quem marcou por engano fica sem como desmarcar. Regra: em aberto
    // sempre aparece; concluída só continua aparecendo na limpeza em que foi
    // resolvida (marca desta ocorrência) ou nas primeiras 24h após a
    // conclusão.
    const DAY_MS = 86_400_000;
    const stillVisibleWhenDone = (t: TaskRow) =>
      completedHere.has(t.id) || (!!t.completedAt && Date.now() - new Date(t.completedAt).getTime() < DAY_MS);

    return cleaningTasks.tasks
      .filter((t) => t.showInCleaning && t.status !== "canceled")
      .filter((t) => t.propertyId === row.propertyId)
      .map((t) => ({ task: t, done: t.logId || t.reservationId ? t.status === "done" : completedHere.has(t.id) }))
      .filter((it) => !it.done || stillVisibleWhenDone(it.task));
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
  // Horário mínimo/máximo na ordem CERTA (min, max), independente de qual
  // campo (`standardTime`/`standardTimeMax`) guarda qual valor pro tipo —
  // ver comentário acima sobre a inversão proposital no checkout. Usado
  // tanto pra detectar divergência quanto pra travar de verdade o seletor de
  // horário logo abaixo (pedido explícito, 04/09/2026: "checkin só pode ser
  // preenchido o horário a partir do horário configurado... checkout pode
  // selecionar até a data/horário limite configurado").
  //
  // Esse piso/teto só faz sentido quando a previsão cai no MESMO dia da
  // reserva confirmada — ele existe pra impedir um horário "impossível"
  // dentro da janela padrão daquele dia. Quando a previsão muda o DIA (só
  // acontece pra chegada depois ou saída antes da data confirmada — o
  // servidor já impede o contrário), o dia deixa de ser o de virada do
  // imóvel e a janela do dia original não se aplica mais: qualquer horário
  // vale. Pedido explícito, 05/09/2026 ("se a reserva é dia 4 a partir das
  // 15h, o hóspede obviamente pode entrar às 11h do dia seguinte").
  const confirmedDateForKind = kind === "checkout" ? row.guestCheckout : row.guestCheckin;
  const predictedDayShifted =
    !!row.arrivalDateOverride && !!confirmedDateForKind && row.arrivalDateOverride !== confirmedDateForKind;
  const effMinTime = predictedDayShifted ? null : kind === "checkout" ? row.standardTimeMax : row.standardTime;
  const effMaxTime = predictedDayShifted ? null : kind === "checkout" ? row.standardTime : row.standardTimeMax;
  const divergent = !!guestTime && !!effMinTime && !isTimeWithin(guestTime, effMinTime, effMaxTime);
  const done = row.status === "done";
  const visualDone = done && mode !== "cleaning" && mode !== "stay";
  // Pedido explícito: a coluna de Limpeza agora espelha TODOS os checkouts
  // do período, não só os já liberados — os que ainda aguardam o check-out
  // do hóspede aparecem aqui também, mas bloqueados (mesmo racional dos
  // outros bloqueios do Kanban: nunca competem com quem já está liberado).
  const awaitingCheckout = mode === "cleaning" && !done;
  const isPendingFill = row.pendingFill;
  // As travas de data da previsão saíram daqui: agora são calculadas POR
  // LADO em `buildPredictionSide` (a chegada trava até um dia antes da
  // saída confirmada; a saída trava na data de saída confirmada). Mantê-las
  // aqui significaria calcular só as do lado deste card, e o tooltip edita
  // os dois.
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
  // A regra vive em card-colors.ts — é o mesmo padrão que os outros cards do
  // sistema passaram a usar (pedido explícito, 08/09/2026).
  const periodoColorClass = periodColorClass({ overdue: isOverdue && !visualDone, kind, done });
  // Trava real do botão "Check-in realizado!": usa a data CONFIRMADA da
  // reserva (`row.guestCheckin`), nunca a prevista (`row.date`, que já pode
  // estar sobrescrita pela previsão de chegada). Uma previsão pra um dia
  // depois da reserva é só uma expectativa registrada pelo anfitrião — ela
  // move o card de dia no dashboard, mas nunca pode impedir marcar o
  // check-in real quando ele de fato acontece (bug real corrigido,
  // 05/09/2026: previsão pra amanhã travava o botão como se a reserva toda
  // fosse amanhã). O indicador visual "data futura" (borda âmbar) e a
  // confirmação de checkout antecipado continuam usando `row.date`
  // normalmente — só esta trava de ação muda.
  const confirmedCheckinFuture = kind === "checkin" && !!row.guestCheckin && row.guestCheckin > todayISO;
  const blockReason = kind === "checkin" && !done && !confirmedCheckinFuture ? (cleaningBlocked ?? null) : null;
  const cleaningBlock = blockReason !== null;
  const blockCheck = (kind === "checkin" && !done && confirmedCheckinFuture) || cleaningBlock;

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
  // Um card "aguardando check-out" (mirror do checkout ainda não confirmado)
  // não tem o que desfazer aqui — ele nem chegou a virar limpeza de verdade.
  /**
   * Lista + Concluídos/Não Compareceu = card mínimo (pedido explícito,
   * 08/09/2026): "não deve ser apresentada qualquer info que não seja o nome
   * do proprietário, título do anúncio e botões".
   *
   * São as duas listas de ARQUIVO do quadro. Ali ninguém está operando nada:
   * está procurando um card específico para desfazer ou conferir. Período,
   * previsão, nota e alertas de iCal só alongam a linha e atrasam a busca —
   * o histórico completo continua a um clique (ver o popup de histórico).
   *
   * A etiqueta ALERTA é a exceção deliberada, por pedido explícito no mesmo
   * dia: ela aparece em todo e qualquer card, inclusive aqui.
   */
  const listBare = compact && (mode === "done" || mode === "no_show");

  /**
   * A ETAPA que a barra lateral pinta. Atraso sobrepõe a fase: uma data que já
   * passou sem a ação feita é o único estado que precisa gritar mais alto que
   * "em que ponto da esteira eu estou".
   */
  const stage: CardStage =
    mode === "done"
      ? "done"
      : mode === "no_show"
        ? "no_show"
        : isOverdue && !visualDone
          ? "late"
          : mode === "cleaning"
            ? "cleaning"
            : mode === "stay"
              ? "stay"
              : mode === "checkout"
                ? "checkout"
                : "checkin";

  /**
   * A PREVISÃO que este card mostra e edita — a do que vem A SEGUIR, não a da
   * lista de origem (pedido explícito, 08/09/2026).
   *
   * A diferença aparece em "Em Estadia": o card vem da lista de CHEGADAS, mas
   * a chegada já aconteceu. Editar ali a previsão de check-in de quem já fez
   * check-in não serve para nada — e o caso mais comum da operação é
   * exatamente o oposto: o hóspede está dentro do imóvel e avisa a que horas
   * vai sair. Por isso Em Estadia, Checkouts e Fila de Limpeza mostram a
   * previsão de SAÍDA, e só Chegadas mostra a de chegada.
   *
   * Concluído e Não Compareceu não têm previsão a exibir: não há próxima ação
   * para prever.
   */
  const showPrediction = !listBare && mode !== "done" && mode !== "no_show";
  const predictionPrimary = prediction?.primary ?? null;
  const predictionSecondary = prediction?.secondary ?? null;
  const predictionTime = predictionPrimary?.timeValue ?? null;
  const predictionDay = predictionDayLabel(
    predictionPrimary?.dateValue ||
      (predictionPrimary?.kind === "checkout" ? row.guestCheckout : row.guestCheckin) ||
      row.date,
    todayISO,
  );
  const allowedPhrase = predictionPrimary
    ? allowedWindowPhrase(predictionPrimary.kind, predictionPrimary.standardTime, predictionPrimary.standardTimeMax)
    : null;
  /**
   * HISTÓRICO DA RESERVA (pedido explícito, 08/09/2026).
   *
   * Na visão Lista, o clique no próprio card abre a jornada completa — é o
   * gesto natural quando o card mostra pouca coisa. No modo Completo o card
   * está cheio de controles e um clique global roubaria o clique de todos
   * eles, então ali o caminho é o item do menu "⋮". Os dois abrem exatamente
   * a mesma tela.
   *
   * Só identificador real: a chave sintética "ical:<id>" não é um uuid de
   * log — nesses cards a reserva é quem identifica a estadia.
   */
  const [journeyOpen, setJourneyOpen] = useState(false);
  const journeyLogId = /^[0-9a-f-]{36}$/i.test(row.logId) ? row.logId : null;
  const journeyReservationId = row.reservationId ?? (row.logId.startsWith("ical:") ? row.logId.slice(5) : null);
  const canOpenJourney = !!journeyLogId || !!journeyReservationId;
  const canRevert = !!onRevert && mode !== "checkin" && !awaitingCheckout;
  const showRevertButton = canRevert && !compact;
  const showRevertMenuItem = canRevert && compact;
  const revertConfirmLabel =
    mode === "stay" || mode === "checkout"
      ? "Desfazer o check-in e voltar este card para a lista de Check-ins?"
      : mode === "cleaning"
        ? "Desfazer o check-out e voltar este card para a lista de Checkouts?"
        : mode === "no_show"
          ? 'Desfazer o "Não Compareceu" e voltar este card para a lista de Check-ins?'
          : "Reabrir esta estadia e voltar o card para a lista Em Limpeza?";
  // Pedido explícito (07/09/2026): rótulo único e curto, sem o detalhe da
  // lista de destino entre parênteses.
  const revertTitle = "Retornar ao status anterior";
  const handleRevertClick = () => {
    if (window.confirm(revertConfirmLabel)) onRevert?.(row);
  };

  // "Não Compareceu" — só faz sentido num card de Check-ins ainda pendente
  // (uma vez que o check-in de verdade acontece, ou o card já está noutra
  // etapa da esteira, a opção não se aplica mais).
  const showNoShowMenuItem = mode === "checkin" && !done && !!onNoShow;
  const handleNoShowClick = () => onNoShow?.(row);

  // "Limpeza não será realizada" — conclui a estadia direto, sem contabilizar
  // o valor da limpeza. Não faz sentido num card ainda aguardando check-out.
  const showSkipCleaningMenuItem = !!onSkipCleaning && !awaitingCheckout;

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
      /* Visão Lista: o card inteiro abre o histórico da reserva (pedido
         explícito).
         O guarda abaixo é o que torna isso seguro. O card carrega botões que
         NÃO param a propagação (concluir, mapa, clipe de registros, menu
         "⋮"): sem ele, concluir uma limpeza abriria o histórico junto. Em
         vez de sair espalhando `stopPropagation` por cada controle — que
         alguém esqueceria no próximo botão adicionado —, o contêiner ignora
         qualquer clique que tenha nascido dentro de algo interativo. */
      /* O clique no card abria o Histórico da reserva. DESATIVADO a pedido
         (08/09/2026) enquanto o histórico é redesenhado — o caminho continua
         existindo pelo item "Histórico da reserva" no menu "⋮", então nada se
         perdeu; só o gesto acidental saiu do caminho. Para reativar, basta
         devolver o onClick abaixo (o guarda de clique em elemento interativo
         está preservado no comentário, era a parte difícil).

         onClick={(e) => {
           const el = e.target as HTMLElement | null;
           const interactive = el?.closest("button, a, input, select, textarea, label, [role='button']");
           if (interactive && interactive !== e.currentTarget) return;
           setJourneyOpen(true);
         }} */
      /* A curva de 0.3rem é a do Design System — o card era o único bloco
         quadrado do sistema. O acento lateral saiu daqui e virou a barra de
         ETAPA: antes só existia em "atrasado" e "data futura", agora vale
         para todas as fases. */
      /* SEM `overflow-hidden` (corrigido 08/09/2026): ele cortava exatamente a
         metade de cima da etiqueta ALERTA, que monta sobre a borda superior do
         card de propósito. A barra de etapa não precisa dele — ela já tem o
         próprio `rounded-l`. E `isolate` cria o contexto de empilhamento do
         card, para a etiqueta ficar acima do card de cima sem depender da
         ordem em que os cards aparecem no DOM. */
      className="group relative isolate flex snap-start flex-col rounded-[0.3rem] bg-secondary/70 p-3 pl-3.5 gap-2 transition-colors hover:bg-secondary/90"
    >
      {journeyOpen && (
        <ReservationJourneyDialog
          open={journeyOpen}
          onOpenChange={setJourneyOpen}
          logId={journeyLogId}
          reservationId={journeyReservationId}
          /* As DUAS previsões vão editáveis para o histórico (pedido
             explícito, 08/09/2026). Este é o único lugar do sistema que é
             por RESERVA e não por coluna — então é onde chegada e saída
             convivem sem depender de o card estar na lista certa. */
          predictionEditor={
            prediction ? (
              <div className="ds-surface divide-y divide-border/60 border border-border/60">
                {[prediction.primary, prediction.secondary]
                  .filter((side): side is PredictionSide => !!side)
                  .map((side) => (
                    <PredictedEditor
                      key={side.kind}
                      disabled={busy}
                      primary={side}
                      /* Aqui NÃO existe lado recolhido: o histórico é por
                         reserva, então os dois já aparecem, cada um com o
                         seu próprio editor. É a diferença combinada com o
                         card, onde um vem aberto e o outro a um clique. */
                      trigger={
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary/40"
                        >
                          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold">
                            <span
                              className={`size-1.5 shrink-0 rounded-full ${side.kind === "checkout" ? "bg-orange-400" : "bg-sky-400"}`}
                            />
                            {side.label}
                          </span>
                          <span
                            className={`text-[11.5px] tabular-nums ${
                              side.dateValue || side.timeValue
                                ? "font-semibold text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                            }`}
                          >
                            {side.dateValue || side.timeValue
                              ? [side.dateValue ? fmtDateBR(side.dateValue) : null, side.timeValue]
                                  .filter(Boolean)
                                  .join(" · ")
                              : "não informada"}
                          </span>
                        </button>
                      }
                    />
                  ))}
              </div>
            ) : null
          }
        />
      )}
      {/* Etiqueta ALERTA — badge sobre a borda superior, CENTRALIZADO, sem
          borda e com o mesmo canto do card (pedido explícito, 08/09/2026).
          Sem condição nenhuma de contexto: "precisa aparecer EM TODO E
          QUALQUER CARD, independentemente do local, tooltip, etc". O próprio
          `EngagementFlags` devolve `null` quando não há o que alertar, então
          o badge continua só aparecendo quando existe alerta — o que mudou é
          que ele não é mais escondido pela coluna nem pela vista. */}
      <div className="absolute -top-2.5 left-1/2 z-30 -translate-x-1/2">
        <EngagementFlags
          openedGuide={row.openedGuide}
          readInstructions={row.readInstructions}
          hasPasswords={row.hasPasswords}
          viewedPasswords={row.viewedPasswords}
        />
      </div>

      {/* A barra de ETAPA: 3px na borda esquerda, sempre no mesmo lugar. É a
          única informação do card que se lê sem ler — percorrendo uma coluna
          inteira dá para ver em que fase cada reserva está sem parar em
          nenhuma. Substitui as antigas bordas de "atrasado"/"data futura",
          que só existiam em dois casos e deixavam o resto sem sinal. */}
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] rounded-l-[0.3rem] ${stageBarClass(stage)}`} />

      <div className="flex items-start gap-3">
        {/* ds-card-lines: o espaçamento padrão entre linhas de card (styles.css). */}
        <div className="min-w-0 flex-1 ds-card-lines">
          <OwnerLine
            name={row.ownerName}
            phone={row.ownerPhone}
            country={row.ownerPhoneCountry}
            phonePosition="adjacent"
          />
          {/* O IMÓVEL é o título do card. O proprietário fica acima, menor e
              no rosa da marca: identifica sem disputar a leitura. */}
          <div className="ds-card-title truncate" title={row.propertyName ?? undefined}>
            {row.propertyName ?? "Sem nome"}
          </div>

          {!listBare && !compact && (
            <>
              {/* Hóspede e código na MESMA linha, separados por ponto. Antes
                  cada um ocupava uma linha própria e o card virava uma pilha
                  de sete linhas com seis cores brigando entre si. */}
              <div className="flex flex-wrap items-center gap-x-1.5 text-[11.5px]">
                {isPendingFill ? (
                  <span className={`inline-flex items-center gap-1 ${CARD_PENDING_GUEST}`}>
                    <UserPlus className="size-3 shrink-0" />
                    Hóspede pendente
                  </span>
                ) : row.guestName && row.guestName !== row.reservationCode ? (
                  <span className={`inline-flex min-w-0 items-center gap-1.5 ${CARD_MUTED}`}>
                    {/* Pedido explícito: nome do hóspede SEMPRE em maiúsculo. */}
                    <span className="min-w-0 truncate uppercase">{row.guestName}</span>
                    <PhoneLink phone={row.guestPhone} country={row.guestPhoneCountry} />
                    <ExtraGuests guests={row.additionalGuests ?? []} />
                  </span>
                ) : null}
                {row.reservationCode && (
                  <>
                    {(isPendingFill || (row.guestName && row.guestName !== row.reservationCode)) && (
                      <span className="text-muted-foreground/60">·</span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => copyReservationCode(e, row.reservationCode as string)}
                      title="Copiar código da reserva"
                      className={`min-w-0 truncate transition-colors hover:text-foreground ${CARD_MUTED}`}
                    >
                      {row.reservationCode}
                    </button>
                  </>
                )}
              </div>

              {/* O período, na cor do ESTADO — é ela que substituiu as antigas
                  etiquetas "Atrasado"/"Data futura". */}
              <div className={`flex flex-wrap items-center gap-1.5 text-[11.5px] tabular-nums ${periodoColorClass}`}>
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
        </div>

        {/* A COLUNA DA PREVISÃO — rótulo, horário, dia. Largura fixa de 78px
            para que os horários fiquem alinhados entre todos os cards: numa
            coluna com quinze reservas eles formam uma coluna própria, que se
            lê de cima a baixo sem parar em cada card.
            Ela inteira é o botão que abre o editor. */}
        {showPrediction && predictionPrimary && (
          <PredictedEditor
            disabled={busy}
            primary={predictionPrimary}
            secondary={predictionSecondary ?? undefined}
            trigger={
              <button
                type="button"
                title="Clique para ajustar a previsão"
                className="w-[78px] shrink-0 rounded-[0.3rem] px-0.5 py-0.5 text-right transition-colors hover:bg-foreground/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed"
              >
                <span className="block text-[8.5px] font-extrabold uppercase leading-tight tracking-[0.12em] text-muted-foreground">
                  Previsão
                </span>
                {predictionTime ? (
                  <span className="block font-display text-[16px] font-bold leading-tight tabular-nums text-amber-500 dark:text-amber-400">
                    {predictionTime}
                  </span>
                ) : (
                  /* MESMA tipografia do rótulo "Previsão" logo acima (pedido
                     explícito): sem previsão, as duas linhas formam um bloco
                     só — "PREVISÃO / NÃO INFORMADA" — em vez de um rótulo
                     miúdo seguido de um texto de outro tamanho e outra caixa. */
                  <span className="block text-[8.5px] font-extrabold uppercase leading-[1.35] tracking-[0.12em] text-muted-foreground/70">
                    não informada
                  </span>
                )}
                {predictionTime && predictionDay.label && (
                  <span
                    className={`block text-[9px] font-bold uppercase leading-tight tracking-[0.1em] ${
                      predictionDay.tone === "late"
                        ? "text-red-500 dark:text-red-400"
                        : predictionDay.tone === "accent"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    {predictionDay.label}
                  </span>
                )}
              </button>
            }
          />
        )}
      </div>

      {/* A JANELA PERMITIDA do imóvel, nomeada (pedido explícito): antes o
          horário padrão aparecia sem rótulo nenhum e ninguém sabia o que
          aquele segundo horário significava.
          Fica em linha própria, de largura inteira, e não dentro da coluna da
          direita: "entre 15:00 e 23:00" precisa de ~130px, e ali roubaria do
          nome do imóvel justamente o espaço que o faz caber. */}
      {showPrediction && allowedPhrase && (
        <div className="flex items-center gap-1.5 border-t border-border/40 pt-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
          <Clock3 className="size-2.5 shrink-0 opacity-70" />
          Permitido <span className="font-semibold text-foreground/70">{allowedPhrase}</span>
        </div>
      )}

      {/* Alertas de conferência com o Airbnb (iCal) — divergência de datas,
          reserva não encontrada e horário fora da janela padrão, com correção
          em um clique. Some no modo "Lista" (pedido explícito). */}
      {!compact &&
        mode !== "cleaning" &&
        !isPendingFill &&
        (() => {
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

      {!listBare && row.note && !noteOpen && (
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

      {!listBare && noteOpen && (
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
      {!listBare && cleaningChecklist.length > 0 && (
        <div className="rounded-lg border border-sky-400/25 bg-sky-400/[0.06] px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-sky-500 dark:text-sky-400">
            <span>Checklist desta limpeza</span>
            <span className="tabular-nums opacity-80">
              {cleaningChecklist.filter((c) => c.done).length}/{cleaningChecklist.length}
            </span>
          </div>
          {cleaningChecklist.map(({ task, done: taskDone }) => (
            <label key={task.id} className="flex items-start gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
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
            className={`inline-flex flex-1 min-w-0 items-center justify-center gap-2 rounded-[0.3rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 font-semibold ${compact ? "h-7 px-2.5 text-[11px]" : "h-9 px-3 text-xs"}`}
          >
            <CheckCircle2 className={compact ? "size-3 shrink-0" : "size-4 shrink-0"} />
            <span className="truncate">Concluído</span>
          </span>
        ) : mode === "no_show" ? (
          <span
            title="Hóspede não compareceu"
            aria-label="Hóspede não compareceu"
            className={`inline-flex flex-1 min-w-0 items-center justify-center gap-2 rounded-[0.3rem] bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30 font-semibold ${compact ? "h-7 px-2.5 text-[11px]" : "h-9 px-3 text-xs"}`}
          >
            <UserX className={compact ? "size-3 shrink-0" : "size-4 shrink-0"} />
            <span className="truncate">{compact ? "Não veio" : "Não Compareceu"}</span>
          </span>
        ) : (
          <button
            onClick={() => {
              if (awaitingCheckout) {
                toast.warning(
                  "Hóspede ainda não fez check-out. A limpeza libera assim que o check-out for confirmado.",
                );
                return;
              }
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
                  `Check-in confirmado para ${fmtDateBR(row.guestCheckin)}. Só é possível marcar a partir do dia da chegada.`,
                );
                return;
              }
              runMark();
            }}
            disabled={busy || blockCheck || awaitingCheckout}
            aria-label={
              awaitingCheckout
                ? "Aguardando check-out do hóspede"
                : cleaningBlock
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
              awaitingCheckout
                ? "Check-out ainda não confirmado — a limpeza só pode ser marcada depois que o hóspede sair"
                : cleaningBlock
                  ? blockReason === "checkout"
                    ? "Check-out anterior pendente — limpeza precisa ser concluída antes de liberar o check-in"
                    : "Limpeza ainda em andamento — check-in bloqueado"
                  : blockCheck
                    ? `Só é possível marcar a partir de ${fmtDateBR(row.guestCheckin)}`
                    : mode === "cleaning"
                      ? "Concluir limpeza (finaliza a estadia)"
                      : mode === "stay"
                        ? "Confirmar check-out (envia o card para Em Limpeza)"
                        : done
                          ? "Reabrir (voltar para Pendente)"
                          : "Marcar como Concluído"
            }
            className={`flex-1 min-w-0 self-center box-border leading-none inline-flex items-center justify-center gap-2 font-semibold tracking-tight rounded-[0.3rem] transition-all active:scale-[0.99] ${
              compact ? "h-7 max-h-7 min-h-7 px-2.5 text-[11px]" : "h-9 max-h-9 min-h-9 px-3 text-[12.5px]"
            } ${
              awaitingCheckout
                ? "bg-amber-900/20 text-amber-800 dark:text-amber-600 border border-amber-800/40 cursor-not-allowed"
                : cleaningBlock
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
            {/* O botão SEMPRE diz o que faz, inclusive na Lista (pedido
                explícito, 08/09/2026). Antes ali ficava só um ✓ ocupando
                60% da largura do card: o maior objeto da tela era também o
                que menos informava. Na Lista o rótulo é a versão curta —
                "Check-in" em vez de "Check-in realizado!" — para caber sem
                empurrar os três ícones ao lado. */}
            <span className="truncate">
              {awaitingCheckout
                ? compact
                  ? "Aguardando"
                  : "Aguardando check-out"
                : mode === "cleaning"
                  ? compact
                    ? "Limpeza"
                    : "Concluir limpeza!"
                  : mode === "checkout" || mode === "stay"
                    ? compact
                      ? "Check-out"
                      : "Check-out realizado!"
                    : done
                      ? "Reabrir"
                      : compact
                        ? "Check-in"
                        : "Check-in realizado!"}
            </span>
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
            aria-label="Retornar ao status anterior"
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
                  className={`grid place-items-center rounded-[0.3rem] bg-background/60 border border-border/50 hover:bg-primary/[0.08] ${compact ? "size-7" : "size-9"}`}
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

          {/* "Registros da reserva" (pedido explícito, 07/09/2026): mesmo
              ícone em QUALQUER status — abre a linha do tempo única da
              reserva (foto/vídeo/áudio/arquivo/nota), entre Maps e "⋮". */}
          <ReservationRecordsButton row={row} mode={mode} compact={compact} />

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
                className={`grid place-items-center rounded-[0.3rem] border ${compact ? "size-7" : "size-9"} ${
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
              {showNoShowMenuItem && (
                <DropdownMenuItem onClick={handleNoShowClick} disabled={busy}>
                  <UserX className="size-3.5 shrink-0" /> Não Compareceu
                </DropdownMenuItem>
              )}
              {showSkipCleaningMenuItem && (
                <DropdownMenuItem onClick={() => onSkipCleaning?.(row)} disabled={busy}>
                  <Ban className="size-3.5 shrink-0" /> Limpeza não será realizada
                </DropdownMenuItem>
              )}
              {canOpenJourney && (
                <DropdownMenuItem onClick={() => setJourneyOpen(true)}>
                  <History className="size-3.5 shrink-0" /> Histórico da reserva
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
                  <DropdownMenuSubContent className="sg-elegant-scroll max-h-72 overflow-y-auto min-w-[10rem]">
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

/**
 * Calendário no MESMO padrão já usado em outros pontos do sistema (ex.:
 * "Prazo" do card de tarefa) — Popover + Calendar do design system, em vez
 * do seletor nativo do navegador (que além de destoar do tema, em alguns
 * ambientes simplesmente parava de abrir depois do primeiro valor
 * escolhido). Pedido explícito, 05/09/2026.
 *
 * A confirmação (`onChange`) só dispara quando o popover FECHA, nunca no
 * clique do dia em si — assim o card não "pula" de lista/ordenação no meio
 * da edição, dando tempo do usuário ajustar também o horário antes da
 * previsão ser efetivamente salva (mesmo pedido). Fechar sem escolher nada
 * não altera o valor.
 */
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
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const shown = pending ?? value;
  const blank = !shown || (!!blankWhen && shown === blankWhen);
  const selected = shown ? parseISODateLocal(shown) : undefined;
  const minDate = min ? parseISODateLocal(min) : undefined;
  const maxDate = max ? parseISODateLocal(max) : undefined;
  const disabledMatcher =
    minDate && maxDate
      ? [{ before: minDate }, { after: maxDate }]
      : minDate
        ? { before: minDate }
        : maxDate
          ? { after: maxDate }
          : undefined;

  function commitPending() {
    if (pending !== null && pending !== value) onChange(pending);
    setPending(null);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) commitPending();
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
          className={`relative inline-flex items-center cursor-pointer rounded hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:hover:text-inherit ${blank ? "text-muted-foreground" : ""}`}
          title="Clique para corrigir a data"
        >
          <span className={`tabular-nums ${valueClassName ?? ""}`}>
            {blank ? (placeholder ?? "—") : fmtDateBR(shown)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0" onClick={(e) => e.stopPropagation()}>
        <RangeCalendar
          mode="single"
          locale={ptBR}
          selected={selected}
          defaultMonth={selected ?? minDate}
          disabled={disabledMatcher}
          onSelect={(d) => {
            if (!d) return;
            setPending(dateToISOLocal(d));
          }}
          className="p-3"
        />
        <div className="flex items-center justify-end border-t border-border p-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
          >
            Concluir
          </button>
        </div>
      </PopoverContent>
    </Popover>
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
  min,
  max,
}: {
  value: string | null;
  disabled?: boolean;
  onChange: (v: string | null) => void;
  size?: "sm" | "xs";
  /** Restringe de verdade os horários selecionáveis (inclusive) ao horário
      configurado do imóvel — pedido explícito do cliente (04/09/2026): antes
      só existia um aviso visual (âmbar) depois de já ter escolhido um
      horário fora da janela; agora o horário nem aparece como opção. `null`/
      omitido = sem limite (imóvel sem esse horário configurado). */
  min?: string | null;
  max?: string | null;
}) {
  const slots = useMemo(() => {
    if (!min && !max) return TIME_SLOTS;
    const a = min ? timeToMinutes(min) : -Infinity;
    const b = max ? timeToMinutes(max) : Infinity;
    return TIME_SLOTS.filter((t) => {
      const v = timeToMinutes(t);
      return v >= a && v <= b;
    });
  }, [min, max]);
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
      <DropdownMenuContent align="end" className="sg-elegant-scroll max-h-64 overflow-y-auto min-w-[6rem] p-1">
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
        {slots.map((t) => (
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

function timeToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Data e horário previstos são dois campos SEPARADOS de novo (pedido
 * explícito, 05/09/2026: "quero que fiquem separados como antes, porém
 * ambos no layout padrão dos tooltips") — cada botão abre seu próprio
 * tooltip (só calendário / só horário, cada um com o mesmo visual dos
 * tooltips padrão do sistema), não mais um painel único com os dois juntos.
 *
 * Mas por baixo dos panos continua sendo UMA ÚNICA sessão de edição
 * (`open`/pendingDate/pendingTime compartilhados): os dois botões só trocam
 * QUAL conteúdo aparece dentro do mesmo Popover (ver `openField`), sem abrir
 * e fechar de verdade um popover por vez. Isso é o que preserva o ajuste
 * anterior (pedido explícito, mesma data): "não é mover depois de fechar o
 * calendário, é mover depois de fechar o TOOLTIP inteiro" — se cada campo
 * tivesse seu próprio Popover independente, fechar o de Data já confirmaria
 * e moveria o card antes do usuário conseguir abrir o de Horário, voltando
 * ao bug original. Nada é gravado (nem o card se move) enquanto QUALQUER um
 * dos dois estiver "aberto" — só quando o usuário clica fora dos dois
 * botões (ou aperta "Concluir"/Esc) é que a data e o horário pendentes são
 * confirmados juntos, numa única leva.
 *
 * O piso/teto do horário reage à data QUE ESTÁ SENDO escolhida (ainda não
 * confirmada) — mesma regra de "dia mudou → sem piso/teto" do card, só que
 * calculada aqui em cima do valor pendente, senão a lista de horários
 * ficaria com a janela do dia errado enquanto o usuário ainda decide.
 */
/**
 * O EDITOR DE PREVISÃO — data e horário, dos DOIS lados da estadia.
 *
 * Pedido explícito (08/09/2026): "o usuário precisa conseguir editar a data +
 * horário da previsão (tanto de checkin quanto de checkout)... e essas duas
 * informações não podem conflitar... porém, cada informação deve ser mostrada
 * no status correto".
 *
 * COMO AS DUAS CONVIVEM SEM CONFLITAR
 *
 * Elas nunca disputam o mesmo campo: `guest_arrival_status` guarda UMA LINHA
 * POR LADO da estadia (`kind` "checkin" e "checkout"), e cada linha tem o seu
 * próprio `arrival_date_override` e `arrival_time_override`. São registros
 * diferentes da mesma reserva. A leitura já é filtrada por lado — a lista de
 * chegadas não enxerga a linha de saída — então "cada uma aparece no status
 * certo" é consequência do modelo, não de uma regra de tela.
 *
 * POR QUE O TOOLTIP TEM OS DOIS, SE O CARD MOSTRA UM
 *
 * Porque quem opera costuma saber os dois de uma vez ("chego dia 8 às 20h e
 * saio dia 14 às 8h"), e o card onde ele está só oferece um. Sem o segundo
 * bloco, registrar a saída exigiria esperar o card mudar de coluna, ou abrir o
 * histórico — dois caminhos mais longos para o caso mais comum. Então: o lado
 * do card vem aberto, o outro fica numa linha recolhida a um clique. Quem só
 * sabe um lado nem percebe que o outro está ali.
 *
 * A MECÂNICA DE CADA BLOCO NÃO MUDOU (regra do projeto: não mexer na estrutura
 * dos tooltips). Continua sendo data + horário no MESMO popover, com o commit
 * acontecendo só quando o popover inteiro fecha — nunca no meio da escolha da
 * data, senão o card se move antes de a pessoa conseguir ajustar o horário
 * (bug real corrigido em 05/09/2026). O que existe agora são DOIS desses
 * blocos, não um bloco diferente.
 */
export type PredictionSide = {
  kind: "checkin" | "checkout";
  /** "Chegada" | "Saída" — o nome que a pessoa lê. */
  label: string;
  /** "" quando não há previsão. */
  dateValue: string;
  timeValue: string | null;
  /** Data confirmada da reserva neste lado — recalcula piso/teto ao vivo. */
  confirmedDate: string | null;
  dateMin?: string;
  dateMax?: string;
  standardTime: string | null;
  standardTimeMax: string | null;
  onCommit: (date: string | null, time: string | null) => void;
};

function PredictedEditor({
  trigger,
  primary,
  secondary,
  disabled,
}: {
  /** O que abre o editor — hoje, a coluna "PREVISÃO / 20:00 / hoje" do card. */
  trigger: React.ReactElement;
  /** O lado que este card representa: vem aberto. */
  primary: PredictionSide;
  /** O outro lado da mesma estadia: vem recolhido. */
  secondary?: PredictionSide;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Três telas dentro do MESMO popover: o resumo (os dois lados), o
  // calendário e a lista de horários. Trocar de tela nunca confirma nada.
  const [view, setView] = useState<"summary" | "date" | "time">("summary");
  const [editing, setEditing] = useState<"primary" | "secondary">("primary");
  const [expanded, setExpanded] = useState(false);
  // undefined = não tocado nesta sessão (mostra o valor gravado).
  const [pending, setPending] = useState<Record<"primary" | "secondary", { date?: string; time?: string | null }>>({
    primary: {},
    secondary: {},
  });

  const sideOf = (slot: "primary" | "secondary") => (slot === "primary" ? primary : secondary);
  const shownDate = (slot: "primary" | "secondary") => {
    const p = pending[slot].date;
    return p !== undefined ? p : (sideOf(slot)?.dateValue ?? "");
  };
  const shownTime = (slot: "primary" | "secondary") => {
    const p = pending[slot].time;
    return p !== undefined ? p : (sideOf(slot)?.timeValue ?? null);
  };

  function reset() {
    setPending({ primary: {}, secondary: {} });
    setView("summary");
    setEditing("primary");
    setExpanded(false);
  }

  /** Grava os dois lados de uma vez — só o que de fato mudou. */
  function closeAndCommit() {
    (["primary", "secondary"] as const).forEach((slot) => {
      const side = sideOf(slot);
      if (!side) return;
      const finalDate = pending[slot].date !== undefined ? pending[slot].date || null : side.dateValue || null;
      const finalTime = pending[slot].time !== undefined ? (pending[slot].time ?? null) : (side.timeValue ?? null);
      const dateChanged = finalDate !== (side.dateValue || null);
      const timeChanged = finalTime !== (side.timeValue ?? null);
      if (dateChanged || timeChanged) side.onCommit(finalDate, finalTime);
    });
    reset();
    setOpen(false);
  }

  function openPicker(slot: "primary" | "secondary", field: "date" | "time") {
    if (disabled) return;
    setEditing(slot);
    setView(field);
  }

  const active = sideOf(editing);
  const activeDate = shownDate(editing);
  const activeTime = shownTime(editing);

  const selected = activeDate ? parseISODateLocal(activeDate) : undefined;
  const minDate = active?.dateMin ? parseISODateLocal(active.dateMin) : undefined;
  const maxDate = active?.dateMax ? parseISODateLocal(active.dateMax) : undefined;
  const disabledMatcher =
    minDate && maxDate
      ? [{ before: minDate }, { after: maxDate }]
      : minDate
        ? { before: minDate }
        : maxDate
          ? { after: maxDate }
          : undefined;

  // A janela do imóvel só vale enquanto a previsão cai no mesmo dia da reserva
  // confirmada: mudou o dia, qualquer horário passa a ser possível.
  const dayShifted = !!activeDate && !!active?.confirmedDate && activeDate !== active.confirmedDate;
  const liveMinTime = dayShifted
    ? null
    : active?.kind === "checkout"
      ? (active?.standardTimeMax ?? null)
      : (active?.standardTime ?? null);
  const liveMaxTime = dayShifted
    ? null
    : active?.kind === "checkout"
      ? (active?.standardTime ?? null)
      : (active?.standardTimeMax ?? null);
  const timeSlots = useMemo(() => {
    if (!liveMinTime && !liveMaxTime) return TIME_SLOTS;
    const a = liveMinTime ? timeToMinutes(liveMinTime) : -Infinity;
    const b = liveMaxTime ? timeToMinutes(liveMaxTime) : Infinity;
    return TIME_SLOTS.filter((t) => {
      const v = timeToMinutes(t);
      return v >= a && v <= b;
    });
  }, [liveMinTime, liveMaxTime]);

  /** Um lado no resumo: nome, valor atual e os dois campos. */
  function SideBlock({ slot }: { slot: "primary" | "secondary" }) {
    const side = sideOf(slot);
    if (!side) return null;
    const d = shownDate(slot);
    const t = shownTime(slot);
    const janela = allowedWindowPhrase(side.kind, side.standardTime, side.standardTimeMax);
    const dot = side.kind === "checkout" ? "bg-orange-400" : "bg-sky-400";
    return (
      <div className="flex flex-col gap-1.5">
        {/* Só o nome do lado. A linha que repetia aqui em cima a data e a hora
            que já aparecem nos campos logo abaixo saiu (pedido explícito,
            08/09/2026: "muito poluído/confuso") — era a mesma informação
            escrita duas vezes, a 6px de distância. */}
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold">
          <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
          {side.label}
        </span>
        <div className="grid grid-cols-[1fr_84px] gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              openPicker(slot, "date");
            }}
            className="ds-surface flex h-8 items-center gap-1.5 border border-border bg-background px-2.5 text-left text-xs tabular-nums hover:border-primary/50 disabled:opacity-50"
          >
            <CalendarRange className="size-3 shrink-0 text-muted-foreground" />
            <span className={d ? "" : "text-muted-foreground"}>{d ? fmtDateBR(d) : "Data"}</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              openPicker(slot, "time");
            }}
            className="ds-surface flex h-8 items-center gap-1.5 border border-border bg-background px-2.5 text-left text-xs tabular-nums hover:border-primary/50 disabled:opacity-50"
          >
            <Clock3 className="size-3 shrink-0 text-muted-foreground" />
            <span className={t ? "" : "text-muted-foreground"}>{t ?? "Horário"}</span>
          </button>
        </div>
        {janela && (
          <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground/80">
            Permitido <span className="text-foreground/60">{janela}</span>
          </span>
        )}
      </div>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          reset();
          setOpen(true);
          return;
        }
        closeAndCommit();
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>

      {view === "summary" ? (
        <PopoverContent align="end" className="w-[252px] p-3" onClick={(e) => e.stopPropagation()}>
          <p className="mb-2.5 text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
            Previsão
          </p>
          <SideBlock slot="primary" />
          {secondary && (
            <>
              <div className="my-2.5 h-px bg-border/70" />
              {expanded ? (
                <SideBlock slot="secondary" />
              ) : (
                /* Recolhido: uma linha só. Quem não precisa do outro lado não
                   ganha um segundo formulário na frente. */
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(true);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-[0.3rem] py-0.5 text-left transition-colors hover:bg-secondary/40"
                >
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${secondary.kind === "checkout" ? "bg-orange-400" : "bg-sky-400"}`}
                    />
                    {secondary.label}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    {shownDate("secondary") || shownTime("secondary")
                      ? [shownDate("secondary") ? fmtDateBR(shownDate("secondary")) : null, shownTime("secondary")]
                          .filter(Boolean)
                          .join(" · ")
                      : "não informada"}
                    <ChevronRight className="size-3" />
                  </span>
                </button>
              )}
            </>
          )}
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPending((prev) => ({ ...prev, [editing]: { date: "", time: null } }));
              }}
              className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Limpar previsão
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeAndCommit();
              }}
              className="ds-surface h-7 bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-3.5 text-[11.5px] font-bold text-white"
            >
              Concluir
            </button>
          </div>
        </PopoverContent>
      ) : view === "date" ? (
        <PopoverContent align="end" className="w-auto p-0" onClick={(e) => e.stopPropagation()}>
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground">
            Data prevista · {active?.label}
          </div>
          <RangeCalendar
            mode="single"
            locale={ptBR}
            selected={selected}
            defaultMonth={selected ?? minDate}
            disabled={disabledMatcher}
            onSelect={(d) => {
              if (!d) return;
              setPending((prev) => ({ ...prev, [editing]: { ...prev[editing], date: dateToISOLocal(d) } }));
            }}
            className="p-3"
          />
          {/* Este botão NÃO confirma nada: só volta ao resumo, dentro da MESMA
              sessão aberta. Confirmar acontece apenas ao fechar o popover. */}
          <div className="flex items-center justify-end border-t border-border p-2">
            <button
              type="button"
              onClick={() => setView("summary")}
              className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
            >
              Voltar
            </button>
          </div>
        </PopoverContent>
      ) : (
        <PopoverContent align="end" className="w-auto p-0" onClick={(e) => e.stopPropagation()}>
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground">
            Horário previsto · {active?.label}
          </div>
          <div className="p-2">
            <div className="flex max-h-56 w-56 flex-wrap gap-1 overflow-y-auto px-1">
              {timeSlots.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPending((prev) => ({ ...prev, [editing]: { ...prev[editing], time: t } }))}
                  className={`rounded px-2 py-1 text-[11px] tabular-nums ${
                    activeTime === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground hover:bg-secondary/70"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-border p-2">
            <button
              type="button"
              onClick={() => setPending((prev) => ({ ...prev, [editing]: { ...prev[editing], time: null } }))}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Limpar horário
            </button>
            <button
              type="button"
              onClick={() => setView("summary")}
              className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
            >
              Voltar
            </button>
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}

/**
 * O DIA da previsão, em palavra quando dá — "hoje", "amanhã", "ontem" — e na
 * data cheia quando não dá.
 *
 * Existe porque um horário sozinho é ambíguo: "20:00" de que dia? A previsão
 * tem data própria (`arrival_date_override`), separada do horário, e ela pode
 * cair num dia diferente do da reserva — o hóspede avisa que só chega amanhã,
 * a saída é antecipada. Sem esta linha, o card mostraria um horário sem dizer
 * de quando ele é.
 *
 * Pedido explícito (08/09/2026): quando é HOJE — o caso da maioria dos cards —
 * a palavra fica apagada, porque uma informação que se repete em quinze cards
 * seguidos deixa de ser lida. Qualquer outro dia ganha destaque, e um dia que
 * já passou fica vermelho: é exceção, e é o que precisa ser visto.
 */
function predictionDayLabel(
  dateISO: string | null,
  todayISO: string,
): { label: string; tone: "muted" | "accent" | "late" } {
  if (!dateISO) return { label: "", tone: "muted" };
  const day = dateISO.slice(0, 10);
  if (day === todayISO) return { label: "hoje", tone: "muted" };
  if (day === addDaysISO(todayISO, 1)) return { label: "amanhã", tone: "accent" };
  if (day === addDaysISO(todayISO, -1)) return { label: "ontem", tone: "late" };
  return { label: fmtDateBR(day), tone: day < todayISO ? "late" : "accent" };
}

/**
 * A JANELA PERMITIDA do imóvel, em frase.
 *
 * Pedido explícito (08/09/2026): "PERMITIDO: ENTRE 15H00 E 23H00". Antes o
 * horário padrão aparecia sem nome nenhum, e quem não conhecia a tela não
 * sabia o que aquele segundo horário significava.
 *
 * A ordem dos campos é invertida no checkout de propósito — é assim que o
 * cadastro do imóvel guarda: `standardTime` é o horário LIMITE de saída e
 * `standardTimeMax` o de abertura.
 */
function allowedWindowPhrase(
  kind: "checkin" | "checkout",
  standardTime: string | null,
  standardTimeMax: string | null,
): string | null {
  const min = kind === "checkout" ? standardTimeMax : standardTime;
  const max = kind === "checkout" ? standardTime : standardTimeMax;
  if (min && max) return `entre ${min} e ${max}`;
  if (min) return `a partir das ${min}`;
  if (max) return `até as ${max}`;
  return null;
}

function isTimeWithin(t: string, min: string, max: string | null): boolean {
  const v = timeToMinutes(t);
  const a = timeToMinutes(min);
  const b = max ? timeToMinutes(max) : a + 60;
  return v >= a - 30 && v <= b + 30;
}
