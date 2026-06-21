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
  LayoutGrid,
  List as ListIcon,
  Utensils,
  Landmark,
  Coffee,
  PartyPopper,
  Cross,
  ShoppingBag,
  Clock,
  ChevronDown,
  HelpCircle,
  Ticket,
} from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";



export const Route = createFileRoute("/g/$slug/explorar")({
  loader: async ({ params }) => {
    const r = await getPublicGuide({ data: { slug: params.slug } });
    if (r.status === "not_found") throw notFound();
    return r;
  },
  head: ({ loaderData, params }) => {
    if (!loaderData || loaderData.status !== "ok") {
      return { meta: [{ title: "Explorar — SigmaGuide" }, { name: "robots", content: "noindex" }] };
    }
    const p = loaderData.property as Record<string, unknown>;
    const name = p.name as string;
    const city = (p.city as string | null) ?? null;
    const title = `Explore a região de ${name} — Guia do Hóspede`;
    const desc = `Restaurantes, atrações, cafés e experiências selecionadas pelo anfitrião perto de ${name}${city ? ` em ${city}` : ""}. Recomendações com distância, horários e mapa.`;
    const url = `https://guiadigital.anfitriaosigma.com.br/g/${params.slug}/explorar`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        ...(p.hero_image_url ? [{ property: "og:image", content: p.hero_image_url as string }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
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
  walk_minutes?: number | null;
  opening_hours?: string[] | null;
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
    types: ["restaurant", "bar"],
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
    title: "Lazer e Compras",
    desc: "Mercados, shoppings e vida noturna.",
    Icon: PartyPopper,
    types: ["shopping", "market", "nightlife"],
  },
  {
    key: "health",
    title: "Saúde e Farmácias",
    desc: "Cuidados e emergências por perto.",
    Icon: Cross,
    types: ["pharmacy"],
  },
];

function hasMeaningfulInfo(r: Rec): boolean {
  return !!(r.name && (r.image_url || r.rating || r.distance_text || r.distance_meters || r.note));
}

function formatWalking(r: Rec): string | null {
  const mins =
    r.walk_minutes != null && r.walk_minutes > 0
      ? r.walk_minutes
      : r.distance_meters != null
        ? Math.max(1, Math.round(r.distance_meters / 80))
        : null;
  if (r.distance_meters != null) {
    const m = r.distance_meters;
    const dist = m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace(/\.0$/, "")} km`;
    return mins ? `${dist} · ${mins} min a pé` : `${dist} a pé`;
  }
  if (mins) return `${mins} min a pé`;
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

function safeHttpsHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function todayOpening(hours: string[] | null | undefined): string | null {
  if (!hours || hours.length === 0) return null;
  const jsDay = new Date().getDay();
  const idx = (jsDay + 6) % 7;
  const line = hours[idx] ?? hours[0];
  if (!line) return null;
  const i = line.indexOf(":");
  return i > 0 && i < 12 ? line.slice(i + 1).trim() : line;
}

function OpeningHours({ hours }: { hours: string[] | null | undefined }) {
  const today = todayOpening(hours);
  if (!today) return null;
  return (
    <details
      className="group/oh text-[11.5px] text-muted-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <summary
        className="inline-flex items-center gap-1.5 cursor-pointer list-none hover:text-foreground transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <Clock className="size-3.5" strokeWidth={1.75} />
        <span className="truncate max-w-[28ch]">Hoje: {today}</span>
      </summary>
      <ul className="mt-1.5 ml-5 space-y-0.5 text-[11px] leading-relaxed">
        {(hours ?? []).map((h, i) => (
          <li key={i} className="text-muted-foreground/85">{h}</li>
        ))}
      </ul>
    </details>
  );

}


// Escolhe a melhor foto para capa da categoria: usa SEMPRE referências da cidade
// (lugares icônicos/relevantes), não pontos "pertinho da residência". Fallback para
// nearby apenas quando não houver nenhuma referência de city disponível.
function pickBestPhoto(nearby: Rec[], city: Rec[]): string | null {
  const score = (r: Rec) => (r.rating ?? 0) * Math.log10((r.user_ratings_total ?? 1) + 10);
  const best = (arr: Rec[]) =>
    arr.filter((x) => x.image_url).sort((a, b) => score(b) - score(a))[0]?.image_url ?? null;
  return best(city) ?? best(nearby);
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
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [minReviews, setMinReviews] = useState<number>(0);

  // Tema herdado da página inicial do guia (definido pelo visitante).
  const adminTheme: "dark" | "light" =
    r.status === "ok" && (r.property as Record<string, unknown>).guide_theme === "light"
      ? "light"
      : "dark";
  const [theme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return adminTheme;
    const stored = window.localStorage.getItem(`guide-theme:${slug}`);
    return stored === "dark" || stored === "light" ? stored : adminTheme;
  });

  if (r.status !== "ok") {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">Guia indisponível.</p>
      </div>
    );
  }

  const p = r.property as Record<string, any>;
  const allRecs: Rec[] = (r.recommendations as Rec[]).filter(hasMeaningfulInfo);

  const categories = useMemo(() => {
    return META_CATEGORIES.map((meta) => {
      const isTouristMeta = meta.key === "sights";
      const filtered = allRecs.filter((rec) => {
        if (!meta.types.includes(rec.type)) return false;
        if (minReviews <= 0) return true;
        return (rec.user_ratings_total ?? 0) >= minReviews;
      });
      const nearby = filtered.filter((x) => x.scope === "nearby");
      const city = filtered.filter((x) => x.scope === "city");
      return { meta, items: filtered, nearby, city, count: filtered.length };
    }).filter((c) => c.count > 0);
  }, [allRecs, minReviews]);

  // Unfiltered (by meta type only) — used inside category detail so each
  // subcategory can apply its own min-reviews filter.
  const categoriesUnfiltered = useMemo(() => {
    return META_CATEGORIES.map((meta) => {
      const filtered = allRecs.filter((rec) => meta.types.includes(rec.type));
      const nearby = filtered.filter((x) => x.scope === "nearby");
      const city = filtered.filter((x) => x.scope === "city");
      return { meta, items: filtered, nearby, city, count: filtered.length };
    }).filter((c) => c.count > 0);
  }, [allRecs]);

  const active = (activeKey
    ? categoriesUnfiltered.find((c) => c.meta.key === activeKey)
    : null) ?? null;

  return (
    <div
      className={`sigma-public-guide guide-ambient min-h-screen bg-background text-foreground pb-24 ${
        theme === "light" ? "theme-light" : ""
      }`}
    >
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
          <p className="text-[10px] uppercase tracking-[0.32em] text-accent font-semibold mb-3">Concierge</p>
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
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <MinReviewsFilter value={minReviews} onChange={setMinReviews} />
              <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
            </div>
            {viewMode === "grid" ? (
              <CategoryGrid categories={categories} onPick={(k) => setActiveKey(k)} />
            ) : (
              <CategoryList categories={categories} onPick={(k) => setActiveKey(k)} />
            )}
          </>
        ) : (
          <CategoryDetail
            nearby={sortRecs(active.nearby, sortBy)}
            city={sortRecs(active.city, sortBy)}
            sortBy={sortBy}
            setSortBy={setSortBy}
            viewMode={viewMode}
            setViewMode={setViewMode}
            isTouristCategory={active.meta.key === "sights"}
          />

        )}


        {categories.length === 0 && (!Array.isArray(p.marketplace_links) || p.marketplace_links.length === 0) && (
          <p className="text-sm text-muted-foreground">Sem recomendações cadastradas ainda.</p>
        )}

        {!active && (() => {
          const links = (Array.isArray(p.marketplace_links) ? p.marketplace_links : []).filter(
            (m: any) => m && typeof m.label === "string" && m.label.trim() && typeof m.url === "string" && m.url.trim(),
          );
          if (links.length === 0) return null;
          return (
            <div className="mt-12">
              <div className="mb-3 flex items-center gap-2">
                <Ticket className="size-4 text-muted-foreground" />
                <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">Reservas & experiências</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {links.map((m: any, i: number) => (
                  <a
                    key={i}
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-3 rounded-2xl border border-border bg-card/40 hover:bg-card hover:border-accent/50 hover:shadow-md transition-all p-4"
                  >
                    <span className="shrink-0 inline-flex size-9 items-center justify-center rounded-full bg-accent/15 text-accent">
                      <Ticket className="size-4" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium text-[14px] leading-tight truncate">{m.label}</span>
                        <ExternalLink className="size-3 text-muted-foreground shrink-0 group-hover:text-accent transition-colors" />
                      </span>
                      {typeof m.description === "string" && m.description.trim() && (
                        <span className="block text-[12.5px] text-muted-foreground mt-1 leading-relaxed">
                          {m.description}
                        </span>
                      )}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          );
        })()}

        {!active && (() => {
          const tagged = (r.faqs ?? []).filter((f: any) => Array.isArray(f?.tags) && f.tags.includes("explore"));
          if (tagged.length === 0) return null;
          return (
            <div className="mt-10">
              <div className="mb-3 flex items-center gap-2">
                <HelpCircle className="size-4 text-muted-foreground" />
                <h3 className="text-xs uppercase tracking-[0.18em] font-semibold text-muted-foreground">Perguntas frequentes</h3>
              </div>
              <Accordion type="single" collapsible className="space-y-1.5">
                {tagged.map((f: any, idx: number) => (
                  <AccordionItem
                    key={f.id}
                    value={f.id}
                    className="border border-border/70 rounded-xl px-3.5 bg-card/30 hover:bg-card/60 transition-colors data-[state=open]:bg-card data-[state=open]:border-accent/40"
                  >
                    <AccordionTrigger className="text-left hover:no-underline py-2.5 gap-3">
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="text-[10px] font-mono text-accent/70 tabular-nums tracking-wider shrink-0">{String(idx + 1).padStart(2, "0")}</span>
                        <span className="text-[13.5px] font-medium leading-snug truncate">{f.question}</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-[13.5px] leading-relaxed whitespace-pre-line text-foreground/80 pl-6 pr-1 pb-3.5 max-w-prose">
                      {f.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          );
        })()}
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
        const fallbackSrc = CATEGORY_FALLBACK_IMAGE[meta.key];
        const Icon = meta.Icon;
        return (
          <button
            key={meta.key}
            type="button"
            onClick={() => onPick(meta.key)}
            className="group relative overflow-hidden rounded-2xl border border-border bg-card text-left hover:border-accent/50 hover:shadow-xl transition-all"
          >
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-secondary">
              <FallbackImage
                src={fallbackSrc}
                alt=""
                className="absolute inset-0 size-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
              />
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

function CategoryList({
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
    <div className="flex flex-col gap-3">
      {categories.map(({ meta, count, nearby, city }) => {
        const fallbackSrc = CATEGORY_FALLBACK_IMAGE[meta.key];
        const Icon = meta.Icon;
        return (
          <button
            key={meta.key}
            type="button"
            onClick={() => onPick(meta.key)}
            className="group flex gap-4 bg-card border border-border rounded-2xl p-3 text-left hover:border-accent/40 hover:shadow-lg transition-all"
          >
            <div className="relative size-24 sm:size-28 shrink-0 overflow-hidden rounded-xl bg-secondary">
              <FallbackImage
                src={fallbackSrc}
                alt=""
                className="absolute inset-0 size-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
              />
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
              <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-semibold text-accent">
                <Icon className="size-3.5" strokeWidth={1.75} />
                {count} {count === 1 ? "lugar" : "lugares"}
              </p>
              <h2 className="font-serif text-[1.3rem] leading-tight">{meta.title}</h2>
              <p className="text-[12.5px] text-muted-foreground leading-relaxed line-clamp-2">{meta.desc}</p>
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
  viewMode,
  setViewMode,
  isTouristCategory,
}: {
  nearby: Rec[];
  city: Rec[];
  sortBy: SortKey;
  setSortBy: (s: SortKey) => void;
  viewMode: "grid" | "list";
  setViewMode: (v: "grid" | "list") => void;
  isTouristCategory: boolean;
}) {
  const [minReviews, setMinReviews] = useState(0);

  const applyFilter = (arr: Rec[]) => {
    if (minReviews <= 0) return arr;
    return arr.filter((rec) => (rec.user_ratings_total ?? 0) >= minReviews);
  };

  const nearbyFiltered = applyFilter(nearby);
  const cityFiltered = applyFilter(city);

  const sections = [
    { key: "nearby", eyebrow: "A poucos minutos", title: "Pertinho da Residência", items: nearbyFiltered, total: nearby.length },
    { key: "city", eyebrow: "Vale o deslocamento", title: "Referências na Cidade", items: cityFiltered, total: city.length },
  ].filter((s) => s.total > 0);

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <SortBar sortBy={sortBy} setSortBy={setSortBy} />
          <MinReviewsFilter value={minReviews} onChange={setMinReviews} />
        </div>
        <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
      </div>
      <div className="mt-8 space-y-6">
        {sections.map((s) => (
          <CollapsibleSection
            key={s.key}
            eyebrow={s.eyebrow}
            title={s.title}
            items={s.items}
            totalCount={s.total}
            viewMode={viewMode}
          />
        ))}
        {sections.length === 0 && (
          <p className="text-sm text-muted-foreground">Nada cadastrado nesta categoria.</p>
        )}
      </div>
    </>
  );
}

function MinReviewsFilter({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const opts: { v: number; label: string }[] = [
    { v: 0, label: "Todas" },
    { v: 50, label: "50+" },
    { v: 200, label: "200+" },
    { v: 1000, label: "1k+" },
    { v: 5000, label: "5k+" },
  ];
  return (
    <div className="inline-flex items-center rounded-full border border-border bg-card/60 backdrop-blur p-1">
      <span className="px-2.5 text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">
        Avaliações
      </span>
      {opts.map((o) => {
        const on = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`px-2.5 py-1.5 rounded-full text-[11.5px] font-medium transition-colors ${
              on ? "bg-accent text-accent-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}


function ViewToggle({
  viewMode,
  setViewMode,
}: {
  viewMode: "grid" | "list";
  setViewMode: (v: "grid" | "list") => void;
}) {
  const opts: { key: "grid" | "list"; label: string; Icon: typeof LayoutGrid }[] = [
    { key: "grid", label: "Grade", Icon: LayoutGrid },
    { key: "list", label: "Lista", Icon: ListIcon },
  ];
  return (
    <div className="inline-flex items-center rounded-full border border-border bg-card/60 backdrop-blur p-1">
      {opts.map((o) => {
        const on = viewMode === o.key;
        const Icon = o.Icon;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => setViewMode(o.key)}
            aria-label={o.label}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-medium transition-colors ${
              on
                ? "bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SortBar({ sortBy, setSortBy }: { sortBy: SortKey; setSortBy: (s: SortKey) => void }) {
  const opts: { key: SortKey; label: string }[] = [
    { key: "distance", label: "Distância" },
    { key: "rating", label: "Avaliação" },
    { key: "alpha", label: "A–Z" },
  ];
  return (
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
  );
}

function CollapsibleSection({
  eyebrow,
  title,
  items,
  totalCount,
  viewMode,
}: {
  eyebrow: string;
  title: string;
  items: Rec[];
  totalCount: number;
  viewMode: "grid" | "list";
}) {
  const [open, setOpen] = useState(false);
  const isFiltered = items.length !== totalCount;

  return (
    <section className="border border-border rounded-2xl bg-card/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-card/80 transition-colors"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.28em] text-accent font-semibold">{eyebrow}</p>
          <h3 className="font-serif text-[1.35rem] md:text-[1.55rem] leading-tight mt-0.5">
            {title}
            <span className="ml-2 text-[12px] text-muted-foreground font-sans font-normal">
              ({items.length}{isFiltered ? ` de ${totalCount}` : ""})
            </span>
          </h3>
        </div>
        <ChevronDown
          className={`size-5 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhum lugar com esse mínimo de avaliações nesta seção.
            </p>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((rec) => (
                <RecCard key={rec.id} rec={rec} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((rec) => (
                <RecRow key={rec.id} rec={rec} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}


function RecCard({ rec }: { rec: Rec }) {
  const walking = formatWalking(rec);
  const driving = formatDriving(rec);
  const href = safeHttpsHref(rec.maps_url);
  const typeLabel = TYPE_LABEL[rec.type] || rec.category || rec.type;
  const imageSrc = usableImageUrl(rec.image_url, fallbackImageForType(rec.type));

  const inner = (
    <div className="group bg-card border border-border rounded-2xl overflow-hidden flex flex-col hover:border-accent/40 hover:shadow-lg transition-all h-full">
      <div className="relative aspect-square w-full overflow-hidden bg-secondary">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={rec.name}
            loading="lazy"
            width={1200}
            height={900}
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

        <div className="pt-2 flex flex-col gap-1.5 text-[11.5px] text-muted-foreground">
          {rec.rating != null && (
            <span className="inline-flex items-center gap-1.5 text-foreground/85 font-semibold">
              <Star className="size-3.5 fill-current text-accent" strokeWidth={0} />
              <span className="tabular-nums">{Number(rec.rating).toFixed(1)}</span>
              {rec.user_ratings_total ? (
                <span className="font-normal text-muted-foreground">
                  ({rec.user_ratings_total.toLocaleString("pt-BR")} avaliações)
                </span>
              ) : null}
            </span>
          )}
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

        <div className="mt-auto pt-1">
          <OpeningHours hours={rec.opening_hours} />
        </div>
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

function RecRow({ rec }: { rec: Rec }) {
  const walking = formatWalking(rec);
  const driving = formatDriving(rec);
  const href = safeHttpsHref(rec.maps_url);
  const typeLabel = TYPE_LABEL[rec.type] || rec.category || rec.type;
  const imageSrc = usableImageUrl(rec.image_url, fallbackImageForType(rec.type));

  const inner = (
    <div className="group flex gap-4 bg-card border border-border rounded-2xl p-3 hover:border-accent/40 hover:shadow-lg transition-all">
      <div className="relative size-24 sm:size-28 shrink-0 overflow-hidden rounded-xl bg-secondary">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={rec.name}
            loading="lazy"
            width={1200}
            height={900}
            className="absolute inset-0 size-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-accent/15 to-accent/5">
            <Compass className="size-7 text-accent/60" strokeWidth={1.25} />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5 py-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-[15px] font-medium leading-snug line-clamp-2">{rec.name}</h4>
            <p className="mt-0.5 text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/80 font-semibold">
              {typeLabel}
            </p>
          </div>
          {href && (
            <ExternalLink className="size-3.5 text-muted-foreground/70 shrink-0 mt-1 group-hover:text-accent transition-colors" />
          )}
        </div>

        {rec.note && (
          <p className="text-[12.5px] text-muted-foreground leading-relaxed line-clamp-2">{rec.note}</p>
        )}

        <div className="mt-auto flex flex-col gap-1 text-[11.5px] text-muted-foreground">
          {rec.rating != null && (
            <span className="inline-flex items-center gap-1.5 text-foreground/85 font-semibold">
              <Star className="size-3.5 fill-current text-accent" strokeWidth={0} />
              <span className="tabular-nums">{Number(rec.rating).toFixed(1)}</span>
              {rec.user_ratings_total ? (
                <span className="font-normal text-muted-foreground">
                  ({rec.user_ratings_total.toLocaleString("pt-BR")} avaliações)
                </span>
              ) : null}
            </span>
          )}
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
        <OpeningHours hours={rec.opening_hours} />

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

void ShoppingBag;
