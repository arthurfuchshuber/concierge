import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  ChevronDown,
  Check,
  FileText,
  Layers,
  Loader2,
  Mic,
  SlidersHorizontal,
  StickyNote,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAntiClipBar } from "@/hooks/useAntiClipBar";
import { useImpersonation } from "@/hooks/useImpersonation";
import { CARD_OWNER } from "@/components/dashboard/card-colors";
import { OperationShell } from "@/components/dashboard/OperationWorkspace";
import { RecordBlock } from "@/components/dashboard/ReservationRecords";
import {
  CATEGORIES,
  CATEGORY_BY_KEY,
  MODE_LABEL,
  fmtDayLabel,
} from "@/components/dashboard/record-categories";
import {
  deleteReservationRecord,
  listAccountRecords,
  type AccountRecord,
  type RecordCategory,
} from "@/lib/reservation-records.functions";

/**
 * ABA "REGISTROS" (mockup aprovado, 09/09/2026 — a tela "filtrado por dano,
 * agrupado por imóvel").
 *
 * O dado já era rico; o que faltava era a PORTA. Um registro só existia
 * dentro do clipe de uma reserva: para achar qualquer coisa era preciso já
 * saber em qual reserva ela estava, e nenhuma pergunta transversal era
 * possível ("todos os danos", "os registros do Studio 101", "o que ainda
 * não foi tratado").
 *
 * Duas decisões do cliente moldam a tela:
 *  1. SEM recorte de período — abre com o histórico inteiro. Quem quiser
 *     recortar usa o botão de filtro, o mesmo das outras páginas.
 *  2. A leitura estratégica ("quantos e de quê") mora na FILA DE CHIPS, com
 *     a contagem em cada categoria. É uma linha só: um segundo andar de
 *     controles foi justamente o que deixou as Pendências poluídas.
 *
 * O agrupamento por imóvel usa a MESMA etiqueta fina das Pendências — nome
 * em caixa alta, proprietário em rosa, fio até a contagem — porque ali ela
 * já provou que agrupa sem virar uma segunda linha por item.
 */

type GroupBy = "property" | "day";

const GROUP_OPTIONS: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: "property", label: "Por imóvel" },
  { value: "day", label: "Por data" },
];

/** Ícone do quadradinho da esquerda — diz o TIPO (foto/vídeo/áudio/nota). */
const KIND_ICON = {
  photo: Camera,
  video: Video,
  audio: Mic,
  file: FileText,
  note: StickyNote,
} as const;

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((t0.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return "hoje";
  if (diff === 1) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Uma linha nunca fica sem título: sem texto digitado, o nome do arquivo;
 * sem nome de arquivo, o rótulo da categoria. */
function recordTitle(r: AccountRecord): string {
  const typed = (r.body ?? "").trim();
  if (typed) return typed;
  if (r.fileName) return r.fileName;
  const meta = CATEGORY_BY_KEY.get(r.category);
  return meta ? meta.label : "Registro";
}

type Group = { key: string; label: string; sublabel: string | null; items: AccountRecord[] };

export function RecordsWorkspace() {
  const { impersonation } = useImpersonation();
  const activeOwnerId = impersonation?.userId ?? null;
  const qc = useQueryClient();

  const listFn = useServerFn(listAccountRecords);
  const deleteFn = useServerFn(deleteReservationRecord);

  const [category, setCategory] = useState<RecordCategory | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("property");
  const [openId, setOpenId] = useState<string | null>(null);

  const chipsRef = useAntiClipBar<HTMLDivElement>();

  const queryKey = [
    "account-records",
    activeOwnerId ?? "self",
    category ?? "all",
    onlyOpen,
  ] as const;
  const q = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { ownerId: activeOwnerId, category, onlyOpen } }),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Registro excluído.");
      void qc.invalidateQueries({ queryKey: ["account-records"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir."),
  });

  const records = useMemo(() => q.data?.records ?? [], [q.data]);
  const counts = q.data?.counts;
  const openCounts = q.data?.openCounts;

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const r of records) {
      const key = groupBy === "property" ? r.propertyId : r.createdAt.slice(0, 10);
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          label: groupBy === "property" ? r.propertyName : fmtDayLabel(r.createdAt),
          sublabel: groupBy === "property" ? r.ownerName : null,
          items: [],
        };
        map.set(key, g);
      }
      g.items.push(r);
    }
    // A ordem de `records` já vem do banco (mais recente primeiro); os
    // grupos herdam a ordem de aparição, então "Por data" sai em ordem
    // cronológica invertida sem nenhuma reordenação extra.
    return Array.from(map.values());
  }, [records, groupBy]);

  const subtitle = (() => {
    if (q.isLoading) return "Carregando…";
    const total = q.data?.total ?? 0;
    const open = q.data?.totalOpen ?? 0;
    if (total === 0) return "Nenhum registro por aqui ainda.";
    const base = `${total} ${total === 1 ? "registro" : "registros"}`;
    return open > 0 ? `${base} · ${open} em aberto` : base;
  })();

  const hasCustomFilters = category !== null || onlyOpen || groupBy !== "property";

  return (
    <>
      <OperationShell
        view="registros"
        subtitle={subtitle}
        actions={
          <RecordsFiltersButton
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            onlyOpen={onlyOpen}
            onOnlyOpenChange={setOnlyOpen}
            hasCustomFilters={hasCustomFilters}
            onClearAll={() => {
              setCategory(null);
              setOnlyOpen(false);
              setGroupBy("property");
            }}
          />
        }
      />

      {/* UMA linha de chips: a categoria E a leitura de quantos há em cada
          uma. Regra ANTI-CORTE — rola na horizontal, rótulos inteiros, a
          sobra vira espaçador invisível, sem degradê nas bordas. */}
      <div ref={chipsRef} className="ds-scroll-x -mx-1 gap-1.5 px-1 pb-3">
        <CategoryChip
          label="Todos"
          count={q.data?.total ?? 0}
          active={category === null}
          onClick={() => setCategory(null)}
        />
        {CATEGORIES.map((c) => (
          <CategoryChip
            key={c.key}
            label={c.short}
            dot={c.dot}
            count={counts?.[c.key] ?? 0}
            openCount={openCounts?.[c.key] ?? 0}
            active={category === c.key}
            onClick={() => setCategory(category === c.key ? null : c.key)}
          />
        ))}
      </div>

      {q.isLoading ? (
        <div className="grid place-items-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <p className="py-14 text-center text-sm text-muted-foreground">
          {onlyOpen
            ? "Nada em aberto por aqui."
            : category
              ? "Nenhum registro nesta categoria."
              : "Os registros feitos nos cards aparecem aqui."}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.key}>
              {/* Etiqueta fina — a mesma das Pendências. */}
              <div className="mb-1.5 flex items-center gap-2 overflow-hidden">
                <span
                  className="shrink-0 truncate text-[9.5px] font-extrabold uppercase tracking-[0.11em] text-foreground/80"
                  style={{ maxWidth: "58%" }}
                >
                  {g.label}
                </span>
                {g.sublabel && (
                  <span className={`shrink truncate text-[9.5px] ${CARD_OWNER}`}>{g.sublabel}</span>
                )}
                <span className="h-px flex-1 bg-border" />
                <span className="shrink-0 text-[9.5px] font-bold tabular-nums text-muted-foreground">
                  {g.items.length}
                </span>
              </div>

              <div className="space-y-1">
                {g.items.map((r) => (
                  <RecordRow
                    key={r.id}
                    record={r}
                    showProperty={groupBy === "day"}
                    expanded={openId === r.id}
                    onToggle={() => setOpenId((v) => (v === r.id ? null : r.id))}
                    onDelete={(id) => del.mutate(id)}
                  />
                ))}
              </div>
            </div>
          ))}

          {q.data?.truncated && (
            <p className="pt-1 text-center text-[11px] text-muted-foreground">
              Histórico longo — a lista mostra os mais recentes. Escolher uma categoria afina o que
              aparece.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function CategoryChip({
  label,
  count,
  openCount,
  dot,
  active,
  onClick,
}: {
  label: string;
  count: number;
  openCount?: number;
  dot?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-state={active ? "active" : "inactive"}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[0.3rem] px-2.5 text-[11px] font-bold leading-none transition-colors ${
        active
          ? "bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
          : "ds-3d bg-card text-foreground"
      }`}
    >
      {dot && <span className={`size-1.5 shrink-0 rounded-full ${active ? "bg-white/70" : dot}`} />}
      {label}
      <span className={`tabular-nums ${active ? "text-white/75" : "text-muted-foreground"}`}>
        {count}
      </span>
      {/* O aviso só existe quando existe: "0 em aberto" não vira pílula. */}
      {!!openCount && openCount > 0 && (
        <span
          className={`rounded-[0.2rem] px-1 py-0.5 text-[9px] font-extrabold tabular-nums ${
            active ? "bg-white/20 text-white" : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
          }`}
        >
          {openCount}
        </span>
      )}
    </button>
  );
}

/** Linha compacta: quadradinho do tipo, título, etapa · autor, data. */
function RecordRow({
  record,
  showProperty,
  expanded,
  onToggle,
  onDelete,
}: {
  record: AccountRecord;
  showProperty: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDelete: (id: string) => void;
}) {
  const meta = CATEGORY_BY_KEY.get(record.category);
  const Icon = KIND_ICON[record.kind] ?? StickyNote;
  const open = record.taskStatus === "pending";

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 rounded-[0.3rem] px-1 py-1.5 text-left transition-colors hover:bg-foreground/[0.04]"
      >
        <span
          className={`grid size-9 shrink-0 place-items-center overflow-hidden rounded-[0.3rem] border ${
            meta ? meta.tone : "border-border/60 bg-muted"
          }`}
        >
          {record.kind === "photo" && record.url ? (
            <img src={record.url} alt="" className="size-full object-cover" />
          ) : (
            <Icon className="size-4" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold leading-tight">
            {recordTitle(record)}
          </span>
          <span className="mt-0.5 block truncate text-[10px] leading-tight text-muted-foreground">
            {showProperty && <>{record.propertyName} · </>}
            {record.cardMode ? `${MODE_LABEL[record.cardMode]} · ` : ""}
            {record.createdByName ?? "Equipe"}
            {open && <span className="font-bold text-rose-500"> · em aberto</span>}
          </span>
        </span>

        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {fmtShortDate(record.createdAt)}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground/70 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Aberto, é o MESMO bloco da linha do tempo da reserva — mídia, texto,
          vínculo com a pendência e rodapé. Nenhuma segunda implementação de
          player/visualizador para manter em pé. */}
      {expanded && (
        <div className="mb-1 mt-1 pl-[46px]">
          <RecordBlock group={{ key: record.id, items: [record] }} onDelete={onDelete} />
        </div>
      )}
    </div>
  );
}

/** Mesmo gatilho compacto dos filtros das outras páginas: quadrado de 30px
 * com o ponto rosa quando há filtro ativo. */
function RecordsFiltersButton({
  groupBy,
  onGroupByChange,
  onlyOpen,
  onOnlyOpenChange,
  hasCustomFilters,
  onClearAll,
}: {
  groupBy: GroupBy;
  onGroupByChange: (v: GroupBy) => void;
  onlyOpen: boolean;
  onOnlyOpenChange: (v: boolean) => void;
  hasCustomFilters: boolean;
  onClearAll: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Filtros dos registros"
          className="relative grid size-[30px] shrink-0 place-items-center rounded-[0.3rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          <SlidersHorizontal className="size-3.5" />
          {hasCustomFilters && (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-[#E82DAE]" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Agrupar
        </DropdownMenuLabel>
        {GROUP_OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => onGroupByChange(o.value)}
            className="text-xs"
          >
            <Layers className="mr-2 size-3.5 opacity-60" />
            <Check
              className={`mr-2 size-3.5 ${o.value === groupBy ? "opacity-100" : "opacity-0"}`}
            />
            {o.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onOnlyOpenChange(!onlyOpen)} className="text-xs">
          <Check className={`mr-2 size-3.5 ${onlyOpen ? "opacity-100" : "opacity-0"}`} />
          Só os em aberto
        </DropdownMenuItem>
        {hasCustomFilters && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClearAll} className="text-xs text-muted-foreground">
              Limpar filtros
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
