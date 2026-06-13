import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { getPublicGuide } from "@/lib/guide.functions";
import { ArrowLeft, Compass, ExternalLink, Star, Footprints, Car } from "lucide-react";

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

const TYPE_LABEL: Record<string, string> = {
  restaurant: "Restaurante",
  bar: "Bar",
  cafe: "Café",
  market: "Mercado",
  pharmacy: "Farmácia",
  park: "Parque",
  nightlife: "Vida noturna",
  shopping: "Compras",
  beach: "Praia",
  attraction: "Atração",
};

const TYPE_ORDER = [
  "restaurant", "bar", "cafe", "nightlife",
  "attraction", "park", "beach",
  "market", "pharmacy", "shopping",
];

type Rec = {
  id: string;
  scope: string;
  type: string;
  name: string;
  category?: string | null;
  rating?: number | null;
  distance_text?: string | null;
  distance_meters?: number | null;
  drive_minutes?: number | null;
  note?: string | null;
  image_url?: string | null;
  maps_url?: string | null;
};

function hasMeaningfulInfo(r: Rec): boolean {
  // Only show items that have at least name + (image OR rating OR distance OR note)
  return !!(r.name && (r.image_url || r.rating || r.distance_text || r.distance_meters || r.note));
}

function formatWalking(r: Rec): string | null {
  if (r.distance_text && /a pé|min/i.test(r.distance_text)) return r.distance_text;
  if (r.distance_meters != null) {
    const m = r.distance_meters;
    if (m < 1000) return `${m} m a pé`;
    return `${(m / 1000).toFixed(1).replace(".0", "")} km a pé`;
  }
  if (r.distance_text) return r.distance_text;
  return null;
}

function formatDriving(r: Rec): string | null {
  if (r.drive_minutes != null && r.drive_minutes > 0) {
    return `${r.drive_minutes} min de carro`;
  }
  // Estimate from meters if far (>1.5km) — gentle estimate ~ 2 min/km in city
  if (r.distance_meters && r.distance_meters > 1500) {
    const mins = Math.max(3, Math.round((r.distance_meters / 1000) * 2));
    return `~${mins} min de carro`;
  }
  return null;
}

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
  const all: Rec[] = (r.recommendations as Rec[]).filter(hasMeaningfulInfo);
  const nearby = all.filter((x) => x.scope === "nearby");
  const city = all.filter((x) => x.scope === "city");

  return (
    <div className="guide-ambient min-h-screen bg-background text-foreground pb-24">
      <div className="mx-auto w-full max-w-md md:max-w-3xl lg:max-w-5xl px-5 md:px-10 pt-5 md:pt-10">
        <Link
          to="/g/$slug"
          params={{ slug }}
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3" /> Voltar ao guia
        </Link>

        <header className="mt-6 mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-px w-6 bg-accent/70" />
            <p className="text-[10px] uppercase tracking-[0.32em] text-accent font-semibold">Concierge</p>
          </div>
          <h1 className="font-serif text-[2.1rem] md:text-[2.6rem] leading-[1.05] tracking-tight">Explore a Região</h1>
          <p className="text-[13px] md:text-[14px] text-muted-foreground mt-3 leading-relaxed max-w-[44ch]">
            Uma curadoria de lugares e experiências próximas a {p.name}.
          </p>
        </header>

        {nearby.length > 0 && (
          <RecBlock title="Aqui pertinho" desc="A poucos minutos da casa" items={nearby} />
        )}
        {city.length > 0 && (
          <RecBlock title="Pela cidade" desc="Vale o deslocamento" items={city} />
        )}
        {nearby.length === 0 && city.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem recomendações cadastradas ainda.</p>
        )}
      </div>
    </div>
  );
}

function RecBlock({ title, desc, items }: { title: string; desc: string; items: Rec[] }) {
  // Group by type and respect TYPE_ORDER. Skip empty groups.
  const grouped: Record<string, Rec[]> = {};
  for (const it of items) {
    const k = it.type || "other";
    (grouped[k] ??= []).push(it);
  }
  const orderedKeys = [
    ...TYPE_ORDER.filter((k) => grouped[k]?.length),
    ...Object.keys(grouped).filter((k) => !TYPE_ORDER.includes(k)),
  ];

  return (
    <section className="mb-10">
      <div className="mb-5">
        <h2 className="font-serif text-[1.75rem] md:text-[2rem] leading-tight">{title}</h2>
        <p className="text-[12px] md:text-[13px] text-muted-foreground mt-1">{desc}</p>
      </div>
      <div className="space-y-8">
        {orderedKeys.map((cat) => {
          const list = grouped[cat];
          if (!list?.length) return null;
          const label = TYPE_LABEL[cat] || list[0]?.category || cat;
          return (
            <div key={cat}>
              <div className="flex items-center gap-3 mb-4">
                <span className="h-px w-6 bg-accent/60" />
                <p className="text-[10px] uppercase tracking-[0.28em] text-accent font-semibold">
                  {label}{list.length > 1 ? `s` : ""}
                </p>
                <span className="h-px flex-1 bg-border" />
                <span className="text-[10px] text-muted-foreground tabular-nums">{list.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map((rec) => (
                  <RecCard key={rec.id} rec={rec} typeLabel={label} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RecCard({ rec, typeLabel }: { rec: Rec; typeLabel: string }) {
  const walking = formatWalking(rec);
  const driving = formatDriving(rec);
  const href = rec.maps_url || undefined;

  const inner = (
    <div className="group bg-card border border-border rounded-2xl overflow-hidden flex flex-col active:scale-[0.99] transition-all hover:border-accent/40 hover:shadow-lg h-full">
      <div className="relative aspect-square w-full overflow-hidden bg-secondary">
        {rec.image_url ? (
          <img
            src={rec.image_url}
            alt={rec.name}
            loading="lazy"
            className="absolute inset-0 size-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-accent/15 to-accent/5">
            <Compass className="size-10 text-accent/60" strokeWidth={1.25} />
          </div>
        )}
        <div className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-background/90 backdrop-blur text-[10px] uppercase tracking-[0.18em] font-semibold text-foreground/80">
          {typeLabel}
        </div>
        {rec.rating != null && (
          <div className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-foreground/90 backdrop-blur text-[11px] font-semibold text-background">
            <Star className="size-3 fill-current" strokeWidth={0} />
            <span className="tabular-nums">{Number(rec.rating).toFixed(1)}</span>
          </div>
        )}
      </div>

      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-medium leading-snug line-clamp-2 flex-1">{rec.name}</h3>
          {href && (
            <ExternalLink className="size-3.5 text-muted-foreground/70 shrink-0 mt-1 group-hover:text-accent transition-colors" />
          )}
        </div>

        {rec.note && (
          <p className="text-[12.5px] text-muted-foreground leading-relaxed line-clamp-3">{rec.note}</p>
        )}

        {(walking || driving) && (
          <div className="mt-auto pt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-muted-foreground">
            {walking && (
              <span className="inline-flex items-center gap-1.5">
                <Footprints className="size-3.5" strokeWidth={1.75} />
                {walking}
              </span>
            )}
            {driving && (
              <span className="inline-flex items-center gap-1.5">
                <Car className="size-3.5" strokeWidth={1.75} />
                {driving}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return inner;
}
