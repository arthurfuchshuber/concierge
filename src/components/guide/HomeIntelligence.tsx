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
    <section className="px-4 md:px-10 lg:px-16 mt-4 md:mt-6 relative z-10">
      <motion.article
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className={`relative overflow-hidden rounded-[14px] border px-4 py-3.5 md:px-5 md:py-4 ${
          isDark
            ? "border-[#332C22] bg-[#1C1712]"
            : "border-border bg-card"
        }`}
      >
        {loading && !tip ? (
          <div className="animate-pulse space-y-2.5">
            <div className="h-3 w-32 rounded bg-foreground/10" />
            <div className="h-4 w-3/4 rounded bg-foreground/10" />
            <div className="h-3 w-full rounded bg-foreground/10" />
            <div className="h-3 w-5/6 rounded bg-foreground/10" />
          </div>
        ) : tip ? (
          <>
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className={`inline-flex items-center gap-1.5 text-[11px] ${isDark ? "text-[#D8CFC0]" : "text-foreground/75"}`}>
                {tip.weather ? (
                  <>
                    <span className="text-[13px] leading-none">{tip.weather.icon}</span>
                    <span className="font-medium">
                      {tip.weather.tempC}°C · {tip.weather.label}
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3 text-[#C9A876]" />
                    <span className="font-medium">Dica do dia</span>
                  </>
                )}
              </div>
              <div className={`inline-flex items-center gap-1.5 text-[10px] ${isDark ? "text-[#8A8378]" : "text-foreground/55"}`}>
                <span className="relative flex size-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#8FCB7A] opacity-70" />
                  <span className="relative inline-flex rounded-full size-1.5 bg-[#8FCB7A]" />
                </span>
                IA ativa agora
              </div>
            </div>
            {guestName && (
              <p className={`text-[11px] font-medium mb-1 ${isDark ? "text-[#B8AF9E]" : "text-foreground/65"}`}>
                {tip.greeting} {guestName.split(" ")[0]}!
              </p>
            )}
            <h3
              className={`font-serif font-medium text-[17px] md:text-[19px] leading-[1.25] tracking-[-0.005em] [text-wrap:balance] ${
                isDark ? "text-white" : "text-foreground"
              }`}
            >
              {tip.title}
            </h3>
            {tip.body && (
              <p className={`mt-1.5 text-[12px] leading-[1.55] [text-wrap:pretty] ${isDark ? "text-[#B8AF9E]" : "text-foreground/75"}`}>
                {tip.body}
              </p>
            )}
            <button
              type="button"
              onClick={() => openChat(`Sobre a dica de hoje: ${tip.title}. `)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border-[0.5px] border-[#C9A876] text-[#C9A876] px-3 py-1.5 text-[11px] font-medium hover:bg-[#C9A876]/10 transition"
            >
              Perguntar mais ao ConciergeIA <ArrowRight className="size-3" />
            </button>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Chip label="O que fazer hoje?" onClick={() => openChat("O que fazer hoje aqui?")} />
              <Chip
                label="Melhor restaurante"
                onClick={() => openChat("Qual o melhor restaurante perto daqui?")}
              />
              <Chip
                label="Como chego na praia"
                onClick={() => openChat("Como chego na praia mais próxima?")}
              />
            </div>
          </>
        ) : null}
      </motion.article>
    </section>
  );
}

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10.5px] font-medium px-2.5 py-1 rounded-full border-[0.5px] border-[#C9A876] text-[#C9A876] hover:bg-[#C9A876]/10 transition"
    >
      {label}
    </button>
  );
}
