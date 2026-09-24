/**
 * PADRÃO DOS QUADRANTES DE "FILTROS" (mockup aprovado, 23/09/2026 — canvas
 * "ConciergeIA — Mockup Filtros/Tooltips", 10 quadros).
 *
 * Pedido explícito: "precisamos começar com o layout de todas as janelas/
 * quadrantes dentro dos botões de filtros" + "a janela/quadrante NUNCA pode
 * ficar 'colada' à lateral" + (depois da 1ª implementação) "não foram
 * implementados fielmente... implemente os mockups em TODAS as telas".
 *
 * Por isso TODAS as telas de dentro dos dois botões de Filtros do dashboard
 * (`CalendarFiltersButton` — Kanban / Limpeza / calendário de ocupação — e
 * `RecordsFiltersButton` — Registros) são montadas SÓ com as peças deste
 * arquivo. Nada de `CommandItem`/`Checkbox` do shadcn aqui dentro: os
 * estilos padrão deles (fundo rosa sólido no item "selecionado" pelo
 * teclado, caixinha branca, `[&_svg]:size-4` forçado) eram justamente o que
 * deixava o quadrante diferente do mockup.
 *
 * Medidas copiadas do mockup: painel de 280px com raio 16 e sombra
 * profunda; linhas com respiro de 14px nas laterais; selo de ícone de
 * 28px (24px nos cabeçalhos internos); valor ativo em chip rosa suave;
 * caixinha de 17px com raio 5; calendário com células de 34px, "hoje" com
 * anel fino e o intervalo em faixa rosa suave com as pontas em círculo.
 *
 * COR "GRAFITE QUENTE" (mockup "Quadrantes v2" aprovado, 23/09/2026 — pedido
 * explícito: "as janelas/quadrantes dos botões de filtros fiquem com a cor
 * principal diferente do tema abaixo... não muito agressivo, mas
 * diferente"; revisão no mesmo dia: a 1ª versão, "Ameixa Grafite", tinha
 * matiz roxo — virou grafite quente, sem roxo). O painel deixou de usar
 * `bg-card`/`border-border` (a cor neutra do resto do app) e passou a usar
 * os tokens `--panel*` só dele (`src/styles.css`, dentro de `.dark`) — nunca
 * os tokens globais, porque a ideia é exatamente destacar o quadrante do
 * fundo, não mudar o app inteiro.
 */
import { useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { DayPicker, type DateRange, type DayButtonProps, type Matcher } from "react-day-picker";
import { addDays, addMonths, endOfMonth, format, isAfter, isBefore, isSameDay, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

import { OVERLAY_COLLISION_PADDING } from "@/components/ui/overlay-collision";

/* ------------------------------------------------------------------------ */
/* Casca do painel                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Classes do `PopoverContent` de qualquer botão de Filtros. `relative` +
 * `before:*` desenha o fio de luz de 1px no topo (mockup: 28px de recuo de
 * cada lado) sem precisar de mais um elemento em cada tela que usa o painel.
 */
export const FILTER_PANEL_CLASS =
  "sg-elegant-scroll relative before:pointer-events-none before:absolute before:inset-x-7 before:top-0 before:h-px before:content-[''] before:bg-[image:var(--panel-hair)] w-[280px] max-w-[calc(100vw-32px)] max-h-[min(36rem,var(--radix-popover-content-available-height))] overflow-y-auto overflow-x-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] p-0 text-foreground shadow-[0_24px_60px_rgba(0,0,0,0.6),0_2px_8px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.05)]";

/**
 * Mesma casca, um tom mais claro (`--panel-2`) — para um quadrante que flutua
 * SOBRE outro (ex.: o popover de Previsão, que abre por cima do diálogo "Em
 * Estadia"). Mockup "Quadrantes v2" aprovado, 23/09/2026: o painel de baixo
 * usa `--panel`, o de cima `--panel-2`, para os dois se distinguirem um do
 * outro em vez de se fundirem numa mancha só.
 */
export const FILTER_PANEL_CLASS_ELEVATED = FILTER_PANEL_CLASS.replace("bg-[var(--panel)]", "bg-[var(--panel-2)]");

/**
 * Nunca colado na lateral: 16px de folga dos dois lados, mantendo as faixas
 * de cima/baixo do padrão global (cabeçalho fixo e barra inferior). Antes
 * passávamos só `16` — um número único, que APAGAVA essas faixas de
 * cima/baixo do padrão.
 */
export const FILTER_PANEL_COLLISION = { ...OVERLAY_COLLISION_PADDING, left: 16, right: 16 } as const;

/** Distância entre o botão e o painel (mockup). */
export const FILTER_PANEL_OFFSET = 8;

const ROW_DIVIDER = "border-b border-[var(--panel-div)]";
const ROW_HOVER = "transition-colors hover:bg-foreground/[0.03]";

/* ------------------------------------------------------------------------ */
/* Peças pequenas                                                            */
/* ------------------------------------------------------------------------ */

export function FilterIconBadge({ icon: Icon, size = "md" }: { icon: LucideIcon; size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-6 rounded-[7px]" : "size-7 rounded-[9px]";
  return (
    <span className={`grid ${box} shrink-0 place-items-center bg-foreground/[0.06] text-foreground`}>
      <Icon className="size-[15px]" strokeWidth={2} />
    </span>
  );
}

export function FilterCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="shrink-0 rounded-full bg-accent/[0.14] px-2 py-[3px] text-[10.5px] font-bold leading-none tabular-nums text-accent">
      {count}
    </span>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`grid size-[17px] shrink-0 place-items-center rounded-[5px] border-[1.5px] ${
        checked ? "border-accent bg-accent" : "border-foreground/25"
      }`}
    >
      {checked && <Check className="size-3 text-[#0b0908]" strokeWidth={3} />}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Menu raiz                                                                 */
/* ------------------------------------------------------------------------ */

/** Topo do menu raiz: "FILTROS" à esquerda, "Limpar" alinhado com "Todos". */
export function FilterRootHeader({ canClear, onClear }: { canClear: boolean; onClear: () => void }) {
  return (
    <div className={`relative flex items-center gap-2.5 py-3 px-3.5 ${ROW_DIVIDER}`}>
      {/*
       * "Limpar" alinhado com a BORDA ESQUERDA da palavra "Todos" nas linhas
       * abaixo (pedido explícito, 23/09/2026 — 2ª correção: a 1ª tentativa,
       * grudado em "Filtros" à esquerda com o resto da linha vazio, também
       * ficou errada; antes dessa, alinhar pela borda DIREITA da coluna de
       * valor tinha lido como "à direita"). Medido de verdade num build real
       * do painel (280px, mesmo CSS compilado do app, fonte Manrope) em vez
       * de chutar mais uma vez: com o painel/`PopoverContent` já `relative`
       * (herdado aqui pela própria linha), o "Todos" de uma `FilterMenuRow`
       * comum começa a 208px da borda do painel — 207px depois de descontar
       * o `border` de 1px do quadrante, que é a origem do `left` de um filho
       * `absolute`. Não depende do rótulo da linha (ex.: "Proprietário" vs.
       * "Cidade"): o valor é sempre encostado à direita, antes da seta, e a
       * seta/padding são os mesmos em toda linha — só o texto do MEIO
       * (rótulo) muda de largura, e ele fica à esquerda desse ponto.
       */}
      <span className="ds-eyebrow text-muted-foreground">Filtros</span>
      <button
        type="button"
        disabled={!canClear}
        onClick={onClear}
        className="absolute left-[207px] text-[11px] font-semibold text-foreground/70 transition-colors hover:text-foreground disabled:pointer-events-none disabled:text-foreground/30"
      >
        Limpar
      </button>
    </div>
  );
}

/** Linha do menu raiz: selo do ícone, rótulo, valor (chip rosa se ativo) e seta. */
export function FilterMenuRow({
  icon,
  label,
  value,
  active,
  onClick,
  last,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  active?: boolean;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3.5 py-[11px] text-left ${ROW_HOVER} ${last ? "" : ROW_DIVIDER}`}
    >
      <FilterIconBadge icon={icon} />
      {/* O rótulo nunca é cortado; quem cede espaço é o valor. */}
      <span className="shrink-0 text-[13px] font-semibold text-foreground">{label}</span>
      <span className="flex min-w-0 flex-1 justify-end">
        {active ? (
          <span className="min-w-0 truncate rounded-full bg-accent/[0.14] px-[9px] py-[3px] text-[11px] font-bold text-accent">
            {value}
          </span>
        ) : (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{value}</span>
        )}
      </span>
      <ChevronRight className="size-[13px] shrink-0 text-foreground/35" strokeWidth={2.5} />
    </button>
  );
}

/** Ação simples do menu raiz (Salvar/Copiar imagem). */
export function FilterActionRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  last,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 px-3.5 py-[11px] text-left disabled:opacity-50 ${ROW_HOVER} ${last ? "" : ROW_DIVIDER}`}
    >
      <Icon className="size-3.5 shrink-0 text-foreground/55" strokeWidth={2} />
      <span className="text-[12.5px] font-semibold text-foreground">{label}</span>
    </button>
  );
}

/** Liga/desliga com caixinha no pé do menu raiz ("Só os em aberto"). */
export function FilterToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-2.5 px-3.5 py-[11px] text-left ${ROW_HOVER}`}
    >
      <CheckBox checked={checked} />
      <span className="text-[12.5px] font-semibold text-foreground">{label}</span>
    </button>
  );
}

/** Divisor entre o bloco de filtros e o bloco de ações do menu raiz. */
export function FilterSection({ children }: { children: ReactNode }) {
  return <div className="border-t border-[var(--panel-div)]">{children}</div>;
}

/* ------------------------------------------------------------------------ */
/* Telas internas                                                            */
/* ------------------------------------------------------------------------ */

/** Cabeçalho de tela interna: voltar, selo pequeno, título em Sora e extra à direita. */
export function FilterScreenHeader({
  icon,
  title,
  onBack,
  right,
}: {
  icon: LucideIcon;
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  return (
    /* Sem a linha divisória sob o título (pedido explícito, 24/09/2026,
       Print 5: "remova completamente a linha divisória demarcada
       especificamente no Print 5") — o respiro do próprio padding já separa
       o cabeçalho do corpo da tela, sem precisar de um traço. */
    <div className="flex items-center gap-[9px] px-3.5 py-[11px]">
      <button
        type="button"
        onClick={onBack}
        aria-label="Voltar para Filtros"
        className="grid size-[22px] shrink-0 place-items-center rounded-[7px] text-foreground/55 transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" strokeWidth={2.5} />
      </button>
      <FilterIconBadge icon={icon} size="sm" />
      <span className="ds-card-title min-w-0 flex-1">{title}</span>
      {right ? <span className="shrink-0">{right}</span> : null}
    </div>
  );
}

/** "Limpar" à direita de um cabeçalho interno. */
export function FilterHeaderClear({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-[11px] font-semibold text-foreground/70 transition-colors hover:text-foreground disabled:pointer-events-none disabled:text-foreground/30"
    >
      Limpar
    </button>
  );
}

/** Opção de escolha ÚNICA (Categoria, Agrupar, Período em lista): check rosa + bolinha opcional. */
export function FilterOptionRow({
  label,
  selected,
  dotClassName,
  onClick,
  last,
}: {
  label: string;
  selected: boolean;
  /** Classe de cor da bolinha (ex.: `bg-[#c98c8c]`), igual à dos cards. */
  dotClassName?: string;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-[9px] px-3.5 py-2.5 text-left ${ROW_HOVER} ${last ? "" : ROW_DIVIDER}`}
    >
      <Check
        className={`size-3.5 shrink-0 text-accent ${selected ? "opacity-100" : "opacity-0"}`}
        strokeWidth={3}
      />
      {dotClassName ? <span className={`size-[7px] shrink-0 rounded-full ${dotClassName}`} /> : null}
      <span
        className={`min-w-0 truncate text-[12.5px] ${
          selected ? "font-bold text-foreground" : "font-medium text-foreground/80"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

export type FilterMultiOption = {
  value: string;
  label: string;
  sublabel?: string | null;
  /** Rótulo em itálico (ex.: "Sem prestador informado" — mockup aprovado,
   * 23/09/2026) — sinaliza uma opção "vazio", não um valor de verdade. */
  italic?: boolean;
};

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Lista de escolha MÚLTIPLA com busca (Cidade, Proprietário, Imóvel):
 * campo de busca em caixa própria, "Selecionar todos"/"Limpar", e linhas
 * com caixinha — a linha marcada ganha o fundo rosa suave.
 */
export function FilterMultiSelect({
  options,
  selected,
  onChange,
  searchPlaceholder,
  emptyLabel = "Nenhum resultado.",
}: {
  options: ReadonlyArray<FilterMultiOption>;
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder: string;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return options;
    return options.filter((o) => normalize(`${o.label} ${o.sublabel ?? ""}`).includes(q));
  }, [options, query]);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <>
      <label className="mx-3.5 mb-1.5 mt-2.5 flex items-center gap-2 rounded-[9px] border border-border bg-[var(--panel-well)] px-2.5 py-2">
        <Search className="size-3.5 shrink-0 text-foreground/40" strokeWidth={2} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-foreground/40"
        />
      </label>
      <div className="flex items-center justify-between px-3.5 pb-2 pt-0.5">
        <button
          type="button"
          onClick={() => onChange(options.map((o) => o.value))}
          className="text-[10.5px] font-semibold text-foreground/55 transition-colors hover:text-foreground"
        >
          Selecionar todos
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          disabled={selected.length === 0}
          className="text-[10.5px] font-semibold text-foreground/55 transition-colors hover:text-foreground disabled:pointer-events-none disabled:text-foreground/25"
        >
          Limpar
        </button>
      </div>
      <div className="border-t border-[var(--panel-div)]">
        {visible.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-xs text-muted-foreground">{emptyLabel}</div>
        ) : (
          visible.map((o, i) => {
            const checked = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(o.value)}
                className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors ${
                  checked ? "bg-accent/[0.14]" : "hover:bg-foreground/[0.03]"
                } ${i === visible.length - 1 ? "" : ROW_DIVIDER}`}
              >
                <CheckBox checked={checked} />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span
                    className={`truncate text-[12.5px] font-semibold leading-[1.3] text-foreground ${o.italic ? "italic text-foreground/70" : ""}`}
                  >
                    {o.label}
                  </span>
                  {o.sublabel ? (
                    <span className="truncate text-[10.5px] leading-[1.3] text-muted-foreground">{o.sublabel}</span>
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Período com calendário                                                    */
/* ------------------------------------------------------------------------ */

function RangeDayButton({ day, modifiers, className: _c, children, ...props }: DayButtonProps) {
  const start = !!modifiers.range_start;
  const end = !!modifiers.range_end;
  const middle = !!modifiers.range_middle;
  const endpoint = start || end;
  const muted = modifiers.outside || modifiers.disabled;

  // Faixa rosa suave atrás do intervalo; nas pontas, só a metade de dentro.
  const band =
    middle ? "inset-x-0" : start && !end ? "left-1/2 right-0" : end && !start ? "left-0 right-1/2" : null;

  const circle = endpoint
    ? "bg-accent text-[#0b0908]"
    : modifiers.today
      ? "border-[1.5px] border-accent text-foreground"
      : muted
        ? "text-foreground/20"
        : "text-foreground group-hover/day:bg-foreground/[0.06]";

  // "Dia vigente" (hoje) ganha um efeito de espelho ESTÁTICO — sem sweep,
  // sem transição, só o brilho de vidro parado (pedido explícito,
  // 23/09/2026: "espelho sem movimento"). Só no anel de "hoje" puro; quando
  // o dia de hoje também é ponta do intervalo (início/fim selecionado), a
  // cor sólida do chip já basta e o vidro por cima ficaria estranho.
  const showTodayMirror = modifiers.today && !endpoint;

  return (
    <button
      {...props}
      className="group/day relative grid h-[34px] w-full place-items-center text-[12.5px] font-semibold outline-none disabled:cursor-default focus-visible:[&>span:last-child]:ring-2 focus-visible:[&>span:last-child]:ring-accent/50"
    >
      {band && !modifiers.outside ? (
        <span aria-hidden className={`absolute inset-y-0.5 ${band} bg-accent/[0.14]`} />
      ) : null}
      <span className={`relative grid size-[30px] place-items-center rounded-full transition-colors ${circle}`}>
        {showTodayMirror ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/20 via-white/[0.04] to-transparent"
          />
        ) : null}
        <span className="relative">{children}</span>
      </span>
    </button>
  );
}

function clampRange(from: Date, to: Date, min?: Date, max?: Date): DateRange | undefined {
  let a = from;
  let b = to;
  if (min && isBefore(a, min)) a = min;
  if (max && isAfter(b, max)) b = max;
  if (isAfter(a, b)) return undefined;
  return { from: a, to: b };
}

/**
 * Corpo da tela "Período" com calendário: atalhos (Hoje / 7 dias / Este
 * mês), o mês com setas próprias, e os chips Início → Fim.
 * `month`/`onMonthChange` são controlados pelo pai (o mês SEMPRE abre no
 * de hoje — pedido explícito de 23/09/2026).
 */
export function FilterPeriodCalendar({
  value,
  onChange,
  month,
  onMonthChange,
  today,
  min,
  max,
}: {
  value: DateRange | undefined;
  /** Recebe cada clique; o pai decide quando propagar (intervalo completo). */
  onChange: (next: DateRange | undefined) => void;
  month: Date;
  onMonthChange: (next: Date) => void;
  today: Date;
  /** Limites opcionais (ex.: só dias com demanda real, na aba Limpeza). */
  min?: Date;
  max?: Date;
}) {
  const disabled: Matcher[] = [];
  if (min) disabled.push({ before: min });
  if (max) disabled.push({ after: max });

  const quick: Array<{ key: string; label: string; range: DateRange | undefined }> = [
    { key: "today", label: "Hoje", range: clampRange(today, today, min, max) },
    { key: "7d", label: "7 dias", range: clampRange(today, addDays(today, 6), min, max) },
    { key: "month", label: "Este mês", range: clampRange(startOfMonth(today), endOfMonth(today), min, max) },
  ];
  const sameRange = (a?: DateRange, b?: DateRange) =>
    !!a?.from && !!a?.to && !!b?.from && !!b?.to && isSameDay(a.from, b.from) && isSameDay(a.to, b.to);

  const canPrev = !min || isAfter(startOfMonth(month), startOfMonth(min));
  const canNext = !max || isBefore(startOfMonth(month), startOfMonth(max));

  const chip = (label: string, date?: Date) => (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-px rounded-[10px] px-2.5 py-2 ${
        date ? "bg-accent/[0.14]" : "bg-foreground/[0.06]"
      }`}
    >
      <span
        className={`text-[9.5px] font-bold uppercase tracking-[0.04em] ${date ? "text-accent" : "text-muted-foreground"}`}
      >
        {label}
      </span>
      <span className="text-[13px] font-bold text-foreground">{date ? format(date, "dd/MM") : "—"}</span>
    </div>
  );

  return (
    <>
      <div className="flex gap-1.5 px-3.5 pt-2.5">
        {quick.map((q) => {
          const active = sameRange(q.range, value);
          return (
            <button
              key={q.key}
              type="button"
              disabled={!q.range}
              onClick={() => {
                if (!q.range?.from) return;
                onMonthChange(startOfMonth(q.range.from));
                onChange(q.range);
              }}
              className={`rounded-full px-[11px] py-[5px] text-[11px] font-semibold transition-colors disabled:opacity-40 ${
                active
                  ? "bg-accent/[0.14] text-accent"
                  : "bg-foreground/[0.06] text-muted-foreground hover:text-foreground"
              }`}
            >
              {q.label}
            </button>
          );
        })}
      </div>

      <div className="px-3.5 pb-1 pt-2.5">
        <div className="flex items-center justify-between px-0.5 pb-2 pt-0.5">
          <button
            type="button"
            aria-label="Mês anterior"
            disabled={!canPrev}
            onClick={() => onMonthChange(addMonths(month, -1))}
            className="grid size-6 place-items-center rounded-[7px] text-foreground/55 transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5" strokeWidth={2.5} />
          </button>
          <span className="font-display text-[12.5px] font-bold capitalize text-foreground">
            {format(month, "MMMM yyyy", { locale: ptBR })}
          </span>
          <button
            type="button"
            aria-label="Próximo mês"
            disabled={!canNext}
            onClick={() => onMonthChange(addMonths(month, 1))}
            className="grid size-6 place-items-center rounded-[7px] text-foreground/55 transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-30"
          >
            <ChevronRight className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
        <DayPicker
          mode="range"
          locale={ptBR}
          showOutsideDays
          hideNavigation
          month={month}
          onMonthChange={onMonthChange}
          selected={value}
          onSelect={onChange}
          disabled={disabled.length ? disabled : undefined}
          today={today}
          formatters={{
            formatWeekdayName: (d) => format(d, "cccccc", { locale: ptBR }).replace(".", ""),
          }}
          classNames={{
            root: "w-full",
            months: "w-full",
            month: "w-full",
            month_caption: "hidden",
            month_grid: "w-full table-fixed border-collapse",
            weekdays: "",
            weekday: "pb-1 text-center text-[10.5px] font-bold uppercase text-muted-foreground",
            weeks: "",
            week: "",
            day: "p-0 py-0.5 text-center",
          }}
          components={{ DayButton: RangeDayButton }}
        />
      </div>

      <div className="flex items-center gap-2 px-3.5 pb-3.5 pt-2.5">
        {chip("Início", value?.from)}
        <span className="text-[13px] text-muted-foreground">→</span>
        {chip("Fim", value?.to)}
      </div>
    </>
  );
}
