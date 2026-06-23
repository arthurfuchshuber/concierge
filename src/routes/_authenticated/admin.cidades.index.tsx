import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAdminCities } from "@/lib/city-references.functions";
import { MapPin, RefreshCw, ChevronRight, AlertCircle, Building2, Sparkles, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/cidades/")({
  component: AdminCitiesPage,
});

function AdminCitiesPage() {
  const list = useServerFn(listAdminCities);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-cities"],
    queryFn: () => list(),
  });

  const cities = data?.cities ?? [];
  const totalProps = cities.reduce((s, c) => s + c.properties, 0);
  const totalRefs = cities.reduce((s, c) => s + c.ref_count, 0);

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-10 space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
          <MapPin className="size-3" /> Administração
        </div>
        <h1 className="font-display text-3xl md:text-4xl">Na Cidade</h1>
        <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
          Pontos icônicos macro compartilhados entre todas as residências de uma mesma cidade.
          Diferente das recomendações "pertinho da residência", aqui você cadastra os endereços
          que valem a viagem — gerados por IA e ajustáveis manualmente.
        </p>
      </header>

      {/* Stats */}
      {!isLoading && cities.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={MapPin} label="Cidades" value={cities.length} />
          <StatCard icon={Building2} label="Residências" value={totalProps} />
          <StatCard icon={Sparkles} label="Referências" value={totalRefs} />
        </div>
      )}

      {/* States */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="size-4 animate-spin" /> Carregando cidades…
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="size-4" /> Erro ao carregar cidades.
        </p>
      )}

      {/* List */}
      {!isLoading && cities.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <MapPin className="size-8 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium">Nenhuma cidade ainda</p>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto">
            Cadastre uma residência com cidade preenchida em <strong>Painel</strong> para ver a
            cidade aqui e começar a gerar suas recomendações macro.
          </p>
        </div>
      )}

      {cities.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cities.map((c) => {
            const slug = `${c.city_key}${c.state ? `--${c.state.toLowerCase()}` : ""}`;
            const ageDays = c.last_refreshed_at
              ? Math.floor((Date.now() - new Date(c.last_refreshed_at).getTime()) / 86400_000)
              : null;
            const stale = ageDays === null || ageDays > 7;
            const empty = c.ref_count === 0;
            return (
              <Link
                key={`${c.city_key}-${c.state ?? ""}-${c.country}`}
                to="/admin/cidades/$cityKey"
                params={{ cityKey: slug }}
                search={{ label: c.city_label, country: c.country }}
                className="group relative rounded-2xl border border-border bg-card p-5 hover:border-accent/60 hover:shadow-lg transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="size-10 rounded-xl bg-accent/10 grid place-items-center shrink-0">
                    <MapPin className="size-4 text-accent" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-[15px] truncate">
                      {c.city_label}
                      {c.state ? <span className="text-muted-foreground"> · {c.state}</span> : null}
                    </h3>
                    <p className="text-[11.5px] text-muted-foreground mt-1">
                      {c.properties} {c.properties === 1 ? "residência" : "residências"}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground group-hover:text-accent transition-colors shrink-0 mt-1" />
                </div>

                <div className="mt-4 pt-4 border-t border-border/60 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <Sparkles className={`size-3.5 ${empty ? "text-muted-foreground/50" : "text-accent"}`} />
                    <span className={empty ? "text-muted-foreground" : "font-medium"}>
                      {c.ref_count} {c.ref_count === 1 ? "referência" : "referências"}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wider px-2 py-1 rounded-full ${
                      stale
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    <RefreshCw className="size-3" />
                    {c.last_refreshed_at
                      ? `${ageDays}d`
                      : "Nunca"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
      <div className="size-10 rounded-xl bg-secondary grid place-items-center shrink-0">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-display leading-none">{value}</div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
      </div>
    </div>
  );
}
