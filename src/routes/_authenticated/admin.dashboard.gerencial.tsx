import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Lock, Landmark, CreditCard, TrendingUp, TrendingDown, CalendarCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
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

function Painel() {
  const [months, setMonths] = useState(12);
  const fn = useServerFn(getExecutiveDashboard);
  const q = useQuery({ queryKey: ["executive-dashboard", months], queryFn: () => fn({ data: { months } }) });
  const d = q.data;
  const variacao =
    d?.mesAnterior && d.mesAnterior.entradas > 0
      ? ((d.mesAtual.entradas - d.mesAnterior.entradas) / d.mesAnterior.entradas) * 100
      : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
      <header className="flex flex-col gap-2.5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Diretoria</p>
          <h1 className="text-2xl font-bold">Gerencial</h1>
          <p className="text-sm text-muted-foreground">Caixa, fluxo mensal e ritmo do negócio em uma só visão.</p>
        </div>
        <div className="ds-scroll-x flex gap-1 rounded-xl bg-secondary p-1">
          {PERIODOS.map((p) => (
            <button
              key={p.v}
              type="button"
              onClick={() => setMonths(p.v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                months === p.v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.l}
            </button>
          ))}
        </div>
      </header>

      {q.isLoading || !d ? (
        <div className="mt-6 text-sm text-muted-foreground">{q.isError ? "Não foi possível carregar o painel." : "Carregando números…"}</div>
      ) : (
        <div className="mt-6 flex flex-col gap-2.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={Landmark} label="Saldo em conta" value={brl(d.saldoDisponivel)} hint={`${d.contas.filter((c) => c.saldo > 0).length} conta(s) com saldo`} />
            <Kpi
              icon={CreditCard}
              label="Fatura aberta do cartão"
              value={brl(d.cartao?.fatura)}
              hint={d.cartao?.disponivel ? `Limite disponível ${brl(d.cartao.disponivel)}` : undefined}
            />
            <Kpi
              icon={TrendingUp}
              label="Entradas no mês"
              value={brl(d.mesAtual.entradas)}
              hint={variacao == null ? undefined : `${variacao >= 0 ? "+" : ""}${variacao.toFixed(0)}% vs. mês anterior`}
            />
            <Kpi
              icon={TrendingDown}
              label="Resultado de caixa no mês"
              value={brl(d.mesAtual.resultado)}
              hint={`Saídas ${brl(d.mesAtual.saidas)}`}
              tone={d.mesAtual.resultado >= 0 ? "pos" : "neg"}
            />
          </div>

          <section className={`${PANEL_SHELL} p-4`}>
            <h2 className="text-sm font-bold">Entradas x saídas por mês</h2>
            <p className="text-xs text-muted-foreground">Movimentos entre contas da própria empresa ficam de fora.</p>
            <div className="mt-3 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.meses.map((m) => ({ ...m, label: mesLabel(m.month) }))}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={brlShort} width={80} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v: number) => brl(v)}
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
                  />
                  <Bar dataKey="entradas" name="Entradas" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="saidas" name="Saídas" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
            <section className={`${PANEL_SHELL} p-4 lg:col-span-2`}>
              <h2 className="text-sm font-bold">Maiores destinos de saída no período</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {d.topSaidas.map((p) => {
                  const max = d.topSaidas[0]?.valor || 1;
                  return (
                    <li key={p.nome} className="min-w-0">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">{p.nome}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{brl(p.valor)}</span>
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
              <h2 className="flex items-center gap-2 text-sm font-bold"><CalendarCheck className="size-4 text-accent" /> Ritmo do mês</h2>
              <dl className="mt-3 grid grid-cols-1 gap-3 text-sm">
                <Linha t="Imóveis ativos" v={String(d.operacao.propriedades)} />
                <Linha t="Reservas com entrada no mês" v={String(d.operacao.reservas)} />
                <Linha t="Noites reservadas" v={String(d.operacao.noites)} />
              </dl>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contas</h3>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {d.contas.map((c) => (
                  <li key={`${c.banco}-${c.numero}`} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{c.banco} · {c.numero}</span>
                    <span className="shrink-0 tabular-nums">{brl(c.saldo)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: typeof Landmark; label: string; value: string; hint?: string; tone?: "pos" | "neg" }) {
  return (
    <div className={`${PANEL_SHELL} p-4`}>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Icon className="size-4 text-accent" /> {label}
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${tone === "neg" ? "text-destructive" : ""}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
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
