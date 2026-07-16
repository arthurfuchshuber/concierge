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
    <section className="px-5 md:px-10 lg:px-16 mt-6 md:mt-8 relative z-10">
      <motion.article
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className={`relative overflow-hidden rounded-3xl border p-5 md:p-6 ${
          isDark
            ? "border-accent/25 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent"
            : "border-accent/30 bg-gradient-to-br from-accent/12 via-accent/6 to-transparent"
        }`}
      >
        <div className="absolute -top-8 -right-8 size-40 rounded-full bg-accent/15 blur-3xl pointer-events-none" />

        {loading && !tip ? (
          <div className="animate-pulse space-y-2.5">
            <div className="h-3 w-32 rounded bg-foreground/10" />
            <div className="h-5 w-3/4 rounded bg-foreground/10" />
            <div className="h-3 w-full rounded bg-foreground/10" />
            <div className="h-3 w-5/6 rounded bg-foreground/10" />
          </div>
        ) : tip ? (
          <>
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="inline-flex items-center gap-1.5 text-[11px] text-foreground/70">
                {tip.weather ? (
                  <>
                    <span className="text-base leading-none">{tip.weather.icon}</span>
                    <span className="font-medium">{tip.weather.tempC}°C · {tip.weather.label}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5 text-accent" />
                    <span className="font-medium">Dica do dia</span>
                  </>
                )}
              </div>
              <div className="inline-flex items-center gap-1.5 text-[10px] text-foreground/60">
                <span className="relative flex size-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70" />
                  <span className="relative inline-flex rounded-full size-1.5 bg-emerald-400" />
                </span>
                IA ativa agora
              </div>
            </div>
            {guestName && (
              <p className="text-[12.5px] text-foreground/65 font-medium">
                {tip.greeting} {guestName.split(" ")[0]}!
              </p>
            )}
            <h3 className="mt-1 font-serif text-[21px] md:text-[24px] leading-tight text-foreground [text-wrap:balance]">
              {tip.title}
            </h3>
            {tip.body && (
              <p className="mt-2 text-[13.5px] leading-relaxed text-foreground/85 [text-wrap:pretty]">{tip.body}</p>
            )}
            <button
              type="button"
              onClick={() => openChat(`Sobre a dica de hoje: ${tip.title}. `)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-accent/50 text-accent px-3.5 py-1.5 text-[11.5px] font-semibold hover:bg-accent/10 transition"
            >
              Perguntar mais ao ConciergeIA <ArrowRight className="size-3.5" />
            </button>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip label="O que fazer hoje?" onClick={() => openChat("O que fazer hoje aqui?")} />
              <Chip label="Melhor restaurante" onClick={() => openChat("Qual o melhor restaurante perto daqui?")} />
              <Chip label="Como chego na praia" onClick={() => openChat("Como chego na praia mais próxima?")} />
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
      className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-accent/40 text-accent/90 hover:bg-accent/10 transition"
    >
      {label}
    </button>
  );
}
