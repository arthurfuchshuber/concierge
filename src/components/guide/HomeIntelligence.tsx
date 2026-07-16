import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Sparkles, MessageCircleMore, ArrowUpRight, Radio } from "lucide-react";
import { getDailyTip, type DailyTip } from "@/lib/daily-tip.functions";
import { getCityPulse, type PulseItem } from "@/lib/city-pulse.functions";
import { cityKeyFromLabel } from "@/lib/city-key";

type Lang = "pt" | "en" | "es" | "fr";

function openChat(prompt?: string) {
  window.dispatchEvent(new CustomEvent("open-guide-chat", { detail: prompt ? { prompt } : {} }));
}

export function HomeIntelligence({
  propertyId,
  city,
  country,
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
  const pulseFn = useServerFn(getCityPulse);
  const [tip, setTip] = useState<DailyTip | null>(null);
  const [pulse, setPulse] = useState<PulseItem[] | null>(null);
  const [loadingTip, setLoadingTip] = useState(true);
  const [loadingPulse, setLoadingPulse] = useState(!!city);

  useEffect(() => {
    let alive = true;
    dailyFn({ data: { propertyId, lang } })
      .then((r) => alive && setTip(r))
      .catch(() => {})
      .finally(() => alive && setLoadingTip(false));
    return () => {
      alive = false;
    };
  }, [propertyId, lang, dailyFn]);

  useEffect(() => {
    if (!city) {
      setLoadingPulse(false);
      return;
    }
    let alive = true;
    const cityKey = cityKeyFromLabel(city);
    pulseFn({ data: { cityKey, cityLabel: city, country: country ?? undefined, lang } })
      .then((r) => alive && setPulse(r?.items ?? null))
      .catch(() => {})
      .finally(() => alive && setLoadingPulse(false));
    return () => {
      alive = false;
    };
  }, [city, country, lang, pulseFn]);

  const isDark = theme === "dark";
  const hasTip = !!tip;
  const hasPulse = pulse && pulse.length > 0;
  const showNothing = !loadingTip && !loadingPulse && !hasTip && !hasPulse;

  // Se não temos absolutamente nada útil, ainda mostramos a bolha do concierge —
  // ela é o coração do engajamento.
  return (
    <section className="px-5 md:px-10 lg:px-16 mt-6 md:mt-8 relative z-10 space-y-3 md:space-y-4">
      {/* Dica do dia */}
      {(loadingTip || hasTip) && (
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
          <div className="absolute -top-6 -right-6 size-32 rounded-full bg-accent/15 blur-2xl pointer-events-none" />
          {loadingTip && !tip ? (
            <div className="animate-pulse space-y-2.5">
              <div className="h-3 w-24 rounded bg-foreground/10" />
              <div className="h-5 w-3/4 rounded bg-foreground/10" />
              <div className="h-3 w-full rounded bg-foreground/10" />
              <div className="h-3 w-5/6 rounded bg-foreground/10" />
            </div>
          ) : tip ? (
            <>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-semibold text-accent/80">
                <Sparkles className="size-3.5" />
                {tip.weather ? (
                  <span>
                    {tip.weather.icon} {tip.weather.tempC}°C · {tip.weather.label}
                  </span>
                ) : (
                  <span>Dica do dia</span>
                )}
              </div>
              <p className="mt-2 text-[13px] text-foreground/70 font-medium">
                {tip.greeting}
                {guestName ? ` ${guestName.split(" ")[0]}!` : ""}
              </p>
              <h3 className="mt-1 font-serif text-[22px] md:text-[26px] leading-tight text-foreground [text-wrap:balance]">
                {tip.title}
              </h3>
              {tip.body && (
                <p className="mt-2 text-[14.5px] leading-relaxed text-foreground/85 [text-wrap:pretty]">{tip.body}</p>
              )}
              <button
                type="button"
                onClick={() => openChat(`Sobre a dica de hoje: ${tip.title}. `)}
                className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent hover:text-accent/80 transition"
              >
                Perguntar mais ao ConciergeIA <ArrowUpRight className="size-3.5" />
              </button>
            </>
          ) : null}
        </motion.article>
      )}

      {/* Bolha do concierge — sempre presente */}
      <motion.button
        type="button"
        onClick={() => openChat()}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.05 }}
        className={`group w-full text-left rounded-3xl border p-5 md:p-6 transition hover:border-accent/50 ${
          isDark ? "border-border/60 bg-card/40 hover:bg-card/60" : "border-border/70 bg-card/70 hover:bg-card"
        }`}
      >
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent">
            <MessageCircleMore className="size-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.3em] font-semibold text-accent/80">Concierge IA</p>
            <p className="mt-1 font-serif text-[19px] md:text-[21px] leading-tight text-foreground">
              Pergunte qualquer coisa sobre a estadia.
            </p>
            <p className="mt-1 text-[13px] text-foreground/70">
              Restaurantes, praias, Wi-Fi, delivery, transporte — respondo em segundos.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <ChatSuggest label="O que fazer hoje?" onClick={() => openChat("O que fazer hoje aqui?")} />
              <ChatSuggest label="Melhor restaurante perto" onClick={() => openChat("Qual o melhor restaurante perto daqui?")} />
              <ChatSuggest label="Como chego na praia" onClick={() => openChat("Como chego na praia mais próxima?")} />
            </div>
          </div>
        </div>
      </motion.button>

      {/* Pulso da cidade */}
      {(loadingPulse || hasPulse) && (
        <motion.article
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className={`rounded-3xl border p-5 md:p-6 ${
            isDark ? "border-border/60 bg-card/30" : "border-border/70 bg-card/60"
          }`}
        >
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] font-semibold text-accent/80">
            <Radio className="size-3.5" />
            {city ? `O que rola em ${city}` : "O que rola hoje"}
          </div>
          {loadingPulse && !pulse ? (
            <div className="mt-3 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="animate-pulse flex gap-3">
                  <div className="size-9 rounded-xl bg-foreground/10" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-2/3 rounded bg-foreground/10" />
                    <div className="h-3 w-full rounded bg-foreground/10" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border/40">
              {pulse?.map((it, idx) => (
                <li key={idx}>
                  <button
                    type="button"
                    onClick={() => openChat(`Me conte mais sobre: ${it.title}`)}
                    className="w-full text-left py-3 flex items-start gap-3 group/item hover:bg-foreground/[0.02] -mx-2 px-2 rounded-xl transition"
                  >
                    <span className="text-[22px] shrink-0 leading-none mt-0.5">{it.emoji ?? "✨"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-[14.5px] text-foreground leading-snug">{it.title}</p>
                        <span className="text-[9px] uppercase tracking-[0.25em] font-semibold text-accent/70">
                          {it.category}
                        </span>
                      </div>
                      {it.detail && (
                        <p className="mt-0.5 text-[13px] text-foreground/70 leading-snug [text-wrap:pretty]">{it.detail}</p>
                      )}
                    </div>
                    <ArrowUpRight className="size-4 text-foreground/40 group-hover/item:text-accent shrink-0 mt-1 transition" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </motion.article>
      )}

      {showNothing && null}
    </section>
  );
}

function ChatSuggest({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }
      }}
      className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1 rounded-full bg-accent/12 text-accent/90 hover:bg-accent/20 transition cursor-pointer"
    >
      {label}
    </span>
  );
}
