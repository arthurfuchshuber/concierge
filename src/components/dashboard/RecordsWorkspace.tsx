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
  Pencil,
  SlidersHorizontal,
  StickyNote,
  Video,
  Maximize2,
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
import { MediaLightbox } from "@/components/dashboard/MediaLightbox";
import { DictationField } from "@/components/dashboard/RecordSituationSheet";
import { CATEGORY_BY_KEY, MODE_LABEL, fmtDayLabel } from "@/components/dashboard/record-categories";
import { listTaskLinkOptions, setTaskStatus } from "@/lib/tasks.functions";
import {
  RECORD_TITLE_MAX,
  deleteReservationRecord,
  listAccountRecords,
  updateRecordText,
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
 * título e o RESTO vira descrição. É reversível: no dia em que existir um campo
 * próprio de título, ele simplesmente passa na frente daqui.
 *
 * REGRA DA CASA (pedido explícito, 10/09/2026): "todo e qualquer registro
 * precisa ter um título curto e uma descrição sobre o assunto... deve-se
 * priorizar mostrar o título e não o nome do arquivo na página principal".
 * Por isso o NOME DO ARQUIVO NUNCA vira título aqui — ele é identificador
 * (CASACHARM-01), não assunto, e vive na meta do visualizador. Sem título
 * gravado a linha diz "Sem título", que é a verdade e cobra o preenchimento.
 */
const UNTITLED = "Sem título";

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
  return { title: UNTITLED, description: null };
}

function recordTitle(r: AccountRecord): string {
  return recordText(r).title;
}

/** Falso quando o título exibido é o marcador de ausência, não texto da pessoa. */
function hasTitle(r: AccountRecord): boolean {
  return recordTitle(r) !== UNTITLED;
}

/**
 * A FAIXA DA CATEGORIA dentro do quadrante (pedido explícito, 10/09/2026):
 * mesma cor da categoria, translúcida, com o texto na versão clara dela. Fica
 * de ponta a ponta no topo do quadrado, centralizada — sobre foto ou vídeo a
 * translucidez deixa a imagem aparecer por baixo.
 */
/** A mesma cor, sólida — para quando a etiqueta fica SOBRE uma imagem. */
const CATEGORY_SOLID: Record<RecordCategory, string> = {
  forgotten: "bg-orange-600",
  damage: "bg-rose-600",
  cleaning_audit: "bg-violet-600",
  maintenance: "bg-sky-600",
  other: "bg-zinc-600",
};

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
  /**
   * ACERVO RECOLHIDO POR PADRÃO, UM DE CADA VEZ (pedido explícito,
   * 10/09/2026). A tela abre mostrando só o que há para EXECUTAR; as
   * miniaturas de prova ficam a um toque. E abrir um imóvel fecha o anterior,
   * senão a página volta a ser uma parede de quadradinhos.
   */
  const [openStrip, setOpenStrip] = useState<string | null>(null);
  const [opened, setOpened] = useState<AccountRecord | null>(null);
  const [resolving, setResolving] = useState<AccountRecord | null>(null);

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

  /**
   * TODO REGISTRO CHEGA COM `media` — nem que seja uma lista de um.
   *
   * A aba quebrou em produção (10/09/2026) porque o servidor respondeu com o
   * formato ANTIGO, de antes das situações com várias mídias, enquanto a tela
   * já era a nova: `record.media.length` num `undefined` derruba a página
   * inteira no ErrorComponent da raiz. Normalizar aqui, na porta de entrada,
   * é mais barato e mais seguro do que espalhar `?.` por toda a tela — e a
   * tela volta a funcionar sozinha assim que o servidor alcançar.
   */
  const records = useMemo<AccountRecord[]>(
    () =>
      (q.data?.records ?? []).map((r) =>
        Array.isArray(r.media)
          ? r
          : {
              ...r,
              media: r.storagePath
                ? [
                    {
                      id: r.id,
                      kind: r.kind,
                      storagePath: r.storagePath,
                      url: r.url,
                      mime: r.mime,
                      durationMs: r.durationMs,
                      sizeBytes: r.sizeBytes,
                      createdAt: r.createdAt,
                    },
                  ]
                : [],
            },
      ),
    [q.data],
  );
  const counts = q.data?.counts;

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
              onResolve={setResolving}
              stripOpen={openStrip === g.key}
              onToggleStrip={() => setOpenStrip((cur) => (cur === g.key ? null : g.key))}
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
        onResolve={() => {
          // Fecha o visualizador antes: dois diálogos empilhados prendem o
          // foco um no outro e o "voltar" do celular fecha os dois.
          const r = opened;
          setOpened(null);
          setResolving(r);
        }}
        onEdited={() => {
          setOpened(null);
          qc.invalidateQueries({ queryKey: ["account-records"] });
        }}
      />

      <ResolveDialog
        record={resolving}
        owners={optionsQ.data?.owners ?? []}
        providers={optionsQ.data?.providers ?? []}
        onClose={() => setResolving(null)}
        onDone={() => {
          setResolving(null);
          void qc.invalidateQueries({ queryKey: ["account-records"] });
        }}
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
  tone,
  active,
  loading,
  onClick,
}: {
  label: string;
  count: number;
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
/**
 * A FAIXA LATERAL DO CARTÃO DO IMÓVEL (pedido explícito, 10/09/2026).
 *
 * Mesma barra de 3px dos cards do Kanban, mas dizendo outra coisa: aqui ela
 * responde "o que mais tem neste imóvel?" antes de a pessoa ler qualquer
 * linha. A cor é a da CATEGORIA MAIS FREQUENTE entre os registros daquele
 * imóvel, com UMA exceção pedida pelo cliente:
 *
 *   "só nunca usar a cor da auditoria de limpeza quando tiver registro de
 *    outras categorias junto. só usar a cor da auditoria da limpeza quando só
 *    tiver isso no imóvel"
 *
 * Faz sentido: auditoria é ROTINA — todo imóvel limpo gera vídeo, então ela
 * ganharia quase sempre na contagem e a faixa viraria uma fileira roxa que não
 * informa nada. Tirando-a da disputa, a faixa passa a mostrar o que exige
 * atenção; roxo então significa exatamente "aqui só há prova de limpeza, nada
 * pendente".
 *
 * Empate: vence a mais grave — dano, depois manutenção, depois esquecidos,
 * depois outros.
 */
/**
 * O DEGRADÊ MORA DENTRO DA BARRA (pedido explícito, 10/09/2026).
 *
 * A primeira tentativa deixava a cor sangrar para dentro do cartão e o
 * cliente cortou na hora: "eu não quero que a cor vaze para o quadrante, eu
 * só quero que o efeito da barra conceda uma leveza na cor, sem torná-la
 * gritante".
 *
 * Então a faixa continua sendo SÓ a faixa — nada invade o conteúdo. O que
 * mudou é que ela deixou de ser um bloco chapado: cheia na quina de fora e
 * dissolvendo até quase transparente do lado de dentro. De longe continua
 * dizendo a cor; de perto é um fio de luz, não um adesivo.
 *
 * Dois botões de ajuste, se quiser calibrar: a LARGURA (`w-[4px]`) e a
 * OPACIDADE das duas pontas do degradê.
 */
const STRIPE_GRADIENT: Record<RecordCategory, string> = {
  damage: "from-rose-500/80 to-rose-500/15",
  maintenance: "from-sky-500/80 to-sky-500/15",
  forgotten: "from-amber-400/80 to-amber-400/15",
  other: "from-zinc-400/70 to-zinc-400/10",
  cleaning_audit: "from-violet-500/80 to-violet-500/15",
};

/** Ordem de desempate, da mais grave para a menos. */
const STRIPE_PRIORITY: RecordCategory[] = ["damage", "maintenance", "forgotten", "other"];

function stripeCategory(records: ReadonlyArray<AccountRecord>): RecordCategory | null {
  if (records.length === 0) return null;
  const count = new Map<RecordCategory, number>();
  for (const r of records) count.set(r.category, (count.get(r.category) ?? 0) + 1);

  // Auditoria de limpeza fica FORA da disputa enquanto houver qualquer outra
  // categoria no imóvel.
  let best: RecordCategory | null = null;
  let bestCount = 0;
  for (const key of STRIPE_PRIORITY) {
    const n = count.get(key) ?? 0;
    if (n > bestCount) {
      best = key;
      bestCount = n;
    }
  }
  if (best) return best;
  return (count.get("cleaning_audit") ?? 0) > 0 ? "cleaning_audit" : null;
}

function PropertyCard({
  group,
  onOpen,
  onResolve,
  stripOpen,
  onToggleStrip,
}: {
  group: Group;
  onOpen: (r: AccountRecord) => void;
  onResolve: (r: AccountRecord) => void;
  /** Acervo aberto? Quem decide é a página — só um imóvel por vez. */
  stripOpen: boolean;
  onToggleStrip: () => void;
}) {
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

  // A faixa lê o cartão INTEIRO — pendências e acervo —, não só o que está
  // visível depois do corte das 3 linhas.
  const stripe = stripeCategory([...group.pending, ...group.rest]);

  return (
    <div className="ds-3d relative overflow-hidden rounded-[0.3rem] bg-card p-3">
      {stripe && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 left-0 w-[4px] bg-gradient-to-r ${STRIPE_GRADIENT[stripe]}`}
        />
      )}
      {/* `relative` mantém o conteúdo acima da faixa: elemento posicionado
          pinta por cima de irmão não posicionado, mesmo vindo antes no DOM. */}
      <div className="relative">
        {/* A ETIQUETA DIVIDE A LINHA DO TÍTULO, não o bloco de duas linhas
          (pedido explícito, 10/09/2026) — é a mesma correção já feita no
          cabeçalho das páginas: centrada no bloco inteiro, ela caía na altura
          do vão entre o nome do imóvel e o proprietário e ficava visivelmente
          baixa. Dentro da mesma linha, o alinhamento é exato por construção. */}
        {/* A etiqueta de contagem saiu do topo (pedido explícito, 10/09/2026):
            a linha "Pendências" logo abaixo já diz o mesmo número, e repetir no
            mesmo cartão só roubava largura do nome do imóvel. */}
        <span className="ds-card-title block">{group.label}</span>
        {group.sublabel && (
          <span className={`mt-0.5 block truncate text-[10.5px] ${CARD_OWNER}`}>
            {group.sublabel}
          </span>
        )}

        {hasPending && (
          <>
            {/* MESMA FONTE de "Registros" (pedido explícito, 10/09/2026) — e
                SÓ a fonte: a cor continua sendo a de alerta ("mandei apenas
                manter na mesma fonte... a cor precisa continuar sendo a
                anterior"). O nome virou "Pendências", como a operação já chama
                no Kanban. */}
            <div className="mb-1 mt-2.5 flex items-center gap-2">
              <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-[0.11em] text-rose-600 dark:text-rose-400">
                Pendências
              </span>
              <span className="h-px flex-1 bg-border" />
              <span className="shrink-0 text-[9px] font-bold tabular-nums text-muted-foreground">
                {group.pending.length}
              </span>
            </div>
            {(showAllPending ? group.pending : group.pending.slice(0, PENDING_ROWS)).map((r) => (
              <PendingRow
                key={r.id}
                record={r}
                onOpen={() => onOpen(r)}
                onResolve={() => onResolve(r)}
              />
            ))}
            {hiddenPending > 0 && (
              <button
                type="button"
                onClick={() => setShowAllPending((v) => !v)}
                aria-expanded={showAllPending}
                className="mt-1 w-full rounded-[0.25rem] py-1 text-center text-[10px] font-bold text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
              >
                {showAllPending ? "Mostrar menos" : `+${hiddenPending} pendências`}
              </button>
            )}
          </>
        )}

        {group.rest.length > 0 && (
          <>
            {/* A ETIQUETA DE "REGISTROS" EXISTE SEMPRE (pedido explícito,
              10/09/2026), com o fio e a contagem à direita — a mesma forma de
              "Pendências". Antes ela só aparecia quando havia pendências, e o
              cartão sem pendência ficava com uma tira de quadrados sem nome.
              Com ela, a contagem some do canto superior: dizer o mesmo número
              duas vezes no mesmo cartão não ajuda ninguém. */}
            {/* A LINHA INTEIRA É O BOTÃO (pedido explícito, 10/09/2026):
                "a expansividade tem que acontecer ao clicar em cima da
                palavra, linha ou número" — e SEM seta, que o cliente cortou.
                O acervo abre RECOLHIDO e só um imóvel fica aberto por vez;
                quem controla isso é a página, não o cartão. */}
            <button
              type="button"
              onClick={onToggleStrip}
              aria-expanded={stripOpen}
              className="mb-1 mt-2.5 flex w-full items-center gap-2 text-left"
            >
              <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-[0.11em] text-muted-foreground">
                Registros
              </span>
              <span className="h-px flex-1 bg-border" />
              <span className="shrink-0 text-[9px] font-bold tabular-nums text-muted-foreground">
                {group.rest.length}
              </span>
            </button>
            {/* Miniaturas de tamanho FIXO, não de largura proporcional: em
              colunas elásticas elas viravam quadrados gigantes no desktop. */}
            {stripOpen && (
              <div className="flex flex-wrap gap-1 pt-1.5">
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
                  return (
                    <Thumb key={r.id} record={r} small={hasPending} onOpen={() => onOpen(r)} />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
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

/**
 * Uma pendência do cartão: miniatura, título legível, data — e, ABAIXO DA
 * DATA, o quadradinho que resolve (pedido explícito, 10/09/2026).
 *
 * A linha deixou de ser um botão só: um checkbox dentro de um botão não é
 * clicável de forma previsível (nem é HTML válido). Agora são dois alvos
 * lado a lado — o corpo abre o registro, o quadradinho abre a resolução.
 */
function PendingRow({
  record,
  onOpen,
  onResolve,
}: {
  record: AccountRecord;
  onOpen: () => void;
  onResolve?: () => void;
}) {
  const meta = CATEGORY_BY_KEY.get(record.category);
  return (
    <div className="flex w-full items-start gap-2 border-t border-border/50 py-1.5 first:border-t-0">
      {/* O QUADRANTE FICA CENTRADO no bloco título + subtítulo (pedido
          explícito, 10/09/2026): ele é mais alto que uma linha, e alinhado ao
          topo sobrava um degrau embaixo. A DATA continua alinhada à linha do
          título — por isso o `items-start` fica só na linha de fora. */}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:opacity-80"
      >
        <span className="relative grid size-[34px] shrink-0 place-items-center overflow-hidden rounded-[0.25rem] bg-gradient-to-br from-secondary/70 to-secondary/30">
          <RecordCover record={record} size="xs" />
          <span className={`absolute inset-x-0 bottom-0 h-[3px] ${meta?.dot ?? "bg-muted"}`} />
          {(record.media?.length ?? 0) > 1 && (
            <span
              className="absolute right-0 top-0 grid h-[12px] min-w-[12px] place-items-center rounded-bl-[0.25rem] bg-black/65 px-0.5 text-[7.5px] font-extrabold tabular-nums text-white"
              aria-label={`${record.media?.length ?? 0} mídias`}
            >
              {record.media?.length ?? 0}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[11.5px] font-semibold leading-tight ${
              hasTitle(record) ? "" : "italic text-muted-foreground"
            }`}
          >
            {recordTitle(record)}
          </span>
          <span className="mt-0.5 block truncate text-[9.5px] leading-tight text-muted-foreground">
            {meta?.short ?? "Registro"}
            {record.createdByName ? ` · ${record.createdByName}` : ""}
            {record.cardMode ? ` · ${MODE_LABEL[record.cardMode].toLowerCase()}` : ""}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {/* Alinhada à LINHA DO TÍTULO, não ao centro da linha inteira. */}
        <span className="text-[9.5px] leading-tight tabular-nums text-muted-foreground">
          {fmtShortDate(record.createdAt)}
        </span>
        {onResolve && (
          <button
            type="button"
            onClick={onResolve}
            aria-label="Marcar como resolvido"
            title="Marcar como resolvido"
            className="grid size-[15px] place-items-center rounded-[3px] border border-muted-foreground/60 transition-colors hover:border-emerald-500 hover:bg-emerald-500/15"
          />
        )}
      </div>
    </div>
  );
}

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
        {/* UMA SITUAÇÃO COM VÁRIAS MÍDIAS: o número avisa que tem mais coisa
            ali dentro — sem ele, quatro fotos viram um quadrado só e ninguém
            desconfia. */}
        {(record.media?.length ?? 0) > 1 && (
          <span
            /* Acima da barra de "em aberto" (3px), nunca em cima dela. */
            className={`absolute right-[3px] grid min-w-[14px] place-items-center rounded-full bg-black/65 px-1 font-extrabold tabular-nums text-white ${
              small ? "bottom-[5px] h-[12px] text-[7.5px]" : "bottom-[6px] h-[14px] text-[8px]"
            }`}
            aria-label={`${record.media?.length ?? 0} mídias`}
          >
            {record.media?.length ?? 0}
          </span>
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
  onResolve,
  onEdited,
}: {
  record: AccountRecord | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onResolve?: () => void;
  onEdited?: () => void;
}) {
  return (
    <Dialog open={!!record} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border-border/60 bg-card/95 p-0 backdrop-blur-xl sm:w-full sm:max-w-md"
        aria-describedby={undefined}
      >
        {record && (
          <RecordViewerBody
            record={record}
            onDelete={onDelete}
            onResolve={onResolve}
            onEdited={onEdited}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * EDITAR O TEXTO DE UM REGISTRO JÁ GRAVADO.
 *
 * Decisão do cliente (10/09/2026): "pode manter 'Sem título informado', mas
 * com a possibilidade do usuário/prestador editar posteriormente". Os mesmos
 * dois campos da folha da situação, com o mesmo microfone — quem registrou
 * falando não tem por que ter de digitar para corrigir.
 */
function RecordTextEditor({
  record,
  initialTitle,
  initialDescription,
  onCancel,
  onSaved,
}: {
  record: AccountRecord;
  initialTitle: string;
  initialDescription: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const updateFn = useServerFn(updateRecordText);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const requiresTitle = !!CATEGORY_BY_KEY.get(record.category)?.createsTask;

  async function save() {
    if (saving || (requiresTitle && !title.trim())) return;
    setSaving(true);
    try {
      await updateFn({
        data: { id: record.id, title: title.trim(), description: description.trim() || null },
      });
      toast.success("Registro atualizado.");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message || "Não consegui salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <DictationField
        label="Título"
        required={requiresTitle}
        value={title}
        onChange={setTitle}
        placeholder="Em poucas palavras, o que houve"
        propertyId={record.propertyId}
        maxLength={RECORD_TITLE_MAX}
      />
      <DictationField
        label="Descrição"
        value={description}
        onChange={setDescription}
        placeholder="Onde, desde quando, o que precisa ser feito"
        propertyId={record.propertyId}
        multiline
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-[0.3rem] px-2.5 py-1.5 text-[10.5px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Cancelar
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={save}
          disabled={saving || (requiresTitle && !title.trim())}
          className="rounded-[0.3rem] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-3 py-1.5 text-[10.5px] font-bold text-white disabled:from-muted disabled:to-muted disabled:text-muted-foreground"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}

function RecordViewerBody({
  record,
  onDelete,
  onResolve,
  onEdited,
}: {
  record: AccountRecord;
  onDelete: (id: string) => void;
  onResolve?: () => void;
  onEdited?: () => void;
}) {
  const meta = CATEGORY_BY_KEY.get(record.category);
  const { title, description } = recordText(record);
  const stay = fmtStayRange(record.checkinDate, record.checkoutDate);
  // Linha da reserva: hóspede · código · datas, sem os separadores dos
  // pedaços que não existem.
  const reservationLine =
    [record.guestName, record.reservationCode, stay].filter(Boolean).join(" · ") ||
    "Sem reserva vinculada";

  /* UMA SITUAÇÃO PODE TER VÁRIAS MÍDIAS (10/09/2026). O palco mostra uma de
     cada vez e a fileira embaixo troca — registro antigo, de uma mídia só,
     não ganha fileira nenhuma e continua igual. */
  const media = record.media?.length
    ? record.media
    : [
        {
          id: record.id,
          kind: record.kind,
          url: record.url,
          durationMs: record.durationMs,
          mime: record.mime,
          sizeBytes: record.sizeBytes,
          storagePath: record.storagePath,
          createdAt: record.createdAt,
        },
      ];
  const [idx, setIdx] = useState(0);
  /* TELA CHEIA (11/09/2026). O palco do registro serve para reconhecer a
     mídia; para EXAMINAR — um risco na parede, a placa de um carro no vídeo de
     auditoria — é preciso a tela inteira e zoom. Ver `MediaLightbox`. */
  const [cheia, setCheia] = useState(false);
  const current = media[Math.min(idx, media.length - 1)];
  const [editing, setEditing] = useState(false);

  return (
    <>
      {/* CABEÇALHO EM UMA LINHA CADA (pedido explícito, repetido 3x).
          Duas coisas seguravam o título em duas linhas:
            · `text-lg` do `DialogTitle` do Radix, que vencia o `ds-card-title`
              — resolvido com um `text-[13.5px]` explícito, que o `twMerge`
              reconhece e usa para descartar o `text-lg`;
            · a regra global `text-wrap: pretty` dos `h1..h6` em styles.css,
              que, fora de `@layer`, vencia o `truncate` e reativava a quebra
              (`text-wrap` é atalho de `text-wrap-mode`). Lá agora é
              `text-wrap-style`, que não mexe em quebrar/não quebrar.
          Com o título em uma linha o cabeçalho encolheu; o `pt`/`pb` foram
          junto. */}
      <DialogHeader className="space-y-0 px-3.5 pb-1.5 pr-11 pt-2.5 text-left">
        <DialogTitle className="ds-card-title block w-full truncate text-[13.5px] leading-tight">
          {record.propertyName}
        </DialogTitle>
        {record.ownerName && (
          <span className={`block truncate text-[10.5px] leading-tight ${CARD_OWNER}`}>
            {record.ownerName}
          </span>
        )}
        <span className="block truncate text-[10px] leading-tight text-muted-foreground">
          {reservationLine}
        </span>
      </DialogHeader>

      <div className={`relative ${VIEWER_STAGE} overflow-hidden bg-black`}>
        <ViewerStage record={current} />
        {/* A mídia inteira abre a tela cheia. Fica ATRÁS das etiquetas e do
            player de vídeo (z-0), então nem o controle do vídeo nem os
            selos perdem o clique. */}
        {(current.kind === "photo" || current.kind === "video") && current.url && (
          <>
            {current.kind === "photo" && (
              <button
                type="button"
                onClick={() => setCheia(true)}
                aria-label="Abrir em tela cheia"
                className="absolute inset-0 z-0 cursor-zoom-in"
              />
            )}
            <button
              type="button"
              onClick={() => setCheia(true)}
              aria-label="Abrir em tela cheia"
              className="absolute bottom-2.5 left-2.5 z-10 grid size-[30px] place-items-center rounded-[0.45rem] border border-white/25 bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
            >
              <Maximize2 className="size-[15px]" strokeWidth={2} />
            </button>
          </>
        )}
        {/* Aqui a etiqueta fica SOBRE a mídia, então ela é sólida (pedido
            explícito): translúcida, sumia contra uma foto clara. Nos
            quadrantes da lista ela segue translúcida — lá não há imagem
            atrás. */}
        <span
          className={`absolute left-2.5 top-2.5 z-10 inline-flex items-center gap-1 rounded-[0.25rem] px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.06em] text-white shadow-sm ${
            CATEGORY_SOLID[record.category] ?? CATEGORY_SOLID.other
          }`}
        >
          {meta?.label ?? "Registro"}
        </span>
        {/* SITUAÇÃO DA PENDÊNCIA no canto oposto à categoria (pedido
            explícito, 10/09/2026). Ela vivia lá embaixo, na ficha, empurrando
            a linha de dados para duas alturas; aqui em cima é lida junto com
            a categoria e não ocupa altura nenhuma. */}
        {record.taskId && (
          <span
            className={`absolute right-2.5 top-2.5 z-10 rounded-[0.25rem] px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.06em] text-white shadow-sm ${
              record.taskStatus === "pending"
                ? "bg-rose-600"
                : record.taskStatus === "canceled"
                  ? "bg-zinc-600"
                  : "bg-emerald-600"
            }`}
          >
            {record.taskStatus === "pending"
              ? "Em aberto"
              : record.taskStatus === "canceled"
                ? "Cancelada"
                : "Resolvida"}
          </span>
        )}
        {media.length > 1 && (
          /* O contador desceu para o pé do palco: em cima ele brigava com a
             situação da pendência. */
          <span className="absolute bottom-2.5 right-2.5 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-extrabold tabular-nums text-white">
            {Math.min(idx, media.length - 1) + 1} / {media.length}
          </span>
        )}
      </div>

      {cheia && (
        <MediaLightbox
          media={media.map((m) => ({ id: m.id, kind: m.kind, url: m.url, mime: m.mime }))}
          startIndex={Math.min(idx, media.length - 1)}
          categoryLabel={meta?.label ?? null}
          categoryClass={CATEGORY_SOLID[record.category] ?? CATEGORY_SOLID.other}
          statusLabel={
            record.taskId
              ? record.taskStatus === "pending"
                ? "Em aberto"
                : record.taskStatus === "canceled"
                  ? "Cancelada"
                  : "Resolvida"
              : null
          }
          statusClass={
            record.taskStatus === "pending"
              ? "bg-rose-600"
              : record.taskStatus === "canceled"
                ? "bg-zinc-600"
                : "bg-emerald-600"
          }
          fileBaseName={record.fileName}
          onClose={() => setCheia(false)}
        />
      )}

      {media.length > 1 && (
        <div className="ds-scroll-x flex gap-1.5 px-3.5 pt-2.5">
          {media.map((m, i) => {
            const on = i === Math.min(idx, media.length - 1);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Mídia ${i + 1}`}
                className={`relative grid size-[44px] shrink-0 place-items-center overflow-hidden rounded-[0.25rem] bg-gradient-to-br from-secondary/70 to-secondary/30 ${
                  on ? "outline outline-2 -outline-offset-2 outline-[#E82DAE]" : "opacity-70"
                }`}
              >
                {m.kind === "photo" && m.url ? (
                  <img src={m.url} alt="" className="size-full object-cover" />
                ) : (
                  <RecordCover record={{ ...record, kind: m.kind }} size="xs" />
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-3.5 pb-3 pt-3">
        {editing ? (
          /* EDITAR DEPOIS (decisão do cliente, 10/09/2026): o registro que
             nasceu sem título — ou com o título errado — se conserta aqui,
             sem passar pela captura de novo. */
          <RecordTextEditor
            record={record}
            initialTitle={hasTitle(record) ? title : ""}
            initialDescription={description ?? ""}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              onEdited?.();
            }}
          />
        ) : (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p
                className={`text-[13px] font-bold leading-snug ${
                  hasTitle(record) ? "" : "italic text-muted-foreground"
                }`}
              >
                {title}
              </p>
              {description && (
                <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Editar título e descrição"
              title="Editar título e descrição"
              className="grid size-[26px] shrink-0 place-items-center rounded-[0.3rem] bg-foreground/[0.06] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <Pencil className="size-3.5" />
            </button>
          </div>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5 text-[9.5px] text-muted-foreground">
          {/* O nome do arquivo é IDENTIFICADOR, não assunto: saiu do título e
              vive aqui, junto com autor, hora e tamanho. */}
          {record.fileName && (
            <>
              <span className="font-bold tabular-nums text-foreground/70">{record.fileName}</span>
              <span className="opacity-45">·</span>
            </>
          )}
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
        </div>
      </div>

      <div className="flex gap-1.5 px-3.5 pb-3.5">
        {current.url && (
          <a
            href={current.url}
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
        {/* "Resolvido" só existe quando há o que resolver: registro sem
            pendência, ou com a pendência já fechada, não mostra o botão. */}
        {record.taskId && record.taskStatus === "pending" && onResolve && (
          <button
            type="button"
            onClick={onResolve}
            className="flex-1 rounded-[0.3rem] bg-emerald-500/15 py-2 text-center text-[10.5px] font-bold text-emerald-600 transition-colors hover:bg-emerald-500/25 dark:text-emerald-400"
          >
            Resolvido
          </button>
        )}
      </div>
    </>
  );
}

/**
 * DIÁLOGO DE RESOLUÇÃO (pedido explícito, 10/09/2026).
 *
 * Fechar uma pendência levanta duas perguntas que a operação sempre faz
 * depois, quando já esqueceu a resposta: HOUVE CUSTO? e QUEM PAGA? Perguntar
 * no momento em que se resolve é o único jeito de ter isso preenchido.
 *
 * "Quem paga" NÃO é "quem resolveu" — o prestador conserta, mas a conta pode
 * ir para o proprietário ou ficar com a empresa. São duas colunas separadas
 * em `tasks` (`cost_payer` / `cost_payer_id` e `resolved_by_provider_id`).
 *
 * Tudo é opcional: dá para resolver sem informar nada, como antes.
 */
type PayerKind = "company" | "owner" | "provider";

function ResolveDialog({
  record,
  owners,
  providers,
  onClose,
  onDone,
}: {
  record: AccountRecord | null;
  owners: ReadonlyArray<{ id: string; name: string }>;
  providers: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const setStatusFn = useServerFn(setTaskStatus);
  const [hasCost, setHasCost] = useState(false);
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState<PayerKind>("company");
  const [payerId, setPayerId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // Reabre sempre limpo — ninguém espera o formulário da pendência anterior.
  const key = record?.id ?? null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (key !== lastKey) {
    setLastKey(key);
    setHasCost(false);
    setAmount("");
    setPayer("company");
    setPayerId(null);
    setNote("");
  }

  const resolve = useMutation({
    mutationFn: async () => {
      if (!record?.taskId) throw new Error("Este registro não tem pendência.");
      // "1.234,56" e "1234.56" chegam iguais em centavos.
      const cents = hasCost
        ? Math.round(Number(amount.replace(/\./g, "").replace(",", ".")) * 100)
        : null;
      if (hasCost && (!Number.isFinite(cents) || (cents ?? 0) < 0)) {
        throw new Error("Informe um valor válido.");
      }
      await setStatusFn({
        data: {
          taskId: record.taskId,
          status: "done",
          amountSpentCents: cents,
          costPayer: hasCost ? payer : null,
          costPayerId: hasCost && payer !== "company" ? payerId : null,
          // Quem resolveu continua sendo o prestador, quando for ele quem
          // pagou ou executou — é a coluna que a tela de Pendências já lê.
          resolvedByProviderId: payer === "provider" ? payerId : null,
          resolutionNote: note.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Pendência resolvida.");
      onDone();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível resolver."),
  });

  const options = payer === "owner" ? owners : payer === "provider" ? providers : [];
  const needsWho = hasCost && payer !== "company";

  return (
    <Dialog open={!!record} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border-border/60 bg-card/95 p-0 backdrop-blur-xl sm:w-full sm:max-w-sm"
        aria-describedby={undefined}
      >
        <DialogHeader className="space-y-0 px-4 pb-2 pr-11 pt-4 text-left">
          <DialogTitle className="ds-card-title block w-full truncate">
            Resolver pendência
          </DialogTitle>
          {record && (
            <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
              {/* Aqui é identificação, não leitura: sem título, o nome do
                  arquivo diz de qual registro estamos falando. */}
              {hasTitle(record) ? recordTitle(record) : (record.fileName ?? UNTITLED)}
            </span>
          )}
        </DialogHeader>

        <div className="space-y-3 px-4 pb-4">
          <button
            type="button"
            onClick={() => setHasCost((v) => !v)}
            className="flex w-full items-center gap-2 rounded-[0.3rem] bg-foreground/[0.04] px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.08]"
          >
            <Checkbox checked={hasCost} className="pointer-events-none" />
            <span className="text-xs font-medium">Houve custo para resolver</span>
          </button>

          {hasCost && (
            <>
              <label className="block">
                <span className="ds-eyebrow block text-[9.5px] text-muted-foreground">Valor</span>
                <div className="mt-1 flex items-center gap-2 rounded-[0.3rem] bg-foreground/[0.04] px-2.5 py-2">
                  <span className="text-[11px] font-bold text-muted-foreground">R$</span>
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0,00"
                    className="w-full bg-transparent text-[13px] font-semibold tabular-nums outline-none placeholder:text-muted-foreground/60"
                  />
                </div>
              </label>

              <div>
                <span className="ds-eyebrow block text-[9.5px] text-muted-foreground">
                  Quem paga
                </span>
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {(
                    [
                      { key: "company" as const, label: "A empresa" },
                      { key: "owner" as const, label: "Proprietário" },
                      { key: "provider" as const, label: "Prestador" },
                    ] satisfies ReadonlyArray<{ key: PayerKind; label: string }>
                  ).map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => {
                        setPayer(o.key);
                        setPayerId(null);
                      }}
                      className={`rounded-[0.3rem] py-2 text-center text-[10.5px] font-bold transition-colors ${
                        payer === o.key
                          ? "bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
                          : "bg-foreground/[0.04] text-foreground/70 hover:bg-foreground/[0.08]"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {needsWho && (
                <div className="overflow-hidden rounded-[0.3rem] border border-border/60">
                  <Command>
                    <CommandInput
                      placeholder={
                        payer === "owner" ? "Buscar proprietário..." : "Buscar prestador..."
                      }
                    />
                    <CommandList className="sg-elegant-scroll max-h-40">
                      <CommandEmpty>Nenhum cadastrado.</CommandEmpty>
                      <CommandGroup>
                        {options.map((o) => (
                          <CommandItem
                            key={o.id}
                            value={o.name}
                            onSelect={() => setPayerId(o.id)}
                            className="cursor-pointer gap-2"
                          >
                            <Check
                              className={`size-3.5 ${payerId === o.id ? "opacity-100" : "opacity-0"}`}
                            />
                            <span className="truncate">{o.name}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </div>
              )}
            </>
          )}

          <label className="block">
            <span className="ds-eyebrow block text-[9.5px] text-muted-foreground">
              Observação (opcional)
            </span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="O que foi feito"
              className="mt-1 w-full resize-none rounded-[0.3rem] bg-foreground/[0.04] px-2.5 py-2 text-[12px] outline-none placeholder:text-muted-foreground/60"
            />
          </label>

          <div className="flex gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-[0.3rem] bg-foreground/[0.06] py-2 text-center text-[10.5px] font-bold text-foreground/80 transition-colors hover:bg-foreground/10"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={resolve.isPending || (needsWho && !payerId)}
              onClick={() => resolve.mutate()}
              className="flex-1 rounded-[0.3rem] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] py-2 text-center text-[10.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {resolve.isPending ? "Salvando…" : "Confirmar"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** O conteúdo do palco, por tipo. */
function ViewerStage({
  record,
}: {
  /* Uma MÍDIA (a situação pode ter várias) — a forma casa tanto com
     `AccountRecord` quanto com `RecordMedia`. */
  record: {
    kind: AccountRecord["kind"];
    url: string | null;
    durationMs: number | null;
  };
}) {
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
  // NOTA: o palco NÃO repete o texto (pedido explícito, 10/09/2026). Ele
  // aparecia aqui e de novo logo abaixo, como título e descrição — a mesma
  // frase duas vezes, e a de cima ainda ficava escondida atrás da etiqueta.
  if (record.kind === "note") {
    return (
      <div className="grid size-full place-items-center bg-gradient-to-br from-secondary/60 to-secondary/20 text-muted-foreground">
        <StickyNote className="size-8" />
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
