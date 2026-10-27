import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import {
  ArrowDownRight, ArrowUpRight, CalendarCheck, CreditCard, GitCompareArrows, Landmark, Lock,
  SlidersHorizontal, Wallet,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { StatCard } from "@/components/ds/StatCard";
import { PANEL_SHELL, PanelHeading, ACTION_SEGMENT, ACTION_BUTTON_TONE, ACTION_ICON } from "@/components/dashboard/panel-chrome";
import { PeriodQuickFilterButton, type QuickPeriod } from "@/components/dashboard/PeriodQuickFilterButton";
import {
  FILTER_PANEL_CLASS, FILTER_PANEL_OFFSET, FilterHeaderClear, FilterIconBadge, FilterOptionRow, FitPopoverContent,
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
const COMPARE_LABEL: Record<Compare, string> = { none: "Sem comparação", prev: "Mês anterior", yoy: "Mesmo período do ano anterior" };
const BANK_LABEL: Record<Bank, string> = { all: "Todas as contas", btg: "Somente BTG", nubank: "Somente Nubank" };

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
  const range = period ?? currentMonth();

  const fn = useServerFn(getExecutiveDashboard);
  const q = useQuery({
    queryKey: ["executive-dashboard", range.start, range.end, compare, bank],
    queryFn: () => fn({ data: { ...range, compare, bank } }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const d = q.data;

  const hoje = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long",
  });

  const c = d?.comparacao ?? null;
  const vsLabel = compare === "prev" ? "vs. mês anterior" : "vs. ano anterior";
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
  const filtersOn = compare !== "prev" || bank !== "all";

  return (
    <div className="ds-page mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
      {/* Cabeçalho: o mesmo desenho do Financeiro (data, título, subtítulo, aba). */}
      <div className="ds-page-heading ds-page-head">
        <p className="ds-eyebrow ds-data text-[10.5px] tracking-[0.2em]">{hoje}</p>
        <div className="ds-page-heading min-w-0">
          <h1 className="ds-page-title !text-lg">Gerencial</h1>
          <p className="ds-page-subtitle">Caixa, fluxo e ritmo da empresa para a diretoria.</p>
        </div>
        <div className="mt-5 lg:mt-2.5">
          <nav className="ds-tabs">
            <span className="ds-tab-active flex min-h-[44px] flex-1 items-center justify-center px-2 text-center text-[13px] font-bold leading-none">
              Visão Geral
            </span>
          </nav>
        </div>
      </div>

      <div className="ds-card-grid">
        <div className="ds-card-grid grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Landmark} label="Saldo em conta" value={brl(d?.saldoDisponivel)} loading={!d}
            note={d ? (() => {
              const comSaldo = d.contas.filter((x: { saldo: number }) => Math.abs(x.saldo) >= 0.01);
              const txt = comSaldo.length === 1
                ? `${comSaldo[0].banco} · ${comSaldo[0].numero}`
                : `${comSaldo.length} ${comSaldo.length === 1 ? "conta" : "contas"}`;
              return <span className="font-medium text-muted-foreground">{txt}</span>;
            })() : null} />
          <StatCard icon={CreditCard} label="Fatura do cartão" value={d?.cartao ? brl(d.cartao.fatura) : "—"} loading={!d}
            note={usoLimite != null ? (
              <span className="flex w-full items-center gap-1.5 px-1">
                <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/45" style={{ width: `${Math.max(2, usoLimite)}%` }} />
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">{usoLimite.toFixed(0)}%</span>
              </span>
            ) : null} />
          <StatCard icon={ArrowDownRight} label="Entradas" value={brl(d?.atual.entradas)} loading={!d}
            note={d ? delta(d.atual.entradas, c?.entradas) : null} />
          <StatCard icon={Wallet} label="Resultado" value={brl(d?.atual.resultado)} loading={!d}
            note={d ? <span className="font-medium text-muted-foreground">Saídas {brl(d.atual.saidas)}</span> : null} />
        </div>
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

function FlowChart({ title, color, dataKey, data }: { title: string; color: string; dataKey: "entradas" | "saidas"; data: Data }) {
  const byMonth = data?.periodo.granularidade === "mes";
  const rows = (data?.serie ?? []).map((s) => ({
    ...s,
    label: byMonth ? `${MESES[Number(s.key.slice(5, 7)) - 1]}/${s.key.slice(2, 4)}` : s.key.slice(8, 10),
  }));
  const total = rows.reduce((s, r) => s + r[dataKey], 0);
  const showLabels = rows.length <= 12;
  return (
    <section className={`${PANEL_SHELL} w-full px-3.5 py-3.5`}>
      <PanelHeading title={`${title} · ${byMonth ? "por mês" : "por dia"}`} dotColor={color} className="mb-2.5"
        right={data ? <span className="text-[11px] font-semibold tabular-nums text-foreground/80">{brl(total)}</span> : null} />
      <Sub>{data ? periodLabel(data.periodo) : "Carregando…"}</Sub>
      <div className="h-36 w-full">
        {data ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 14, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false}
                interval="preserveStartEnd" minTickGap={8} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.3 }} contentStyle={TOOLTIP_STYLE}
                labelFormatter={(l: string) => (byMonth ? l : `Dia ${l}`)}
                formatter={(v: number) => [brlFull(v), title]} />
              <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                {showLabels ? (
                  <LabelList dataKey={dataKey} position="top"
                    formatter={(v: number) => (v ? brlShort(v) : "")}
                    style={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                ) : null}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : null}
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

function FiltersButton({ compare, onCompare, bank, onBank, active }: {
  compare: Compare; onCompare: (c: Compare) => void; bank: Bank; onBank: (b: Bank) => void; active: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Filtros" title="Filtros" className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE} relative`}>
          <SlidersHorizontal className={ACTION_ICON} />
          {active ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" /> : null}
        </button>
      </PopoverTrigger>
      <FitPopoverContent align="end" sideOffset={FILTER_PANEL_OFFSET} className={FILTER_PANEL_CLASS} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-[9px] border-b border-border px-3.5 py-[11px]">
          <FilterIconBadge icon={GitCompareArrows} size="sm" />
          <span className="ds-card-title min-w-0 flex-1">Comparar com</span>
          {active ? <FilterHeaderClear onClick={() => { onCompare("prev"); onBank("all"); }} /> : null}
        </div>
        {(Object.keys(COMPARE_LABEL) as Compare[]).map((k, i, arr) => (
          <FilterOptionRow key={k} label={COMPARE_LABEL[k]} selected={compare === k} onClick={() => onCompare(k)} last={i === arr.length - 1} />
        ))}
        <div className="flex items-center gap-[9px] border-y border-border px-3.5 py-[11px]">
          <FilterIconBadge icon={Landmark} size="sm" />
          <span className="ds-card-title min-w-0 flex-1">Contas</span>
        </div>
        {(Object.keys(BANK_LABEL) as Bank[]).map((k, i, arr) => (
          <FilterOptionRow key={k} label={BANK_LABEL[k]} selected={bank === k} onClick={() => onBank(k)} last={i === arr.length - 1} />
        ))}
      </FitPopoverContent>
    </Popover>
  );
}
