import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Radio, ArrowUpRight, ExternalLink, Bookmark } from "lucide-react";
import { getCityNews, type NewsItem } from "@/lib/city-news.functions";
import { cityKey } from "@/lib/city-key";

type Lang = "pt" | "en" | "es" | "fr";

function openChat(prompt: string) {
  window.dispatchEvent(new CustomEvent("open-guide-chat", { detail: { prompt } }));
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string; ring: string }> = {
  natureza: { bg: "bg-emerald-500/15", text: "text-emerald-400", ring: "ring-emerald-500/30" },
  gastronomia: { bg: "bg-orange-500/15", text: "text-orange-400", ring: "ring-orange-500/30" },
  evento: { bg: "bg-fuchsia-500/15", text: "text-fuchsia-400", ring: "ring-fuchsia-500/30" },
  passeio: { bg: "bg-sky-500/15", text: "text-sky-400", ring: "ring-sky-500/30" },
  cultura: { bg: "bg-amber-500/15", text: "text-amber-400", ring: "ring-amber-500/30" },
  noite: { bg: "bg-indigo-500/15", text: "text-indigo-400", ring: "ring-indigo-500/30" },
  mercado: { bg: "bg-rose-500/15", text: "text-rose-400", ring: "ring-rose-500/30" },
};

function styleFor(cat: string) {
  return CATEGORY_STYLES[cat.toLowerCase()] ?? CATEGORY_STYLES.passeio;
}

export function CityNewsFeed({
  city,
  country,
  lang,
  theme,
}: {
  city: string | null;
  country: string | null;
  lang: Lang;
  theme: "dark" | "light";
}) {
  const newsFn = useServerFn(getCityNews);
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [loading, setLoading] = useState(!!city);

  useEffect(() => {
    if (!city) {
      setLoading(false);
      return;
    }
    let alive = true;
    newsFn({ data: { cityKey: cityKey(city), cityLabel: city, country: country ?? undefined, lang } })
      .then((r) => alive && setItems(r?.items ?? null))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [city, country, lang, newsFn]);

  const hasItems = items && items.length > 0;
  if (!loading && !hasItems) return null;

  const isDark = theme === "dark";

  return (
    <section className="mt-6 md:mt-8 relative z-10">
      <div className="px-5 md:px-10 lg:px-16 flex items-center gap-2 mb-3">
        <span className="relative flex size-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex rounded-full size-1.5 bg-emerald-400" />
        </span>
        <p className="text-[10px] uppercase tracking-[0.3em] font-semibold text-accent/80 flex items-center gap-1.5">
          <Radio className="size-3" />
          {city ? `o que rola em ${city}` : "o que rola hoje"}
        </p>
        <span className="text-[9px] uppercase tracking-[0.25em] text-foreground/40">· atualizado agora</span>
      </div>

      {loading && !hasItems ? (
        <div className="px-5 md:px-10 lg:px-16 flex gap-3 overflow-x-hidden">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`shrink-0 w-[74%] sm:w-[46%] md:w-[32%] rounded-2xl border overflow-hidden animate-pulse ${
                isDark ? "border-border/60 bg-card/40" : "border-border/70 bg-card/70"
              }`}
            >
              <div className="h-32 bg-foreground/10" />
              <div className="p-3 space-y-2">
                <div className="h-3 w-20 rounded bg-foreground/10" />
                <div className="h-4 w-4/5 rounded bg-foreground/10" />
                <div className="h-3 w-full rounded bg-foreground/10" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="relative">
          <div
            className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-none pl-5 md:pl-10 lg:pl-16 pr-5 md:pr-10 lg:pr-16 pb-2"
            style={{ scrollbarWidth: "none" }}
          >
            {items!.map((it, idx) => {
              const s = styleFor(it.category);
              return (
                <motion.article
                  key={idx}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.04 }}
                  className={`snap-start shrink-0 w-[76%] sm:w-[46%] md:w-[32%] rounded-2xl border overflow-hidden group transition ${
                    isDark
                      ? "border-border/60 bg-card/40 hover:border-accent/40"
                      : "border-border/70 bg-card/70 hover:border-accent/50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openChat(`Me conte mais sobre isso em ${city ?? "aqui"}: ${it.title}`)}
                    className="block w-full text-left"
                  >
                    <div
                      className={`relative h-36 w-full overflow-hidden ${
                        isDark ? "bg-gradient-to-br from-foreground/10 to-foreground/5" : "bg-gradient-to-br from-foreground/8 to-foreground/3"
                      }`}
                    >
                      {it.imageUrl ? (
                        <img
                          src={it.imageUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="absolute inset-0 h-full w-full object-cover group-hover:scale-105 transition duration-500"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : null}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
                      <span className="absolute top-2 left-2 text-2xl leading-none drop-shadow">
                        {it.emoji ?? "✨"}
                      </span>
                      <Bookmark className="absolute top-2 right-2 size-3.5 text-white/70" />
                      <span
                        className={`absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] font-semibold ring-1 ${s.bg} ${s.text} ${s.ring} backdrop-blur-sm`}
                      >
                        {it.category}
                      </span>
                    </div>
                    <div className="p-3">
                      <p className="font-medium text-[13.5px] leading-snug text-foreground line-clamp-2 [text-wrap:pretty]">
                        {it.title}
                      </p>
                      {it.summary && (
                        <p className="mt-1.5 text-[12px] leading-snug text-foreground/65 line-clamp-2 [text-wrap:pretty]">
                          {it.summary}
                        </p>
                      )}
                      <div className="mt-2.5 flex items-center justify-between text-[10px]">
                        <span className="inline-flex items-center gap-1 text-accent/80 font-semibold">
                          perguntar à IA <ArrowUpRight className="size-3" />
                        </span>
                        {it.sourceName && (
                          <span className="text-foreground/40 truncate max-w-[110px]">{it.sourceName}</span>
                        )}
                      </div>
                    </div>
                  </button>
                  {it.sourceUrl && (
                    <a
                      href={it.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-t border-border/40 flex items-center justify-center gap-1.5 py-1.5 text-[10.5px] text-foreground/50 hover:text-accent transition"
                    >
                      abrir fonte <ExternalLink className="size-3" />
                    </a>
                  )}
                </motion.article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
