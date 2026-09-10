import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Mic,
  SlidersHorizontal,
  StickyNote,
  Video,
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
import { AudioPlayer } from "@/components/dashboard/ReservationRecords";
import { CATEGORY_BY_KEY, MODE_LABEL, fmtDayLabel } from "@/components/dashboard/record-categories";
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
 * inteiro e com o cartão "TODOS" selecionado.
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
/** Versão curta, quando o cartão já gastou altura com "a resolver". */
const SMALL_THUMB_SIZE = "size-[44px]";

/**
 * O ÍCONE DO QUADRANTE — diz o TIPO do registro (foto, vídeo, áudio, nota,
 * arquivo).
 *
 * O quadrante NÃO mostra a mídia (pedido explícito, 10/09/2026). Chegou a
 * mostrar: foto e vídeo viravam capa, áudio virava play, nota virava a letra
 * T. Na tela real, com dezenas de miniaturas de origens diferentes, a tira
 * virou uma colcha de retalhos — e o vídeo ainda obrigava o navegador a
 * buscar o cabeçalho de cada arquivo só para pintar um quadro. O ícone é
 * calmo, é instantâneo e diz o que interessa na lista: que tipo de registro
 * é aquele. A MÍDIA abre no clique, no visualizador.
 */
const KIND_ICON = {
  photo: Camera,
  video: Video,
  audio: Mic,
  file: FileText,
  note: StickyNote,
} as const;

function RecordCover({ record, size }: { record: AccountRecord; size: "xs" | "sm" }) {
  const Icon = KIND_ICON[record.kind] ?? StickyNote;
  return <Icon className={`${size === "xs" ? "size-3.5" : "size-4"} text-muted-foreground`} />;
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

/**
 * TÍTULO E DESCRIÇÃO a partir do ÚNICO campo de texto que existe.
 *
 * O banco guarda um `body` só — o que a pessoa digita junto com a mídia — e
 * o nome do arquivo. Não há dois campos. Então a PRIMEIRA LINHA do texto vira
 * título e o RESTO vira descrição; sem texto digitado, o título é o nome do
 * arquivo e não há descrição. É reversível: no dia em que existir um campo
 * próprio de título, ele simplesmente passa na frente daqui.
 */
function recordText(r: AccountRecord): { title: string; description: string | null } {
  const typed = (r.body ?? "").trim();
  if (typed) {
    const nl = typed.indexOf("\n");
    if (nl === -1) return { title: typed, description: null };
    return {
      title: typed.slice(0, nl).trim(),
      description: typed.slice(nl + 1).trim() || null,
    };
  }
  if (r.fileName) return { title: r.fileName, description: null };
  return { title: CATEGORY_BY_KEY.get(r.category)?.label ?? "Registro", description: null };
}

function recordTitle(r: AccountRecord): string {
  return recordText(r).title;
}

/**
 * A FAIXA DA CATEGORIA dentro do quadrante (pedido explícito, 10/09/2026):
 * mesma cor da categoria, translúcida, com o texto na versão clara dela. Fica
 * de ponta a ponta no topo do quadrado, centralizada — sobre foto ou vídeo a
 * translucidez deixa a imagem aparecer por baixo.
 */
const CATEGORY_BAND: Record<RecordCategory, string> = {
  forgotten: "bg-orange-500/20 text-orange-300",
  damage: "bg-rose-500/20 text-rose-300",
  cleaning_audit: "bg-violet-500/20 text-violet-300",
  maintenance: "bg-sky-500/20 text-sky-300",
  other: "bg-muted-foreground/20 text-muted-foreground",
};

/** "07–10 set" — a janela da reserva na etiqueta do grupo. */
function fmtStayRange(checkin: string | null, checkout: string | null): string | null {
  const fmt = (iso: string, withMonth: boolean) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    return withMonth
      ? dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")
      : String(d).padStart(2, "0");
  };
  if (checkin && checkout) return `${fmt(checkin, false)}–${fmt(checkout, true)}`;
  if (checkin) return fmt(checkin, true);
  if (checkout) return fmt(checkout, true);
  return null;
}

/**
 * ORDEM DOS CARTÕES nesta tela (pedido explícito, 10/09/2026): manutenção,
 * dano, esquecidos, auditoria e outros — a ordem de PRIORIDADE da operação,
 * com "Todos" na frente de todos.
 *
 * Não mexe em `CATEGORIES`: aquela ordem é do SELETOR que abre antes da
 * câmera (definida pelo cliente em 07/09/2026) e continua valendo lá.
 */
const CARD_ORDER: readonly RecordCategory[] = [
  "maintenance",
  "damage",
  "forgotten",
  "cleaning_audit",
  "other",
];
const CARDS = CARD_ORDER.map((k) => CATEGORY_BY_KEY.get(k)!).filter(Boolean);

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

  const hasCustomFilters =
    category !== null ||
    onlyOpen ||
    period !== "all" ||
    groupBy !== "property" ||
    ownerFilters.length > 0 ||
    propertyFilters.length > 0;

  function clearAllFilters() {
    setCategory(null);
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
        {/* TODOS é o primeiro cartão e o filtro de entrada da aba (pedido
            explícito, 10/09/2026). Ele não é "mais uma categoria": é a visão
            em que os registros de uma MESMA RESERVA vêm empacotados. */}
        <CategoryCard
          label="Todos"
          count={q.data?.total ?? 0}
          openCount={q.data?.totalOpen ?? 0}
          tone={null}
          active={category === null}
          loading={q.isLoading}
          onClick={() => setCategory(null)}
        />
        {CARDS.map((c) => (
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
            <PropertyCard key={g.key} group={g} onOpen={setOpened} />
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

/**
 * Contador/filtro de uma categoria. Mesma casca dos KPIs da Operacional.
 *
 * A COR DO NÚMERO É UM SEMÁFORO, NÃO UMA ETIQUETA (pedido explícito,
 * 10/09/2026): zerado é BRANCO em todas as categorias — não há nada ali, nada
 * a sinalizar. Acima de zero, a cor diz o quanto aquilo pesa: manutenção e
 * dano em vermelho (é trabalho parado), esquecidos e outros em âmbar (é
 * atenção), auditoria de limpeza no violeta de sempre (é rotina, não alarme)
 * e "Todos" sempre branco, porque somar tudo não é sinal de nada.
 *
 * Cartão zerado NÃO é mais esmaecido — todos têm a mesma tonalidade.
 */
const CARD_NUMBER_TONE: Record<RecordCategory, string> = {
  maintenance: "text-rose-500 dark:text-rose-400",
  damage: "text-rose-500 dark:text-rose-400",
  forgotten: "text-amber-500 dark:text-amber-400",
  cleaning_audit: "text-violet-600 dark:text-violet-400",
  other: "text-amber-500 dark:text-amber-400",
};

const CARD_RING_TONE: Record<RecordCategory, string> = {
  maintenance: "ring-sky-500/60",
  damage: "ring-rose-500/60",
  forgotten: "ring-orange-500/60",
  cleaning_audit: "ring-violet-500/60",
  other: "ring-muted-foreground/50",
};

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
  tone: RecordCategory | null;
  active: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const numberClass = !tone || count === 0 ? "text-foreground" : CARD_NUMBER_TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`ds-3d relative flex flex-col justify-between rounded-[0.3rem] bg-card px-2 py-2.5 text-left transition hover:bg-secondary/30 ${
        active ? `ring-2 ring-inset ${tone ? CARD_RING_TONE[tone] : "ring-accent/70"}` : ""
      }`}
    >
      <span
        className={`font-display text-[17px] font-bold leading-none tabular-nums ${numberClass}`}
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
function PropertyCard({ group, onOpen }: { group: Group; onOpen: (r: AccountRecord) => void }) {
  // "+N a resolver" EXPANDE A PRÓPRIA LISTA (pedido explícito, 10/09/2026).
  // Antes ele recortava a página inteira para aquele imóvel — resolvia, mas
  // custava perder a visão dos outros. Abrir no lugar é mais barato e é o que
  // a pessoa espera de um "+N".
  const [showAllPending, setShowAllPending] = useState(false);
  const hasPending = group.pending.length > 0;
  const hiddenPending = group.pending.length - PENDING_ROWS;
  // Com o andar de pendências em cima, o acervo encolhe para não esticar o
  // cartão; sozinho, ele fica no tamanho de leitura de sempre.
  const thumbCap = hasPending ? 6 : THUMBS_PER_GROUP;

  return (
    <div className="ds-3d rounded-[0.3rem] bg-card p-3">
      {/* A ETIQUETA DIVIDE A LINHA DO TÍTULO, não o bloco de duas linhas
          (pedido explícito, 10/09/2026) — é a mesma correção já feita no
          cabeçalho das páginas: centrada no bloco inteiro, ela caía na altura
          do vão entre o nome do imóvel e o proprietário e ficava visivelmente
          baixa. Dentro da mesma linha, o alinhamento é exato por construção. */}
      <div className="flex items-center gap-2">
        <span className="ds-card-title min-w-0 flex-1">{group.label}</span>
        {hasPending && (
          <span className="shrink-0 rounded-[0.25rem] bg-rose-500/15 px-1.5 py-0.5 text-[9.5px] font-extrabold tabular-nums text-rose-600 dark:text-rose-400">
            {group.pending.length} a resolver
          </span>
        )}
      </div>
      {group.sublabel && (
        <span className={`mt-0.5 block truncate text-[10.5px] ${CARD_OWNER}`}>
          {group.sublabel}
        </span>
      )}

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
          {(showAllPending ? group.pending : group.pending.slice(0, PENDING_ROWS)).map((r) => (
            <PendingRow key={r.id} record={r} onOpen={() => onOpen(r)} />
          ))}
          {hiddenPending > 0 && (
            <button
              type="button"
              onClick={() => setShowAllPending((v) => !v)}
              aria-expanded={showAllPending}
              className="mt-1 w-full rounded-[0.25rem] py-1 text-center text-[10px] font-bold text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
            >
              {showAllPending ? "Mostrar menos" : `+${hiddenPending} a resolver`}
            </button>
          )}
        </>
      )}

      {group.rest.length > 0 && (
        <>
          {/* A ETIQUETA DE "REGISTROS" EXISTE SEMPRE (pedido explícito,
              10/09/2026), com o fio e a contagem à direita — a mesma forma de
              "A resolver". Antes ela só aparecia quando havia pendências, e o
              cartão sem pendência ficava com uma tira de quadrados sem nome.
              Com ela, a contagem some do canto superior: dizer o mesmo número
              duas vezes no mesmo cartão não ajuda ninguém. */}
          <div className="mb-1 mt-2.5 flex items-center gap-2">
            <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-[0.11em] text-muted-foreground">
              Registros
            </span>
            <span className="h-px flex-1 bg-border" />
            <span className="shrink-0 text-[9px] font-bold tabular-nums text-muted-foreground">
              {group.rest.length}
            </span>
          </div>
          {/* Miniaturas de tamanho FIXO, não de largura proporcional: em
              colunas elásticas elas viravam quadrados gigantes no desktop. */}
          <div className="flex flex-wrap gap-1">
            {group.rest.slice(0, thumbCap).map((r, i) => {
              const isLastSlot = i === thumbCap - 1;
              const hidden = group.rest.length - thumbCap;
              if (isLastSlot && hidden > 0) {
                return (
                  <MoreThumb
                    key="more"
                    small={hasPending}
                    count={hidden + 1}
                    onClick={() => onOpen(r)}
                  />
                );
              }
              return <Thumb key={r.id} record={r} small={hasPending} onOpen={() => onOpen(r)} />;
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** O "+N" da tira — mesma caixa do quadrante, sem faixa e sem data. */
function MoreThumb({
  small,
  count,
  onClick,
}: {
  small?: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${small ? "w-[44px]" : "w-[68px] sm:w-[76px]"} shrink-0 text-left`}
    >
      <span
        className={`${small ? SMALL_THUMB_SIZE : THUMB_SIZE} grid place-items-center rounded-[0.25rem] bg-secondary/40 text-[11px] font-bold tabular-nums text-muted-foreground transition-colors hover:bg-secondary/70`}
      >
        +{count}
      </span>
      <span className="mt-1 block text-center text-[8.5px] text-transparent">·</span>
    </button>
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

/**
 * O QUADRANTE, em dois andares: o quadrado com a FAIXA DA CATEGORIA dentro,
 * no topo, e a DATA logo abaixo, fora dele (pedido explícito, 10/09/2026).
 * O antigo pontinho colorido no canto saiu — a faixa diz a mesma coisa e diz
 * melhor, com o nome escrito.
 */
function Thumb({
  record,
  small,
  onOpen,
}: {
  record: AccountRecord;
  small?: boolean;
  onOpen: () => void;
}) {
  const meta = CATEGORY_BY_KEY.get(record.category);
  const open = record.taskStatus === "pending";
  const bandH = small ? "h-3.5" : "h-4";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={recordTitle(record)}
      className={`${small ? "w-[44px]" : "w-[68px] sm:w-[76px]"} shrink-0 text-left transition-opacity hover:opacity-80`}
    >
      <span
        className={`${small ? SMALL_THUMB_SIZE : THUMB_SIZE} relative grid place-items-center overflow-hidden rounded-[0.25rem] bg-gradient-to-br from-secondary/70 to-secondary/30 ${
          small ? "pt-3.5" : "pt-4"
        }`}
      >
        <RecordCover record={record} size={small ? "xs" : "sm"} />
        <span
          className={`absolute inset-x-0 top-0 ${bandH} flex items-center justify-center font-extrabold uppercase ${
            small ? "px-0.5 text-[6.5px] tracking-[0.01em]" : "px-1 text-[7px] tracking-[0.02em]"
          } ${CATEGORY_BAND[record.category] ?? CATEGORY_BAND.other}`}
        >
          {/* O `truncate` mora no FILHO: num flex centralizado, reticências no
              container não cortam nada — o texto vaza pelos dois lados. */}
          <span className="truncate">{meta?.short ?? "Registro"}</span>
        </span>
        {open && (
          <span
            className="absolute inset-x-0 bottom-0 h-[3px] bg-rose-500"
            aria-label="Em aberto"
          />
        )}
      </span>
      <span className="mt-1 block text-center text-[8.5px] tabular-nums text-muted-foreground">
        {fmtShortDate(record.createdAt)}
      </span>
    </button>
  );
}

/**
 * O VISUALIZADOR (mockup aprovado, 10/09/2026).
 *
 * Três decisões moldam esta folha:
 *
 *  1. PALCO DE ALTURA FIXA. Vídeo vertical, vídeo horizontal, foto quadrada,
 *     áudio e nota abrem todos do mesmo tamanho. A folha parava de ser a
 *     mesma coisa a cada registro — pulava de altura e reposicionava os
 *     botões debaixo do dedo.
 *  2. FUNDO FOSCO. A mídia entra INTEIRA (`object-contain`) e o vão que
 *     sobraria como tarja preta recebe uma cópia dela mesma, borrada e
 *     escurecida. Onde a mídia preenche o palco, não há fosco nenhum.
 *  3. TÍTULO E DESCRIÇÃO ABAIXO da mídia, nunca por cima: sobre a imagem o
 *     texto some assim que o vídeo escurece.
 */
const VIEWER_STAGE = "h-[250px]";

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
      <DialogContent
        className="w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border-border/60 bg-card/95 p-0 backdrop-blur-xl sm:w-full sm:max-w-md"
        aria-describedby={undefined}
      >
        {record && <RecordViewerBody record={record} onDelete={onDelete} />}
      </DialogContent>
    </Dialog>
  );
}

function RecordViewerBody({
  record,
  onDelete,
}: {
  record: AccountRecord;
  onDelete: (id: string) => void;
}) {
  const meta = CATEGORY_BY_KEY.get(record.category);
  const { title, description } = recordText(record);
  const stay = fmtStayRange(record.checkinDate, record.checkoutDate);
  // Linha da reserva: hóspede · código · datas, sem os separadores dos
  // pedaços que não existem.
  const reservationLine =
    [record.guestName, record.reservationCode, stay].filter(Boolean).join(" · ") ||
    "Sem reserva vinculada";

  return (
    <>
      <DialogHeader className="space-y-0 px-3.5 pb-2.5 pr-11 pt-3.5 text-left">
        {/* Uma linha com reticências (pedido explícito): o nome do anúncio é
            longo e, em duas linhas, empurrava a folha inteira. */}
        <DialogTitle className="ds-card-title">{record.propertyName}</DialogTitle>
        {record.ownerName && (
          <span className={`mt-0.5 block truncate text-[10.5px] ${CARD_OWNER}`}>
            {record.ownerName}
          </span>
        )}
        <span className="mt-1 block truncate text-[10px] text-muted-foreground">
          {reservationLine}
        </span>
      </DialogHeader>

      <div className={`relative ${VIEWER_STAGE} overflow-hidden bg-black`}>
        <ViewerStage record={record} />
        <span
          className={`absolute left-2.5 top-2.5 z-10 inline-flex items-center gap-1 rounded-[0.25rem] px-1.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.06em] backdrop-blur ${
            CATEGORY_BAND[record.category] ?? CATEGORY_BAND.other
          }`}
        >
          {meta?.label ?? "Registro"}
        </span>
      </div>

      <div className="px-3.5 pb-3 pt-3">
        <p className="text-[13px] font-bold leading-snug">{title}</p>
        {description && (
          <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5 text-[9.5px] text-muted-foreground">
          <b className="font-bold text-foreground/80">{record.createdByName ?? "Equipe"}</b>
          {record.cardMode && (
            <>
              <span className="opacity-45">·</span>
              <span>via {MODE_LABEL[record.cardMode]}</span>
            </>
          )}
          <span className="opacity-45">·</span>
          <span className="tabular-nums">
            {new Date(record.createdAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {!!record.sizeBytes && (
            <>
              <span className="opacity-45">·</span>
              <span>{fmtSize(record.sizeBytes)}</span>
            </>
          )}
          {record.taskId && (
            <span
              className={`ml-auto shrink-0 rounded-[0.25rem] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.04em] ${
                record.taskStatus === "pending"
                  ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                  : record.taskStatus === "canceled"
                    ? "bg-muted-foreground/15 text-muted-foreground"
                    : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {record.taskStatus === "pending"
                ? "Em aberto"
                : record.taskStatus === "canceled"
                  ? "Cancelada"
                  : "Resolvida"}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 px-3.5 pb-3.5">
        {record.url && (
          <a
            href={record.url}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-[0.3rem] bg-foreground/[0.06] py-2 text-center text-[10.5px] font-bold text-foreground/80 transition-colors hover:bg-foreground/10"
          >
            Baixar
          </a>
        )}
        <button
          type="button"
          onClick={() => onDelete(record.id)}
          className="flex-1 rounded-[0.3rem] bg-foreground/[0.06] py-2 text-center text-[10.5px] font-bold text-foreground/80 transition-colors hover:bg-foreground/10"
        >
          Excluir
        </button>
      </div>
    </>
  );
}

/** O conteúdo do palco, por tipo. */
function ViewerStage({ record }: { record: AccountRecord }) {
  if (record.kind === "photo" && record.url) {
    return (
      <>
        <div
          aria-hidden
          className="absolute -inset-5 scale-110 bg-cover bg-center blur-2xl brightness-[.55] saturate-125"
          style={{ backgroundImage: `url(${JSON.stringify(record.url)})` }}
        />
        <img src={record.url} alt="" className="relative size-full object-contain" />
      </>
    );
  }
  if (record.kind === "video" && record.url) {
    return (
      <>
        {/* O fosco é o PRÓPRIO vídeo, parado no primeiro quadro. Só metadados
            são baixados aqui — o arquivo inteiro é do player da frente. */}
        <video
          aria-hidden
          src={`${record.url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          className="pointer-events-none absolute -inset-5 size-[calc(100%+2.5rem)] scale-110 object-cover blur-2xl brightness-[.55] saturate-125"
        />
        <video
          src={record.url}
          controls
          playsInline
          preload="metadata"
          className="relative size-full object-contain"
        />
      </>
    );
  }
  if (record.kind === "audio" && record.url) {
    return (
      <div className="grid size-full place-items-center bg-gradient-to-br from-secondary/60 to-secondary/20 px-5">
        <div className="w-full max-w-[16rem]">
          <AudioPlayer url={record.url} durationMs={record.durationMs} />
        </div>
      </div>
    );
  }
  if (record.kind === "note") {
    return (
      <div className="sg-elegant-scroll size-full overflow-y-auto bg-gradient-to-br from-secondary/60 to-secondary/20 px-4 py-4">
        <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground/90">
          {record.body}
        </p>
      </div>
    );
  }
  return (
    <div className="grid size-full place-items-center gap-2 bg-gradient-to-br from-secondary/60 to-secondary/20 text-muted-foreground">
      <FileText className="size-8" />
    </div>
  );
}

/** "1,2 MB" — mesmo formato do rodapé da linha do tempo da reserva. */
function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
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
            {CARDS.map((c) => (
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
