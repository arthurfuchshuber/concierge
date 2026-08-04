import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  Sparkles, Loader2, Globe2, GitBranch, Bot, Wand2, ArrowUpRight, Check, X, Plus,
  ScrollText, Search, Activity, BrainCircuit,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  listGlobalInsights,
  saveGlobalInsight,
  listLearningPipeline,
  promoteLearningToGlobal,
  getAgentImprovement,
  listPromptEvolution,
  reviewPromptEvolution,
  type GlobalInsightRow,
  type PipelineRow,
  type PromptSuggestionRow,
} from "@/lib/knowledge-governance.functions";
import {
  listSystemEvents,
  getSystemEventTimeline,
  getAuditAnalytics,
  listAuditTenants,
} from "@/lib/audit.functions";

export const Route = createFileRoute("/_authenticated/admin/inteligencia")({
  head: () => ({
    meta: [
      { title: "Inteligência — Evolução da IA e auditoria do SaaS" },
      {
        name: "description",
        content:
          "Painel único da plataforma: inteligência global, pipeline de aprendizado, evolução de agentes e prompts, mais o rastro de auditoria de todo o SaaS.",
      },
      { property: "og:title", content: "Inteligência — ConciergeIA" },
      {
        property: "og:description",
        content: "Evolução da IA e auditoria completa da plataforma em um só lugar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntelligencePage,
});

function IntelligencePage() {
  const [group, setGroup] = useState<"ia" | "auditoria">("ia");

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl flex items-center gap-2">
          <BrainCircuit className="size-6 text-primary" /> Inteligência
        </h1>
        <p className="text-sm text-muted-foreground">
          Evolução da IA da plataforma e o rastro de auditoria de todo o SaaS — acessos, permissões,
          integrações, cobrança, dados e decisões.
        </p>
      </header>

      {/* Dois grupos, cada um com suas próprias abas */}
      <div className="inline-flex flex-wrap gap-2">
        <Button
          variant={group === "ia" ? "default" : "outline"}
          onClick={() => setGroup("ia")}
        >
          <Sparkles className="size-4" /> Melhoria da IA
        </Button>
        <Button
          variant={group === "auditoria" ? "default" : "outline"}
          onClick={() => setGroup("auditoria")}
        >
          <ScrollText className="size-4" /> Auditoria do SaaS
        </Button>
      </div>


      {group === "ia" ? <AiGroup /> : <AuditGroup />}
    </div>
  );
}

function AiGroup() {
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Inteligência agregada de toda a plataforma — sem expor dados de nenhum cliente específico.
      </p>
      <Tabs defaultValue="global">
        <TabsList className="w-full flex overflow-x-auto justify-start">
          <TabsTrigger value="global" className="shrink-0">Global Intelligence</TabsTrigger>
          <TabsTrigger value="pipeline" className="shrink-0">Pipeline de Aprendizado</TabsTrigger>
          <TabsTrigger value="agentes" className="shrink-0">Evolução dos Agentes</TabsTrigger>
          <TabsTrigger value="prompts" className="shrink-0">Evolução dos Prompts</TabsTrigger>
        </TabsList>
        <TabsContent value="global" className="mt-5"><GlobalTab /></TabsContent>
        <TabsContent value="pipeline" className="mt-5"><PipelineTab /></TabsContent>
        <TabsContent value="agentes" className="mt-5"><AgentsTab /></TabsContent>
        <TabsContent value="prompts" className="mt-5"><PromptsTab /></TabsContent>
      </Tabs>
    </section>
  );
}

function AuditGroup() {
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Cada ação da plataforma registrada com autor, conta, motivo, origem, canal e severidade.
      </p>
      <Tabs defaultValue="eventos">
        <TabsList className="w-full flex overflow-x-auto justify-start">
          <TabsTrigger value="eventos" className="shrink-0">Eventos</TabsTrigger>
          <TabsTrigger value="analytics" className="shrink-0">Analytics de Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="eventos" className="mt-5"><EventsTab /></TabsContent>
        <TabsContent value="analytics" className="mt-5"><AnalyticsTab /></TabsContent>
      </Tabs>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Grupo IA                                                            */
/* ------------------------------------------------------------------ */

const EMPTY_INSIGHT = {
  id: null as string | null,
  title: "",
  insight: "",
  category: "hospitalidade",
  confidence: 0.8,
  impactEstimate: "",
  status: "draft" as "draft" | "published" | "archived",
};

function GlobalTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listGlobalInsights);
  const saveFn = useServerFn(saveGlobalInsight);
  const [form, setForm] = useState<typeof EMPTY_INSIGHT | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["saas-global-insights"],
    queryFn: async () => {
      try { return await listFn({ data: {} }); } catch { return [] as GlobalInsightRow[]; }
    },
    staleTime: 60_000,
  });

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await saveFn({ data: { ...form, impactEstimate: form.impactEstimate || null } });
      toast.success("Insight salvo");
      setForm(null);
      await qc.invalidateQueries({ queryKey: ["saas-global-insights"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setForm({ ...EMPTY_INSIGHT })}><Plus className="size-4" /> Novo insight</Button>
      </div>
      {!data?.length ? (
        <Empty icon={<Globe2 className="size-5" />} title="Nenhum insight global" text="Promova aprendizados do pipeline ou cadastre boas práticas manualmente." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((g) => (
            <article key={g.id} className="rounded-2xl border border-border bg-surface p-4 space-y-2 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium leading-snug">{g.title}</h3>
                <Badge variant={g.status === "published" ? "default" : "secondary"}>{g.status}</Badge>
              </div>
              <p className="text-sm text-foreground/80 whitespace-pre-wrap">{g.insight}</p>
              <p className="text-xs text-muted-foreground">
                {g.category} · {Math.round(g.confidence * 100)}% confiança · {g.source_tenants} conta(s) ·{" "}
                {g.source_conversations} conversa(s)
              </p>
              {g.impact_estimate && <p className="text-xs rounded-lg bg-secondary/60 px-2 py-1">{g.impact_estimate}</p>}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setForm({
                    id: g.id,
                    title: g.title,
                    insight: g.insight,
                    category: g.category,
                    confidence: g.confidence,
                    impactEstimate: g.impact_estimate ?? "",
                    status: (g.status as "draft" | "published" | "archived") ?? "draft",
                  })
                }
              >
                Editar
              </Button>
            </article>
          ))}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form?.id ? "Editar insight" : "Novo insight global"}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Insight</Label>
                <Textarea rows={6} value={form.insight} onChange={(e) => setForm({ ...form, insight: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Confiança (0-1)</Label>
                  <Input
                    type="number" step="0.05" min={0} max={1}
                    value={form.confidence}
                    onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Impacto estimado</Label>
                <Input value={form.impactEstimate} onChange={(e) => setForm({ ...form, impactEstimate: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />} Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PipelineTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listLearningPipeline);
  const promoteFn = useServerFn(promoteLearningToGlobal);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["saas-learning-pipeline"],
    queryFn: async () => {
      try { return await listFn({ data: {} }); } catch { return [] as PipelineRow[]; }
    },
    staleTime: 30_000,
  });

  async function promote(id: string) {
    setBusy(id);
    try {
      await promoteFn({ data: { candidateId: id } });
      toast.success("Aprendizado promovido à inteligência global");
      await qc.invalidateQueries({ queryKey: ["saas-learning-pipeline"] });
      await qc.invalidateQueries({ queryKey: ["saas-global-insights"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível promover");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty icon={<GitBranch className="size-5" />} title="Pipeline vazio" text="Nenhum aprendizado registrado no período." />;

  return (
    <div className="space-y-3">
      {data.map((p) => (
        <article key={p.id} className="rounded-2xl border border-border bg-surface p-4 space-y-2 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="font-medium">{p.title ?? "Aprendizado"}</h3>
            <div className="flex gap-2">
              <Badge variant="secondary">{p.approval_status}</Badge>
              {p.promoted_global_id && <Badge>global</Badge>}
            </div>
          </div>
          <p className="text-sm text-foreground/80 whitespace-pre-wrap line-clamp-4">{p.content}</p>
          <p className="text-xs text-muted-foreground">
            {p.learning_type ?? "regra"} · escopo {p.approved_scope ?? p.suggested_scope ?? "—"} ·{" "}
            {p.confidence == null ? "—" : `${Math.round(p.confidence * 100)}% confiança`} ·{" "}
            {new Date(p.created_at).toLocaleDateString("pt-BR")}
          </p>
          {p.approval_status === "approved" && !p.promoted_global_id && (
            <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => promote(p.id)}>
              <ArrowUpRight className="size-4" /> Promover para global
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}

function AgentsTab() {
  const fn = useServerFn(getAgentImprovement);
  const { data, isLoading } = useQuery({
    queryKey: ["saas-agent-improvement"],
    queryFn: async () => {
      try { return await fn({ data: { days: 30 } }); } catch { return []; }
    },
    staleTime: 60_000,
  });

  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty icon={<Bot className="size-5" />} title="Sem dados de agentes" text="Ainda não há interações suficientes nos últimos 30 dias." />;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-3">Agente</th>
            <th className="text-right px-4 py-3">Interações</th>
            <th className="text-right px-4 py-3">Resolução</th>
            <th className="text-right px-4 py-3">Escalonamentos</th>
            <th className="text-right px-4 py-3">Erros</th>
            <th className="text-right px-4 py-3">Confiança</th>
            <th className="text-right px-4 py-3">Sugestões</th>
          </tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.agent} className="border-t border-border">
              <td className="px-4 py-3 font-medium">{a.agent}</td>
              <td className="px-4 py-3 text-right">{a.interactions}</td>
              <td className="px-4 py-3 text-right">{a.resolutionRate == null ? "—" : `${Math.round(a.resolutionRate * 100)}%`}</td>
              <td className="px-4 py-3 text-right">{a.escalations}</td>
              <td className="px-4 py-3 text-right">{a.errors}</td>
              <td className="px-4 py-3 text-right">{a.avgConfidence == null ? "—" : a.avgConfidence.toFixed(2)}</td>
              <td className="px-4 py-3 text-right">{a.suggestions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PromptsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPromptEvolution);
  const reviewFn = useServerFn(reviewPromptEvolution);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["saas-prompt-evolution"],
    queryFn: async () => {
      try { return await listFn({ data: {} }); } catch { return [] as PromptSuggestionRow[]; }
    },
    staleTime: 30_000,
  });

  async function review(id: string, status: "approved" | "rejected") {
    setBusy(id);
    try {
      await reviewFn({ data: { id, status } });
      toast.success(status === "approved" ? "Sugestão aprovada" : "Sugestão rejeitada");
      await qc.invalidateQueries({ queryKey: ["saas-prompt-evolution"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível revisar");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <Loading />;
  if (!data?.length) return <Empty icon={<Wand2 className="size-5" />} title="Nenhuma sugestão de prompt" text="O otimizador cria sugestões quando detecta padrões repetidos de falha." />;

  return (
    <div className="space-y-3">
      {data.map((s) => (
        <article key={s.id} className="rounded-2xl border border-border bg-surface p-4 space-y-2 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="font-medium">
              {s.prompt_key} {s.prompt_version ? <span className="text-muted-foreground">· {s.prompt_version}</span> : null}
            </h3>
            <Badge variant="secondary">{s.status}</Badge>
          </div>
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{s.suggestion}</p>
          {s.reason && <p className="text-xs text-muted-foreground">Motivo: {s.reason}</p>}
          {s.expected_impact && <p className="text-xs rounded-lg bg-secondary/60 px-2 py-1">{s.expected_impact}</p>}
          {s.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" disabled={busy === s.id} onClick={() => review(s.id, "approved")}><Check className="size-4" /> Aprovar</Button>
              <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => review(s.id, "rejected")}><X className="size-4" /> Rejeitar</Button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grupo Auditoria do SaaS                                             */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  "AUTHENTICATION",
  "PERMISSIONS",
  "USER_MANAGEMENT",
  "CONVERSATION",
  "AI_DECISION",
  "MEMORY",
  "LEARNING",
  "INTEGRATIONS",
  "SECURITY",
  "ACTIVITY",
  "SERVER_CALL",
  "ERROR",
] as const;


const SEVERITIES = ["info", "notice", "warning", "error", "critical"] as const;

const SEVERITY_STYLE: Record<string, string> = {
  info: "bg-secondary text-secondary-foreground",
  notice: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  error: "bg-red-500/15 text-red-600 dark:text-red-300",
  critical: "bg-red-600 text-white",
};

type Row = Record<string, unknown>;

function EventsTab() {
  const listFn = useServerFn(listSystemEvents);
  const tenantsFn = useServerFn(listAuditTenants);
  const timelineFn = useServerFn(getSystemEventTimeline);

  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [tenantId, setTenantId] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const tenants = useQuery({
    queryKey: ["audit-tenants"],
    queryFn: async () => {
      try { return await tenantsFn(); } catch { return []; }
    },
    staleTime: 5 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["audit-events", applied, category, severity, tenantId, page],
    queryFn: async () => {
      try {
        return await listFn({
          data: {
            search: applied || null,
            eventCategory: category === "all" ? null : category,
            severity: severity === "all" ? null : severity,
            tenantId: tenantId === "all" ? null : tenantId,
            limit: 50,
            offset: page * 50,
          },
        });
      } catch {
        return { rows: [] as Row[], total: 0 };
      }
    },
    staleTime: 10_000,
  });

  const timeline = useQuery({
    queryKey: ["audit-timeline", selected],
    enabled: !!selected,
    queryFn: async () => {
      try { return await timelineFn({ data: { eventId: selected as string } }); } catch { return null; }
    },
  });

  const rows = (data?.rows ?? []) as Row[];
  const total = data?.total ?? 0;

  const activeFilters =
    (category !== "all" ? 1 : 0) + (severity !== "all" ? 1 : 0) + (tenantId !== "all" ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por descrição, autor ou motivo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); setApplied(search); } }}
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="relative shrink-0" aria-label="Filtros">
              <SlidersHorizontal className="size-4" />
              {activeFilters > 0 && (
                <span className="absolute -top-1 -right-1 size-4 rounded-full bg-primary text-primary-foreground text-[10px] grid place-items-center">
                  {activeFilters}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Categoria</Label>
              <Select value={category} onValueChange={(v) => { setCategory(v); setPage(0); }}>
                <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Severidade</Label>
              <Select value={severity} onValueChange={(v) => { setSeverity(v); setPage(0); }}>
                <SelectTrigger><SelectValue placeholder="Severidade" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(tenants.data?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Conta</Label>
                <Select value={tenantId} onValueChange={(v) => { setTenantId(v); setPage(0); }}>
                  <SelectTrigger><SelectValue placeholder="Conta" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as contas</SelectItem>
                    {(tenants.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={() => { setCategory("all"); setSeverity("all"); setTenantId("all"); setPage(0); }}
              >
                Limpar
              </Button>
              <Button size="sm" className="flex-1" onClick={() => { setPage(0); setApplied(search); }}>
                Aplicar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {isLoading ? (
        <Loading />
      ) : !rows.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum evento encontrado com esses filtros.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-left px-4 py-3">Hora</th>
                <th className="text-left px-4 py-3">Autor</th>
                <th className="text-left px-4 py-3">Tipo de autor</th>
                <th className="text-left px-4 py-3">Evento</th>
                <th className="text-left px-4 py-3">Categoria</th>
                <th className="text-left px-4 py-3">Descrição</th>
                <th className="text-left px-4 py-3">Severidade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const when = new Date(String(r.created_at));
                return (
                <tr
                  key={String(r.id)}
                  className="border-t border-border hover:bg-secondary/40 cursor-pointer align-top"
                  onClick={() => setSelected(String(r.id))}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                    {when.toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                    {when.toLocaleTimeString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    {String(r.actor_name ?? r.actor_id ?? "visitante")}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {String(r.actor_type ?? "—")}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{String(r.event_type ?? "")}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {String(r.event_category ?? "")}
                  </td>
                  <td className="px-4 py-3 min-w-[280px]">{String(r.description ?? "—")}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${SEVERITY_STYLE[String(r.severity ?? "info")] ?? ""}`}>
                      {String(r.severity ?? "info")}
                    </span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}


      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} evento(s)</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <Button variant="outline" size="sm" disabled={(page + 1) * 50 >= total} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader><SheetTitle>Timeline de investigação</SheetTitle></SheetHeader>
          {timeline.isLoading ? (
            <Loading />
          ) : !timeline.data ? (
            <p className="text-sm text-muted-foreground mt-6">Evento não encontrado.</p>
          ) : (
            <div className="mt-6 space-y-4">
              <EventCard row={timeline.data.event as Row} highlight />
              {(timeline.data.related as Row[]).map((r) => (
                <EventCard key={String(r.id)} row={r} />
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function EventCard({ row, highlight }: { row: Row; highlight?: boolean }) {
  return (
    <article
      className={`rounded-xl border p-3 space-y-1 ${highlight ? "border-primary bg-primary/5" : "border-border bg-surface"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{String(row.event_type ?? "")}</span>
        <Badge variant="secondary">{String(row.event_category ?? "")}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {new Date(String(row.created_at)).toLocaleString("pt-BR")} · {String(row.actor_name ?? row.actor_id ?? "sistema")}
      </p>
      {row.description ? <p className="text-sm">{String(row.description)}</p> : null}
      {row.reason ? <p className="text-xs text-muted-foreground">Motivo: {String(row.reason)}</p> : null}
      {row.channel ? <p className="text-xs text-muted-foreground">Canal: {String(row.channel)}</p> : null}
    </article>
  );
}

function AnalyticsTab() {
  const fn = useServerFn(getAuditAnalytics);
  const { data, isLoading } = useQuery({
    queryKey: ["audit-analytics"],
    queryFn: async () => {
      try { return await fn({ data: { days: 30 } }); } catch { return null; }
    },
    staleTime: 60_000,
  });

  if (isLoading) return <Loading />;
  if (!data) return <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Sem dados no período.</div>;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Kpi label="Eventos (30d)" value={data.total} />
        <Kpi label="Falhas de permissão" value={data.permissionFailures} />
        <Kpi label="Mudanças administrativas" value={data.adminChanges} />
        <Kpi label="Aprendizados gerados" value={data.learningGenerated} />
        <Kpi label="Conhecimento aplicado" value={data.knowledgeApplied} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard title="Por categoria" rows={data.byCategory.map((c) => ({ label: c.category, value: c.count }))} />
        <ListCard title="Por severidade" rows={data.bySeverity.map((c) => ({ label: c.severity, value: c.count }))} />
        <ListCard title="Usuários mais ativos" rows={data.topActors.map((a) => ({ label: `${a.actor} (${a.actorType})`, value: a.count }))} />
        <ListCard title="Agentes mais acionados" rows={data.topAgents.map((a) => ({ label: a.agent, value: a.count }))} />
        <ListCard title="Erros por integração" rows={data.integrationErrors.map((i) => ({ label: i.integration, value: i.count }))} />
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function ListCard({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm space-y-2">
      <h3 className="font-medium flex items-center gap-2 text-sm">
        <Activity className="size-4 text-primary" /> {title}
      </h3>
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">Sem registros.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between text-sm">
              <span className="truncate pr-3">{r.label}</span>
              <span className="text-muted-foreground tabular-nums">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid place-items-center py-16 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center space-y-2">
      <div className="grid place-items-center text-muted-foreground">{icon}</div>
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{text}</p>
    </div>
  );
}
