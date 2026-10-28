import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type ReactNode } from "react";
import {
  ArrowDownRight, ArrowUpRight, CalendarCheck, CreditCard, GitCompareArrows, Landmark, Layers, Lock,
  SlidersHorizontal, Wallet,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { StatCard } from "@/components/ds/StatCard";
import { PANEL_SHELL, PanelHeading, ACTION_SEGMENT, ACTION_BUTTON_TONE, ACTION_ICON } from "@/components/dashboard/panel-chrome";
import { PeriodQuickFilterButton, type QuickPeriod } from "@/components/dashboard/PeriodQuickFilterButton";
import {
  FILTER_PANEL_CLASS, FILTER_PANEL_OFFSET, FilterMenuRow, FilterOptionRow, FilterRootHeader, FilterScreenHeader, FitPopoverContent,
} from "@/components/dashboard/filter-panel";
import { getExecutiveAccess, getExecutiveDashboard } from "@/lib/executive.functions";

export const Route = createFileRoute("/_authenticated/admin/dashboard/gerencial")({
  head: () => ({
    meta: [
      { title: "Gerencial — ConciergeIA" },
      { name: "description", content: "Painel estratégico da diretoria: caixa, fluxo do mês e ritmo do negócio." },
      { property: "og:title", content: "Gerencial — ConciergeIA" },
      { property: "og:description", content: "Painel estratégico da diretoria: caixa, fluxo do mês e ritmo do negócio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GerencialPage,
});

/* ---------------------------- formatação ---------------------------- */
const brl = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlFull = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlShort = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(Math.round(v));
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const todaySP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

/** Mês atual: do dia 1 até hoje. */
function currentMonth(): QuickPeriod {
  const t = todaySP();
  return { start: `${t.slice(0, 7)}-01`, end: t };
}
/** "Outubro de 2026" quando o período é um mês (inteiro ou até hoje); senão "01/09 a 15/10". */
function periodLabel(p: { start: string; end: string }) {
  const sameMonth = p.start.slice(0, 7) === p.end.slice(0, 7) && p.start.endsWith("-01");
  const [y, m] = p.end.split("-").map(Number);
  const isFull = Number(p.end.slice(8)) === lastDay(y, m) || p.end === todaySP();
  if (sameMonth && isFull) return `${MESES_LONGO[m - 1].replace(/^\w/, (c) => c.toUpperCase())} de ${y}`;
  return `${ddmm(p.start)}/${p.start.slice(2, 4)} a ${ddmm(p.end)}/${p.end.slice(2, 4)}`;
}
const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

const SAGE = "var(--success)";
const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
} as const;

type Compare = "none" | "prev" | "yoy";
type Bank = "all" | "btg" | "nubank";
type Ref = 0 | 1;
const BANK_LABEL: Record<Bank, string> = { all: "Todas as contas", btg: "Somente BTG", nubank: "Somente Nubank" };

/** Visões de período (em meses) — o período segue o bloco do calendário (jan–mar, abr–jun…). */
const VIEWS = [
  { span: 1, label: "Mensal", unit: "Mês" },
  { span: 2, label: "Bimestral", unit: "Bimestre" },
  { span: 3, label: "Trimestral", unit: "Trimestre" },
  { span: 4, label: "Quadrimestral", unit: "Quadrimestre" },
  { span: 6, label: "Semestral", unit: "Semestre" },
  { span: 12, label: "Anual", unit: "Ano" },
] as const;
const viewOf = (span: number) => VIEWS.find((v) => v.span === span) ?? VIEWS[0];

/** Bloco da visão que contém hoje (ref 0) ou o anterior (ref 1); o atual vai até hoje. */
function viewRange(span: number, ref: Ref): QuickPeriod {
  const t = todaySP();
  const y = Number(t.slice(0, 4));
  const m0 = Number(t.slice(5, 7)) - 1;
  const startIdx = Math.floor(m0 / span) * span - ref * span;
  const s = new Date(Date.UTC(y, startIdx, 1));
  const e = new Date(Date.UTC(y, startIdx + span, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(s), end: ref === 0 ? t : iso(e) };
}

function viewLabel(span: number, r: QuickPeriod) {
  const [y, m] = r.start.split("-").map(Number);
  if (span === 1) return periodLabel(r);
  if (span === 12) return `Ano de ${y}`;
  const n = Math.floor((m - 1) / span) + 1;
  return `${n}º ${viewOf(span).unit} de ${y}`;
}

/* ------------------------------ página ------------------------------ */
function GerencialPage() {
  const accessFn = useServerFn(getExecutiveAccess);
  const access = useQuery({ queryKey: ["executive-access"], queryFn: () => accessFn() });
  if (access.isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (!access.data?.allowed) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <Lock className="mx-auto mb-3 size-6 text-muted-foreground" />
        <h1 className="text-lg font-bold">Área restrita à diretoria</h1>
        <p className="mt-1 text-sm text-muted-foreground">Este painel é exclusivo da alta diretoria da empresa.</p>
        <Link to="/admin/dashboard" className="mt-4 inline-block text-sm font-semibold text-accent">Voltar ao Dashboard</Link>
      </div>
    );
  }
  return <Painel />;
}

function Painel() {
  const [period, setPeriod] = useState<QuickPeriod | null>(null);
  const [compare, setCompare] = useState<Compare>("prev");
  const [bank, setBank] = useState<Bank>("all");
  const [span, setSpan] = useState<number>(12);
  const [ref, setRef] = useState<Ref>(0);
  // Datas escolhidas no calendário mandam; senão vale a visão (padrão: mês atual).
  const range = period ?? (span === 1 && ref === 0 ? currentMonth() : viewRange(span, ref));
  const effSpan = period ? 1 : span;

  const fn = useServerFn(getExecutiveDashboard);
  const q = useQuery({
    queryKey: ["executive-dashboard", range.start, range.end, compare, bank, effSpan],
    queryFn: () => fn({ data: { ...range, compare, bank, span: effSpan } }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const d = q.data;

  const hoje = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long",
  });

  const c = d?.comparacao ?? null;
  const prevName = period ? "período anterior" : `${viewOf(span).unit.toLowerCase()} anterior`;
  const vsLabel = compare === "prev" ? `vs. ${prevName}` : "vs. ano anterior";
  const delta = (cur: number, prev: number | undefined, invert = false) => {
    if (!c || prev == null) return null;
    const v = pct(cur, prev);
    if (v == null) return null;
    const good = invert ? v <= 0 : v >= 0;
    return (
      <span className={good ? "ds-ok" : "text-destructive"}>
        {v >= 0 ? "+" : ""}{v.toFixed(0)}% <span className="font-medium text-muted-foreground">{vsLabel}</span>
      </span>
    );
  };
  const usoLimite = d?.cartao?.limite ? Math.min(100, (d.cartao.fatura / d.cartao.limite) * 100) : null;
  const filtersOn = compare !== "prev" || bank !== "all" || span !== 12 || ref !== 0;
  const unitName = viewOf(span).unit;
  const pageTitle = period
    ? `Gerencial Entre ${ddmm(range.start)} e ${ddmm(range.end)}`
    : `Gerencial do ${unitName}${ref === 1 ? " Anterior" : ""}`;
  const title = period ? periodLabel(range) : viewLabel(span, range);
  const vsShort = compare === "none" ? "" : compare === "prev" ? `vs. ${prevName.replace(/^\w/, (x) => x.toUpperCase())}` : "vs. Ano Anterior";

  return (
    <div className="ds-page relative w-full max-w-[1440px] px-3.5 py-5 sm:px-5 lg:px-8 lg:py-8">
      <div aria-hidden className="ds-page-halo" />
      {/* Cabeçalho: o mesmo desenho do Financeiro (data, título, subtítulo, aba). */}
      <div className="ds-page-heading ds-page-head">
        <p className="ds-eyebrow ds-data text-[10.5px] tracking-[0.2em]">{hoje}</p>
        {/* Mesma árvore do OperationShell: título+subtítulo e abas dentro de um
            <div> próprio, para a aba NÃO herdar o vão do `ds-page-heading`
            (somava 6px a mais que no Financeiro). */}
        <div>
          <div className="ds-page-heading min-w-0 lg:flex-1">
            <h1 className="ds-page-title !text-lg ">{pageTitle}</h1>
            <p className="ds-page-subtitle truncate">Caixa, fluxo e ritmo da empresa para a diretoria.</p>
          </div>
          <div className="mt-5 flex flex-col gap-2 lg:mt-2.5 lg:flex-row lg:items-center lg:gap-2">
            <nav className="ds-tabs order-1 lg:order-2 lg:min-w-0 lg:flex-1">
              <span className="ds-tab-active flex min-h-[44px] flex-1 items-center justify-center px-2 text-center text-[13px] font-bold leading-none">
                Visão Geral
              </span>
            </nav>
          </div>
        </div>
      </div>

      <div className="ds-card-grid">
        {/* BARRA DO GERENCIAL (28/10/2026): período por extenso + calendário +
            filtros, acima dos cards que ela comanda. Mesma casca da busca. */}
        <div className="flex min-w-0 items-stretch ds-3d ds-3d-hover h-10 overflow-hidden rounded-[9px] bg-card !shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_7%,transparent),inset_0_0_0_1px_var(--border),0_8px_14px_-8px_rgb(0_0_0/0.55)] lg:h-[var(--ds-action-h-lg)] lg:rounded-[13px]">
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3.5 text-center leading-tight">
            <span className="shrink-0 text-[13px] font-bold text-foreground">{title}</span>
            {(compare !== "none" || bank !== "all") && (
              <span className="truncate text-[10.5px] font-medium text-muted-foreground">
                {vsShort}
                {bank !== "all" ? `${compare === "none" ? "" : " · "}${BANK_LABEL[bank]}` : ""}
              </span>
            )}
          </div>
          <div className="ds-icon-actions flex shrink-0 divide-x divide-[color-mix(in_oklab,var(--foreground)_11%,transparent)] border-l border-[color-mix(in_oklab,var(--foreground)_11%,transparent)] [&>*]:!w-12 lg:[&>*]:!w-[52px] [&>*]:!flex-none [&>*]:!px-0">
            <PeriodQuickFilterButton value={period} onChange={setPeriod} max={todaySP()} defaultChip="Mês atual" />
            <FiltersButton
              compare={compare} onCompare={setCompare} bank={bank} onBank={setBank}
              span={span} onSpan={(s) => { setSpan(s); setPeriod(null); }}
              refPeriod={ref} onRef={(r) => { setRef(r); setPeriod(null); }}
              unit={viewOf(span).unit}
              active={filtersOn}
              onClear={() => { setCompare("prev"); setBank("all"); setSpan(12); setRef(0); setPeriod(null); }}
            />
          </div>
        </div>
        <div className="ds-card-grid grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Landmark} label="Saldo em conta" value={brl(d?.saldoDisponivel)} loading={!d}
            note={d ? (() => {
              const comSaldo = d.contas.filter((x: { saldo: number }) => Math.abs(x.saldo) >= 0.01);
              const txt = `${comSaldo.length} ${comSaldo.length === 1 ? "conta" : "contas"}`;
              return <span className="font-medium text-muted-foreground">{txt}</span>;
            })() : null} />
          <StatCard icon={CreditCard} label="Fatura do cartão" value={d?.cartao ? brl(d.cartao.fatura) : "—"} loading={!d}
            note={usoLimite != null ? (
              <span className="mt-1 flex w-full items-center gap-2">
                <span className="text-[11.5px] font-bold leading-none tabular-nums text-foreground">
                  {usoLimite.toFixed(0)}%
                </span>
                <span className="relative block h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                  <span
                    className="absolute inset-y-0 left-0 overflow-hidden rounded-full"
                    style={{ width: `${Math.max(1, Math.min(100, usoLimite))}%` }}
                  >
                    <span
                      className="absolute inset-y-0 left-0"
                      style={{
                        width: `${10000 / Math.max(1, Math.min(100, usoLimite))}%`,
                        background: "linear-gradient(90deg, var(--success, oklch(0.72 0.16 150)), oklch(0.8 0.16 85), var(--destructive))",
                      }}
                    />
                  </span>
                </span>
              </span>
            ) : null} />
          <StatCard icon={ArrowDownRight} label="Entradas" value={brl(d?.atual.entradas)} loading={!d}
            note={d ? delta(d.atual.entradas, c?.entradas) : null} />
          <StatCard icon={Wallet}
            label={!d ? "Resultado" : d.atual.resultado >= 0 ? "Resultado positivo" : "Resultado negativo"}
            value={d ? <span className={d.atual.resultado >= 0 ? "text-success" : "text-destructive"}>{brl(d.atual.resultado)}</span> : "—"}
            iconTone={d ? (d.atual.resultado >= 0 ? "var(--success)" : "var(--destructive)") : undefined}
            loading={!d}
            note={d ? <span className="font-medium text-muted-foreground">Saídas {brl(d.atual.saidas)}</span> : null} />
        </div>
        <FlowChart data={d} />
        {q.isError ? (
          <div className={`${PANEL_SHELL} p-4 text-sm text-muted-foreground`}>Não foi possível carregar o painel.</div>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------- blocos visuais --------------------------- */
type Data = Awaited<ReturnType<typeof getExecutiveDashboard>> | undefined;

function Sub({ children }: { children: ReactNode }) {
  return <p className="-mt-1 mb-3 pl-4 text-[10.5px] font-medium text-muted-foreground">{children}</p>;
}

function FlowChart({ data }: { data: Data }) {
  const byMonth = data?.periodo.granularidade === "mes";
  const rows = (data?.serie ?? []).map((s) => ({
    ...s,
    label: byMonth ? MESES[Number(s.key.slice(5, 7)) - 1] : String(Number(s.key.slice(8, 10))),
  }));
  const scrollRef = useRef<HTMLDivElement>(null);
  // ANTI-CORTE: a largura da coluna divide a tela em colunas inteiras
  // (5 meses no celular, mais no desktop) — nenhuma barra fica cortada na borda.
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const minCol = byMonth ? 64 : 44;
  const perView = boxW ? Math.max(1, Math.min(rows.length || 1, Math.floor(boxW / minCol))) : 5;
  const colW = boxW ? boxW / perView : minCol;
  const years: { y: string; n: number }[] = [];
  for (const r of rows) {
    const y = r.key.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last.y === y) last.n++;
    else years.push({ y, n: 1 });
  }
  const fmt = (v: number) => (v ? brlShort(v).replace(" mil", "k") : "");
  const [tip, setTip] = useState<{ x: number; y: number } | undefined>();
  const TIP_W = 200;
  const onMove = (s: any) => {
    const el = scrollRef.current;
    const x = s?.chartX;
    if (!el || x == null) return setTip(undefined);
    const visRight = el.scrollLeft + el.clientWidth;
    const visLeft = el.scrollLeft;
    let tx = x + 12;
    if (tx + TIP_W > visRight) tx = x - TIP_W - 12;
    if (tx < visLeft) tx = visLeft + 4;
    setTip({ x: tx, y: 8 });
  };
  return (
    <section className={`${PANEL_SHELL} w-full min-w-0 px-3.5 py-3.5`}>
      <PanelHeading title={`Entradas e saídas · ${byMonth ? "por mês" : "por dia"}`} dotColor={SAGE} className="mb-2.5" />
      <div ref={scrollRef} className="ds-scroll-x">
        <div style={{ width: rows.length * colW || "100%" }}>
          <div className="h-60">
            {data ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 20, right: 4, left: 4, bottom: 0 }} barGap={4} barCategoryGap="14%"
                  onMouseMove={onMove} onClick={onMove} onMouseLeave={() => setTip(undefined)}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} interval={0} />
                  <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                    contentStyle={{ ...TOOLTIP_STYLE, width: TIP_W, whiteSpace: "nowrap" }}
                    position={tip} allowEscapeViewBox={{ x: true, y: false }}
                    labelFormatter={(l: string) => (byMonth ? l : `Dia ${l}`)}
                    formatter={(v: number, n: string) => [brlFull(v), n === "entradas" ? "Entradas" : "Saídas"]} />
                  {(["entradas", "saidas"] as const).map((k) => (
                    <Bar key={k} dataKey={k} fill={k === "entradas" ? "var(--success)" : "var(--destructive)"} fillOpacity={0.85}
                      radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false}>
                      <LabelList dataKey={k} position="top" formatter={fmt}
                        style={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : null}
          </div>
          {data && years.length > 1 ? (
            <div className="mt-1 flex px-1">
              {years.map((s) => (
                <div key={s.y} style={{ flexGrow: s.n, flexBasis: 0 }}
                  className="mx-0.5 border-t border-border pt-1 text-center text-[10.5px] font-semibold tabular-nums text-muted-foreground">
                  {s.y}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {data && years.length === 1 ? (
        <div className="mt-1 border-t border-border pt-1 text-center text-[10.5px] font-semibold tabular-nums text-muted-foreground">
          {years[0].y}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-center gap-4 text-[10.5px] font-medium text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-[7px] rounded-full bg-success" />Entradas</span>
        <span className="flex items-center gap-1"><span className="size-[7px] rounded-full bg-destructive" />Saídas</span>
      </div>
    </section>
  );
}

function CompareRow({ t, cur, prev, invert, last }: { t: string; cur: number; prev: number; invert?: boolean; last?: boolean }) {
  const v = pct(Math.abs(cur), Math.abs(prev));
  const up = v != null && v >= 0;
  const good = v == null ? null : invert ? !up : up;
  return (
    <li className={`flex items-center gap-3 py-2.5 ${last ? "" : "border-b border-border"}`}>
      <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-foreground">{t}</span>
      <span className="shrink-0 text-right">
        <span className="block text-[13px] font-bold tabular-nums">{brl(cur)}</span>
        <span className="block text-[10.5px] tabular-nums text-muted-foreground">antes {brl(prev)}</span>
      </span>
      <span className={`flex w-14 shrink-0 items-center justify-end gap-0.5 text-[11.5px] font-bold tabular-nums ${
        good == null ? "text-muted-foreground" : good ? "ds-ok" : "text-destructive"}`}>
        {v == null ? "—" : (
          <>
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(v) > 999 ? ">999" : Math.abs(v).toFixed(0)}%
          </>
        )}
      </span>
    </li>
  );
}

function Ritmo({ d }: { d: Data }) {
  return (
    <section className={`${PANEL_SHELL} px-3.5 py-3.5`}>
      <PanelHeading title="Ritmo do período" dotColor={SAGE} className="mb-2.5"
        right={<CalendarCheck className="size-3.5 text-muted-foreground" />} />
      <Sub>Reservas com entrada no período e saldo por conta</Sub>
      {d ? (
        <ul className="flex flex-col">
          <Linha t="Imóveis ativos" v={String(d.operacao.propriedades)} />
          <Linha t="Reservas" v={String(d.operacao.reservas)} />
          <Linha t="Noites reservadas" v={String(d.operacao.noites)} />
          {d.contas.map((c: { banco: string; numero: string; saldo: number }, i: number) => (
            <Linha key={`${c.banco}-${c.numero}`} t={`${c.banco} · ${c.numero}`} v={brl(c.saldo)} last={i === d.contas.length - 1} muted />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Linha({ t, v, last, muted }: { t: string; v: string; last?: boolean; muted?: boolean }) {
  return (
    <li className={`flex items-center justify-between gap-3 py-2.5 ${last ? "" : "border-b border-border"}`}>
      <span className={`min-w-0 truncate text-[12.5px] ${muted ? "text-muted-foreground" : "font-semibold text-foreground"}`}>{t}</span>
      <span className="shrink-0 text-[13px] font-bold tabular-nums">{v}</span>
    </li>
  );
}

function FiltersButton({ compare, onCompare, bank, onBank, span, onSpan, refPeriod, onRef, unit, active, onClear }: {
  compare: Compare; onCompare: (c: Compare) => void; bank: Bank; onBank: (b: Bank) => void;
  span: number; onSpan: (s: number) => void; refPeriod: Ref; onRef: (r: Ref) => void; unit: string;
  active: boolean; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<"root" | "view" | "ref" | "compare" | "bank">("root");
  const compareLabel: Record<Compare, string> = {
    none: "Sem comparação",
    prev: `${unit} anterior`,
    yoy: "Mesmo período do ano anterior",
  };
  const refLabel = (r: Ref) => `${unit} ${r === 0 ? "atual" : "anterior"}`;
  const pick = (fn: () => void) => { fn(); setScreen("root"); };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setScreen("root"); }}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Filtros" title="Filtros" className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE} relative`}>
          <SlidersHorizontal className={ACTION_ICON} />
          {active ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" /> : null}
        </button>
      </PopoverTrigger>
      <FitPopoverContent align="end" sideOffset={FILTER_PANEL_OFFSET} className={FILTER_PANEL_CLASS} onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => { if (screen !== "root") { e.preventDefault(); setScreen("root"); } }}
        onEscapeKeyDown={(e) => { if (screen !== "root") { e.preventDefault(); setScreen("root"); } }}>
        {screen === "root" ? (
          <>
            <FilterRootHeader canClear={active} onClear={onClear} />
            <FilterMenuRow icon={Layers} label="Visão" value={viewOf(span).label} active={span !== 12} onClick={() => setScreen("view")} />
            <FilterMenuRow icon={CalendarCheck} label="Referência" value={refLabel(refPeriod)} active={refPeriod !== 0} onClick={() => setScreen("ref")} />
            <FilterMenuRow icon={GitCompareArrows} label="Comparar" value={compareLabel[compare]} active={compare !== "prev"} onClick={() => setScreen("compare")} />
            <FilterMenuRow icon={Landmark} label="Contas" value={BANK_LABEL[bank]} active={bank !== "all"} onClick={() => setScreen("bank")} last />
          </>
        ) : screen === "view" ? (
          <>
            <FilterScreenHeader title="Visão" />
            {VIEWS.map((v, i) => (
              <FilterOptionRow key={v.span} label={v.label} selected={span === v.span} onClick={() => pick(() => onSpan(v.span))} last={i === VIEWS.length - 1} />
            ))}
          </>
        ) : screen === "ref" ? (
          <>
            <FilterScreenHeader title="Referência" />
            {([0, 1] as Ref[]).map((r) => (
              <FilterOptionRow key={r} label={refLabel(r)} selected={refPeriod === r} onClick={() => pick(() => onRef(r))} last={r === 1} />
            ))}
          </>
        ) : screen === "compare" ? (
          <>
            <FilterScreenHeader title="Comparar com" />
            {(Object.keys(compareLabel) as Compare[]).map((k, i, arr) => (
              <FilterOptionRow key={k} label={compareLabel[k]} selected={compare === k} onClick={() => pick(() => onCompare(k))} last={i === arr.length - 1} />
            ))}
          </>
        ) : (
          <>
            <FilterScreenHeader title="Contas" />
            {(Object.keys(BANK_LABEL) as Bank[]).map((k, i, arr) => (
              <FilterOptionRow key={k} label={BANK_LABEL[k]} selected={bank === k} onClick={() => pick(() => onBank(k))} last={i === arr.length - 1} />
            ))}
          </>
        )}
      </FitPopoverContent>
    </Popover>
  );
}
