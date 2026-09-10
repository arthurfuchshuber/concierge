import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  Camera,
  Check,
  FileText,
  LayoutGrid,
  Loader2,
  Mic,
  SlidersHorizontal,
  StickyNote,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useImpersonation } from "@/hooks/useImpersonation";
import { CARD_OWNER } from "@/components/dashboard/card-colors";
import { OperationShell, TaskChoiceMenu } from "@/components/dashboard/OperationWorkspace";
import { RecordBlock } from "@/components/dashboard/ReservationRecords";
import { CATEGORIES, CATEGORY_BY_KEY, fmtDayLabel } from "@/components/dashboard/record-categories";
import {
  deleteReservationRecord,
  listAccountRecords,
  type AccountRecord,
  type RecordCategory,
} from "@/lib/reservation-records.functions";

/**
 * ABA "REGISTROS" — mockup aprovado "filtrado por dano, agrupado por imóvel".
 *
 * O dado já era rico; o que faltava era a PORTA. Um registro só existia
 * dentro do clipe de uma reserva: para achar qualquer coisa era preciso já
 * saber em qual reserva ela estava, e nenhuma pergunta transversal era
 * possível ("todos os danos", "os registros do Studio 101").
 *
 * A tela tem TRÊS andares, exatamente como no mockup:
 *   1. Quatro/cinco CONTADORES por categoria — a leitura estratégica
 *      ("quantos e de quê") e, ao mesmo tempo, o filtro. Mesmo cartão dos
 *      KPIs da tela Operacional (bg-card + ds-3d + ds-eyebrow).
 *   2. Dois seletores compactos — agrupar e período — no mesmo componente
 *      (`TaskChoiceMenu`) já usado pelas Pendências.
 *   3. Um CARTÃO POR IMÓVEL: nome, proprietário em rosa, contagem à direita
 *      e a fileira de MINIATURAS. É a miniatura que faz esta tela valer —
 *      lista de texto é o que já existe dentro da reserva.
 *
 * Sem recorte de período por padrão (pedido explícito): abre com o histórico
 * inteiro.
 */

type GroupBy = "property" | "day";

const GROUP_OPTIONS: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: "property", label: "Por imóvel" },
  { value: "day", label: "Por data" },
];

type PeriodValue = "all" | "7" | "30" | "90";

const PERIOD_OPTIONS: ReadonlyArray<{ value: PeriodValue; label: string }> = [
  { value: "all", label: "Todo o período" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
];

/** Quantas miniaturas aparecem antes do "+N" — quatro, como no mockup. */
const THUMBS_PER_GROUP = 4;
/** Lado da miniatura. Fixo de propósito (ver comentário na tira). */
const THUMB_SIZE = "size-[68px] sm:size-[76px]";

/** Ícone da miniatura quando não há imagem — diz o TIPO do registro. */
const KIND_ICON = {
  photo: Camera,
  video: Video,
  audio: Mic,
  file: FileText,
  note: StickyNote,
} as const;

/** Uma miniatura nunca fica sem legenda ao abrir: sem texto digitado, o nome
 * do arquivo; sem nome de arquivo, o rótulo da categoria. */
function recordTitle(r: AccountRecord): string {
  const typed = (r.body ?? "").trim();
  if (typed) return typed;
  if (r.fileName) return r.fileName;
  return CATEGORY_BY_KEY.get(r.category)?.label ?? "Registro";
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
  const [period, setPeriod] = useState<PeriodValue>("all");
  const [opened, setOpened] = useState<AccountRecord | null>(null);

  const days = period === "all" ? null : Number(period);

  const q = useQuery({
    queryKey: [
      "account-records",
      activeOwnerId ?? "self",
      category ?? "all",
      onlyOpen,
      period,
    ] as const,
    queryFn: () => listFn({ data: { ownerId: activeOwnerId, category, onlyOpen, days } }),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      setOpened(null);
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
    // `records` já vem do banco do mais recente para o mais antigo; os grupos
    // herdam a ordem de aparição — por data, isso já é a ordem cronológica
    // invertida, sem nenhuma reordenação extra.
    return Array.from(map.values());
  }, [records, groupBy]);

  // "6 de 38 · danos" — exatamente a legenda do mockup.
  const subtitle = (() => {
    if (q.isLoading) return "Carregando…";
    const total = q.data?.total ?? 0;
    if (total === 0) return "Nenhum registro por aqui ainda.";
    if (category) {
      const meta = CATEGORY_BY_KEY.get(category);
      return `${counts?.[category] ?? 0} de ${total} · ${(meta?.short ?? "").toLowerCase()}`;
    }
    const open = q.data?.totalOpen ?? 0;
    const base = `${total} ${total === 1 ? "registro" : "registros"}`;
    return open > 0 ? `${base} · ${open} em aberto` : base;
  })();

  const hasCustomFilters = category !== null || onlyOpen || period !== "all";

  return (
    <>
      <OperationShell
        view="registros"
        subtitle={subtitle}
        actions={
          <RecordsFiltersButton
            onlyOpen={onlyOpen}
            onOnlyOpenChange={setOnlyOpen}
            hasCustomFilters={hasCustomFilters}
            onClearAll={() => {
              setCategory(null);
              setOnlyOpen(false);
              setPeriod("all");
            }}
          />
        }
      />

      {/* 1 — CONTADORES. Mesmo cartão dos KPIs da Operacional; o número é da
          cor da categoria e o cartão selecionado ganha um anel da mesma cor.
          Tocar no que já está selecionado volta para "todos". */}
      <div className="mb-2 grid grid-cols-5 gap-1.5">
        {CATEGORIES.map((c) => (
          <CategoryCard
            key={c.key}
            label={c.short}
            count={counts?.[c.key] ?? 0}
            openCount={openCounts?.[c.key] ?? 0}
            tone={c.key}
            active={category === c.key}
            loading={q.isLoading}
            onClick={() => setCategory(category === c.key ? null : c.key)}
          />
        ))}
      </div>

      {/* 2 — SELETORES */}
      <div className="mb-2.5 flex items-center gap-1.5">
        <TaskChoiceMenu
          icon={LayoutGrid}
          value={groupBy}
          onChange={setGroupBy}
          options={GROUP_OPTIONS}
        />
        <TaskChoiceMenu
          icon={CalendarDays}
          value={period}
          onChange={setPeriod}
          options={PERIOD_OPTIONS}
        />
      </div>

      {/* 3 — UM CARTÃO POR GRUPO, com a fileira de miniaturas */}
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
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.key} className="ds-3d rounded-[0.3rem] bg-card p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <span className="ds-card-title">{g.label}</span>
                  {g.sublabel && (
                    <span className={`mt-0.5 block truncate text-[10.5px] ${CARD_OWNER}`}>
                      {g.sublabel}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-[10.5px] font-bold tabular-nums text-muted-foreground">
                  {g.items.length}
                </span>
              </div>

              {/* Miniaturas de tamanho FIXO, não de largura proporcional: em
                  quatro colunas elásticas elas viravam quadrados gigantes no
                  desktop (a mesma tira que no celular tem 70px passava de
                  300px). Fixas, a tira é sempre uma tira. */}
              <div className="mt-2 flex flex-wrap gap-1">
                {g.items.slice(0, THUMBS_PER_GROUP).map((r, i) => {
                  const isLastSlot = i === THUMBS_PER_GROUP - 1;
                  const rest = g.items.length - THUMBS_PER_GROUP;
                  if (isLastSlot && rest > 0) {
                    return (
                      <button
                        key="more"
                        type="button"
                        onClick={() => setOpened(r)}
                        className={`${THUMB_SIZE} grid place-items-center rounded-[0.25rem] bg-secondary/40 text-[11px] font-bold tabular-nums text-muted-foreground transition-colors hover:bg-secondary/70`}
                      >
                        +{rest + 1}
                      </button>
                    );
                  }
                  return <Thumb key={r.id} record={r} onOpen={() => setOpened(r)} />;
                })}
              </div>
            </div>
          ))}

          {q.data?.truncated && (
            <p className="pt-1 text-center text-[11px] text-muted-foreground">
              Histórico longo — a lista mostra os mais recentes. Escolher uma categoria ou um
              período afina o que aparece.
            </p>
          )}
        </div>
      )}

      <RecordViewerDialog
        record={opened}
        onClose={() => setOpened(null)}
        onDelete={(id) => del.mutate(id)}
      />
    </>
  );
}

/** Contador/filtro de uma categoria. Mesma casca dos KPIs da Operacional. */
function CategoryCard({
  label,
  count,
  openCount,
  tone,
  active,
  loading,
  onClick,
}: {
  label: string;
  count: number;
  openCount: number;
  tone: RecordCategory;
  active: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const numberTone: Record<RecordCategory, string> = {
    forgotten: "text-orange-600 dark:text-orange-400",
    damage: "text-rose-600 dark:text-rose-400",
    cleaning_audit: "text-violet-600 dark:text-violet-400",
    maintenance: "text-sky-600 dark:text-sky-400",
    other: "text-muted-foreground",
  };
  const ringTone: Record<RecordCategory, string> = {
    forgotten: "ring-orange-500/60",
    damage: "ring-rose-500/60",
    cleaning_audit: "ring-violet-500/60",
    maintenance: "ring-sky-500/60",
    other: "ring-muted-foreground/50",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`ds-3d relative flex flex-col justify-between rounded-[0.3rem] bg-card px-2 py-2.5 text-left transition hover:bg-secondary/30 ${
        active ? `ring-2 ring-inset ${ringTone[tone]}` : ""
      } ${count === 0 && !active ? "opacity-55" : ""}`}
    >
      <span
        className={`font-display text-[17px] font-bold leading-none tabular-nums ${numberTone[tone]}`}
      >
        {loading ? "—" : count}
      </span>
      <span className="ds-eyebrow mt-1.5 truncate text-[8.5px] text-muted-foreground" title={label}>
        {label}
      </span>
      {/* O aviso só existe quando existe — "0 em aberto" não vira etiqueta. */}
      {openCount > 0 && (
        <span
          aria-label={`${openCount} em aberto`}
          className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-rose-500"
        />
      )}
    </button>
  );
}

function Thumb({ record, onOpen }: { record: AccountRecord; onOpen: () => void }) {
  const meta = CATEGORY_BY_KEY.get(record.category);
  const Icon = KIND_ICON[record.kind] ?? StickyNote;
  const open = record.taskStatus === "pending";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={recordTitle(record)}
      className={`${THUMB_SIZE} relative grid place-items-center overflow-hidden rounded-[0.25rem] bg-gradient-to-br from-secondary/70 to-secondary/30 transition-opacity hover:opacity-80`}
    >
      {record.kind === "photo" && record.url ? (
        <img src={record.url} alt="" className="size-full object-cover" />
      ) : (
        <Icon className="size-4 text-muted-foreground" />
      )}
      {/* Ponto da categoria: sem ele, com "todos" selecionado a fileira não
          diz mais o que cada miniatura é. */}
      <span
        className={`absolute bottom-1 left-1 size-1.5 rounded-full ${meta?.dot ?? "bg-muted"}`}
      />
      {open && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-rose-500" aria-label="Em aberto" />
      )}
    </button>
  );
}

/** O registro aberto — o MESMO bloco da linha do tempo da reserva (mídia,
 * texto, vínculo com a pendência, rodapé). Nenhuma segunda implementação de
 * player/visualizador para manter em pé. */
function RecordViewerDialog({
  record,
  onClose,
  onDelete,
}: {
  record: AccountRecord | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Dialog open={!!record} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border-border/60 bg-card/95 p-0 backdrop-blur-xl sm:w-full sm:max-w-md">
        {record && (
          <>
            <DialogHeader className="px-4 pb-0 pt-4">
              <DialogTitle className="ds-card-title pr-6">{record.propertyName}</DialogTitle>
              {record.ownerName && (
                <span className={`block truncate text-[11px] ${CARD_OWNER}`}>
                  {record.ownerName}
                </span>
              )}
            </DialogHeader>
            <div className="px-4 pb-4 pt-3">
              <RecordBlock group={{ key: record.id, items: [record] }} onDelete={onDelete} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mesmo gatilho compacto de filtro das outras páginas: quadrado de 30px com
 * o ponto rosa quando há algum filtro ativo. */
function RecordsFiltersButton({
  onlyOpen,
  onOnlyOpenChange,
  hasCustomFilters,
  onClearAll,
}: {
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
      <DropdownMenuContent align="end" className="w-48">
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
