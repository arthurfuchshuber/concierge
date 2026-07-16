import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { ArrowRight, CalendarDays, Utensils, Waves } from "lucide-react";
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
    <section className="px-4 md:px-10 lg:px-16 mt-3 md:mt-5 relative z-10">
      {tip?.weather && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div
            className={`flex min-h-[72px] items-center gap-3 rounded-[20px] border px-4 py-3 ${
              isDark
                ? "border-white/8 bg-white/[0.035] shadow-[0_16px_40px_-28px_rgba(0,0,0,0.85)]"
                : "border-slate-900/[0.06] bg-white/55 shadow-[0_14px_35px_-28px_rgba(31,24,74,0.28)]"
            }`}
          >
            <span className="text-[34px] leading-none drop-shadow-[0_6px_16px_rgba(251,191,36,0.25)]">
              {tip.weather.icon}
            </span>
            <div className="min-w-0">
              <p className={`text-[15px] font-black leading-none ${isDark ? "text-white" : "text-slate-950"}`}>
                {tip.weather.tempC}°C
              </p>
              <p className={`mt-1 text-[11px] leading-snug ${isDark ? "text-white/62" : "text-slate-700/80"}`}>
                {tip.weather.label || "Clima local"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openChat("Preciso de ajuda durante minha estadia.")}
            className={`flex min-h-[72px] items-start gap-3 rounded-[20px] border px-4 py-3 text-left transition active:scale-[0.99] ${
              isDark
                ? "border-white/8 bg-white/[0.035] shadow-[0_16px_40px_-28px_rgba(0,0,0,0.85)]"
                : "border-slate-900/[0.06] bg-white/55 shadow-[0_14px_35px_-28px_rgba(31,24,74,0.28)]"
            }`}
          >
            <span className="mt-1 size-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
            <span className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-[0.24em] text-emerald-400">
                IA ativa
              </span>
              <span className={`mt-1 block text-[11.5px] leading-snug ${isDark ? "text-white/68" : "text-slate-700/85"}`}>
                Seu concierge digital 24h com você
              </span>
            </span>
          </button>
        </div>
      )}
      <motion.article
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className={`relative overflow-hidden rounded-[24px] border px-4 py-4 md:px-5 md:py-5 ${
          isDark
            ? "border-fuchsia-400/25 bg-[linear-gradient(135deg,#6d28d9_0%,#bc1bd8_52%,#ec2f97_100%)] shadow-[0_22px_60px_-24px_rgba(217,70,239,0.72)]"
            : "border-fuchsia-200/70 bg-[linear-gradient(135deg,#7c3aed_0%,#c026d3_50%,#ec4899_100%)] shadow-[0_22px_60px_-24px_rgba(217,70,239,0.42)]"
        }`}
      >
        {/* Ambient glows inside the panel */}
        {isDark ? (
          <>
            <span className="pointer-events-none absolute -top-20 -right-16 h-40 w-40 rounded-full bg-pink-300/25 blur-3xl" />
            <span className="pointer-events-none absolute -bottom-24 -left-20 h-48 w-48 rounded-full bg-violet-200/20 blur-3xl" />
          </>
        ) : (
          <>
            <span className="pointer-events-none absolute -top-16 -right-14 h-36 w-36 rounded-full bg-pink-200/30 blur-3xl" />
            <span className="pointer-events-none absolute -bottom-20 -left-16 h-40 w-40 rounded-full bg-violet-100/25 blur-3xl" />
          </>
        )}

        {loading && !tip ? (
          <div className="relative animate-pulse space-y-3">
            <div className="h-10 w-10 rounded-full bg-white/18" />
            <div className="h-4 w-2/3 rounded bg-white/16" />
            <div className="h-3 w-full rounded bg-white/14" />
            <div className="h-9 w-full rounded-2xl bg-white/14" />
          </div>
        ) : tip ? (
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* WhatsApp-ish glass avatar */}
                <div
                    className="grid size-12 shrink-0 place-items-center rounded-full border border-white/35 bg-white shadow-[0_12px_30px_-14px_rgba(0,0,0,0.55)]"
                >
                  <svg viewBox="0 0 24 24" className="size-8 text-emerald-500" fill="currentColor" aria-hidden="true">
                    <path d="M20.52 3.48A11.86 11.86 0 0 0 12.05 0C5.5 0 .17 5.33.17 11.88c0 2.1.55 4.14 1.6 5.94L0 24l6.32-1.66a11.86 11.86 0 0 0 5.72 1.46h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.17-1.23-6.15-3.41-8.44Zm-8.47 18.27h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.75.99 1-3.66-.24-.38a9.87 9.87 0 0 1-1.51-5.23c0-5.45 4.44-9.88 9.9-9.88 2.64 0 5.13 1.03 6.99 2.9a9.83 9.83 0 0 1 2.9 6.99c0 5.45-4.44 9.86-9.89 9.86Zm5.42-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.66.15-.2.3-.76.97-.94 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48a9.02 9.02 0 0 1-1.66-2.06c-.17-.3-.02-.46.13-.6.13-.13.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.66-1.59-.9-2.18-.24-.57-.48-.5-.66-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.06 2.9 1.21 3.1.15.2 2.08 3.17 5.04 4.45.7.3 1.25.48 1.68.62.7.22 1.34.19 1.84.11.56-.08 1.76-.72 2-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] font-black leading-tight text-white">
                    Perguntar mais ao Concierge IA
                  </p>
                  <p className="mt-0.5 text-[11.5px] font-medium leading-snug text-white/82">
                    Respostas imediatas e personalizadas
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openChat(tip.title ? `Sobre a dica de hoje: ${tip.title}. ` : "")}
                aria-label="Perguntar ao Concierge IA"
                className="grid size-12 shrink-0 place-items-center rounded-full bg-pink-500/90 text-white shadow-[0_12px_32px_-10px_rgba(236,72,153,0.9)] transition hover:bg-pink-400 active:scale-95"
              >
                <ArrowRight className="size-5" strokeWidth={2.2} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <Chip icon={<CalendarDays />} label="O que fazer hoje?" onClick={() => openChat("O que fazer hoje aqui?")} />
              <Chip icon={<Utensils />} label="Melhor restaurante" onClick={() => openChat("Qual o melhor restaurante perto daqui?")} />
              <Chip icon={<Waves />} label="Como chego na praia?" onClick={() => openChat("Como chego na praia mais próxima?")} />
            </div>
          </div>
        ) : null}
      </motion.article>
    </section>
  );
}

function Chip({ label, onClick, icon }: { label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl border border-white/18 bg-white/9 px-2 py-2 text-center text-[10px] font-semibold leading-tight text-white/92 transition hover:bg-white/14 active:scale-95"
    >
      <span className="shrink-0 text-pink-100 [&>svg]:size-3.5">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

