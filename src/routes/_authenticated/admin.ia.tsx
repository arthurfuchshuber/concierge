import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/ds/PageShell";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TelemetryKpis } from "@/components/admin/ia/TelemetryKpis";
import { TelemetryFeed } from "@/components/admin/ia/TelemetryFeed";
import { TelemetryInspector } from "@/components/admin/ia/TelemetryInspector";
import { checkIsAdmin } from "@/lib/admin-subs.functions";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { getAiTelemetry } from "@/lib/admin-ia-telemetry.functions";
import {
  LIVE_INTERVALS,
  filterFeedRows,
  utcDayStart,
  type FeedFilter,
} from "@/lib/admin-ia-telemetry";

export const Route = createFileRoute("/_authenticated/admin/ia")({
  beforeLoad: async () => {
    try {
      const res = await checkIsAdmin();
      if (!res.isAdmin) throw redirect({ to: "/admin" });
    } catch (e: unknown) {
      if ((e as { isRedirect?: boolean } | null)?.isRedirect) throw e;
      throw redirect({ to: "/admin" });
    }
  },
  head: () => ({ meta: [{ title: "Telemetria IA · ConciergeIA" }] }),
  component: AiTelemetryPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-md space-y-2 p-6 text-center">
      <p className="text-sm font-medium">Falha ao carregar a telemetria da IA</p>
      <p className="text-xs text-muted-foreground">{friendlyErrorMessage(error)}</p>
    </div>
  ),
});

function useSecondsAgo(iso: string | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return "carregando…";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `atualizado há ${s} s` : `atualizado há ${Math.round(s / 60)} min`;
}

function AiTelemetryPage() {
  const fetchFn = useServerFn(getAiTelemetry);
  const [intervalKey, setIntervalKey] = useState<string>("5");
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const ms = LIVE_INTERVALS.find((i) => i.key === intervalKey)?.ms ?? 0;

  const q = useQuery({
    queryKey: ["admin-ia-telemetry"],
    queryFn: () => fetchFn(),
    refetchInterval: ms > 0 ? ms : false,
    refetchIntervalInBackground: false,
    staleTime: 2_000,
  });

  const rows = useMemo(() => filterFeedRows(q.data?.rows ?? [], filter), [q.data, filter]);
  const todayTotal = useMemo(() => {
    if (!q.data) return 0;
    const start = utcDayStart(Date.parse(q.data.generatedAt));
    return q.data.rows.filter((r) => Date.parse(r.startedAt) >= start).length;
  }, [q.data]);
  const updated = useSecondsAgo(q.data?.generatedAt);
  const live = ms > 0;

  return (
    <div className="ds-page w-full max-w-[1440px] px-3.5 py-5 sm:px-5 lg:px-8 lg:pl-4 lg:py-8">
      <PageShell
        title="Telemetria IA"
        subtitle="Cada sugestão do Copiloto e cada ação nos cards, à medida que acontecem. Resposta automática desligada."
      />

      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`inline-flex shrink-0 items-center gap-2 text-[12.5px] font-bold ${live ? "text-success" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          <span
            className={`size-2 rounded-full ${live ? "animate-pulse bg-success shadow-[0_0_0_4px_color-mix(in_oklab,var(--success)_20%,transparent)]" : "bg-muted-foreground/50"}`}
          />
          {live ? "Ao vivo" : "Pausado"}
        </span>
        <Tabs
          value={intervalKey}
          onValueChange={setIntervalKey}
          className="min-w-0 flex-1 sm:max-w-[320px] sm:flex-none"
        >
          <TabsList aria-label="Atualização automática">
            {LIVE_INTERVALS.map((i) => (
              <TabsTrigger key={i.key} value={i.key}>
                {i.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {q.error ? (
        <p className="rounded-[14px] bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {friendlyErrorMessage(q.error)}
        </p>
      ) : null}

      <TelemetryKpis kpis={q.data?.kpis ?? null} loading={q.isLoading} />

      <TelemetryFeed
        rows={rows}
        filter={filter}
        onFilter={setFilter}
        onOpen={setOpenId}
        updatedLabel={updated}
        total={todayTotal}
      />
      {q.data?.truncated ? (
        <p className="text-center text-xs text-muted-foreground">
          Indicadores calculados sobre as 5.000 inferências mais recentes da janela de 14 dias.
        </p>
      ) : null}

      <TelemetryInspector id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
