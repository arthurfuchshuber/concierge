import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { Loader2, Sparkles, ArrowLeft } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { getEngagementAnalytics } from "@/lib/engagement-analytics.functions";
import { getEngagementGuests } from "@/lib/engagement-guests.functions";
import { checkIsAdmin } from "@/lib/admin-subs.functions";
import { useSubscription } from "@/hooks/useSubscription";
import { AiPlanLock } from "@/components/admin/AiPlanLock";

import { FiltersIconButton, type EngagementFilters } from "@/components/engagement/GlobalFilters";
import { InsightsRibbon } from "@/components/engagement/InsightsRibbon";
import { KpiStrip } from "@/components/engagement/KpiStrip";
import { TrendChart } from "@/components/engagement/TrendChart";
import { PropertiesDotPlot } from "@/components/engagement/PropertiesDotPlot";
import { Funnel } from "@/components/engagement/Funnel";
import { SectionsBar } from "@/components/engagement/SectionsBar";
import { ContentImpactMatrix } from "@/components/engagement/ContentImpactMatrix";
import { FeedbackList } from "@/components/engagement/FeedbackList";
import { PoiInsights } from "@/components/engagement/PoiInsights";
import { DetailSheet, type DetailTarget } from "@/components/engagement/DetailSheet";
import { DurationBuckets, DepthCurve } from "@/components/engagement/EngagementBars";
import { GuestsTable } from "@/components/engagement/GuestsTable";

import { computeInsights } from "@/components/engagement/insights";

const searchSchema = z.object({
  period: fallback(z.string(), "30d").default("30d"),
  property: fallback(z.string(), "all").default("all"),
  device: fallback(z.string(), "all").default("all"),
  tab: fallback(z.string(), "panorama").default("panorama"),
  q: fallback(z.string(), "").default(""),
  account: fallback(z.string(), "").default(""),
});

function normalizePeriod(v: string): EngagementFilters["period"] {
  return v === "7d" || v === "30d" || v === "90d" || v === "all" ? v : "30d";
}
function normalizeDevice(v: string): EngagementFilters["device"] {
  return v === "mobile" || v === "tablet" || v === "desktop" ? v : "all";
}
function parsePropertyCsv(v: string): string[] {
  if (!v || v === "all") return ["all"];
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length === 0 ? ["all"] : parts;
}
function serializeProperty(ids: string[]): string {
  if (ids.length === 0 || ids.includes("all")) return "all";
  return ids.join(",");
}

export const Route = createFileRoute("/_authenticated/admin/engajamento")({
  validateSearch: zodValidator(searchSchema),
  beforeLoad: async () => {
    try {
      const res = await checkIsAdmin();
      if (!res.isAdmin) throw redirect({ to: "/admin" });
    } catch (e: unknown) {
      if ((e as { isRedirect?: boolean } | null)?.isRedirect) throw e;
      throw redirect({ to: "/admin" });
    }
  },
  component: EngagementPage,
  errorComponent: ({ error }) => (
    <div className="p-6 max-w-md mx-auto text-center space-y-2">
      <p className="text-sm font-medium">Falha ao carregar engajamento</p>
      <p className="text-xs text-muted-foreground">{error.message}</p>
    </div>
  ),
});

type SearchShape = z.infer<typeof searchSchema>;

function EngagementPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { info: sub } = useSubscription();
  const aiLocked = !sub.features.ai;

  const filters: EngagementFilters = {
    period: normalizePeriod(search.period),
    propertyIds: parsePropertyCsv(search.property),
    device: normalizeDevice(search.device),
  };
  const tab = search.tab || "panorama";
  const q = search.q ?? "";
  const accountIds: string[] = search.account
    ? search.account.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const backendPropIds = filters.propertyIds.includes("all") ? null : filters.propertyIds;
  const backendUserIds = accountIds.length > 0 ? accountIds : null;
  const accountsKey = accountIds.join(",") || "self";

  const analyticsFn = useServerFn(getEngagementAnalytics);
  const analyticsQ = useQuery({
    queryKey: ["engagement-analytics", filters.period, filters.propertyIds.join(","), filters.device, accountsKey],
    queryFn: () => analyticsFn({
      data: { period: filters.period, propertyIds: backendPropIds, device: filters.device, asUserIds: backendUserIds },
    }),
    staleTime: 30_000,
  });
  const data = analyticsQ.data;

  const guestsFn = useServerFn(getEngagementGuests);
  const guestsQ = useQuery({
    queryKey: ["engagement-guests", filters.period, filters.propertyIds.join(","), q, accountsKey],
    queryFn: () => guestsFn({
      data: { period: filters.period, propertyIds: backendPropIds, q: q || null, asUserIds: backendUserIds },
    }),
    enabled: tab === "hospedes",
    staleTime: 30_000,
  });

  const [detail, setDetail] = useState<DetailTarget>(null);
  const insights = useMemo(() => (data ? computeInsights(data) : []), [data]);

  function patch(p: Partial<EngagementFilters> & { tab?: string; q?: string; accountIds?: string[] }) {
    navigate({
      search: (prev: SearchShape) => ({
        period: p.period ?? prev.period,
        property: p.propertyIds ? serializeProperty(p.propertyIds) : prev.property,
        device: p.device ?? prev.device,
        tab: p.tab ?? prev.tab,
        q: typeof p.q === "string" ? p.q : prev.q,
        account: p.accountIds !== undefined ? p.accountIds.join(",") : prev.account,
      }),
      replace: true,
    });
  }

  const filtersBtn = (
    <FiltersIconButton
      filters={filters}
      onChange={(p) => patch(p)}
      properties={data?.properties ?? []}
      accountIds={accountIds}
      onAccountsChange={(ids) => patch({ accountIds: ids })}
    />
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
            Behavioral Analytics
          </div>
          <h1 className="text-2xl sm:text-3xl font-display">Engajamento</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Como seus hóspedes usam o guia.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin"><ArrowLeft className="size-4 mr-1" /> Voltar</Link>
          </Button>
        </div>
      </header>

      {analyticsQ.isLoading && (
        <div className="py-24 flex items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> Carregando comportamento…
        </div>
      )}

      {analyticsQ.isError && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm space-y-2">
          <p>Não foi possível carregar os dados.</p>
          <Button size="sm" variant="outline" onClick={() => analyticsQ.refetch()}>Tentar novamente</Button>
        </div>
      )}

      {data && !analyticsQ.isLoading && (
        <>
          {data.properties.length === 0 ? (
            <EmptyState />
          ) : (
            <Tabs value={tab} onValueChange={(v) => patch({ tab: v })} className="w-full">
              <TabsList className="w-full h-auto p-1 bg-muted/40 flex-wrap">
                <TabsTrigger value="panorama" className="text-xs flex-1">Panorama</TabsTrigger>
                <TabsTrigger value="jornada" className="text-xs flex-1">Jornada</TabsTrigger>
                <TabsTrigger value="conteudo" className="text-xs flex-1">Conteúdo</TabsTrigger>
                <TabsTrigger value="hospedes" className="text-xs flex-1">Hóspedes</TabsTrigger>
              </TabsList>

              <div className="relative">
                <div className="absolute right-3 top-3 z-20">{filtersBtn}</div>


              <TabsContent value="panorama" className="space-y-5 mt-5">
                <InsightsRibbon insights={insights} />
                <KpiStrip kpis={data.kpis} timeseries={data.timeseries} />
                <div className="grid lg:grid-cols-[1.7fr_1fr] gap-4">
                  <TrendChart data={data.timeseries} />
                  <PropertiesDotPlot rows={data.perProperty} onSelect={(id) => setDetail({ kind: "property", id })} />
                </div>
              </TabsContent>

              <TabsContent value="jornada" className="space-y-5 mt-5">
                <div className="grid lg:grid-cols-2 gap-4">
                  <DurationBuckets buckets={data.durationBuckets} />
                  <DepthCurve curve={data.depthCurve} />
                </div>
                <Funnel steps={data.funnel} />
                <SectionsBar rows={data.sections} silent={data.silentSections} />
              </TabsContent>

              <TabsContent value="conteudo" className="space-y-5 mt-5">
                <ContentImpactMatrix rows={data.sections} />
                <AiPlanLock locked={aiLocked}>
                  <FeedbackList items={data.openFeedbackList} properties={data.properties} />
                </AiPlanLock>
                <PoiInsights top={data.topPois} cold={data.coldPois} />
              </TabsContent>

              <TabsContent value="hospedes" className="space-y-5 mt-5">
                {guestsQ.isLoading ? (
                  <div className="py-12 flex items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin mr-2" /> Consolidando hóspedes…
                  </div>
                ) : guestsQ.isError ? (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm">
                    Não foi possível carregar os hóspedes.
                  </div>
                ) : guestsQ.data ? (
                  <>
                    <GuestsTable
                      guests={guestsQ.data.guests}
                      q={q}
                      onQ={(v) => patch({ q: v })}
                      onSelect={(guestKey) => setDetail({ kind: "guest", guestKey })}
                    />
                  </>
                ) : null}
              </TabsContent>
              </div>
            </Tabs>
          )}
        </>
      )}

      {data && <DetailSheet target={detail} onClose={() => setDetail(null)} data={data} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center space-y-3">
      <div className="mx-auto size-10 rounded-full bg-muted flex items-center justify-center">
        <Sparkles className="size-5 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-sm font-semibold">Nenhum guia publicado ainda</h3>
        <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">
          Crie e publique seu primeiro guia. Assim que os hóspedes começarem a navegar, esse painel se torna vivo com padrões, dúvidas e oportunidades.
        </p>
      </div>
      <Button asChild size="sm">
        <Link to="/admin">Ir para meus guias</Link>
      </Button>
    </div>
  );
}
