import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAdminCities } from "@/lib/city-references.functions";
import { MapPin, RefreshCw, ChevronRight, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/cidades/")({
  component: AdminCitiesPage,
});

function AdminCitiesPage() {
  const list = useServerFn(listAdminCities);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-cities"],
    queryFn: () => list(),
  });

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="font-serif text-3xl">Referências por Cidade</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Pontos icônicos compartilhados entre todas as residências de uma mesma cidade.
          Diferente das recomendações de "pertinho da residência", aqui você cadastra os
          endereços macro que valem a viagem.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && (
        <p className="text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="size-4" /> Erro ao carregar cidades.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(data?.cities ?? []).map((c) => {
          const slug = `${c.city_key}${c.state ? `--${c.state.toLowerCase()}` : ""}`;
          const ageDays = c.last_refreshed_at
            ? Math.floor((Date.now() - new Date(c.last_refreshed_at).getTime()) / 86400_000)
            : null;
          const stale = ageDays === null || ageDays > 7;
          return (
            <Link
              key={`${c.city_key}-${c.state ?? ""}-${c.country}`}
              to="/admin/cidades/$cityKey"
              params={{ cityKey: slug }}
              search={{ label: c.city_label, country: c.country }}
              className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 hover:border-accent/50 hover:shadow-md transition-all"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 text-accent shrink-0" />
                  <h3 className="font-medium text-[15px] truncate">
                    {c.city_label}
                    {c.state ? ` — ${c.state}` : ""}
                  </h3>
                </div>
                <p className="text-[12px] text-muted-foreground mt-1.5">
                  {c.properties} {c.properties === 1 ? "residência" : "residências"} ·{" "}
                  {c.ref_count} {c.ref_count === 1 ? "referência" : "referências"}
                </p>
                <p className={`text-[11px] mt-1 inline-flex items-center gap-1 ${stale ? "text-amber-600" : "text-muted-foreground"}`}>
                  <RefreshCw className="size-3" />
                  {c.last_refreshed_at
                    ? `Atualizada há ${ageDays} ${ageDays === 1 ? "dia" : "dias"}`
                    : "Nunca atualizada"}
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-accent transition-colors" />
            </Link>
          );
        })}
      </div>

      {data && data.cities.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma cidade encontrada. Cadastre uma residência com cidade preenchida primeiro.
        </p>
      )}
    </div>
  );
}
