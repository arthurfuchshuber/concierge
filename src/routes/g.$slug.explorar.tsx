import { createFileRoute, notFound, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState, useEffect, useRef } from "react";
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
  MapPin,
  Map,
  X,
} from "lucide-react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { GuideAiChat } from "@/components/GuideAiChat";
import { toTitleCase } from "@/lib/text";
import { useCityReferencesRealtime } from "@/hooks/useCityReferencesRealtime";
import { useTaxonomy } from "@/components/admin/TagPicker";



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


// Fallback labels — usados pelos componentes-filhos enquanto a taxonomia carrega.
// O componente principal hidrata `TYPE_LABEL` em runtime com os dados do DB.
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
const TYPE_LABEL_FALLBACK = TYPE_LABEL;

type MetaCategory = {
  key: string;
  title: string;
  desc: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  types: string[];
};

function iconForCategorySlug(slug: string): MetaCategory["Icon"] {
  const s = (slug || "").toLowerCase();
  if (/(restaur|comida|food)/.test(s)) return Utensils;
  if (/(bar|noturn|night)/.test(s)) return PartyPopper;
  if (/(caf|padar)/.test(s)) return Coffee;
  if (/(atra|turis|sight|parqu|praia|lago)/.test(s)) return Landmark;
  if (/(compr|shop|merc)/.test(s)) return ShoppingBag;
  if (/(farm|saud|health)/.test(s)) return Cross;
  return Compass;
}

function hasMeaningfulInfo(r: Rec): boolean {
  return !!(r.name && (r.image_url || r.rating || r.distance_text || r.distance_meters || r.note));
}

// "Pertinho" — top-level helper, usado nos cards para destaque visual.
function isPertinhoRec(r: Rec): boolean {
  if (typeof r.distance_meters === "number" && r.distance_meters > 0 && r.distance_meters <= 1500) return true;
  if (typeof r.walk_minutes === "number" && r.walk_minutes > 0 && r.walk_minutes <= 20) return true;
  return false;
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

function safeHttpsHref(value: string | null | undefined, fallbackName?: string): string | undefined {
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:") return url.toString();
    } catch {
      // fall through to fallback
    }
  }
  // Fallback: Google Maps search by name
  if (fallbackName?.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackName.trim())}`;
  }
  return undefined;
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


// Capa da categoria = foto do lugar com MAIOR número de avaliações
// (entre os que têm imagem). Prioriza referências da cidade; cai para
// "pertinho" só quando não houver nenhuma referência city com foto.
function pickBestPhoto(nearby: Rec[], city: Rec[]): string | null {
  const pickByReviews = (arr: Rec[]) =>
    arr
      .filter((x) => x.image_url)
      .sort((a, b) => (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0))[0]?.image_url ?? null;
  return pickByReviews(city) ?? pickByReviews(nearby);
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

function matchesQuery(rec: Rec, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    rec.name,
    rec.category ?? "",
    TYPE_LABEL[rec.type] ?? rec.type,
    rec.note ?? "",
  ].join(" \u0001 ").toLowerCase();
  return hay.includes(needle);
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full mt-3">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Buscar por nome, categoria ou descrição…"}
        className="w-full rounded-full border border-border bg-card/60 backdrop-blur px-4 py-2.5 pr-10 text-[13px] placeholder:text-muted-foreground/70 focus:outline-none focus:border-accent/60 focus:bg-card transition-colors"
      />
      {value && (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => onChange("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function ExplorePage() {
  const r = Route.useLoaderData();
  const router = useRouter();
  const { slug } = Route.useParams();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("distance");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [minReviews, setMinReviews] = useState<number>(0);
  const [query, setQuery] = useState<string>("");
  // "Ver Mapa" temporariamente desabilitado — state preservado no histórico do arquivo.

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
  const realtimeCityLabel = r.status === "ok" ? ((r.property as Record<string, unknown>).city as string | null) : null;
  useCityReferencesRealtime(realtimeCityLabel, () => {
    void router.invalidate();
  });

  if (r.status !== "ok") {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">Guia indisponível.</p>
      </div>
    );
  }

  const p = r.property as Record<string, any>;
  const propLat = typeof p.lat === "number" ? (p.lat as number) : null;
  const propLng = typeof p.lng === "number" ? (p.lng as number) : null;

  // "Pertinho" = até 1,5km OU até 20 minutos a pé.
  const isPertinho = (rec: Rec): boolean => {
    if (typeof rec.distance_meters === "number" && rec.distance_meters > 0) {
      if (rec.distance_meters <= 1500) return true;
    }
    if (typeof rec.walk_minutes === "number" && rec.walk_minutes > 0 && rec.walk_minutes <= 20) {
      return true;
    }
    return false;
  };

  // Distância em metros entre dois pontos lat/lng (haversine).
  const distMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R = 6371000;
    const toRad = (n: number) => (n * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  };

  const allRecs: Rec[] = (r.recommendations as Rec[])
    .filter((rec) => rec.scope === "nearby")
    .filter(hasMeaningfulInfo)
    .map((rec) => ({ ...rec, name: toTitleCase(rec.name) }));

  // Referências macro da cidade — compartilhadas entre todas as residências
  // da mesma cidade. Vindas de city_references (alimentadas pelo admin).
  // Calcula distance_meters/walk_minutes quando temos lat/lng da residência
  // e da referência, para que possam também aparecer em "Pertinho" se couberem.
  const cityRefs: Rec[] = useMemo(() => {
    const list = ((r as Record<string, unknown>).cityReferences ?? []) as Array<Record<string, unknown>>;
    return list
      .map((c) => {
        const lat = typeof c.lat === "number" ? (c.lat as number) : null;
        const lng = typeof c.lng === "number" ? (c.lng as number) : null;
        let dMeters: number | null = null;
        let walkMin: number | null = null;
        let driveMin: number | null = null;
        if (propLat !== null && propLng !== null && lat !== null && lng !== null) {
          dMeters = distMeters({ lat: propLat, lng: propLng }, { lat, lng });
          walkMin = Math.max(1, Math.round(dMeters / 80));
          if (dMeters > 1500) {
            driveMin = Math.max(2, Math.round((dMeters / 1000 / 40) * 60));
          }
        }
        return {
          id: c.id as string,
          scope: "city",
          type: (c.type as string) ?? "other",
          name: toTitleCase((c.name as string) ?? ""),
          category: (c.category as string) ?? null,
          rating: (c.rating as number) ?? null,
          user_ratings_total: (c.user_ratings_total as number) ?? null,
          distance_meters: dMeters,
          walk_minutes: walkMin,
          drive_minutes: driveMin,
          note: (c.note as string) ?? null,
          image_url: (c.image_url as string) ?? null,
          maps_url: (c.maps_url as string) ?? null,
          opening_hours: (c.opening_hours as string[]) ?? null,
        } as Rec;
      })
      .filter((x) => x.name);
  }, [r, propLat, propLng]);
  // Constrói nearby/city por meta-categoria a partir de:
  // - property_recommendations: apenas "Pertinho" do imóvel;
  // - city_references: apenas "Referências na Cidade", compartilhadas.
  const buildBuckets = (meta: MetaCategory, applyMinReviews: boolean) => {
    const passesReviews = (x: Rec) =>
      !applyMinReviews || minReviews <= 0 || (x.user_ratings_total ?? 0) >= minReviews;
    const passesQuery = (x: Rec) => matchesQuery(x, query);
    const recsInType = allRecs.filter((rec) => meta.types.includes(rec.type) && passesReviews(rec) && passesQuery(rec));
    const cityInType = cityRefs.filter((rec) => meta.types.includes(rec.type) && passesReviews(rec) && passesQuery(rec));

    const nearbyFromRecs = recsInType.filter(isPertinho);

    const seen = new Set<string>();
    const nearby: Rec[] = [];
    for (const x of nearbyFromRecs) {
      const k = (x.name || "").toLowerCase().trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      nearby.push(x);
    }

    const seenCity = new Set<string>();
    const city: Rec[] = [];
    for (const x of cityInType) {
      const k = (x.name || "").toLowerCase().trim();
      if (!k || seenCity.has(k)) continue;
      seenCity.add(k);
      city.push(x);
    }

    const total = nearby.length + city.length;
    return { meta, items: [...nearby, ...city], nearby, city, count: total };
  };

  // Categorias agora vêm da taxonomia configurada pelo admin (DB).
  const { data: taxonomy } = useTaxonomy();
  const dynamicMetas: MetaCategory[] = useMemo(() => {
    const cats = taxonomy?.categories ?? [];
    const tags = taxonomy?.tags ?? [];
    return cats.map((c) => {
      const types = tags.filter((t) => t.category_id === c.id).map((t) => t.slug);
      return {
        key: c.slug,
        title: c.label,
        desc: "",
        Icon: iconForCategorySlug(c.slug),
        types,
      };
    });
  }, [taxonomy]);

  // Tipos órfãos: aparecem em allRecs/cityRefs mas não constam de nenhuma categoria.
  // Agrupamos sob "Outros" para não desaparecerem do guia.
  const orphanMeta: MetaCategory | null = useMemo(() => {
    const known = new Set(dynamicMetas.flatMap((m) => m.types));
    const orphanTypes = new Set<string>();
    [...allRecs, ...cityRefs].forEach((r) => { if (r.type && !known.has(r.type)) orphanTypes.add(r.type); });
    if (orphanTypes.size === 0) return null;
    return {
      key: "__outros__",
      title: "Outros",
      desc: "",
      Icon: Compass,
      types: Array.from(orphanTypes),
    };
  }, [dynamicMetas, allRecs, cityRefs]);

  const allMetas = useMemo(
    () => (orphanMeta ? [...dynamicMetas, orphanMeta] : dynamicMetas),
    [dynamicMetas, orphanMeta],
  );

  const categories = useMemo(
    () => allMetas.map((m) => buildBuckets(m, true)).filter((c) => c.count > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allMetas, allRecs, cityRefs, minReviews],
  );

  const categoriesUnfiltered = useMemo(
    () => allMetas.map((m) => buildBuckets(m, false)).filter((c) => c.count > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allMetas, allRecs, cityRefs],
  );

  // Mantém o mapa de label sincronizado com a taxonomia (mutação intencional
  // do objeto module-level para que componentes-filhos enxerguem labels reais).
  useEffect(() => {
    (taxonomy?.tags ?? []).forEach((t) => { TYPE_LABEL[t.slug] = t.label; });
  }, [taxonomy]);

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
          <div className="flex items-start justify-between gap-4">
            <h1 className="font-serif text-[2.1rem] md:text-[2.8rem] leading-[1.02] tracking-tight">
              {active ? active.meta.title : "Explore a Região"}
            </h1>
          </div>
          <p className="text-[13px] md:text-[14px] text-muted-foreground mt-3 leading-relaxed max-w-[52ch]">
            {active
              ? active.meta.desc
              : `Uma curadoria de lugares e experiências próximas a ${p.name}.`}
          </p>
        </header>

        {/* "Ver Mapa" temporariamente desabilitado — componente EmbeddedMapModal preservado abaixo para reativação futura. */}

        {!active ? (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <MinReviewsFilter value={minReviews} onChange={setMinReviews} items={[...allRecs, ...cityRefs]} />
              <div className="ml-auto">
                <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
              </div>
            </div>
            <SearchBar value={query} onChange={setQuery} />
            <div className="mt-5">
              {viewMode === "grid" ? (
                <CategoryGrid categories={categories} onPick={(k) => setActiveKey(k)} />
              ) : (
                <CategoryList categories={categories} onPick={(k) => setActiveKey(k)} />
              )}
            </div>
          </>
        ) : (
          <CategoryDetail
            nearby={active!.nearby}
            city={active!.city}
            sortBy={sortBy}
            setSortBy={setSortBy}
            viewMode={viewMode}
            setViewMode={setViewMode}
            isTouristCategory={active!.meta.key === "sights"}
          />
        )}

        {/* Reservas & marketplace — fica ao final da página (somente fora do detalhe). */}
        {(() => {
          if (active) return null;
          const links = (Array.isArray(p.marketplace_links) ? p.marketplace_links : []).filter(
            (m: any) => m && typeof m.label === "string" && m.label.trim() && typeof m.url === "string" && m.url.trim(),
          );
          if (links.length === 0) return null;
          return (
            <div className="mt-10">
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


        {categories.length === 0 && cityRefs.length === 0 && (!Array.isArray(p.marketplace_links) || p.marketplace_links.length === 0) && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="size-14 rounded-2xl bg-accent/10 grid place-items-center">
              <Compass className="size-7 text-accent/60" strokeWidth={1.25} />
            </div>
            <p className="text-[15px] font-medium">Recomendações a caminho</p>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              O anfitrião ainda está preparando as dicas desta hospedagem. Volte em breve!
            </p>
          </div>
        )}


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
      {(r as { aiEnabled?: boolean }).aiEnabled ? (
        <GuideAiChat slug={slug} propertyName={(p.name as string) ?? "Guia"} guestName={null} />
      ) : null}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden animate-pulse">
      <div className="aspect-[16/10] w-full bg-secondary" />
      <div className="p-5 space-y-3">
        <div className="h-5 bg-secondary rounded-lg w-3/4" />
        <div className="h-3.5 bg-secondary rounded w-full" />
        <div className="h-3.5 bg-secondary rounded w-2/3" />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex gap-4 bg-card border border-border rounded-2xl p-3 animate-pulse">
      <div className="size-24 sm:size-28 shrink-0 rounded-xl bg-secondary" />
      <div className="flex-1 space-y-2 py-1">
        <div className="h-4 bg-secondary rounded w-2/3" />
        <div className="h-3 bg-secondary rounded w-1/3" />
        <div className="h-3 bg-secondary rounded w-full" />
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
  if (categories.length === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[1,2,3,4].map((k) => <SkeletonCard key={k} />)}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {categories.map(({ meta, count, nearby, city }) => {
        const heroSrc = pickBestPhoto(nearby, city);
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
        const heroSrc = pickBestPhoto(nearby, city);
        const Icon = meta.Icon;
        return (
          <button
            key={meta.key}
            type="button"
            onClick={() => onPick(meta.key)}
            className="group flex gap-4 bg-card border border-border rounded-2xl p-3 text-left hover:border-accent/40 hover:shadow-lg transition-all"
          >
            <div className="relative size-24 sm:size-28 shrink-0 overflow-hidden rounded-xl bg-secondary">
              {heroSrc ? (
                <img
                  src={heroSrc}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-accent/20 to-accent/5">
                  <Icon className="size-8 text-accent/70" strokeWidth={1.25} />
                </div>
              )}
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
  // Filtros de proximidade: "pertinho" (<=1,6 km) e "refs" (rating>=4.5 e
  // user_ratings_total>=500). Podem ser combinados; quando ambos desligados,
  // mostramos todos os itens da categoria.
  const [showNear, setShowNear] = useState(false);
  const [showRefs, setShowRefs] = useState(false);
  const [query, setQuery] = useState("");

  // Combina pertinho + cidade num único pool e deduplica por nome.
  const allItems = useMemo(() => {
    const seen = new Set<string>();
    const out: Rec[] = [];
    for (const x of [...nearby, ...city]) {
      const k = (x.name || "").toLowerCase().trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }, [nearby, city]);

  const isNear = (r: Rec) =>
    (typeof r.distance_meters === "number" && r.distance_meters > 0 && r.distance_meters <= 1600);
  const isRef = (r: Rec) =>
    (r.rating ?? 0) >= 4.5 && (r.user_ratings_total ?? 0) >= 500;

  const filtered = useMemo(() => {
    let arr = allItems;
    if (showNear || showRefs) {
      arr = arr.filter((r) => (showNear && isNear(r)) || (showRefs && isRef(r)));
    }
    if (minReviews > 0) {
      arr = arr.filter((r) => (r.user_ratings_total ?? 0) >= minReviews);
    }
    if (query.trim()) {
      arr = arr.filter((r) => matchesQuery(r, query));
    }
    return arr;
  }, [allItems, showNear, showRefs, minReviews, query]);

  const sorted = useMemo(() => sortRecs(filtered, sortBy), [filtered, sortBy]);
  const nearCount = allItems.filter(isNear).length;
  const refsCount = allItems.filter(isRef).length;

  return (
    <>
      {/* Linha 1: ordenação + filtros de proximidade */}
      <div className="flex items-center gap-3 flex-wrap">
        <SortBar sortBy={sortBy} setSortBy={setSortBy} />
        <div className="ml-auto">
          <ProximityFilters
            showNear={showNear}
            setShowNear={setShowNear}
            showRefs={showRefs}
            setShowRefs={setShowRefs}
            nearCount={nearCount}
            refsCount={refsCount}
          />
        </div>
      </div>
      {/* Linha 2: avaliações + view toggle à direita */}
      <div className="flex items-center justify-between gap-3 flex-wrap mt-3">
        <MinReviewsFilter value={minReviews} onChange={setMinReviews} items={allItems} />
        <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
      </div>
      {/* Linha 3: busca livre */}
      <SearchBar value={query} onChange={setQuery} />

      <div className="mt-5">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Nenhum lugar com esses filtros.
          </p>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map((rec) => <RecCard key={rec.id} rec={rec} />)}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((rec) => <RecRow key={rec.id} rec={rec} />)}
          </div>
        )}
      </div>
    </>
  );
}

function ProximityFilters({
  showNear, setShowNear, showRefs, setShowRefs, nearCount, refsCount,
}: {
  showNear: boolean; setShowNear: (b: boolean) => void;
  showRefs: boolean; setShowRefs: (b: boolean) => void;
  nearCount: number; refsCount: number;
}) {
  const opts = [
    { key: "near", label: "Pertinho", on: showNear, toggle: () => setShowNear(!showNear), count: nearCount },
    { key: "refs", label: "Referências na Cidade", on: showRefs, toggle: () => setShowRefs(!showRefs), count: refsCount },
  ].filter((o) => o.count > 0);
  if (opts.length === 0) return null;
  return (
    <div className="inline-flex items-center rounded-full border border-border bg-card/60 backdrop-blur p-1">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={o.toggle}
          className={`px-3 py-1.5 rounded-full text-[11.5px] font-medium transition-colors ${
            o.on ? "bg-accent text-accent-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MinReviewsFilter({ value, onChange, items }: { value: number; onChange: (n: number) => void; items?: Rec[] }) {
  const all: { v: number; label: string }[] = [
    { v: 0, label: "Todas" },
    { v: 50, label: "50+" },
    { v: 200, label: "200+" },
    { v: 1000, label: "1k+" },
    { v: 5000, label: "5k+" },
  ];

  // Limita as opções com base no min/max de avaliações dos itens disponíveis.
  // Esconde "X+" se não houver item >= X (max < X) e esconde se nenhum item
  // estiver na faixa < próximo threshold (min >= próximo threshold).
  let opts = all;
  if (items && items.length > 0) {
    const counts = items.map((r) => r.user_ratings_total ?? 0);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    opts = all.filter((o, i) => {
      if (o.v === 0) return true;
      if (max < o.v) return false;
      const next = all[i + 1]?.v ?? Infinity;
      if (min >= next) return false;
      return true;
    });
  }

  if (opts.length <= 1) return null;
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
  open: openProp,
  onToggle,
}: {
  eyebrow: string;
  title: string;
  items: Rec[];
  totalCount: number;
  viewMode: "grid" | "list";
  open?: boolean;
  onToggle?: () => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = openProp ?? localOpen;
  const toggle = onToggle ?? (() => setLocalOpen((v) => !v));
  const isFiltered = items.length !== totalCount;

  return (
    <section className="border border-border rounded-2xl bg-card/40 overflow-hidden">
      <button
        type="button"
        onClick={toggle}
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
  const href = safeHttpsHref(rec.maps_url, rec.name);
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
            <span
              className={`inline-flex items-center gap-1.5 ${isPertinhoRec(rec) ? "rounded-full bg-amber-400/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 font-medium" : ""}`}
            >
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
  const href = safeHttpsHref(rec.maps_url, rec.name);
  const typeLabel = TYPE_LABEL[rec.type] || rec.category || rec.type;

  const inner = (
    <div className="group flex gap-4 bg-card border border-border rounded-2xl p-3 hover:border-accent/40 hover:shadow-lg transition-all">
      <div className="relative size-24 sm:size-28 shrink-0 overflow-hidden rounded-xl bg-secondary">
        {rec.image_url ? (
          <img
            src={rec.image_url}
            alt={rec.name}
            loading="lazy"
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
            <span
              className={`inline-flex items-center gap-1.5 ${isPertinhoRec(rec) ? "rounded-full bg-amber-400/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 font-medium" : ""}`}
            >
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


// ─── CityMap: visual grid of pinned places linking to Google Maps ─────────────
function CityMap({ items }: { items: Rec[] }) {
  const withImg = items.filter((it) => it.image_url).slice(0, 6);
  if (withImg.length < 2) return null;

  const categoryColors: Record<string, string> = {
    attraction: "bg-amber-500", restaurant: "bg-red-500", bar: "bg-purple-500",
    cafe: "bg-yellow-600", beach: "bg-blue-500", park: "bg-green-500",
    market: "bg-orange-500", pharmacy: "bg-pink-500", shopping: "bg-indigo-500",
    nightlife: "bg-violet-500",
  };

  return (
    <div className="rounded-2xl border border-border overflow-hidden bg-card mb-2">
      <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-accent" strokeWidth={1.75} />
          <h3 className="text-[13px] font-medium">Destaque visual</h3>
        </div>
        <span className="text-[11px] text-muted-foreground">{items.length} pontos</span>
      </div>
      <div className="p-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
        {withImg.map((it) => {
          const href = it.maps_url ?? undefined;
          const color = categoryColors[it.type] ?? "bg-accent";
          const inner = (
            <div className="group relative overflow-hidden rounded-xl aspect-square cursor-pointer hover:scale-[1.03] transition-transform">
              <img src={it.image_url!} alt={it.name} className="absolute inset-0 size-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <div className={`absolute top-1.5 left-1.5 size-2 rounded-full ${color} ring-1 ring-white/50`} />
              <p className="absolute bottom-1.5 left-1.5 right-1.5 text-[10px] font-medium text-white leading-tight line-clamp-2">{it.name}</p>
              <ExternalLink className="absolute top-1.5 right-1.5 size-2.5 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          );
          return href ? (
            <a key={it.id} href={href} target="_blank" rel="noopener noreferrer">{inner}</a>
          ) : <div key={it.id}>{inner}</div>;
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// EmbeddedMapModal — mostra todos os pontos de recomendação no Google Maps
// embutido dentro da própria página, sem redirecionar o usuário.
// ──────────────────────────────────────────────────────────────────────────────
function EmbeddedMapModal({
  recs,
  propLat,
  propLng,
  propName,
  onClose,
}: {
  recs: Rec[];
  propLat: number;
  propLng: number;
  propName: string;
  onClose: () => void;
}) {
  // Build a Google Maps Embed URL with multiple markers.
  // The Embed API supports "q" for a single search OR we use the place-search
  // mode. For multiple custom pins we use the "search" mode with the property
  // location as center + all maps_url links listed below the map.
  const GOOGLE_MAPS_KEY = (typeof window !== "undefined"
    ? ((window as unknown as { __ENV__?: { VITE_GOOGLE_MAPS_KEY?: string } }).__ENV__?.VITE_GOOGLE_MAPS_KEY ?? null)
    : null) as string | null;

  // Build comma-separated waypoints from recs that have maps_url or a name.
  // The Embed API doesn't support multiple custom pins natively, so we use
  // the "search" query centered on the property to show nearby places.
  const searchQuery = encodeURIComponent(`restaurantes e atrações perto de ${propName}`);

  const embedSrc = GOOGLE_MAPS_KEY
    ? `https://www.google.com/maps/embed/v1/search?key=${GOOGLE_MAPS_KEY}&q=${searchQuery}&center=${propLat},${propLng}&zoom=14`
    : `https://maps.google.com/maps?q=${propLat},${propLng}&z=14&output=embed`;

  // Separate recs that have a direct maps link
  const withMapsUrl = recs.filter((r) => r.maps_url && r.name);

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-0 sm:px-4"
      onClick={handleBackdrop}
    >
      <div className="relative w-full sm:max-w-2xl lg:max-w-4xl bg-card rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <Map className="size-4.5 text-accent" strokeWidth={1.75} />
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Mapa</p>
              <p className="text-[14px] font-medium leading-tight">Recomendações próximas</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-full bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Map iframe */}
        <div className="relative w-full" style={{ aspectRatio: "16/9", minHeight: 240 }}>
          <iframe
            title="Mapa de recomendações"
            src={embedSrc}
            width="100%"
            height="100%"
            style={{ border: 0, display: "block" }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>

        {/* List of places with direct links */}
        {withMapsUrl.length > 0 && (
          <div className="overflow-y-auto px-5 py-4 flex-1 min-h-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold mb-3">
              Abrir no Google Maps
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {withMapsUrl.map((rec) => (
                <a
                  key={rec.id}
                  href={rec.maps_url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-xl border border-border bg-background/50 hover:bg-card hover:border-accent/40 hover:shadow-md transition-all p-3"
                >
                  {rec.image_url ? (
                    <img
                      src={rec.image_url}
                      alt={rec.name}
                      loading="lazy"
                      className="size-9 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <span className="size-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
                      <MapPin className="size-4 text-accent" strokeWidth={1.75} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="text-[13px] font-medium truncate">{rec.name}</span>
                      <ExternalLink className="size-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {TYPE_LABEL[rec.type] ?? rec.type}
                      {rec.distance_text ? ` · ${rec.distance_text}` : ""}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
