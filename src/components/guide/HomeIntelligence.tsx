import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight } from "lucide-react";
import { getDailyTip, type DailyTip } from "@/lib/daily-tip.functions";

type Lang = "pt" | "en" | "es" | "fr";

function openChat(prompt?: string) {
  window.dispatchEvent(new CustomEvent("open-guide-chat", { detail: prompt ? { prompt } : {} }));
}

export function HomeIntelligence({
  propertyId,
  lang,
  guestName,
  theme,
}: {
  propertyId: string;
  city: string | null;
  country: string | null;
  lang: Lang;
  guestName: string | null;
  theme: "dark" | "light";
}) {
  const dailyFn = useServerFn(getDailyTip);
  const [tip, setTip] = useState<DailyTip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    dailyFn({ data: { propertyId, lang } })
      .then((r) => alive && setTip(r))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [propertyId, lang, dailyFn]);

  const hasTip = !!tip;
  if (!loading && !hasTip) return null;
  const isDark = theme === "dark";

  return (
    <section className="px-4 md:px-10 lg:px-16 mt-5 md:mt-7 relative z-10">
      <motion.article
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className={`relative overflow-hidden rounded-3xl border backdrop-blur-xl px-5 py-5 md:px-6 md:py-6 ${
          isDark
            ? "border-white/10 bg-white/[0.04]"
            : "border-border bg-card"
        }`}
      >
        {/* Ambient glows inside the panel */}
        {isDark && (
          <>
            <span className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-amber-400/15 blur-3xl" />
            <span className="pointer-events-none absolute -bottom-20 -left-16 h-40 w-40 rounded-full bg-purple-500/15 blur-3xl" />
          </>
        )}

        {loading && !tip ? (
          <div className="relative animate-pulse space-y-3">
            <div className="h-3 w-32 rounded bg-white/10" />
            <div className="h-5 w-3/4 rounded bg-white/10" />
            <div className="h-3 w-full rounded bg-white/10" />
            <div className="h-3 w-5/6 rounded bg-white/10" />
          </div>
        ) : tip ? (
          <div className="relative">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className={`inline-flex items-center gap-1.5 text-[11.5px] ${isDark ? "text-white/85" : "text-foreground/75"}`}>
                {tip.weather ? (
                  <>
                    <span className="text-[15px] leading-none drop-shadow-[0_0_6px_rgba(251,191,36,0.35)]">
                      {tip.weather.icon}
                    </span>
                    <span className="font-semibold">
                      {tip.weather.tempC}°C · {tip.weather.label}
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5 text-amber-400" />
                    <span className="font-semibold">Dica do dia</span>
                  </>
                )}
              </div>
              <div
                className={`inline-flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.16em] font-semibold px-2 py-0.5 rounded-full ${
                  isDark
                    ? "bg-emerald-500/10 border border-emerald-400/25 text-emerald-300"
                    : "bg-emerald-500/10 border border-emerald-500/25 text-emerald-700"
                }`}
              >
                <span className="relative flex size-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full size-1.5 bg-emerald-400" />
                </span>
                IA ativa
              </div>
            </div>

            {guestName && (
              <p className={`text-[11.5px] font-medium mb-1.5 ${isDark ? "text-white/60" : "text-foreground/65"}`}>
                {tip.greeting} {guestName.split(" ")[0]}!
              </p>
            )}

            <h3
              className={`font-serif text-[19px] md:text-[22px] leading-[1.2] tracking-[-0.01em] [text-wrap:balance] ${
                isDark
                  ? "bg-gradient-to-b from-white via-white to-white/70 bg-clip-text text-transparent"
                  : "text-foreground"
              }`}
            >
              {tip.title}
            </h3>

            {tip.body && (
              <p className={`mt-2 text-[12.5px] leading-[1.6] [text-wrap:pretty] ${isDark ? "text-white/65" : "text-foreground/75"}`}>
                {tip.body}
              </p>
            )}

            <button
              type="button"
              onClick={() => openChat(`Sobre a dica de hoje: ${tip.title}. `)}
              className={`group mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11.5px] font-semibold transition-all active:scale-[0.98] ${
                isDark
                  ? "bg-white text-black shadow-[0_8px_30px_-6px_rgba(255,255,255,0.35)] hover:shadow-[0_10px_36px_-6px_rgba(251,191,36,0.4)]"
                  : "bg-foreground text-background hover:opacity-90"
              }`}
            >
              Perguntar mais ao ConciergeIA
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2.2} />
            </button>

            <div className="mt-3 flex flex-wrap gap-2">
              <Chip label="O que fazer hoje?" onClick={() => openChat("O que fazer hoje aqui?")} isDark={isDark} />
              <Chip label="Melhor restaurante" onClick={() => openChat("Qual o melhor restaurante perto daqui?")} isDark={isDark} />
              <Chip label="Como chego na praia" onClick={() => openChat("Como chego na praia mais próxima?")} isDark={isDark} />
            </div>
          </div>
        ) : null}
      </motion.article>
    </section>
  );
}

function Chip({ label, onClick, isDark }: { label: string; onClick: () => void; isDark: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10.5px] font-medium px-3 py-1.5 rounded-full transition-all active:scale-95 ${
        isDark
          ? "bg-white/5 border border-white/10 text-white/85 hover:bg-white/10 hover:border-white/20"
          : "bg-foreground/5 border border-border text-foreground/80 hover:bg-foreground/10"
      }`}
    >
      {label}
    </button>
  );
}
