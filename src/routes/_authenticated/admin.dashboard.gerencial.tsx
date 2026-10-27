import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Lock, Landmark, CreditCard, TrendingUp, TrendingDown, CalendarCheck } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { PANEL_SHELL, PanelHeading } from "@/components/dashboard/panel-chrome";
import { getExecutiveAccess, getExecutiveDashboard } from "@/lib/executive.functions";

export const Route = createFileRoute("/_authenticated/admin/dashboard/gerencial")({
  head: () => ({
    meta: [
      { title: "Gerencial — ConciergeIA" },
      { name: "description", content: "Painel estratégico da diretoria: caixa, fluxo mensal e ritmo do negócio." },
      { property: "og:title", content: "Gerencial — ConciergeIA" },
      { property: "og:description", content: "Painel estratégico da diretoria: caixa, fluxo mensal e ritmo do negócio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GerencialPage,
});

const brl = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlShort = (v: number) =>
  Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : brl(v);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesLabel = (k: string) => `${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`;

const PERIODOS = [
  { v: 3, l: "3 meses" },
  { v: 6, l: "6 meses" },
  { v: 12, l: "12 meses" },
  { v: 24, l: "24 meses" },
];

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

const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
} as const;

type Mes = { month: string; entradas: number; saidas: number; resultado: number };

function Painel() {
  const [months, setMonths] = useState(12);
  const fn = useServerFn(getExecutiveDashboard);
  const q = useQuery({ queryKey: ["executive-dashboard", months], queryFn: () => fn({ data: { months } }) });
  const d = q.data;

  const hoje = new Date()
    .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" })
    .replace(/^\w/, (c) => c.toUpperCase());

  const intel = useMemo(() => {
    if (!d) return null;
    const meses = (d.meses as Mes[]).map((m) => ({
      ...m,
      label: mesLabel(m.month),
      margem: m.entradas > 0 ? Math.round((m.resultado / m.entradas) * 100) : 0,
    }));
    // Mês corrente ainda não fechou: as médias usam só meses completos.
    const fechados = meses.length > 1 ? meses.slice(0, -1) : meses;
    const n = fechados.length || 1;
    const mediaEntradas = fechados.reduce((s, m) => s + m.entradas, 0) / n;
    const mediaSaidas = fechados.reduce((s, m) => s + m.saidas, 0) / n;
    const totalEntradas = meses.reduce((s, m) => s + m.entradas, 0);
    const totalResultado = meses.reduce((s, m) => s + m.resultado, 0);
    const pico = fechados.reduce((a, m) => (m.entradas > a.entradas ? m : a), fechados[0]);
    const positivos = fechados.filter((m) => m.resultado >= 0).length;
    const totalSaidasTop = d.topSaidas.reduce((s, p) => s + p.valor, 0);
    const queimaMensal = mediaSaidas - mediaEntradas;
    return {
      meses,
      mediaEntradas,
      mediaSaidas,
      margemPeriodo: totalEntradas > 0 ? (totalResultado / totalEntradas) * 100 : 0,
      totalResultado,
      pico,
      positivos,
      fechados: fechados.length,
      totalSaidasTop,
      // Fôlego: quantos meses o saldo cobre se o mês médio fechar negativo.
      folego: queimaMensal > 0 ? d.saldoDisponivel / queimaMensal : null,
    };
  }, [d]);

  const variacao =
    d?.mesAnterior && d.mesAnterior.entradas > 0
      ? ((d.mesAtual.entradas - d.mesAnterior.entradas) / d.mesAnterior.entradas) * 100
      : null;
  const usoLimite =
    d?.cartao?.limite && d.cartao.limite > 0 ? Math.min(100, (d.cartao.fatura / d.cartao.limite) * 100) : null;

  return (
    <div className="ds-page mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
      <div className="ds-page-heading ds-page-head">
        <p className="ds-eyebrow ds-data text-[10.5px] tracking-[0.2em]">{hoje}</p>
        <div>
          <div className="ds-page-heading min-w-0">
            <h1 className="ds-page-title !text-lg">Gerencial</h1>
            <p className="ds-page-subtitle">Caixa, fluxo mensal e ritmo do negócio para a diretoria.</p>
          </div>
          <div className="mt-5 lg:mt-2.5">
            <nav className="ds-tabs">
              {PERIODOS.map((p) => {
                const active = months === p.v;
                return (
                  <button
                    key={p.v}
                    type="button"
                    onClick={() => setMonths(p.v)}
                    className={`flex min-h-[44px] flex-1 items-center justify-center px-2 text-center text-[13px] leading-none transition-colors ${
                      active ? "ds-tab-active font-bold" : "font-semibold text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p.l}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </div>

      {q.isLoading || !d || !intel ? (
        <div className={`${PANEL_SHELL} p-4 text-sm text-muted-foreground`}>
          {q.isError ? "Não foi possível carregar o painel." : "Carregando números…"}
        </div>
      ) : (
        <>
          <div className="ds-card-grid grid-cols-2 xl:grid-cols-4">
            <Kpi icon={Landmark} label="Saldo em conta" value={brl(d.saldoDisponivel)}
              hint={intel.folego != null ? `Fôlego de ${intel.folego.toFixed(1).replace(".", ",")} meses no ritmo médio` : "Caixa crescendo no ritmo médio"}
              tone={intel.folego != null && intel.folego < 3 ? "neg" : undefined} />
            <Kpi icon={CreditCard} label="Fatura do cartão" value={brl(d.cartao?.fatura)}
              hint={usoLimite != null ? `${usoLimite.toFixed(0)}% do limite em uso` : undefined}
              bar={usoLimite ?? undefined} />
            <Kpi icon={TrendingUp} label="Entradas no mês" value={brl(d.mesAtual.entradas)}
              hint={variacao == null ? undefined : `${variacao >= 0 ? "+" : ""}${variacao.toFixed(0)}% vs. mês anterior`}
              tone={variacao != null && variacao < 0 ? "neg" : "pos"} />
            <Kpi icon={TrendingDown} label="Resultado no mês" value={brl(d.mesAtual.resultado)}
              hint={`Saídas ${brl(d.mesAtual.saidas)}`}
              tone={d.mesAtual.resultado >= 0 ? "pos" : "neg"} />
          </div>

          <section className={`${PANEL_SHELL} p-4`}>
            <PanelHeading title="Fluxo de caixa e resultado" dotColor="var(--accent)"
              right={<span className="text-[11px] text-muted-foreground tabular-nums">Margem do período {intel.margemPeriodo.toFixed(0)}%</span>} />
            <div className="h-64 w-full lg:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={intel.meses} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <ReferenceLine y={intel.mediaEntradas} stroke="var(--accent)" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.3 }} content={<FluxoTooltip />} />
                  <Bar dataKey="entradas" name="Entradas" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="saidas" name="Saídas" fill="var(--muted-foreground)" fillOpacity={0.45} radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Line dataKey="resultado" name="Resultado" type="monotone" stroke="var(--success)" strokeWidth={2}
                    dot={(p: { cx?: number; cy?: number; payload?: Mes; index?: number }) => (
                      <circle key={p.index} cx={p.cx} cy={p.cy} r={3}
                        fill={(p.payload?.resultado ?? 0) >= 0 ? "var(--success)" : "var(--destructive)"} stroke="none" />
                    )} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <Legenda cor="var(--accent)" t="Entradas" />
              <Legenda cor="var(--muted-foreground)" t="Saídas" />
              <Legenda cor="var(--success)" t="Resultado" linha />
              <span>Tracejado: média mensal de entradas</span>
            </div>
          </section>

          <div className="ds-card-grid grid-cols-2 xl:grid-cols-4">
            <Mini label="Média de entradas" value={brlShort(intel.mediaEntradas)} hint="por mês fechado" />
            <Mini label="Média de saídas" value={brlShort(intel.mediaSaidas)} hint="por mês fechado" />
            <Mini label="Mês de pico" value={intel.pico ? intel.pico.label : "—"} hint={intel.pico ? brlShort(intel.pico.entradas) : undefined} />
            <Mini label="Meses no azul" value={`${intel.positivos}/${intel.fechados}`} hint="resultado positivo" />
          </div>

          <section className={`${PANEL_SHELL} p-4`}>
            <PanelHeading title="Margem de caixa por mês" dotColor="var(--success)" />
            <div className="h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={intel.meses} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.3 }} contentStyle={TOOLTIP_STYLE}
                    formatter={(v: number) => [`${v}%`, "Sobra de caixa"]} />
                  <Bar dataKey="margem" radius={[4, 4, 4, 4]} maxBarSize={22}>
                    {intel.meses.map((m) => (
                      <Cell key={m.month} fill={m.margem >= 0 ? "var(--success)" : "var(--destructive)"} />
                    ))}
                    <LabelList dataKey="margem" position="top" formatter={(v: number) => `${v}%`}
                      style={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="ds-card-grid grid-cols-1 lg:grid-cols-3">
            <section className={`${PANEL_SHELL} p-4 lg:col-span-2`}>
              <PanelHeading title="Para onde vai o dinheiro" dotColor="var(--accent)"
                right={<span className="text-[11px] text-muted-foreground tabular-nums">{brlShort(intel.totalSaidasTop)}</span>} />
              <ul className="flex flex-col gap-2.5">
                {d.topSaidas.map((p) => {
                  const pct = intel.totalSaidasTop > 0 ? (p.valor / intel.totalSaidasTop) * 100 : 0;
                  const max = d.topSaidas[0]?.valor || 1;
                  return (
                    <li key={p.nome} className="min-w-0">
                      <div className="flex items-baseline justify-between gap-3 text-[13px]">
                        <span className="min-w-0 truncate">{p.nome}</span>
                        <span className="shrink-0 tabular-nums">
                          <span className="font-semibold">{brl(p.valor)}</span>
                          <span className="ml-2 text-[11px] text-muted-foreground">{pct.toFixed(0)}%</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(p.valor / max) * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className={`${PANEL_SHELL} p-4`}>
              <PanelHeading title="Ritmo do mês" dotColor="var(--accent)" right={<CalendarCheck className="size-3.5 text-muted-foreground" />} />
              <dl className="flex flex-col gap-2.5 text-[13px]">
                <Linha t="Imóveis ativos" v={String(d.operacao.propriedades)} />
                <Linha t="Reservas com entrada" v={String(d.operacao.reservas)} />
                <Linha t="Noites reservadas" v={String(d.operacao.noites)} />
              </dl>
              <PanelHeading title="Contas" className="mb-2.5 mt-5" />
              <ul className="flex flex-col gap-2.5 text-[13px]">
                {d.contas.map((c: { banco: string; numero: string; saldo: number }) => (
                  <li key={`${c.banco}-${c.numero}`} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-muted-foreground">{c.banco} · {c.numero}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{brl(c.saldo)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function FluxoTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: Mes & { margem: number } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2">
      <div className="mb-1 font-semibold">{label}</div>
      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Entradas</span><span className="tabular-nums">{brl(m.entradas)}</span></div>
      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Saídas</span><span className="tabular-nums">{brl(m.saidas)}</span></div>
      <div className="flex justify-between gap-4 font-semibold"><span>Resultado</span>
        <span className={`tabular-nums ${m.resultado < 0 ? "text-destructive" : "text-success"}`}>{brl(m.resultado)} · {m.margem}%</span></div>
    </div>
  );
}

function Legenda({ cor, t, linha }: { cor: string; t: string; linha?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={linha ? "h-0.5 w-3 rounded-full" : "size-2 rounded-[3px]"} style={{ background: cor }} />
      {t}
    </span>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone, bar }: { icon: typeof Landmark; label: string; value: string; hint?: string; tone?: "pos" | "neg"; bar?: number }) {
  return (
    <div className={`${PANEL_SHELL} min-w-0 p-4`}>
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-accent" />
        <span className="ds-eyebrow truncate text-[10px] tracking-[0.2em] text-muted-foreground">{label}</span>
      </div>
      <div className={`mt-2 text-lg font-bold tabular-nums lg:text-2xl ${tone === "neg" ? "text-destructive" : ""}`}>{value}</div>
      {bar != null && (
        <div className="mt-2 h-1.5 rounded-full bg-secondary">
          <div className={`h-full rounded-full ${bar > 80 ? "bg-destructive" : "bg-accent"}`} style={{ width: `${bar}%` }} />
        </div>
      )}
      {hint && <div className={`mt-1 text-[11px] ${tone === "pos" ? "text-success" : tone === "neg" ? "text-destructive" : "text-muted-foreground"}`}>{hint}</div>}
    </div>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${PANEL_SHELL} min-w-0 p-4`}>
      <div className="ds-eyebrow truncate text-[10px] tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-base font-bold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Linha({ t, v }: { t: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{t}</dt>
      <dd className="font-semibold tabular-nums">{v}</dd>
    </div>
  );
}
