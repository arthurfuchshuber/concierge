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

const CATEGORY_STYLES: Record<
  string,
  { cover: string; icon: string; chipBg: string; chipText: string }
> = {
  natureza: { cover: "bg-[#1E2E3F]", icon: "text-[#8CB4DC]", chipBg: "bg-[#8CB4DC]/15", chipText: "text-[#8CB4DC]" },
  gastronomia: { cover: "bg-[#3A2A20]", icon: "text-[#DC966E]", chipBg: "bg-[#DC966E]/15", chipText: "text-[#DC966E]" },
  evento: { cover: "bg-[#3A1F35]", icon: "text-[#E0A8CE]", chipBg: "bg-[#E0A8CE]/15", chipText: "text-[#E0A8CE]" },
  passeio: { cover: "bg-[#1F3540]", icon: "text-[#7EC8D8]", chipBg: "bg-[#7EC8D8]/15", chipText: "text-[#7EC8D8]" },
  cultura: { cover: "bg-[#3A2E1A]", icon: "text-[#C9A876]", chipBg: "bg-[#C9A876]/15", chipText: "text-[#C9A876]" },
  noite: { cover: "bg-[#221F3E]", icon: "text-[#9B92E8]", chipBg: "bg-[#9B92E8]/15", chipText: "text-[#9B92E8]" },
  mercado: { cover: "bg-[#3A1F28]", icon: "text-[#E8A0B0]", chipBg: "bg-[#E8A0B0]/15", chipText: "text-[#E8A0B0]" },
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
              const isFeatured = idx === 0;

              if (!isFeatured) {
                // Compact horizontal row card
                return (
                  <motion.article
                    key={idx}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: idx * 0.04 }}
                    className={`snap-start shrink-0 w-[76%] sm:w-[46%] md:w-[32%] rounded-[12px] border overflow-hidden group transition flex ${
                      isDark
                        ? "border-[#292019] bg-[#1C1712]"
                        : "border-border bg-card"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openChat(`Me conte mais sobre isso em ${city ?? "aqui"}: ${it.title}`)}
                      className="flex w-full text-left"
                    >
                      <div className={`${s.cover} w-16 shrink-0 grid place-items-center relative`}>
                        {it.imageUrl ? (
                          <img
                            src={it.imageUrl}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="absolute inset-0 h-full w-full object-cover opacity-60"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : null}
                        <span className={`relative text-[22px] leading-none ${s.icon}`}>
                          {it.emoji ?? "✨"}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col justify-center">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-[12px] font-medium leading-tight line-clamp-2 ${
                              isDark ? "text-white" : "text-foreground"
                            }`}
                          >
                            {it.title}
                          </p>
                          <ArrowUpRight
                            className={`size-3 shrink-0 ${isDark ? "text-[#8A8378]" : "text-foreground/50"}`}
                          />
                        </div>
                        <span
                          className={`mt-1 text-[9px] uppercase tracking-[0.18em] font-medium ${isDark ? "text-[#8A8378]" : "text-foreground/50"}`}
                        >
                          {it.category}
                        </span>
                      </div>
                    </button>
                  </motion.article>
                );
              }

              // Featured card (idx === 0)
              return (
                <motion.article
                  key={idx}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.04 }}
                  className={`snap-start shrink-0 w-[80%] sm:w-[46%] md:w-[32%] rounded-[12px] border overflow-hidden group transition ${
                    isDark
                      ? "border-[#3A2F1E] bg-[#1C1712]"
                      : "border-border bg-card"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openChat(`Me conte mais sobre isso em ${city ?? "aqui"}: ${it.title}`)}
                    className="block w-full text-left"
                  >
                    <div className={`${s.cover} relative h-[80px] w-full overflow-hidden grid place-items-center`}>
                      {it.imageUrl ? (
                        <img
                          src={it.imageUrl}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="absolute inset-0 h-full w-full object-cover opacity-50 group-hover:opacity-60 transition"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : null}
                      <span className={`relative text-[30px] leading-none ${s.icon}`}>
                        {it.emoji ?? "✨"}
                      </span>
                      <Bookmark
                        className={`absolute top-2 right-2 size-3.5 ${isDark ? "text-[#D8CFC0]" : "text-white/80"}`}
                        strokeWidth={1.8}
                      />
                    </div>
                    <div className="px-3 py-2.5">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] font-semibold ${s.chipBg} ${s.chipText}`}
                      >
                        {it.category}
                      </span>
                      <p
                        className={`mt-1.5 font-medium text-[13px] leading-snug line-clamp-2 [text-wrap:pretty] ${
                          isDark ? "text-white" : "text-foreground"
                        }`}
                      >
                        {it.title}
                      </p>
                      {it.summary && (
                        <p
                          className={`mt-1 text-[11px] leading-[1.5] line-clamp-2 [text-wrap:pretty] ${
                            isDark ? "text-[#B8AF9E]" : "text-foreground/65"
                          }`}
                        >
                          {it.summary}
                        </p>
                      )}
                    </div>
                  </button>
                  {it.sourceUrl && (
                    <a
                      href={it.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-1.5 py-1.5 text-[10px] transition border-t ${
                        isDark
                          ? "border-[#292019] text-[#8A8378] hover:text-[#C9A876]"
                          : "border-border text-foreground/50 hover:text-accent"
                      }`}
                    >
                      abrir fonte <ExternalLink className="size-2.5" />
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
