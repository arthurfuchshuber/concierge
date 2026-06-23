import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import {
  listCityReferences,
  generateCityReferences,
  toggleHideCityReference,
  deleteCityReference,
  bulkDeleteCityReferences,
  addManualCityReference,
} from "@/lib/city-references.functions";
import { searchPlacesForRec, TYPE_MAP } from "@/lib/maps.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Eye, EyeOff, Trash2, Sparkles, Plus, Star, Search, Loader2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";


const SearchSchema = z.object({
  label: z.string().min(1),
  country: z.string().default("BR"),
});

export const Route = createFileRoute("/_authenticated/admin/cidades/$cityKey")({
  validateSearch: (s) => SearchSchema.parse(s),
  component: AdminCityDetail,
});

function AdminCityDetail() {
  const { cityKey: slug } = Route.useParams();
  const { label, country } = Route.useSearch();
  const state = slug.includes("--") ? slug.split("--")[1].toUpperCase() : null;

  const list = useServerFn(listCityReferences);
  const generate = useServerFn(generateCityReferences);
  const toggleHide = useServerFn(toggleHideCityReference);
  const del = useServerFn(deleteCityReference);
  const addManual = useServerFn(addManualCityReference);
  const searchPlaces = useServerFn(searchPlacesForRec);
  const qc = useQueryClient();

  const queryKey = ["admin-city-refs", slug, country];
  const { data, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: () => list({ data: { city_label: label, state, country, includeHidden: true } }),
  });

  const [generating, setGenerating] = useState<string | null>(null);
  const [generateProgress, setGenerateProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchPlaces>>>([]);

  async function handleGenerate(type?: string | null) {
    const key = type ?? "__all__";
    setGenerating(key);

    if (!type) {
      const categories = TYPE_MAP.map((c) => c.category);
      const total = categories.length;
      let step = 0;
      setGenerateProgress({ current: 1, total, label: categories[0] });

      const interval = setInterval(() => {
        step += 1;
        if (step < total) {
          setGenerateProgress({ current: step + 1, total, label: categories[step] });
        }
      }, 4500);

      try {
        const r = await generate({ data: { city_label: label, state, country, type: null } });
        clearInterval(interval);
        setGenerateProgress(null);
        if (r.status === "ok" || r.status === "partial") {
          toast.success(`Concluído — ${r.total} encontrados (${r.inserted} novos, ${r.updated} atualizados${r.failed ? `, ${r.failed} falhas` : ""})`);
          if (r.status === "partial" && r.message) toast.warning(r.message);
        } else {
          toast.error(`Falhou: ${r.message ?? "erro"}`);
        }
        await qc.invalidateQueries({ queryKey });
      } catch (e) {
        clearInterval(interval);
        setGenerateProgress(null);
        toast.error(e instanceof Error ? e.message : "Erro");
      } finally {
        setGenerating(null);
      }
    } else {
      const catLabel = TYPE_MAP.find((c) => c.type === type)?.category ?? type;
      setGenerateProgress({ current: 1, total: 1, label: catLabel });
      try {
        const r = await generate({ data: { city_label: label, state, country, type } });
        if (r.status === "ok" || r.status === "partial") {
          toast.success(`${catLabel} — ${r.total} encontrados (${r.inserted} novos, ${r.updated} atualizados${r.failed ? `, ${r.failed} falhas` : ""})`);
          if (r.status === "partial" && r.message) toast.warning(r.message);
        } else {
          toast.error(`Falhou: ${r.message ?? "erro"}`);
        }
        await qc.invalidateQueries({ queryKey });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro");
      } finally {
        setGenerating(null);
        setGenerateProgress(null);
      }
    }
  }


  async function handleSearch() {
    if (searchTerm.trim().length < 2) return;
    setSearching(true);
    try {
      const r = await searchPlaces({ data: { query: `${searchTerm} ${label}` } });
      setResults(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro na busca");
    } finally {
      setSearching(false);
    }
  }

  async function handleAdd(place: typeof results[number]) {
    try {
      const result = await addManual({
        data: {
          city_label: label,
          state,
          country,
          type: place.type,
          category: place.category,
          name: place.name,
          place_id: place.place_id,
          note: place.note,
          address: place.formatted_address,
          rating: place.rating,
          user_ratings_total: place.user_ratings_total,
          lat: place.lat,
          lng: place.lng,
          image_url: place.image_url,
          maps_url: place.maps_url,
        },
      });
      if ((result as { duplicate?: boolean })?.duplicate) {
        toast.info(`${place.name} já estava na lista — informações atualizadas.`);
      } else {
        toast.success(`${place.name} adicionado`);
      }
      setResults((arr) => arr.filter((p) => p.place_id !== place.place_id));
      await qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao adicionar");
    }
  }

  async function handleToggleHide(id: string, hidden: boolean) {
    await toggleHide({ data: { id, hidden: !hidden } });
    await qc.invalidateQueries({ queryKey });
  }

  async function handleDelete(id: string) {
    await del({ data: { id } });
    await qc.invalidateQueries({ queryKey });
  }

  const items = data?.items ?? [];
  const groupedByType = items.reduce<Record<string, typeof items>>((acc, it) => {
    (acc[it.type] = acc[it.type] ?? []).push(it);
    return acc;
  }, {});

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      <Link
        to="/admin/cidades"
        className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground font-semibold"
      >
        <ArrowLeft className="size-3" /> Todas as cidades
      </Link>

      <div className="pb-6 border-b border-border/60 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-2">Na Cidade</p>
          <h1 className="font-serif text-3xl sm:text-4xl leading-tight">
            {label}
            {state ? <span className="text-muted-foreground"> — {state}</span> : null}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            Pontos turísticos e referências macro compartilhados entre todas as suas residências nesta cidade.
            {data?.job?.last_refreshed_at && (
              <> <span className="text-foreground/70">Atualizado em {new Date(data.job.last_refreshed_at).toLocaleDateString("pt-BR")}.</span></>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex gap-2">
            <Button onClick={() => handleGenerate(null)} disabled={generating !== null}>
              {generating === "__all__" ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Sparkles className="size-4 mr-2" />}
              Gerar tudo com IA
            </Button>
            <Button variant="outline" onClick={() => setAddOpen((v) => !v)}>
              <Plus className="size-4 mr-2" /> Adicionar manual
            </Button>
          </div>
          {generating === "__all__" && generateProgress && (
            <div className="flex items-center gap-2.5 text-[11.5px] text-muted-foreground">
              <div className="flex gap-0.5">
                {Array.from({ length: generateProgress.total }).map((_, i) => (
                  <span
                    key={i}
                    className={`block h-1 w-4 rounded-full transition-colors duration-500 ${
                      i < generateProgress.current ? "bg-accent" : "bg-border"
                    }`}
                  />
                ))}
              </div>
              <span>
                Buscando <span className="text-foreground font-medium">{generateProgress.label}</span>…
                <span className="ml-1 text-muted-foreground/60">{generateProgress.current}/{generateProgress.total}</span>
              </span>
            </div>
          )}
        </div>
      </div>



      {addOpen && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder={`Buscar lugar em ${label}…`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSearch();
                }
              }}
            />
            <Button onClick={handleSearch} disabled={searching || searchTerm.trim().length < 2}>
              {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            </Button>
          </div>
          {results.length > 0 && (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {results.map((p) => (
                <div key={p.place_id} className="flex items-center gap-3 rounded-lg border border-border p-2">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="size-12 rounded object-cover shrink-0" />
                  ) : (
                    <div className="size-12 rounded bg-secondary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {p.category}
                      {typeof p.rating === "number" ? ` · ★ ${p.rating} (${p.user_ratings_total ?? 0})` : ""}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => handleAdd(p)}>
                    Adicionar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {Object.entries(groupedByType).map(([type, list]) => (
        <section key={type} className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between gap-3">
            <h3 className="font-medium text-sm uppercase tracking-wider">
              {list[0]?.category ?? type}{" "}
              <span className="text-muted-foreground font-normal">({list.length})</span>
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleGenerate(type)}
              disabled={generating !== null}
              title={`Regenerar ${list[0]?.category ?? type} com IA`}
            >
              {generating === type ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Sparkles className="size-3.5 mr-1.5" />}
              Regenerar
            </Button>
          </div>

          <ul className="divide-y divide-border">
            {list.map((it) => (
              <li key={it.id} className={`flex items-center gap-3 p-3 ${it.is_hidden ? "opacity-50" : ""}`}>
                {it.image_url ? (
                  <img src={it.image_url} alt="" className="size-14 rounded object-cover shrink-0" />
                ) : (
                  <div className="size-14 rounded bg-secondary shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {it.name}
                    {it.source === "manual" && (
                      <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                        Manual
                      </span>
                    )}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground truncate flex items-center gap-2">
                    {it.rating != null && (
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3 fill-current text-amber-500" strokeWidth={0} />
                        {Number(it.rating).toFixed(1)} ({it.user_ratings_total ?? 0})
                      </span>
                    )}
                    {it.address && <span className="truncate">· {it.address}</span>}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleHide(it.id, it.is_hidden)}
                  title={it.is_hidden ? "Exibir" : "Ocultar"}
                >
                  {it.is_hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" title="Remover">
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remover referência?</AlertDialogTitle>
                      <AlertDialogDescription>
                        "{it.name}" será removido permanentemente desta cidade.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(it.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Remover
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {data && items.length === 0 && !isLoading && (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center">
          <div className="mx-auto size-12 rounded-full bg-secondary/60 flex items-center justify-center mb-4">
            <Sparkles className="size-5 text-muted-foreground" />
          </div>
          <h3 className="font-serif text-lg mb-1">Nenhuma referência ainda</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-5">
            Gere automaticamente pontos turísticos populares de {label} com IA, ou adicione manualmente seus favoritos.
          </p>
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-2 justify-center">
              <Button onClick={() => handleGenerate(null)} disabled={generating !== null}>
                {generating === "__all__" ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Sparkles className="size-4 mr-2" />}
                Gerar com IA
              </Button>
              <Button variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="size-4 mr-2" /> Adicionar manual
              </Button>
            </div>
            {generating === "__all__" && generateProgress && (
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex gap-0.5">
                  {Array.from({ length: generateProgress.total }).map((_, i) => (
                    <span
                      key={i}
                      className={`block h-1 w-4 rounded-full transition-colors duration-500 ${
                        i < generateProgress.current ? "bg-accent" : "bg-border"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  Buscando <span className="text-foreground font-medium">{generateProgress.label}</span>…{" "}
                  <span className="text-muted-foreground/60">{generateProgress.current}/{generateProgress.total}</span>
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
