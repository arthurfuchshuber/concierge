import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { listTaskLinkOptions } from "@/lib/tasks.functions";
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
 * A tela tem DOIS andares:
 *   1. CONTADORES por categoria, em duas linhas de três — a leitura
 *      estratégica ("quantos e de quê") e, ao mesmo tempo, o filtro. Mesmo
 *      cartão dos KPIs da tela Operacional (bg-card + ds-3d + ds-eyebrow).
 *   2. Um CARTÃO POR IMÓVEL (ver `PropertyCard`): o que há para EXECUTAR em
 *      cima, em linhas com título legível; o acervo embaixo, em miniaturas.
 *
 * Todo o resto dos filtros — categoria, agrupar, período, proprietário e
 * imóvel — mora no botão único ao lado do título. Nenhuma faixa horizontal
 * de controles: foi ela que deixou as Pendências poluídas.
 *
 * Sem recorte de período por padrão (pedido explícito): abre com o histórico
 * inteiro, já filtrado pela categoria de maior prioridade que tenha registro
 * (ver `AUTO_CATEGORY_PRIORITY`).
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

/**
 * A MINIATURA DO ACERVO TEM UM TAMANHO SÓ.
 *
 * Chegou a ter dois — 44px nos cartões com "a resolver" e 76px nos sem —
 * para poupar altura. Visto na tela, dois cartões vizinhos com quadrados de
 * tamanhos diferentes leem como desalinho, não como economia. Um tamanho só,
 * e a tira fica igual em todo lugar.
 */
const THUMB_SIZE = "size-[52px]";
/** Quantas miniaturas antes do "+N". Enche a linha do celular sem passar. */
const THUMBS_PER_GROUP = 5;

/**
 * A CAPA DO QUADRANTE (pedido explícito, 10/09/2026).
 *
 * Foto e vídeo mostram a própria imagem — o vídeo usa o primeiro quadro como
 * capa (`#t=0.1` + `preload="metadata"`: o navegador busca só o cabeçalho e
 * pinta esse quadro, sem baixar o arquivo) com um play por cima. Áudio, que
 * não tem imagem nenhuma, ganha o play no centro do quadrante. Nota é a
 * letra T. Só o arquivo genérico continua com ícone.
 *
 * `pointer-events-none` no <video>: o quadrante inteiro é um botão, e sem
 * isso o clique no vídeo abriria os controles nativos em vez do registro.
 */
function RecordCover({ record, size }: { record: AccountRecord; size: "xs" | "sm" | "md" }) {
  const iconClass = size === "xs" ? "size-3.5" : size === "sm" ? "size-4" : "size-5";
  const playClass = size === "xs" ? "size-3.5" : size === "sm" ? "size-5" : "size-6";
  const letterClass = size === "xs" ? "text-[13px]" : size === "sm" ? "text-[17px]" : "text-[22px]";

  if (record.kind === "photo" && record.url) {
    return <img src={record.url} alt="" className="size-full object-cover" />;
  }
  if (record.kind === "video" && record.url) {
    return (
      <>
        <video
          src={`${record.url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          className="pointer-events-none size-full object-cover"
        />
        <span className="absolute inset-0 grid place-items-center bg-black/25">
          <Play className={`${playClass} fill-white text-white drop-shadow`} />
        </span>
      </>
    );
  }
  if (record.kind === "audio") {
    return (
      <span className="grid size-full place-items-center">
        <Play className={`${playClass} fill-foreground/70 text-foreground/70`} />
      </span>
    );
  }
  if (record.kind === "note") {
    return <span className={`font-display font-bold text-muted-foreground ${letterClass}`}>T</span>;
  }
  return <FileText className={`${iconClass} text-muted-foreground`} />;
}

/** "hoje" / "ontem" / "08/09" — a data curta da linha e do rodapé. */
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

/** Uma miniatura nunca fica sem legenda ao abrir: sem texto digitado, o nome
 * do arquivo; sem nome de arquivo, o rótulo da categoria. */
function recordTitle(r: AccountRecord): string {
  const typed = (r.body ?? "").trim();
  if (typed) return typed;
  if (r.fileName) return r.fileName;
  return CATEGORY_BY_KEY.get(r.category)?.label ?? "Registro";
}

/**
 * ORDEM DE PRIORIDADE do filtro que a tela escolhe sozinha ao abrir (pedido
 * explícito): manutenção, depois dano, esquecidos, auditoria e outros. Cai
 * para o próximo sempre que o anterior estiver zerado — e, se não houver
 * registro nenhum, não seleciona nada.
 *
 * Nota: é a ordem de PRIORIDADE, não a ordem em que os cartões aparecem —
 * essa continua sendo a ordem de `CATEGORIES`, definida pelo cliente em
 * 07/09/2026.
 */
const AUTO_CATEGORY_PRIORITY: readonly RecordCategory[] = [
  "maintenance",
  "damage",
  "forgotten",
  "cleaning_audit",
  "other",
];

/** Quantas pendências o cartão do imóvel lista antes de colapsar em "+N". */
const PENDING_ROWS = 3;

/**
 * O QUE SOBE PARA "A RESOLVER" (pedido explícito, 10/09/2026): DANO e
 * MANUTENÇÃO. Objeto esquecido também abre pendência no Kanban, mas ficou
 * de fora daqui — é devolução, não conserto; continua no acervo e na tela de
 * Pendências. Para incluí-lo, basta acrescentar "forgotten" nesta lista.
 * Auditoria de limpeza nunca gera tarefa: é prova, não trabalho.
 */
const PENDING_CATEGORIES: readonly RecordCategory[] = ["damage", "maintenance"];

type Group = {
  key: string;
  label: string;
  sublabel: string | null;
  propertyId: string;
  /** Registros com pendência AINDA EM ABERTO — o que há para executar. */
  pending: AccountRecord[];
  /** Todo o resto: prova, não tarefa. */
  rest: AccountRecord[];
  total: number;
};

export function RecordsWorkspace() {
  const { impersonation } = useImpersonation();
  const activeOwnerId = impersonation?.userId ?? null;
  const qc = useQueryClient();

  const listFn = useServerFn(listAccountRecords);
  const deleteFn = useServerFn(deleteReservationRecord);
  const optionsFn = useServerFn(listTaskLinkOptions);

  const [category, setCategory] = useState<RecordCategory | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("property");
  const [period, setPeriod] = useState<PeriodValue>("all");
  /** Nomes (mesma chave do filtro de proprietário das outras telas). */
  const [ownerFilters, setOwnerFilters] = useState<string[]>([]);
  /** Ids de imóvel. */
  const [propertyFilters, setPropertyFilters] = useState<string[]>([]);
  const [opened, setOpened] = useState<AccountRecord | null>(null);

  const days = period === "all" ? null : Number(period);

  // Imóveis e proprietários da conta — a MESMA função que alimenta o
  // vínculo das Pendências, já recortada por perfil.
  const optionsQ = useQuery({
    queryKey: ["records-link-options", activeOwnerId ?? "self"] as const,
    queryFn: () => optionsFn({ data: { ownerId: activeOwnerId } }),
    staleTime: 5 * 60_000,
  });
  const linkProperties = useMemo(() => optionsQ.data?.properties ?? [], [optionsQ.data]);
  const ownerOptions = useMemo(
    () => (optionsQ.data?.owners ?? []).map((o) => o.name),
    [optionsQ.data],
  );

  /**
   * O filtro de PROPRIETÁRIO vira lista de imóveis antes de ir ao servidor —
   * é o mesmo recorte, e assim os contadores por categoria acompanham o
   * filtro em vez de continuarem contando a conta inteira.
   */
  const propertyIds = useMemo<string[] | null>(() => {
    const byOwner =
      ownerFilters.length > 0
        ? linkProperties.filter((p) => p.ownerName && ownerFilters.includes(p.ownerName))
        : null;
    const ids = new Set<string>();
    if (byOwner) for (const p of byOwner) ids.add(p.id);
    if (propertyFilters.length > 0) {
      if (byOwner) {
        // Os dois filtros juntos são uma INTERSEÇÃO: "os imóveis deste
        // proprietário que também estão marcados".
        const chosen = new Set(propertyFilters);
        for (const id of Array.from(ids)) if (!chosen.has(id)) ids.delete(id);
      } else {
        for (const id of propertyFilters) ids.add(id);
      }
    }
    if (!byOwner && propertyFilters.length === 0) return null;
    // Interseção vazia: manda um id impossível para não cair no "sem filtro".
    return ids.size > 0 ? Array.from(ids) : ["00000000-0000-0000-0000-000000000000"];
  }, [ownerFilters, propertyFilters, linkProperties]);

  const q = useQuery({
    queryKey: [
      "account-records",
      activeOwnerId ?? "self",
      category ?? "all",
      onlyOpen,
      period,
      (propertyIds ?? []).join(","),
    ] as const,
    queryFn: () =>
      listFn({ data: { ownerId: activeOwnerId, category, onlyOpen, days, propertyIds } }),
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

  /**
   * FILTRO PADRÃO AO ABRIR (pedido explícito). Toda vez que se entra na aba,
   * a tela já vem filtrada pela primeira categoria com registro na ordem de
   * prioridade — manutenção, dano, esquecidos, auditoria, outros.
   *
   * Roda UMA vez por visita (o `useRef`), senão desmarcar o cartão no dedo
   * seria desfeito no mesmo instante. Sair da aba desmonta o componente, e a
   * próxima entrada escolhe de novo — inclusive se a operação mudou.
   */
  const autoPicked = useRef(false);
  const [defaultCategory, setDefaultCategory] = useState<RecordCategory | null>(null);
  useEffect(() => {
    if (autoPicked.current || !counts) return;
    autoPicked.current = true;
    const first = AUTO_CATEGORY_PRIORITY.find((k) => (counts[k] ?? 0) > 0) ?? null;
    setDefaultCategory(first);
    if (first) setCategory(first);
  }, [counts]);

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
          propertyId: r.propertyId,
          pending: [],
          rest: [],
          total: 0,
        };
        map.set(key, g);
      }
      // O QUE É TRABALHO vs. O QUE É PROVA. Um registro só sobe para "a
      // resolver" quando é dano/manutenção E a pendência que ele abriu no
      // Kanban ainda está de pé. Concluída a pendência, ele desce sozinho
      // para o acervo — o status é lido de `tasks`, nunca copiado.
      if (r.taskStatus === "pending" && PENDING_CATEGORIES.includes(r.category)) g.pending.push(r);
      else g.rest.push(r);
      g.total += 1;
    }
    // Em "a resolver", o MAIS ANTIGO vem primeiro: ali antiguidade é atraso.
    // No acervo vale a ordem que veio do banco (mais recente primeiro).
    for (const g of map.values()) {
      g.pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
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

  // A categoria escolhida SOZINHA pela tela não conta como "filtro do
  // usuário": se contasse, o pontinho no botão estaria sempre aceso e
  // deixaria de significar alguma coisa.
  const hasCustomFilters =
    category !== defaultCategory ||
    onlyOpen ||
    period !== "all" ||
    groupBy !== "property" ||
    ownerFilters.length > 0 ||
    propertyFilters.length > 0;

  function clearAllFilters() {
    setCategory(defaultCategory);
    setOnlyOpen(false);
    setPeriod("all");
    setGroupBy("property");
    setOwnerFilters([]);
    setPropertyFilters([]);
  }

  return (
    /* MESMA MOLDURA DE PÁGINA das outras três telas (Operacional / Kanban /
       Limpeza) — este wrapper é o que dá o respiro lateral, o teto de
       largura e o alinhamento do título com o conteúdo. Sem ele a tela
       nasce colada nas bordas e desalinhada de todo o resto do app. */
    <div className="w-full max-w-[1440px] space-y-1.5 px-2.5 py-5 sm:px-5 lg:px-8 lg:py-8">
      <OperationShell
        view="registros"
        subtitle={subtitle}
        actions={
          <RecordsFiltersButton
            category={category}
            onCategoryChange={setCategory}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            period={period}
            onPeriodChange={setPeriod}
            onlyOpen={onlyOpen}
            onOnlyOpenChange={setOnlyOpen}
            ownerFilters={ownerFilters}
            onOwnerFiltersChange={setOwnerFilters}
            ownerOptions={ownerOptions}
            propertyFilters={propertyFilters}
            onPropertyFiltersChange={setPropertyFilters}
            propertyOptions={linkProperties}
            hasCustomFilters={hasCustomFilters}
            onClearAll={clearAllFilters}
          />
        }
      />

      {/* 1 — CONTADORES, em DUAS LINHAS de três (pedido explícito): cinco
          cartões numa linha só deixavam o rótulo cortado ("ESQUECID…",
          "MANUTEN…") justamente nas categorias que mais importam. Em
          `grid-cols-3` sobram três em cima e dois embaixo, com o rótulo
          inteiro. O número é da cor da categoria e o cartão selecionado
          ganha o anel da mesma cor; tocar no selecionado volta para "todos". */}
      <div className="grid grid-cols-3 gap-1.5">
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

      {/* UM CARTÃO POR GRUPO, com a fileira de miniaturas */}
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
        <div className="space-y-1.5">
          {groups.map((g) => (
            <PropertyCard
              key={g.key}
              group={g}
              onOpen={setOpened}
              onFocusPending={() => {
                // "+N a resolver" recorta a própria tela para ESTE imóvel,
                // só os abertos — em vez de abrir uma quarta tela para dizer
                // o que os filtros já sabem dizer.
                setPropertyFilters([g.propertyId]);
                setOwnerFilters([]);
                setOnlyOpen(true);
              }}
            />
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
    </div>
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

/**
 * O CARTÃO DO IMÓVEL EM DOIS ANDARES (mockup B, aprovado 10/09/2026).
 *
 * Antes era uma fileira de quadrados cinzentos com um ponto de 6px: um dano
 * sem conserto e uma foto de auditoria eram visualmente o mesmo quadrado. O
 * cartão passa a admitir que há duas naturezas ali dentro —
 *
 *   A RESOLVER  o que abriu pendência e ela ainda está de pé (dano,
 *               manutenção, objeto esquecido). Vira LINHA, com título
 *               legível, porque é trabalho e trabalho precisa de nome.
 *   REGISTROS   o resto. Continua miniatura, porque é prova.
 *
 * Sem nada em aberto o primeiro andar não existe e o cartão fica igual ao de
 * antes — a mesma regra de sempre: o aviso só aparece quando há aviso.
 */
function PropertyCard({
  group,
  onOpen,
  onFocusPending,
}: {
  group: Group;
  onOpen: (r: AccountRecord) => void;
  onFocusPending: () => void;
}) {
  const hasPending = group.pending.length > 0;
  const hiddenPending = group.pending.length - PENDING_ROWS;

  return (
    <div className="ds-3d rounded-[0.3rem] bg-card p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <span className="ds-card-title">{group.label}</span>
          {group.sublabel && (
            <span className={`mt-0.5 block truncate text-[10.5px] ${CARD_OWNER}`}>
              {group.sublabel}
            </span>
          )}
        </div>
        {hasPending ? (
          <span className="shrink-0 rounded-[0.25rem] bg-rose-500/15 px-1.5 py-0.5 text-[9.5px] font-extrabold tabular-nums text-rose-600 dark:text-rose-400">
            {group.pending.length} a resolver
          </span>
        ) : (
          <span className="shrink-0 text-[10.5px] font-bold tabular-nums text-muted-foreground">
            {group.total}
          </span>
        )}
      </div>

      {hasPending && (
        <>
          <div className="mb-1 mt-2.5 flex items-center gap-2">
            <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-[0.11em] text-rose-600 dark:text-rose-400">
              A resolver
            </span>
            <span className="h-px flex-1 bg-border" />
            <span className="shrink-0 text-[9px] font-bold tabular-nums text-muted-foreground">
              {group.pending.length}
            </span>
          </div>
          {group.pending.slice(0, PENDING_ROWS).map((r) => (
            <PendingRow key={r.id} record={r} onOpen={() => onOpen(r)} />
          ))}
          {hiddenPending > 0 && (
            <button
              type="button"
              onClick={onFocusPending}
              className="mt-1 w-full rounded-[0.25rem] py-1 text-center text-[10px] font-bold text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            >
              +{hiddenPending} a resolver
            </button>
          )}
        </>
      )}

      {group.rest.length > 0 && (
        <>
          {hasPending && (
            <div className="mb-1 mt-2.5 flex items-center gap-2">
              <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-[0.11em] text-muted-foreground">
                Registros
              </span>
              <span className="h-px flex-1 bg-border" />
              <span className="shrink-0 text-[9px] font-bold tabular-nums text-muted-foreground">
                {group.rest.length}
              </span>
            </div>
          )}
          {/* Miniaturas de tamanho FIXO, não de largura proporcional: em
              colunas elásticas elas viravam quadrados gigantes no desktop. */}
          <div className={`flex flex-wrap gap-1 ${hasPending ? "" : "mt-2"}`}>
            {group.rest.slice(0, THUMBS_PER_GROUP).map((r, i) => {
              const isLastSlot = i === THUMBS_PER_GROUP - 1;
              const hidden = group.rest.length - THUMBS_PER_GROUP;
              if (isLastSlot && hidden > 0) {
                return (
                  <button
                    key="more"
                    type="button"
                    onClick={() => onOpen(r)}
                    className={`${THUMB_SIZE} grid place-items-center rounded-[0.25rem] bg-secondary/40 text-[11px] font-bold tabular-nums text-muted-foreground transition-colors hover:bg-secondary/70`}
                  >
                    +{hidden + 1}
                  </button>
                );
              }
              return <Thumb key={r.id} record={r} onOpen={() => onOpen(r)} />;
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Uma pendência do cartão: miniatura pequena, título legível, data. */
function PendingRow({ record, onOpen }: { record: AccountRecord; onOpen: () => void }) {
  const meta = CATEGORY_BY_KEY.get(record.category);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 border-t border-border/50 py-1.5 text-left transition-colors first:border-t-0 hover:bg-secondary/30"
    >
      <span className="relative grid size-[34px] shrink-0 place-items-center overflow-hidden rounded-[0.25rem] bg-gradient-to-br from-secondary/70 to-secondary/30">
        <RecordCover record={record} size="xs" />
        <span className={`absolute inset-x-0 bottom-0 h-[3px] ${meta?.dot ?? "bg-muted"}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] font-semibold leading-tight">
          {recordTitle(record)}
        </span>
        <span className="mt-0.5 block truncate text-[9.5px] leading-tight text-muted-foreground">
          {meta?.short ?? "Registro"}
          {record.createdByName ? ` · ${record.createdByName}` : ""}
          {record.cardMode ? ` · ${MODE_LABEL[record.cardMode].toLowerCase()}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-[9.5px] tabular-nums text-muted-foreground">
        {fmtShortDate(record.createdAt)}
      </span>
    </button>
  );
}

function Thumb({ record, onOpen }: { record: AccountRecord; onOpen: () => void }) {
  const meta = CATEGORY_BY_KEY.get(record.category);
  const open = record.taskStatus === "pending";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={recordTitle(record)}
      className={`${THUMB_SIZE} relative grid place-items-center overflow-hidden rounded-[0.25rem] bg-gradient-to-br from-secondary/70 to-secondary/30 transition-opacity hover:opacity-80`}
    >
      <RecordCover record={record} size="sm" />
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

/**
 * FILTRO ÚNICO (pedido explícito): os dois seletores que viviam soltos abaixo
 * dos contadores — agrupar e período — mudaram-se para DENTRO deste botão,
 * junto com proprietário e imóvel. Uma faixa horizontal inteira de controles
 * some da tela, e o lugar do filtro passa a ser o mesmo das outras páginas:
 * o quadrado ao lado do título.
 *
 * A mecânica é a MESMA do `CalendarFiltersButton`: um resumo com uma linha
 * por filtro (rótulo à esquerda, valor atual à direita) e uma tela interna
 * para cada um, com "voltar" no topo. Nada de menu-dentro-de-menu.
 */
function RecordsFiltersButton({
  category,
  onCategoryChange,
  groupBy,
  onGroupByChange,
  period,
  onPeriodChange,
  onlyOpen,
  onOnlyOpenChange,
  ownerFilters,
  onOwnerFiltersChange,
  ownerOptions,
  propertyFilters,
  onPropertyFiltersChange,
  propertyOptions,
  hasCustomFilters,
  onClearAll,
}: {
  category: RecordCategory | null;
  onCategoryChange: (v: RecordCategory | null) => void;
  groupBy: GroupBy;
  onGroupByChange: (v: GroupBy) => void;
  period: PeriodValue;
  onPeriodChange: (v: PeriodValue) => void;
  onlyOpen: boolean;
  onOnlyOpenChange: (v: boolean) => void;
  ownerFilters: string[];
  onOwnerFiltersChange: (next: string[]) => void;
  ownerOptions: string[];
  propertyFilters: string[];
  onPropertyFiltersChange: (next: string[]) => void;
  propertyOptions: ReadonlyArray<{ id: string; name: string; ownerName: string | null }>;
  hasCustomFilters: boolean;
  onClearAll: () => void;
}) {
  type Screen = "root" | "category" | "group" | "period" | "owner" | "property";
  const [screen, setScreen] = useState<Screen>("root");

  function toggle(list: string[], value: string, onChange: (next: string[]) => void) {
    onChange(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  const categoryLabel = category ? (CATEGORY_BY_KEY.get(category)?.short ?? "Todas") : "Todas";
  const groupLabel = GROUP_OPTIONS.find((o) => o.value === groupBy)?.label ?? "Por imóvel";
  const periodLabel = PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? "Todo o período";
  const ownerLabel =
    ownerFilters.length === 0
      ? "Todos"
      : ownerFilters.length === 1
        ? ownerFilters[0]
        : `${ownerFilters.length} selecionados`;
  const propertyLabel =
    propertyFilters.length === 0
      ? "Todos"
      : propertyFilters.length === 1
        ? (propertyOptions.find((p) => p.id === propertyFilters[0])?.name ?? "1 selecionado")
        : `${propertyFilters.length} selecionados`;

  function BackRow() {
    return (
      <button
        type="button"
        onClick={() => setScreen("root")}
        className="flex w-full items-center gap-1.5 border-b border-border px-3 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" />
        Filtros
      </button>
    );
  }

  function Row({
    label,
    value,
    onClick,
    last,
  }: {
    label: string;
    value: string;
    onClick: () => void;
    last?: boolean;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-secondary/30 ${
          last ? "" : "border-b border-border"
        }`}
      >
        <span className="text-xs font-medium">{label}</span>
        <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          <span className="max-w-[7rem] truncate">{value}</span>
          <ChevronRight className="size-3.5 shrink-0 opacity-60" />
        </span>
      </button>
    );
  }

  return (
    <Popover
      onOpenChange={(open) => {
        // Sempre reabre no resumo — ninguém espera "continuar de onde parou"
        // dentro de uma tela interna da última vez.
        if (!open) setScreen("root");
      }}
    >
      <PopoverTrigger asChild>
        {/* MESMO botão das outras telas (CalendarFiltersButton, compactTrigger):
            quadrado de 30px, raio 0.4rem, fundo foreground/6%, ponto no accent. */}
        <button
          type="button"
          title={hasCustomFilters ? "Filtros · há filtro ativo" : "Filtros"}
          aria-label="Filtros dos registros"
          className="relative grid size-[30px] shrink-0 place-items-center rounded-[0.4rem] bg-foreground/[0.06] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <SlidersHorizontal className="size-3.5" />
          {hasCustomFilters && (
            <span className="absolute right-1 top-1 size-[5px] rounded-full bg-accent" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        collisionPadding={12}
        className="sg-elegant-scroll max-h-[min(28rem,70vh)] w-64 overflow-y-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {screen === "root" ? (
          <>
            <div className="flex items-center justify-start gap-2 border-b border-border px-3 py-2.5">
              <button
                type="button"
                disabled={!hasCustomFilters}
                onClick={onClearAll}
                className="text-[11px] font-medium text-foreground/70 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                Limpar
              </button>
            </div>
            <Row label="Categoria" value={categoryLabel} onClick={() => setScreen("category")} />
            <Row label="Agrupar" value={groupLabel} onClick={() => setScreen("group")} />
            <Row label="Período" value={periodLabel} onClick={() => setScreen("period")} />
            <Row label="Proprietário" value={ownerLabel} onClick={() => setScreen("owner")} />
            <Row label="Imóvel" value={propertyLabel} onClick={() => setScreen("property")} />
            <button
              type="button"
              onClick={() => onOnlyOpenChange(!onlyOpen)}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left transition-colors hover:bg-secondary/30"
            >
              <Checkbox checked={onlyOpen} className="pointer-events-none" />
              <span className="text-xs font-medium">Só os em aberto</span>
            </button>
          </>
        ) : null}

        {screen === "category" ? (
          <>
            <BackRow />
            <button
              type="button"
              onClick={() => onCategoryChange(null)}
              className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-xs transition-colors hover:bg-secondary/30"
            >
              <Check className={`size-3.5 ${category === null ? "opacity-100" : "opacity-0"}`} />
              Todas
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => onCategoryChange(c.key)}
                className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-xs transition-colors last:border-b-0 hover:bg-secondary/30"
              >
                <Check className={`size-3.5 ${c.key === category ? "opacity-100" : "opacity-0"}`} />
                <span className={`size-1.5 shrink-0 rounded-full ${c.dot}`} />
                {c.label}
              </button>
            ))}
          </>
        ) : null}

        {screen === "group" ? (
          <>
            <BackRow />
            {GROUP_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onGroupByChange(o.value)}
                className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-xs transition-colors last:border-b-0 hover:bg-secondary/30"
              >
                <Check
                  className={`size-3.5 ${o.value === groupBy ? "opacity-100" : "opacity-0"}`}
                />
                {o.label}
              </button>
            ))}
          </>
        ) : null}

        {screen === "period" ? (
          <>
            <BackRow />
            {PERIOD_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onPeriodChange(o.value)}
                className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-xs transition-colors last:border-b-0 hover:bg-secondary/30"
              >
                <Check className={`size-3.5 ${o.value === period ? "opacity-100" : "opacity-0"}`} />
                {o.label}
              </button>
            ))}
          </>
        ) : null}

        {screen === "owner" ? (
          <>
            <BackRow />
            <Command>
              <CommandInput placeholder="Buscar proprietário..." />
              <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                  onClick={() => onOwnerFiltersChange([...ownerOptions])}
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
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
                      <Checkbox
                        checked={ownerFilters.includes(o)}
                        className="pointer-events-none"
                      />
                      <span className="truncate">{o}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </>
        ) : null}

        {screen === "property" ? (
          <>
            <BackRow />
            <Command>
              <CommandInput placeholder="Buscar imóvel..." />
              <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                  onClick={() => onPropertyFiltersChange(propertyOptions.map((p) => p.id))}
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                  onClick={() => onPropertyFiltersChange([])}
                >
                  Limpar
                </button>
              </div>
              <CommandList className="sg-elegant-scroll max-h-52">
                <CommandEmpty>Nenhum resultado.</CommandEmpty>
                <CommandGroup>
                  {propertyOptions.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.name} ${p.ownerName ?? ""}`}
                      onSelect={() => toggle(propertyFilters, p.id, onPropertyFiltersChange)}
                      className="cursor-pointer gap-2"
                    >
                      <Checkbox
                        checked={propertyFilters.includes(p.id)}
                        className="pointer-events-none"
                      />
                      <span className="truncate">{p.name}</span>
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
