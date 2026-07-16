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
        className={`relative overflow-hidden rounded-3xl border px-5 py-5 md:px-6 md:py-6 ${
          isDark
            ? "border-white/10 bg-[linear-gradient(135deg,#1a0b2e_0%,#2d1b4e_45%,#4c1d95_100%)] shadow-[0_25px_70px_-25px_rgba(139,92,246,0.55)]"
            : "border-violet-200/60 bg-[linear-gradient(135deg,#f5f0ff_0%,#faf5ff_45%,#fdf2f8_100%)] shadow-[0_25px_70px_-25px_rgba(139,92,246,0.25)]"
        }`}
      >
        {/* Ambient glows inside the panel */}
        {isDark ? (
          <>
            <span className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-fuchsia-500/30 blur-3xl" />
            <span className="pointer-events-none absolute -bottom-24 -left-20 h-52 w-52 rounded-full bg-violet-500/25 blur-3xl" />
          </>
        ) : (
          <>
            <span className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-pink-300/30 blur-3xl" />
            <span className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full bg-violet-300/25 blur-3xl" />
          </>
        )}

        {loading && !tip ? (
          <div className="relative animate-pulse space-y-3">
            <div className={`h-3 w-32 rounded ${isDark ? "bg-white/10" : "bg-foreground/10"}`} />
            <div className={`h-5 w-3/4 rounded ${isDark ? "bg-white/10" : "bg-foreground/10"}`} />
            <div className={`h-3 w-full rounded ${isDark ? "bg-white/10" : "bg-foreground/10"}`} />
            <div className={`h-3 w-5/6 rounded ${isDark ? "bg-white/10" : "bg-foreground/10"}`} />
          </div>
        ) : tip ? (
          <div className="relative">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* WhatsApp-ish glass avatar */}
                <div
                  className={`grid size-11 shrink-0 place-items-center rounded-full border backdrop-blur-md ${
                    isDark
                      ? "border-white/20 bg-white/10"
                      : "border-violet-300/50 bg-white/70"
                  }`}
                >
                  <svg viewBox="0 0 24 24" className={`size-5 ${isDark ? "text-white" : "text-violet-700"}`} fill="currentColor" aria-hidden="true">
                    <path d="M20.52 3.48A11.86 11.86 0 0 0 12.05 0C5.5 0 .17 5.33.17 11.88c0 2.1.55 4.14 1.6 5.94L0 24l6.32-1.66a11.86 11.86 0 0 0 5.72 1.46h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.17-1.23-6.15-3.41-8.44Zm-8.47 18.27h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.75.99 1-3.66-.24-.38a9.87 9.87 0 0 1-1.51-5.23c0-5.45 4.44-9.88 9.9-9.88 2.64 0 5.13 1.03 6.99 2.9a9.83 9.83 0 0 1 2.9 6.99c0 5.45-4.44 9.86-9.89 9.86Zm5.42-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.66.15-.2.3-.76.97-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48a9.02 9.02 0 0 1-1.66-2.06c-.17-.3-.02-.46.13-.6.13-.13.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.66-1.59-.9-2.18-.24-.57-.48-.5-.66-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.06 2.9 1.21 3.1.15.2 2.08 3.17 5.04 4.45.7.3 1.25.48 1.68.62.7.22 1.34.19 1.84.11.56-.08 1.76-.72 2-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className={`text-[10.5px] uppercase tracking-[0.18em] font-bold ${isDark ? "text-white/70" : "text-violet-700/80"}`}>
                    ConciergeIA
                  </p>
                  {guestName && (
                    <p className={`text-[11px] font-medium mt-0.5 ${isDark ? "text-white/60" : "text-foreground/65"}`}>
                      {tip.greeting} {guestName.split(" ")[0]}!
                    </p>
                  )}
                </div>
              </div>
              {tip.weather && (
                <div className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold shrink-0 ${isDark ? "text-white/85" : "text-foreground/75"}`}>
                  <span className="text-[14px] leading-none">{tip.weather.icon}</span>
                  <span>{tip.weather.tempC}°C</span>
                </div>
              )}
            </div>

            <h3
              className={`font-serif text-[19px] md:text-[22px] leading-[1.2] tracking-[-0.01em] [text-wrap:balance] ${
                isDark ? "text-white" : "text-foreground"
              }`}
            >
              {tip.title}
            </h3>

            {tip.body && (
              <p className={`mt-2 text-[12.5px] leading-[1.6] [text-wrap:pretty] ${isDark ? "text-white/70" : "text-foreground/75"}`}>
                {tip.body}
              </p>
            )}

            <button
              type="button"
              onClick={() => openChat(`Sobre a dica de hoje: ${tip.title}. `)}
              className={`group mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11.5px] font-semibold transition-all active:scale-[0.98] ${
                isDark
                  ? "bg-white text-violet-900 shadow-[0_10px_30px_-8px_rgba(255,255,255,0.35)] hover:shadow-[0_12px_36px_-8px_rgba(236,72,153,0.5)]"
                  : "bg-violet-600 text-white hover:bg-violet-700"
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
          ? "bg-white/10 border border-white/15 text-white/90 hover:bg-white/15 hover:border-white/25"
          : "bg-white/80 border border-violet-200/70 text-violet-800 hover:bg-white"
      }`}
    >
      {label}
    </button>
  );
}

