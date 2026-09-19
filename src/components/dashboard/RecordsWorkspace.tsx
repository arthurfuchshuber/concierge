import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  Check,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Mic,
  Pencil,
  LayoutGrid,
  SlidersHorizontal,
  StickyNote,
  Video,
  Maximize2,
} from "lucide-react";
import { toast } from "sonner";
import { useUndoableRecordDelete } from "@/hooks/useUndoableRecordDelete";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";
import { notifyAction } from "@/components/UndoActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useImpersonation } from "@/hooks/useImpersonation";
import {
  PANEL_SHELL,
  PanelHeading,
  SectionLabel,
  CountPill,
  ACTION_SEGMENT,
  ACTION_BUTTON_TONE,
  ACTION_ICON,
} from "@/components/dashboard/panel-chrome";
import { CARD_OWNER } from "@/components/dashboard/card-colors";
import { PendenciasButton } from "@/components/dashboard/pendencias";
import { OperationShell } from "@/components/dashboard/OperationWorkspace";
import { AudioPlayer } from "@/components/dashboard/ReservationRecords";
import { MediaLightbox } from "@/components/dashboard/MediaLightbox";
import { DictationField } from "@/components/dashboard/RecordSituationSheet";
import { CATEGORY_BY_KEY, MODE_LABEL, fmtDayLabel } from "@/components/dashboard/record-categories";
import { listTaskLinkOptions, restoreTask, setTaskStatus } from "@/lib/tasks.functions";
import {
  RECORD_TITLE_MAX,
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
/* PADRÃO "PRESENÇA" (18/09/2026): as cinco categorias usavam cinco cores
   saturadas (laranja, rosa, violeta, azul, cinza). Agora são três tons
   contidos, pela NATUREZA e não pelo nome: rosa terroso para o que é problema
   (dano, manutenção), âmbar queimado para o que pede atenção (esquecidos,
   outros) e verde sálvia para rotina (auditoria de limpeza). */
const CATEGORY_SOLID: Record<RecordCategory, string> = {
  forgotten: "bg-[#c9a962] text-[#1a1408]",
  damage: "bg-[#c98c8c] text-[#1a0a0a]",
  cleaning_audit: "bg-[#7fb79a] text-[#05140d]",
  maintenance: "bg-[#c98c8c] text-[#1a0a0a]",
  other: "bg-muted-foreground text-background",
};

const CATEGORY_BAND: Record<RecordCategory, string> = {
  forgotten: "bg-[#c9a962]/15 text-[#c9a962]",
  damage: "bg-[#c98c8c]/15 text-[#c98c8c]",
  cleaning_audit: "bg-[#7fb79a]/15 text-[#7fb79a]",
  maintenance: "bg-[#c98c8c]/15 text-[#c98c8c]",
  other: "bg-muted-foreground/15 text-muted-foreground",
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
const CARD_ORDER: readonly RecordCategory[] = ["maintenance", "damage", "forgotten", "cleaning_audit", "other"];
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
  /**
   * PENDÊNCIAS TAMBÉM RECOLHIDAS, PELA MESMA REGRA (pedido explícito,
   * 11/09/2026): "coloque também a linha PENDÊNCIAS recolhida seguindo as
   * mesmas regras da linha REGISTROS". Mesma mecânica, estado separado — a
   * linha inteira é o botão, sem seta, e abrir um imóvel fecha o anterior.
   * Separado do acervo de propósito: são duas perguntas diferentes ("o que há
   * para fazer aqui?" e "que provas existem aqui?"), e amarrar as duas faria
   * uma abrir a outra sem ninguém ter pedido.
   */
  const [openPending, setOpenPending] = useState<string | null>(null);
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
  const ownerOptions = useMemo(() => (optionsQ.data?.owners ?? []).map((o) => o.name), [optionsQ.data]);

  /**
   * O filtro de PROPRIETÁRIO vira lista de imóveis antes de ir ao servidor —
   * é o mesmo recorte, e assim os contadores por categoria acompanham o
   * filtro em vez de continuarem contando a conta inteira.
   */
  const propertyIds = useMemo<string[] | null>(() => {
    const byOwner =
      ownerFilters.length > 0 ? linkProperties.filter((p) => p.ownerName && ownerFilters.includes(p.ownerName)) : null;
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
    queryFn: () => listFn({ data: { ownerId: activeOwnerId, category, onlyOpen, days, propertyIds } }),
  });

  // Excluir com "Desfazer" e resposta instantânea (17/09/2026).
  const deleteRecord = useUndoableRecordDelete(() => setOpened(null));

  // AO VIVO PARA TODOS (pedido explícito, 17/09/2026: "tudo que um usuário
  // faz precisa refletir INSTANTANEAMENTE para os demais usuários"): um
  // registro criado, editado ou excluído por outra pessoa, ou uma pendência
  // resolvida, aparece aqui sem recarregar.
  useRealtimeInvalidate(
    "records-live",
    [{ table: "reservation_records" }, { table: "tasks" }, { table: "task_completions" }],
    [["account-records"]],
  );

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

  // Divisão da lista (mockup B, 17/09/2026). No bloco de cima, o imóvel com a
  // pendência MAIS ANTIGA vem primeiro — ali antiguidade é atraso, a mesma
  // regra das linhas dentro do cartão. Embaixo, a ordem de sempre.
  const byProperty = groupBy === "property";
  const attentionGroups = byProperty
    ? groups
        .filter((g) => g.pending.length > 0)
        .sort((a, b) => a.pending[0].createdAt.localeCompare(b.pending[0].createdAt))
    : [];
  const calmGroups = byProperty ? groups.filter((g) => g.pending.length === 0) : groups;
  const attentionCount = attentionGroups.reduce((n, g) => n + g.pending.length, 0);

  const renderCard = (g: Group) => (
    <PropertyCard
      key={g.key}
      group={g}
      onOpen={setOpened}
      onResolve={setResolving}
      stripOpen={openStrip === g.key}
      onToggleStrip={() => setOpenStrip((cur) => (cur === g.key ? null : g.key))}
      pendingOpen={openPending === g.key}
      onTogglePending={() => setOpenPending((cur) => (cur === g.key ? null : g.key))}
    />
  );

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
    <div className="w-full max-w-[1440px] px-3.5 py-5 sm:px-5 lg:px-8 lg:py-8">
      {/* O RESPIRO DA SUBPÁGINA VEM DA REGRA (mockup "Direção A" aprovado,
          18/09/2026). Era `space-y-1.5` — 6px entre TUDO: a barra de abas
          encostava nos cartões, os cartões encostavam no bloco de atenção, e
          a tela inteira lia como um amontoado só. O cliente comparou com o
          Operacional: "veja como você espaçou bem os cards... isso torna o
          visual mais limpo".

          `ds-blocks` (24px, ver `styles.css`) separa os BLOCOS; dentro de
          cada um, o vão continua curto de propósito — o que é da mesma coisa
          continua junto. Os diálogos ficam FORA deste contêiner: eles não
          desenham nada em linha, e como irmãos de um flex abririam um vão
          fantasma no fim da página. */}
      <div className="ds-blocks">
        <OperationShell
          view="registros"
          subtitle={subtitle}
          actions={
            <>
              {/* PENDÊNCIAS MORA AQUI AGORA (pedido explícito, 18/09/2026):
                  veio do Kanban, porque é nesta aba que as pendências já
                  aparecem ("Precisam de atenção") — é aqui que a mão procura.
                  Ver `pendencias.tsx`. */}
              <PendenciasButton ownerId={activeOwnerId} enabled />
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
            </>
          }
        />

        {/* 1 — CONTADORES, em DUAS LINHAS de três (pedido explícito): cinco
          cartões numa linha só deixavam o rótulo cortado ("ESQUECID…",
          "MANUTEN…") justamente nas categorias que mais importam. Em
          `grid-cols-3` sobram três em cima e dois embaixo, com o rótulo
          inteiro. Desde 18/09/2026 os seis são um BLOCO SÓ, com fios internos
          — cada quadrado continua sendo o seu próprio clique. O número não tem
          cor própria (padrão "Presença"): a categoria vive na caixinha do
          ícone e o selecionado ganha luz, não cor. Tocar no selecionado volta
          para "todos". */}
        <div className={`${PANEL_SHELL} grid grid-cols-3`}>
          {/* TODOS é o primeiro cartão e o filtro de entrada da aba (pedido
            explícito, 10/09/2026). Ele não é "mais uma categoria": é a visão
            em que os registros de uma MESMA RESERVA vêm empacotados. */}
          {(() => {
            /* O ÍNDICE SELECIONADO comanda os fios: a célula acesa e as suas
               vizinhas de cima/esquerda escondem o fio que encostaria na
               mancha de seleção — é isso que elimina a "borda" que sobrava
               na direita e embaixo do cartão selecionado. */
            const ativo = category === null ? 0 : CARDS.findIndex((c) => c.key === category) + 1;
            return (
              <>
                <CategoriaCelula i={0} ativo={ativo}>
                  <CategoryCard
                    label="Todos"
                    count={q.data?.total ?? 0}
                    tone={null}
                    icon={LayoutGrid}
                    active={category === null}
                    loading={q.isLoading}
                    onClick={() => setCategory(null)}
                  />
                </CategoriaCelula>
                {CARDS.map((c, i) => (
                  <CategoriaCelula key={c.key} i={i + 1} ativo={ativo}>
                    <CategoryCard
                      label={c.short}
                      count={counts?.[c.key] ?? 0}
                      tone={c.key}
                      icon={c.icon}
                      active={category === c.key}
                      loading={q.isLoading}
                      onClick={() => setCategory(category === c.key ? null : c.key)}
                    />
                  </CategoriaCelula>
                ))}
              </>
            );
          })()}
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
          <div className="ds-blocks">
            {/* PENDÊNCIAS SEMPRE EM CIMA (mockup B aprovado, 17/09/2026): os
              imóveis com pendência aberta sobem para um bloco próprio, com
              borda de luz e o total de pendências; os que estão em dia vêm
              depois de um divisor discreto. Só vale para "Por imóvel" — em
              "Por data" a ordem do dia é a informação e não é quebrada. */}
            {attentionGroups.length > 0 && (
              <section
                aria-label="Imóveis que precisam de atenção"
                /* PADRÃO "PRESENÇA" (18/09/2026): era uma moldura vermelha
                 inteira, com fundo tingido e etiqueta vermelha — gritava mais
                 que o próprio conteúdo. Agora é um card normal, com um FIO no
                 tom rosa terroso na aresta de cima e a contagem numa pílula
                 neutra. Continua sendo a primeira coisa que se vê, sem ser a
                 mais barulhenta. */
                className={`${PANEL_SHELL} px-1.5 pb-1.5 pt-3`}
              >
                <span
                  aria-hidden
                  className="absolute inset-x-3 top-0 h-[2px] rounded-b-[3px] bg-gradient-to-r from-[#c98c8c] to-transparent"
                />
                <div className="space-y-1.5">
                  {/* MESMO CABEÇALHO DE BLOCO das outras duas abas (pedido
                    explícito, 18/09/2026: "não é só replicar a paleta, mas sim
                    o layout inteiro") — ponto, rótulo em caixa alta, fio que
                    some e a contagem na pílula neutra. */}
                  <PanelHeading
                    title="Precisam de atenção"
                    dot={
                      <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-[#c98c8c]/12 text-[#c98c8c]">
                        <CircleAlert className="size-[13px]" strokeWidth={2.2} />
                      </span>
                    }
                    right={
                      <CountPill>
                        {attentionCount} {attentionCount === 1 ? "pendência" : "pendências"}
                      </CountPill>
                    }
                    className="mb-1 px-1.5"
                  />
                  <div className="ds-card-grid">{attentionGroups.map(renderCard)}</div>
                </div>
              </section>
            )}

            {attentionGroups.length > 0 && calmGroups.length > 0 && (
              <SectionLabel className="px-1 pt-0" count={calmGroups.length}>
                Em dia
              </SectionLabel>
            )}

            <div className="ds-card-grid">{calmGroups.map(renderCard)}</div>

            {q.data?.truncated && (
              <p className="pt-1 text-center text-[11px] text-muted-foreground">
                Histórico longo — a lista mostra os mais recentes. Escolher uma categoria ou um período afina o que
                aparece.
              </p>
            )}
          </div>
        )}
      </div>

      <RecordViewerDialog
        record={opened}
        onClose={() => setOpened(null)}
        onDelete={deleteRecord}
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
/* PADRÃO "PRESENÇA" (18/09/2026): o NÚMERO não tem mais cor própria. Seis
   cartões, cada um com o seu tom, era o que fazia esta tela parecer um
   carnaval — e, pior, dava o mesmo peso visual a "31 limpezas" (rotina) e a
   "1 manutenção" (problema). Agora o número é sempre cor de texto e a
   categoria vira um FIO de 2px na aresta de cima do cartão. */
/* A COR DA CATEGORIA MUDOU DE LUGAR (mockup aprovado, 18/09/2026). Era um fio
   de 2px na aresta de cima de cada cartão; com os seis virando um BLOCO só, o
   fio da segunda fileira cairia no meio da peça. Foi para a caixinha do
   ícone, que está sempre dentro da célula e funciona em qualquer posição da
   grade. O mapa é o mesmo de sempre: rosa terroso = problema, âmbar =
   atenção, verde sálvia = rotina em ordem. */
const CARD_ICON_TONE: Record<RecordCategory, string> = {
  maintenance: "#c98c8c",
  damage: "#c98c8c",
  forgotten: "#c9a962",
  cleaning_audit: "#7fb79a",
  other: "#c9a962",
};

/**
 * Uma CÉLULA do bloco de contadores — não é mais um cartão solto.
 *
 * Pedido explícito (18/09/2026): "é possível fazer o mesmo com os cards?
 * separando certinho para que cada quadrado seja clicável naquela
 * informação". Seis cartões com respiro entre eles viraram uma peça única com
 * fios internos; cada quadrado continua sendo o seu próprio clique.
 *
 * O selecionado ganha uma placa POR DENTRO, com respiro da borda: um fundo
 * que fosse até a borda brigaria com o canto arredondado do bloco.
 */
function CategoryCard({
  label,
  count,
  tone,
  icon: Icon,
  active,
  loading,
  onClick,
}: {
  label: string;
  count: number;
  tone: RecordCategory | null;
  icon: React.ElementType;
  active: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const cor = tone && count > 0 ? CARD_ICON_TONE[tone] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="relative flex w-full flex-col px-2 pb-3 pt-3 text-left transition-colors hover:bg-foreground/[0.03]"
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-1 rounded-[9px] bg-foreground/[0.07] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]"
        />
      )}
      <div className="relative flex w-full min-w-0 items-center gap-1.5">
        <span
          className="grid size-5 shrink-0 place-items-center rounded-[7px]"
          style={cor ? { background: `${cor}1f`, color: cor } : undefined}
        >
          <Icon className={`size-3 ${cor ? "" : "text-muted-foreground"}`} strokeWidth={2} />
        </span>
        <span
          className="ds-eyebrow min-w-0 flex-1 truncate text-[8.5px] tracking-[0.04em] text-muted-foreground"
          title={label}
        >
          {label}
        </span>
      </div>
      <span className="relative w-full pt-2 text-center font-display text-[22px] font-bold leading-none tracking-[-0.03em] tabular-nums">
        {loading ? "—" : count}
      </span>
    </button>
  );
}

/** O fio entre as células do bloco. */
const FIO_INTERNO = "bg-[color-mix(in_oklab,var(--foreground)_11%,transparent)]";

/** Envolve cada célula e desenha os fios: vertical à esquerda (menos na 1ª
 *  coluna) e horizontal em cima (só a partir da 2ª fileira). */
function CategoriaCelula({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <div className="relative">
      {i % 3 !== 0 && <span aria-hidden className={`absolute inset-y-2 left-0 w-px ${FIO_INTERNO}`} />}
      {i >= 3 && <span aria-hidden className={`absolute inset-x-2 top-0 h-px ${FIO_INTERNO}`} />}
      {children}
    </div>
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
/* O TRAÇO DE CATEGORIA — 2px na lateral, sumindo nas duas pontas. É o mesmo
   desenho da faixa de limpeza da Operacional (padrão "Presença", 18/09/2026):
   antes era um bloco cheio de 4px correndo a altura toda do cartão, a coisa
   mais colorida da tela depois dos seis cartões de contagem. */
const STRIPE_GRADIENT: Record<RecordCategory, string> = {
  damage: "bg-gradient-to-b from-transparent via-[#c98c8c] to-transparent",
  maintenance: "bg-gradient-to-b from-transparent via-[#c98c8c] to-transparent",
  forgotten: "bg-gradient-to-b from-transparent via-[#c9a962] to-transparent",
  other: "bg-gradient-to-b from-transparent via-muted-foreground to-transparent",
  cleaning_audit: "bg-gradient-to-b from-transparent via-[#7fb79a] to-transparent",
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
  pendingOpen,
  onTogglePending,
}: {
  group: Group;
  onOpen: (r: AccountRecord) => void;
  onResolve: (r: AccountRecord) => void;
  /** Acervo aberto? Quem decide é a página — só um imóvel por vez. */
  stripOpen: boolean;
  onToggleStrip: () => void;
  /** Pendências abertas? Mesma regra do acervo, estado próprio. */
  pendingOpen: boolean;
  onTogglePending: () => void;
}) {
  // "+N a resolver" EXPANDE A PRÓPRIA LISTA (pedido explícito, 10/09/2026).
  // Antes ele recortava a página inteira para aquele imóvel — resolvia, mas
  // custava perder a visão dos outros. Abrir no lugar é mais barato e é o que
  // a pessoa espera de um "+N".
  const [showAllPending, setShowAllPending] = useState(false);
  // Recolher zera o "+N": reabrir depois mostrando a lista inteira, sem
  // ninguém ter pedido, é surpresa — e surpresa em tela de operação é ruído.
  useEffect(() => {
    if (!pendingOpen) setShowAllPending(false);
  }, [pendingOpen]);
  const hasPending = group.pending.length > 0;
  const hiddenPending = group.pending.length - PENDING_ROWS;
  // Com o andar de pendências em cima, o acervo encolhe para não esticar o
  // cartão; sozinho, ele fica no tamanho de leitura de sempre.
  const thumbCap = hasPending ? 6 : THUMBS_PER_GROUP;

  // A faixa lê o cartão INTEIRO — pendências e acervo —, não só o que está
  // visível depois do corte das 3 linhas.
  const stripe = stripeCategory([...group.pending, ...group.rest]);

  return (
    /* MESMA CASCA DOS CARDS DA OPERACIONAL (18/09/2026): o cartão de imóvel
       usava um canto quase reto (0.3rem) enquanto todo cartão das outras abas
       tem 14px, e a faixa de categoria era um bloco cheio de 4px na lateral.
       Agora é o traço de 2px que some nas pontas — o mesmo da faixa de
       limpeza da Operacional. */
    <div className={`${PANEL_SHELL} p-3`}>
      {stripe && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 left-0 w-[2px] ${STRIPE_GRADIENT[stripe]}`}
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
          <span className={`mt-0.5 block truncate text-[10.5px] ${CARD_OWNER}`}>{group.sublabel}</span>
        )}

        {hasPending && (
          <>
            {/* MESMA FONTE de "Registros" (pedido explícito, 10/09/2026) — e
                SÓ a fonte: a cor continua sendo a de alerta ("mandei apenas
                manter na mesma fonte... a cor precisa continuar sendo a
                anterior"). O nome virou "Pendências", como a operação já chama
                no Kanban. */}
            {/* A LINHA INTEIRA É O BOTÃO, sem seta — igualzinho à de
                "Registros" (pedido explícito, 11/09/2026: "a linha PENDÊNCIAS
                recolhida seguindo as mesmas regras da linha REGISTROS"). A
                forma não muda em nada: mesma fonte, mesmo fio, mesma contagem
                à direita, e a cor de alerta continua sendo a de antes. */}
            <button
              type="button"
              onClick={onTogglePending}
              aria-expanded={pendingOpen}
              className="mb-1 mt-2.5 flex w-full items-center gap-2 text-left"
            >
              <span className="ds-falta shrink-0 text-[9px] font-extrabold uppercase tracking-[0.11em]">
                Pendências
              </span>
              <span
                aria-hidden
                className="h-px flex-1 bg-gradient-to-r from-[color-mix(in_oklab,var(--foreground)_9%,transparent)] to-transparent"
              />
              <span className="shrink-0 text-[9px] font-bold tabular-nums text-muted-foreground">
                {group.pending.length}
              </span>
            </button>
            {pendingOpen && (
              <>
                {(showAllPending ? group.pending : group.pending.slice(0, PENDING_ROWS)).map((r) => (
                  <PendingRow key={r.id} record={r} onOpen={() => onOpen(r)} onResolve={() => onResolve(r)} />
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
              <span
                aria-hidden
                className="h-px flex-1 bg-gradient-to-r from-[color-mix(in_oklab,var(--foreground)_9%,transparent)] to-transparent"
              />
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
                    return <MoreThumb key="more" small={hasPending} count={hidden + 1} onClick={() => onOpen(r)} />;
                  }
                  return <Thumb key={r.id} record={r} small={hasPending} onOpen={() => onOpen(r)} />;
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
function MoreThumb({ small, count, onClick }: { small?: boolean; count: number; onClick: () => void }) {
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

function Thumb({ record, small, onOpen }: { record: AccountRecord; small?: boolean; onOpen: () => void }) {
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
        {open && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-rose-500" aria-label="Em aberto" />}
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
        {record && <RecordViewerBody record={record} onDelete={onDelete} onResolve={onResolve} onEdited={onEdited} />}
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
  const qc = useQueryClient();
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
      onSaved();
      // "Desfazer" (17/09/2026): grava de volta o texto que estava antes.
      notifyAction("Registro atualizado.", () => {
        void updateFn({
          data: {
            id: record.id,
            title: initialTitle,
            description: initialDescription.trim() || null,
          },
        })
          .then(() => qc.invalidateQueries({ queryKey: ["account-records"] }))
          .catch((e) => toast.error((e as Error).message || "Não foi possível desfazer."));
      });
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
    [record.guestName, record.reservationCode, stay].filter(Boolean).join(" · ") || "Sem reserva vinculada";

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
          <span className={`block truncate text-[10.5px] leading-tight ${CARD_OWNER}`}>{record.ownerName}</span>
        )}
        <span className="block truncate text-[10px] leading-tight text-muted-foreground">{reservationLine}</span>
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
  const restoreTaskFn = useServerFn(restoreTask);
  const qc = useQueryClient();
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
      const cents = hasCost ? Math.round(Number(amount.replace(/\./g, "").replace(",", ".")) * 100) : null;
      if (hasCost && (!Number.isFinite(cents) || (cents ?? 0) < 0)) {
        throw new Error("Informe um valor válido.");
      }
      return setStatusFn({
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
    onSuccess: (res) => {
      onDone();
      // "Desfazer" (17/09/2026): a pendência volta exatamente como estava.
      notifyAction("Pendência resolvida.", () => {
        void restoreTaskFn({ data: { before: res.before } })
          .then(() => {
            void qc.invalidateQueries({ queryKey: ["account-records"] });
            void qc.invalidateQueries({ queryKey: ["dash-tasks"] });
          })
          .catch((e) => toast.error(e instanceof Error ? e.message : "Não foi possível desfazer."));
      });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não foi possível resolver."),
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
          <DialogTitle className="ds-card-title block w-full truncate">Resolver pendência</DialogTitle>
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
                <span className="ds-eyebrow block text-[9.5px] text-muted-foreground">Quem paga</span>
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
                    <CommandInput placeholder={payer === "owner" ? "Buscar proprietário..." : "Buscar prestador..."} />
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
                            <Check className={`size-3.5 ${payerId === o.id ? "opacity-100" : "opacity-0"}`} />
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
            <span className="ds-eyebrow block text-[9.5px] text-muted-foreground">Observação (opcional)</span>
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
        <video src={record.url} controls playsInline preload="metadata" className="relative size-full object-contain" />
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

  function Row({ label, value, onClick, last }: { label: string; value: string; onClick: () => void; last?: boolean }) {
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
        {/* MESMO botão das outras telas (padrão "Presença", 18/09/2026): no
            celular divide a largura com os irmãos e mostra o rótulo; no
            computador vira um quadrado de 44px ao lado da barra de abas. */}
        <button
          type="button"
          title={hasCustomFilters ? "Filtros · há filtro ativo" : "Filtros"}
          aria-label="Filtros dos registros"
          className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
        >
          <SlidersHorizontal className={ACTION_ICON} />
          <span className="lg:hidden">Filtros</span>
          {hasCustomFilters && <span className="absolute right-2 top-2 size-[5px] rounded-full bg-accent" />}
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
                <Check className={`size-3.5 ${o.value === groupBy ? "opacity-100" : "opacity-0"}`} />
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
                      <Checkbox checked={ownerFilters.includes(o)} className="pointer-events-none" />
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
                      <Checkbox checked={propertyFilters.includes(p.id)} className="pointer-events-none" />
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
