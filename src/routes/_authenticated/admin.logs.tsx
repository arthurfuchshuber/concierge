import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ScrollText, Loader2, Search, Activity } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  listSystemEvents,
  getSystemEventTimeline,
  getAuditAnalytics,
  listAuditTenants,
} from "@/lib/audit.functions";

export const Route = createFileRoute("/_authenticated/admin/logs")({
  head: () => ({
    meta: [
      { title: "Logs & Auditoria — Rastro completo do ConciergeIA" },
      {
        name: "description",
        content:
          "Log viewer corporativo: quem fez o quê, quando, em qual conta, com qual permissão e por quê — com timeline de investigação.",
      },
      { property: "og:title", content: "Logs & Auditoria — ConciergeIA" },
      { property: "og:description", content: "Rastro completo de decisões, acessos e integrações da plataforma." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LogsPage,
});

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

function LogsPage() {
  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl flex items-center gap-2">
          <ScrollText className="size-6 text-primary" /> Logs & Auditoria
        </h1>
        <p className="text-sm text-muted-foreground">
          Cada ação registrada com autor, conta, motivo, canal e severidade.
        </p>
      </header>

      <Tabs defaultValue="eventos">
        <TabsList className="w-full flex overflow-x-auto justify-start">
          <TabsTrigger value="eventos" className="shrink-0">Eventos</TabsTrigger>
          <TabsTrigger value="analytics" className="shrink-0">Analytics de Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="eventos" className="mt-5"><EventsTab /></TabsContent>
        <TabsContent value="analytics" className="mt-5"><AnalyticsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por descrição, autor ou motivo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); setApplied(search); } }}
          />
        </div>
        <Select value={category} onValueChange={(v) => { setCategory(v); setPage(0); }}>
          <SelectTrigger className="w-[190px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={(v) => { setSeverity(v); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Severidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {(tenants.data?.length ?? 0) > 0 && (
          <Select value={tenantId} onValueChange={(v) => { setTenantId(v); setPage(0); }}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Conta" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as contas</SelectItem>
              {(tenants.data ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" onClick={() => { setPage(0); setApplied(search); }}>Filtrar</Button>
      </div>

      {isLoading ? (
        <Loading />
      ) : !rows.length ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nenhum evento encontrado com esses filtros.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Quando</th>
                <th className="text-left px-4 py-3">Autor</th>
                <th className="text-left px-4 py-3">Evento</th>
                <th className="text-left px-4 py-3">Descrição</th>
                <th className="text-left px-4 py-3">Severidade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={String(r.id)}
                  className="border-t border-border hover:bg-secondary/40 cursor-pointer"
                  onClick={() => setSelected(String(r.id))}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {new Date(String(r.created_at)).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{String(r.actor_name ?? r.actor_id ?? "—")}</div>
                    <div className="text-xs text-muted-foreground">{String(r.actor_type ?? "")}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{String(r.event_type ?? "")}</div>
                    <div className="text-xs text-muted-foreground">{String(r.event_category ?? "")}</div>
                  </td>
                  <td className="px-4 py-3 max-w-md truncate">{String(r.description ?? "")}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${SEVERITY_STYLE[String(r.severity ?? "info")] ?? ""}`}>
                      {String(r.severity ?? "info")}
                    </span>
                  </td>
                </tr>
              ))}
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
