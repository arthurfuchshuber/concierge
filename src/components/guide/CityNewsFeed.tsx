import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { getCityNews, type NewsItem } from "@/lib/city-news.functions";
import { cityKey } from "@/lib/city-key";

type Lang = "pt" | "en" | "es" | "fr";

function openChat(prompt: string) {
  window.dispatchEvent(new CustomEvent("open-guide-chat", { detail: { prompt } }));
}

// Category color system — vibrant editorial pills over the image
const CATEGORY_STYLES: Record<
  string,
  { cover: string; pill: string; glow: string }
> = {
  natureza:    { cover: "bg-gradient-to-br from-emerald-900 via-emerald-950 to-teal-950",   pill: "bg-emerald-500 text-emerald-950",   glow: "shadow-emerald-500/30" },
  gastronomia: { cover: "bg-gradient-to-br from-orange-900 via-amber-950 to-rose-950",       pill: "bg-orange-400 text-orange-950",     glow: "shadow-orange-500/30" },
  evento:      { cover: "bg-gradient-to-br from-fuchsia-900 via-purple-950 to-indigo-950",   pill: "bg-fuchsia-400 text-fuchsia-950",   glow: "shadow-fuchsia-500/30" },
  passeio:     { cover: "bg-gradient-to-br from-cyan-900 via-sky-950 to-blue-950",           pill: "bg-cyan-300 text-cyan-950",         glow: "shadow-cyan-500/30" },
  cultura:     { cover: "bg-gradient-to-br from-amber-800 via-amber-950 to-stone-950",       pill: "bg-amber-300 text-amber-950",       glow: "shadow-amber-500/30" },
  noite:       { cover: "bg-gradient-to-br from-indigo-900 via-violet-950 to-slate-950",     pill: "bg-violet-300 text-violet-950",     glow: "shadow-violet-500/30" },
  mercado:     { cover: "bg-gradient-to-br from-rose-900 via-pink-950 to-rose-950",          pill: "bg-rose-300 text-rose-950",         glow: "shadow-rose-500/30" },
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
    <section className="mt-8 md:mt-10 relative z-10">
      {/* Section title — one line, elegant, adapts to both themes */}
      <div className="px-5 md:px-10 lg:px-16 flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <span className="relative flex size-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex rounded-full size-1.5 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
          </span>
          <h2
            className={`whitespace-nowrap text-[9.5px] md:text-[11px] uppercase tracking-[0.2em] md:tracking-[0.22em] font-bold ${
              isDark ? "text-white/85" : "text-foreground/80"
            }`}
          >
            {city ? `O que rola em ${city}` : "O que rola hoje"}
          </h2>
        </div>
        <span className={`h-px flex-1 bg-gradient-to-r ${isDark ? "from-white/15 via-white/5" : "from-foreground/15 via-foreground/5"} to-transparent`} />
        <span className={`shrink-0 text-[9px] uppercase tracking-[0.2em] font-semibold ${isDark ? "text-emerald-300/80" : "text-emerald-700/80"}`}>
          agora
        </span>
      </div>

      {loading && !hasItems ? (
        <div className="pl-5 md:pl-10 lg:pl-16 pr-5 md:pr-10 lg:pr-16 flex gap-4 overflow-x-hidden">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="shrink-0 w-[240px] aspect-[3/4] rounded-[28px] border border-white/5 bg-white/[0.03] animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-none pl-5 md:pl-10 lg:pl-16 pr-5 md:pr-10 lg:pr-16 pb-4"
          style={{ scrollbarWidth: "none" }}
        >
          {items!.map((it, idx) => {
            const s = styleFor(it.category);
            return (
              <motion.article
                key={idx}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: idx * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
                className={`snap-start shrink-0 w-[240px] aspect-[3/4] relative rounded-[28px] overflow-hidden border ${
                  isDark ? "border-white/10" : "border-border"
                } shadow-2xl ${s.glow}`}
              >
                <button
                  type="button"
                  onClick={() => openChat(`Me conte mais sobre isso em ${city ?? "aqui"}: ${it.title}`)}
                  className="block h-full w-full text-left group"
                >
                  {/* Cover — image or gradient fallback */}
                  <div className={`absolute inset-0 ${s.cover}`}>
                    {it.imageUrl && (
                      <img
                        src={it.imageUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 h-full w-full object-cover opacity-70 group-hover:opacity-85 group-hover:scale-105 transition-all duration-700 ease-out"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                  </div>

                  {/* Dark gradient overlay for readability */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

                  {/* Emoji watermark */}
                  {it.emoji && (
                    <span className="absolute top-6 right-5 text-[38px] leading-none drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] opacity-90 group-hover:scale-110 transition-transform duration-500">
                      {it.emoji}
                    </span>
                  )}

                  {/* Category pill */}
                  <div className="absolute top-5 left-5">
                    <span
                      className={`inline-block rounded-lg px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.15em] ${s.pill}`}
                    >
                      {it.category}
                    </span>
                  </div>

                  {/* Bottom content */}
                  <div className="absolute bottom-0 left-0 right-0 p-5">
                    <h3 className="text-white font-bold text-[17px] leading-[1.2] tracking-[-0.01em] [text-wrap:pretty] line-clamp-3 drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
                      {it.title}
                    </h3>
                    {it.summary && (
                      <p className="mt-2 text-[11px] leading-[1.45] text-white/70 line-clamp-2 [text-wrap:pretty]">
                        {it.summary}
                      </p>
                    )}
                    <div className="mt-3 inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-white/80">
                      Ver mais
                      <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2.2} />
                    </div>
                  </div>
                </button>
              </motion.article>
            );
          })}
        </div>
      )}
    </section>
  );
}
