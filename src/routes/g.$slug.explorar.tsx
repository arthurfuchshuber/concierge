import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { getPublicGuide } from "@/lib/guide.functions";
import {
  ArrowLeft,
  Compass,
  ExternalLink,
  Star,
  Footprints,
  Car,
  ArrowUpDown,
  LayoutGrid,
  List as ListIcon,
  Utensils,
  Landmark,
  Coffee,
  PartyPopper,
  Cross,
  ShoppingBag,
} from "lucide-react";


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

type Rec = {
  id: string;
  scope: string;
  type: string;
  name: string;
  category?: string | null;
  rating?: number | null;
  user_ratings_total?: number | null;
  distance_text?: string | null;
  distance_meters?: number | null;
  drive_minutes?: number | null;
  note?: string | null;
  image_url?: string | null;
  maps_url?: string | null;
};

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

type MetaCategory = {
  key: string;
  title: string;
  desc: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  types: string[];
};

const META_CATEGORIES: MetaCategory[] = [
  {
    key: "food",
    title: "Bares e Restaurantes",
    desc: "Onde comer, beber e brindar.",
    Icon: Utensils,
    types: ["restaurant", "bar", "nightlife"],
  },
  {
    key: "sights",
    title: "Pontos Turísticos",
    desc: "Atrações imperdíveis pela região.",
    Icon: Landmark,
    types: ["attraction", "park", "beach"],
  },
  {
    key: "cafe",
    title: "Padarias e Cafeterias",
    desc: "Para a pausa do café e do pão fresquinho.",
    Icon: Coffee,
    types: ["cafe"],
  },
  {
    key: "fun",
    title: "Lazer e Entretenimento",
    desc: "Para um programa diferente.",
    Icon: PartyPopper,
    types: ["shopping", "market"],
  },
  {
    key: "health",
    title: "Hospitais e Farmácias",
    desc: "Cuidados e emergências por perto.",
    Icon: Cross,
    types: ["pharmacy"],
  },
];

function hasMeaningfulInfo(r: Rec): boolean {
  return !!(r.name && (r.image_url || r.rating || r.distance_text || r.distance_meters || r.note));
}

function formatWalking(r: Rec): string | null {
  if (r.distance_meters != null) {
    const m = r.distance_meters;
    if (m < 1000) return `${m} m a pé`;
    return `${(m / 1000).toFixed(1).replace(/\.0$/, "")} km a pé`;
  }
  if (r.distance_text) return r.distance_text;
  return null;
}

function formatDriving(r: Rec): string | null {
  if (r.drive_minutes != null && r.drive_minutes > 0) return `${r.drive_minutes} min de carro`;
  if (r.distance_meters && r.distance_meters > 1500) {
    const mins = Math.max(3, Math.round((r.distance_meters / 1000) * 2));
    return `~${mins} min de carro`;
  }
  return null;
}

type SortKey = "distance" | "rating" | "alpha";

function sortRecs(list: Rec[], by: SortKey): Rec[] {
  const arr = [...list];
  if (by === "distance") {
    arr.sort((a, b) => (a.distance_meters ?? Infinity) - (b.distance_meters ?? Infinity));
  } else if (by === "rating") {
    arr.sort((a, b) => {
      const ar = a.rating ?? 0;
      const br = b.rating ?? 0;
      if (br !== ar) return br - ar;
      const ac = a.user_ratings_total ?? 0;
      const bc = b.user_ratings_total ?? 0;
      return bc - ac;
    });
  } else {
    arr.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  }
  return arr;
}

function ExplorePage() {
  const r = Route.useLoaderData();
  const { slug } = Route.useParams();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("distance");

  if (r.status !== "ok") {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">Guia indisponível.</p>
      </div>
    );
  }

  const p = r.property as Record<string, any>;
  const allRecs: Rec[] = (r.recommendations as Rec[]).filter(hasMeaningfulInfo);

  // Compute per-meta-category buckets and counts
  const categories = useMemo(() => {
    return META_CATEGORIES.map((meta) => {
      const items = allRecs.filter((rec) => meta.types.includes(rec.type));
      const nearby = items.filter((x) => x.scope === "nearby");
      const city = items.filter((x) => x.scope === "city");
      return { meta, items, nearby, city, count: items.length };
    }).filter((c) => c.count > 0);
  }, [allRecs]);

  const active = categories.find((c) => c.meta.key === activeKey) ?? null;

  return (
    <div className="guide-ambient min-h-screen bg-background text-foreground pb-24">
      <div className="mx-auto w-full max-w-md md:max-w-3xl lg:max-w-5xl px-5 md:px-10 pt-5 md:pt-10">
        {active ? (
          <button
            type="button"
            onClick={() => setActiveKey(null)}
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3" /> Todas as categorias
          </button>
        ) : (
          <Link
            to="/g/$slug"
            params={{ slug }}
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3" /> Voltar ao guia
          </Link>
        )}

        <header className="mt-6 mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-px w-6 bg-accent/70" />
            <p className="text-[10px] uppercase tracking-[0.32em] text-accent font-semibold">Concierge</p>
          </div>
          <h1 className="font-serif text-[2.1rem] md:text-[2.8rem] leading-[1.02] tracking-tight">
            {active ? active.meta.title : "Explore a Região"}
          </h1>
          <p className="text-[13px] md:text-[14px] text-muted-foreground mt-3 leading-relaxed max-w-[52ch]">
            {active
              ? active.meta.desc
              : `Uma curadoria de lugares e experiências próximas a ${p.name}.`}
          </p>
        </header>

        {!active ? (
          <CategoryGrid
            categories={categories}
            onPick={(k) => setActiveKey(k)}
          />
        ) : (
          <CategoryDetail
            nearby={sortRecs(active.nearby, sortBy)}
            city={sortRecs(active.city, sortBy)}
            sortBy={sortBy}
            setSortBy={setSortBy}
          />
        )}

        {categories.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem recomendações cadastradas ainda.</p>
        )}
      </div>
    </div>
  );
}

function CategoryGrid({
  categories,
  onPick,
}: {
  categories: {
    meta: MetaCategory;
    count: number;
    nearby: Rec[];
    city: Rec[];
  }[];
  onPick: (k: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {categories.map(({ meta, count, nearby, city }) => {
        // Pick a hero image for the category if available
        const heroSrc =
          nearby.find((x) => x.image_url)?.image_url ??
          city.find((x) => x.image_url)?.image_url ??
          null;
        const Icon = meta.Icon;
        return (
          <button
            key={meta.key}
            type="button"
            onClick={() => onPick(meta.key)}
            className="group relative overflow-hidden rounded-2xl border border-border bg-card text-left hover:border-accent/50 hover:shadow-xl transition-all"
          >
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-secondary">
              {heroSrc ? (
                <img
                  src={heroSrc}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-accent/20 to-accent/5">
                  <Icon className="size-12 text-accent/70" strokeWidth={1.25} />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/20 to-transparent" />
              <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background/85 backdrop-blur text-[10px] uppercase tracking-[0.2em] font-semibold text-foreground/85">
                <Icon className="size-3.5 text-accent" strokeWidth={1.75} />
                {count} {count === 1 ? "lugar" : "lugares"}
              </div>
            </div>
            <div className="p-5">
              <h2 className="font-serif text-[1.4rem] md:text-[1.55rem] leading-tight">{meta.title}</h2>
              <p className="text-[12.5px] text-muted-foreground mt-1.5 leading-relaxed">{meta.desc}</p>
              <div className="mt-3 inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.24em] font-semibold text-accent">
                Explorar
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CategoryDetail({
  nearby,
  city,
  sortBy,
  setSortBy,
}: {
  nearby: Rec[];
  city: Rec[];
  sortBy: SortKey;
  setSortBy: (s: SortKey) => void;
}) {
  return (
    <>
      <SortBar sortBy={sortBy} setSortBy={setSortBy} />
      <div className="mt-8 space-y-12">
        {nearby.length > 0 && (
          <Section
            eyebrow="A poucos minutos"
            title="Pertinho da Residência"
            items={nearby}
          />
        )}
        {city.length > 0 && (
          <Section
            eyebrow="Vale o deslocamento"
            title="Referências na Cidade"
            items={city}
          />
        )}
        {nearby.length === 0 && city.length === 0 && (
          <p className="text-sm text-muted-foreground">Nada cadastrado nesta categoria.</p>
        )}
      </div>
    </>
  );
}

function SortBar({ sortBy, setSortBy }: { sortBy: SortKey; setSortBy: (s: SortKey) => void }) {
  const opts: { key: SortKey; label: string }[] = [
    { key: "distance", label: "Distância" },
    { key: "rating", label: "Avaliação" },
    { key: "alpha", label: "A–Z" },
  ];
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] font-semibold text-muted-foreground">
        <ArrowUpDown className="size-3" />
        Ordenar por
      </span>
      <div className="inline-flex items-center rounded-full border border-border bg-card/60 backdrop-blur p-1">
        {opts.map((o) => {
          const on = sortBy === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setSortBy(o.key)}
              className={`px-3 py-1.5 rounded-full text-[11.5px] font-medium transition-colors ${
                on
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  items,
}: {
  eyebrow: string;
  title: string;
  items: Rec[];
}) {
  return (
    <section>
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="h-px w-6 bg-accent/70" />
          <p className="text-[10px] uppercase tracking-[0.28em] text-accent font-semibold">{eyebrow}</p>
        </div>
        <h3 className="font-serif text-[1.55rem] md:text-[1.85rem] leading-tight">{title}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((rec) => (
          <RecCard key={rec.id} rec={rec} />
        ))}
      </div>
    </section>
  );
}

function RecCard({ rec }: { rec: Rec }) {
  const walking = formatWalking(rec);
  const driving = formatDriving(rec);
  const href = rec.maps_url || undefined;
  const typeLabel = TYPE_LABEL[rec.type] || rec.category || rec.type;

  const inner = (
    <div className="group bg-card border border-border rounded-2xl overflow-hidden flex flex-col hover:border-accent/40 hover:shadow-lg transition-all h-full">
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
            {rec.user_ratings_total ? (
              <span className="opacity-70 font-normal">
                ({rec.user_ratings_total.toLocaleString("pt-BR")})
              </span>
            ) : null}
          </div>
        )}
      </div>

      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-[15px] font-medium leading-snug line-clamp-2 flex-1">{rec.name}</h4>
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
// Silence unused import warnings for icons that may be tree-shaken in dev
void ShoppingBag;
