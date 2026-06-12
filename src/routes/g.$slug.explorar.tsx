import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { getPublicGuide } from "@/lib/guide.functions";
import { ArrowLeft, Compass, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/g/$slug/explorar")({
  loader: async ({ params }) => {
    const r = await getPublicGuide({ data: { slug: params.slug } });
    if (r.status === "not_found") throw notFound();
    return r;
  },
  head: ({ loaderData }) => {
    if (!loaderData || loaderData.status !== "ok") {
      return { meta: [{ title: "Explorar — SigmaGuide" }, { name: "robots", content: "noindex" }] };
    }
    const p = loaderData.property as Record<string, unknown>;
    return {
      meta: [
        { title: `Explorar ${p.name as string} — Guia` },
        { name: "description", content: `Recomendações próximas a ${p.name as string}` },
      ],
    };
  },
  component: ExplorePage,
});

function ExplorePage() {
  const r = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (r.status !== "ok") {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">Guia indisponível.</p>
      </div>
    );
  }
  const p = r.property as Record<string, any>;
  const nearby = r.recommendations.filter((x: any) => x.scope === "nearby");
  const city = r.recommendations.filter((x: any) => x.scope === "city");
  return (
    <div className="guide-ambient min-h-screen bg-background text-foreground pb-20">
      <div className="mx-auto w-full max-w-md px-5 pt-5">
        <Link
          to="/g/$slug"
          params={{ slug }}
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3" /> Voltar ao guia
        </Link>

        <header className="mt-6 mb-7">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-px w-6 bg-accent/70" />
            <p className="text-[10px] uppercase tracking-[0.32em] text-accent font-semibold">Concierge</p>
          </div>
          <h1 className="font-serif text-[2rem] leading-[1.05] tracking-tight">Explore a Região</h1>
          <p className="text-[13px] text-muted-foreground mt-3 leading-relaxed max-w-[36ch]">
            Curadoria de lugares e experiências próximas a {p.name}.
          </p>
        </header>

        {nearby.length > 0 && <RecBlock title="Aqui pertinho" desc="A poucos minutos a pé" items={nearby} />}
        {city.length > 0 && <RecBlock title="Pela cidade" desc="Vale a visita" items={city} />}
        {nearby.length === 0 && city.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem recomendações cadastradas ainda.</p>
        )}
      </div>
    </div>
  );
}

function RecBlock({ title, desc, items }: { title: string; desc: string; items: any[] }) {
  const grouped = items.reduce<Record<string, any[]>>((acc, r) => {
    const k = r.category || r.type;
    (acc[k] ??= []).push(r);
    return acc;
  }, {});
  return (
    <section className="mb-8">
      <div className="mb-4">
        <h3 className="font-serif text-[1.7rem] leading-tight">{title}</h3>
        <p className="text-[12px] text-muted-foreground mt-1">{desc}</p>
      </div>
      <div className="space-y-6">
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-3">
              <span className="h-px flex-1 bg-border" />
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-semibold">{cat}</p>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-3">
              {list.map((r) => (
                <a key={r.id} href={r.maps_url ?? "#"} target="_blank" rel="noreferrer"
                  className="group flex items-stretch gap-3.5 bg-card border border-border rounded-2xl p-3 active:scale-[0.99] transition-all hover:border-accent/40">
                  {r.image_url ? (
                    <img src={r.image_url} alt={r.name} className="size-20 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="size-20 rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 grid place-items-center shrink-0">
                      <Compass className="size-6 text-accent/70" strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 py-0.5 flex flex-col justify-center">
                    <p className="text-[15px] font-medium truncate leading-tight">{r.name}</p>
                    <p className="text-[12px] text-muted-foreground truncate mt-1">
                      {r.distance_text}{r.rating ? ` · ★ ${r.rating}` : ""}
                    </p>
                    {r.note && <p className="text-[12px] text-muted-foreground/80 mt-1 italic line-clamp-2 leading-snug">{r.note}</p>}
                  </div>
                  <ExternalLink className="size-3.5 text-muted-foreground/60 shrink-0 mt-1 group-hover:text-accent transition-colors" />
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
