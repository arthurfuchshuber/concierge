import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { getCityNews, type NewsItem } from "@/lib/city-news.functions";
import { cityKey } from "@/lib/city-key";
import recBeach from "@/assets/rec-beach.jpg";
import recRestaurant from "@/assets/rec-restaurant.jpg";
import recCafe from "@/assets/rec-cafe.jpg";

type Lang = "pt" | "en" | "es" | "fr";

function openChat(prompt: string) {
  window.dispatchEvent(new CustomEvent("open-guide-chat", { detail: { prompt, source: "city_news", forceAi: true } }));
}

// Category color system — editorial pills over the image
const CATEGORY_STYLES: Record<
  string,
  { cover: string; pill: string; glow: string }
> = {
  natureza:    { cover: "bg-gradient-to-br from-emerald-900 via-emerald-950 to-teal-950",   pill: "bg-emerald-600 text-white", glow: "shadow-emerald-500/18" },
  gastronomia: { cover: "bg-gradient-to-br from-orange-900 via-amber-950 to-rose-950",       pill: "bg-violet-600 text-white",  glow: "shadow-orange-500/18" },
  evento:      { cover: "bg-gradient-to-br from-fuchsia-900 via-purple-950 to-indigo-950",   pill: "bg-fuchsia-500 text-white", glow: "shadow-fuchsia-500/18" },
  passeio:     { cover: "bg-gradient-to-br from-cyan-900 via-sky-950 to-blue-950",           pill: "bg-cyan-600 text-white",    glow: "shadow-cyan-500/18" },
  cultura:     { cover: "bg-gradient-to-br from-amber-800 via-amber-950 to-stone-950",       pill: "bg-amber-500 text-white",   glow: "shadow-amber-500/18" },
  noite:       { cover: "bg-gradient-to-br from-indigo-900 via-violet-950 to-slate-950",     pill: "bg-violet-500 text-white",  glow: "shadow-violet-500/18" },
  mercado:     { cover: "bg-gradient-to-br from-rose-900 via-pink-950 to-rose-950",          pill: "bg-rose-500 text-white",    glow: "shadow-rose-500/18" },
};

function styleFor(cat: string) {
  return CATEGORY_STYLES[cat.toLowerCase()] ?? CATEGORY_STYLES.passeio;
}

function fallbackImage(cat: string, idx: number) {
  const key = cat.toLowerCase();
  if (/gastr|rest|noite|experi|mercado/.test(key)) return recRestaurant;
  if (/cafe|café|cultura|evento/.test(key)) return recCafe;
  return idx % 2 === 0 ? recBeach : recRestaurant;
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
    <section className="mt-5 md:mt-7 relative z-10">
      <div className="px-4 md:px-10 lg:px-16 flex items-center gap-3 mb-3.5">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <span className="relative flex size-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-500 opacity-70" />
            <span className="relative inline-flex rounded-full size-1.5 bg-pink-500 shadow-[0_0_6px_rgba(236,72,153,0.8)]" />
          </span>
          <h2
            className={`whitespace-nowrap text-[9.5px] md:text-[11px] uppercase tracking-[0.2em] md:tracking-[0.22em] font-bold ${
              isDark ? "text-white/85" : "text-foreground/80"
            }`}
          >
            {city ? `O que rola em ${city}` : "O que rola hoje"}
          </h2>
        </div>
        <span className={`h-px flex-1 bg-gradient-to-r ${isDark ? "from-white/12 via-white/5" : "from-slate-900/12 via-slate-900/5"} to-transparent`} />
        <span className={`shrink-0 text-[9px] uppercase tracking-[0.24em] font-bold ${isDark ? "text-fuchsia-300/90" : "text-fuchsia-600/85"}`}>
          RECENTE
        </span>
      </div>

      {loading && !hasItems ? (
        <div className="pl-4 md:pl-10 lg:pl-16 pr-4 md:pr-10 lg:pr-16 flex gap-3 overflow-x-hidden">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`shrink-0 w-[210px] h-[230px] rounded-[18px] border animate-pulse ${
                isDark ? "border-white/6 bg-white/[0.035]" : "border-slate-900/[0.05] bg-white/55"
              }`}
            />
          ))}
        </div>
      ) : (
        <div
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-none pl-4 md:pl-10 lg:pl-16 pr-4 md:pr-10 lg:pr-16 pb-3"
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
                className={`snap-start shrink-0 w-[210px] h-[260px] relative overflow-hidden rounded-[18px] border ${
                  isDark
                    ? "border-white/8 bg-[#070817] shadow-[0_20px_48px_-28px_rgba(0,0,0,0.9)]"
                    : "border-slate-900/[0.055] bg-white/70 shadow-[0_18px_45px_-32px_rgba(31,24,74,0.32)]"
                } ${s.glow}`}
              >
                <button
                  type="button"
                  onClick={() => openChat(
                    `Sobre "${it.title}" em ${city ?? "aqui"}${it.category ? ` (${it.category})` : ""}${it.summary ? `. Resumo: ${it.summary}` : ""}. Me conta mais sobre isso — o que é, por que vale a pena, o que dá pra fazer/ver/comer lá, quanto custa em média, melhor horário, como chegar e alguma dica de quem já foi. Solte curiosidades, seja natural, empolgado, como se estivesse me contando pessoalmente. Termine sugerindo próximos passos ou perguntando algo relevante.`,
                  )}

                  className="block h-full w-full text-left group"
                >
                  <div className={`absolute inset-x-0 top-0 h-[96px] overflow-hidden ${s.cover}`}>
                      <img
                        src={it.imageUrl || fallbackImage(it.category, idx)}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 h-full w-full object-cover opacity-82 group-hover:opacity-95 group-hover:scale-105 transition-all duration-700 ease-out"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                  </div>

                  <div className="absolute inset-x-0 top-0 h-[96px] bg-gradient-to-b from-black/8 via-transparent to-black/22" />

                  {it.emoji && (
                    <span className="absolute top-5 right-4 text-[25px] leading-none drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)] opacity-85 group-hover:scale-110 transition-transform duration-500">
                      {it.emoji}
                    </span>
                  )}

                  <div className="absolute top-4 left-4">
                    <span
                      className={`inline-block rounded-md px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] ${s.pill}`}
                    >
                      {it.category}
                    </span>
                  </div>

                  <div className="absolute inset-x-0 bottom-0 top-[96px] px-4 pt-3 pb-10">
                    <h3 className={`font-black text-[13.5px] leading-[1.18] [text-wrap:pretty] line-clamp-2 ${isDark ? "text-white" : "text-slate-950"}`}>
                      {it.title}
                    </h3>
                    {it.summary && (
                      <p className={`mt-1.5 text-[10.5px] leading-[1.38] line-clamp-3 [text-wrap:pretty] ${isDark ? "text-white/60" : "text-slate-700/78"}`}>
                        {it.summary}
                      </p>
                    )}
                  </div>
                  <div className={`absolute bottom-3 left-4 inline-flex items-center gap-1.5 text-[8.5px] font-black uppercase tracking-[0.2em] ${isDark ? "text-pink-300" : "text-pink-600"}`}>
                    Ver mais
                    <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2.2} />
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
