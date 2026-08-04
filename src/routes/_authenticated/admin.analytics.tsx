import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { checkIsAdmin } from "@/lib/admin-subs.functions";
import {
  getSaasAnalytics,
  listSaasAlerts,
  acknowledgeSaasAlert,
  runAlertScan,
} from "@/lib/saas-analytics.functions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Activity, Brain, Wrench, Users, DollarSign, BellRing, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  beforeLoad: async () => {
    try {
      const res = await checkIsAdmin();
      if (!res.isAdmin) throw redirect({ to: "/admin" });
    } catch {
      throw redirect({ to: "/admin" });
    }
  },
  head: () => ({
    meta: [
      { title: "Analytics da Plataforma | Sigma Concierge" },
      { name: "description", content: "Painel executivo com eficiência da IA, operação, experiência do hóspede, custos e alertas inteligentes." },
      { property: "og:title", content: "Analytics da Plataforma | Sigma Concierge" },
      { property: "og:description", content: "Visão consolidada de IA, operação, custos e saúde da plataforma." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalyticsPage,
});

type PeriodKey = "today" | "7d" | "30d" | "90d";
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
];

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function AnalyticsPage() {
  const analyticsFn = useServerFn(getSaasAnalytics);
  const alertsFn = useServerFn(listSaasAlerts);
  const ackFn = useServerFn(acknowledgeSaasAlert);
  const scanFn = useServerFn(runAlertScan);
  const qc = useQueryClient();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [scanning, setScanning] = useState(false);

  const analytics = useQuery({
    queryKey: ["saas-analytics", period],
    queryFn: () => analyticsFn({ data: { period } }),
  });

  const alerts = useQuery({
    queryKey: ["saas-alerts"],
    queryFn: () => alertsFn({ data: { status: "open" } }),
  });

  const d = analytics.data;

  async function handleScan() {
    setScanning(true);
    try {
      const res = await scanFn();
      toast.success(`${res.created} novo(s) alerta(s) identificado(s)`);
      qc.invalidateQueries({ queryKey: ["saas-alerts"] });
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setScanning(false);
    }
  }

  async function handleAck(id: string) {
    try {
      await ackFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["saas-alerts"] });
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Analytics da Plataforma</h1>
          <p className="text-sm text-muted-foreground">Eficiência da IA, operação, hóspedes, custos e saúde geral.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={period === p.key ? "default" : "outline"}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={handleScan} disabled={scanning}>
            {scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
            Varrer alertas
          </Button>
        </div>
      </header>

      {analytics.isLoading ? (
        <div className="flex items-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando métricas…
        </div>
      ) : !d ? (
        <p className="p-8 text-sm text-muted-foreground">Sem dados no período.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi label="Health Score" value={`${d.healthScore}`} hint="0–100" />
            <Kpi label="Resolução IA" value={`${d.ai.resolutionRate}%`} hint={`${d.ai.interactions} interações`} />
            <Kpi label="Escalonamento" value={`${d.ai.escalationRate}%`} />
            <Kpi label="Custo total" value={`US$ ${d.cost.totalUsd.toFixed(2)}`} hint={`US$ ${d.cost.costPerResolution.toFixed(4)}/resolução`} />
            <Kpi label="Hóspedes atendidos" value={`${d.usage.guestsServed}`} hint={`${d.usage.conversations} conversas`} />
          </div>

          <Tabs defaultValue="ia">
            <TabsList className="flex w-full flex-wrap justify-start">
              <TabsTrigger value="ia">IA</TabsTrigger>
              <TabsTrigger value="operacao">Operação</TabsTrigger>
              <TabsTrigger value="hospede">Hóspede</TabsTrigger>
              <TabsTrigger value="custos">Custos</TabsTrigger>
              <TabsTrigger value="alertas">
                Alertas {alerts.data?.length ? <Badge className="ml-2">{alerts.data.length}</Badge> : null}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ia" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Confiança média" value={d.ai.avgConfidence.toFixed(2)} />
                <Kpi label="Qualidade (reflexão)" value={d.ai.reflectionQuality.toFixed(2)} />
                <Kpi label="Latência média" value={`${d.ai.avgLatencyMs} ms`} />
                <Kpi label="Mensagens" value={`${d.usage.messages}`} />
              </div>
              <Panel title="Desempenho por agente" icon={<Brain className="h-4 w-4" />}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr><th className="py-2">Agente</th><th>Execuções</th><th>Resolução</th><th>Confiança</th><th>Latência</th></tr>
                    </thead>
                    <tbody>
                      {d.ai.agentPerformance.map((a) => (
                        <tr key={a.agent} className="border-t">
                          <td className="py-2 font-medium">{a.agent}</td>
                          <td>{a.runs}</td>
                          <td>{a.resolutionRate}%</td>
                          <td>{a.avgConfidence.toFixed(2)}</td>
                          <td>{a.avgLatencyMs} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <Panel title="Volume por canal" icon={<Activity className="h-4 w-4" />}>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(d.usage.byChannel).map(([ch, n]) => (
                    <Badge key={ch} variant="secondary">{ch}: {n}</Badge>
                  ))}
                  {Object.keys(d.usage.byChannel).length === 0 ? <p className="text-sm text-muted-foreground">Sem tráfego.</p> : null}
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="operacao" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Chamados criados" value={`${d.operations.ticketsCreated}`} />
                <Kpi label="Chamados resolvidos" value={`${d.operations.ticketsResolved}`} />
                <Kpi label="Tempo médio" value={`${d.operations.avgResolutionMinutes} min`} />
                <Kpi label="Imóveis conectados" value={`${d.usage.connectedProperties}`} />
              </div>
              <Panel title="Problemas recorrentes por imóvel" icon={<Wrench className="h-4 w-4" />}>
                {d.operations.recurringIssues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma recorrência relevante.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {d.operations.recurringIssues.map((r) => (
                      <li key={r.propertyId} className="flex justify-between border-b py-1">
                        <span className="font-mono text-xs">{r.propertyId}</span>
                        <span>{r.issues} ocorrências</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="Categorias mais solicitadas" icon={<Activity className="h-4 w-4" />}>
                <div className="flex flex-wrap gap-2">
                  {d.operations.topCategories.map((c) => (
                    <Badge key={c.category} variant="outline">{c.category}: {c.count}</Badge>
                  ))}
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="hospede" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Satisfação média" value={d.guest.avgSatisfaction ? d.guest.avgSatisfaction.toFixed(2) : "—"} />
                <Kpi label="Reclamações" value={`${d.guest.complaints}`} />
                <Kpi label="Hóspedes recorrentes" value={`${d.guest.returningGuests}`} />
                <Kpi label="Upsells sugeridos" value={`${d.commercial.upsellsSuggested}`} hint={`${d.commercial.upsellsAccepted} aceitos`} />
              </div>
              <Panel title="Sentimento e idiomas" icon={<Users className="h-4 w-4" />}>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(d.guest.sentimentBreakdown).map(([s, n]) => (
                    <Badge key={s} variant="secondary">{s}: {n}</Badge>
                  ))}
                  {d.guest.languages.map((l) => (
                    <Badge key={l.language} variant="outline">{l.language}: {l.count}</Badge>
                  ))}
                </div>
              </Panel>
            </TabsContent>

            <TabsContent value="custos" className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Tokens entrada" value={d.cost.tokensIn.toLocaleString("pt-BR")} />
                <Kpi label="Tokens saída" value={d.cost.tokensOut.toLocaleString("pt-BR")} />
                <Kpi label="Custo/conversa" value={`US$ ${d.cost.costPerConversation.toFixed(4)}`} />
                <Kpi label="Contas ativas" value={`${d.usage.activeTenants}`} />
              </div>
              <Panel title="Custo por conta" icon={<DollarSign className="h-4 w-4" />}>
                <ul className="space-y-1 text-sm">
                  {d.cost.byTenant.map((t) => (
                    <li key={t.tenantId} className="flex justify-between border-b py-1">
                      <span className="font-mono text-xs">{t.tenantId}</span>
                      <span>US$ {t.costUsd.toFixed(4)} · {t.interactions} interações</span>
                    </li>
                  ))}
                  {d.cost.byTenant.length === 0 ? <p className="text-sm text-muted-foreground">Sem custos registrados.</p> : null}
                </ul>
              </Panel>
            </TabsContent>

            <TabsContent value="alertas" className="mt-4">
              <Panel title="Alertas abertos" icon={<BellRing className="h-4 w-4" />}>
                {alerts.isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : !alerts.data?.length ? (
                  <p className="text-sm text-muted-foreground">Nenhum alerta aberto.</p>
                ) : (
                  <ul className="space-y-2">
                    {alerts.data.map((a) => (
                      <li key={a.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge variant={a.severity === "critical" ? "destructive" : "secondary"}>{a.severity}</Badge>
                            <span className="text-sm font-medium">{a.title}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{a.detail}</p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => handleAck(a.id)}>
                          <CheckCircle2 className="mr-1 h-4 w-4" /> Ciente
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
