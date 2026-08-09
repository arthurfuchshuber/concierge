import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  Utensils,
  Waves,
  Mountain,
  Landmark,
  Sparkles,
  MapPin,
  Wine,
  Music,
  TreePine,
  Bike,
  ShoppingBag,
  Camera,
  Building2,
  Sun,
} from "lucide-react";
import { getDailyTip, type DailyTip } from "@/lib/daily-tip.functions";
import { getLiveWeather, type LiveWeather } from "@/lib/live-weather.functions";

type Lang = "pt" | "en" | "es" | "fr";

function openChat(prompt?: string) {
  window.dispatchEvent(new CustomEvent("open-guide-chat", { detail: prompt ? { prompt } : {} }));
}

type ChipDef = { label: string; prompt: string; icon: ReactNode };

function normalizeCity(city: string | null): string {
  return (city || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Sugestões contextuais por cidade. Para cidades desconhecidas, cai em um
// conjunto genérico que evita menções a praia/mar quando não faz sentido.
function chipsForCity(city: string | null): ChipDef[] {
  const c = normalizeCity(city);

  if (c.includes("foz do iguacu") || c.includes("iguacu")) {
    return [
      { label: "Cataratas hoje", prompt: "Como visitar as Cataratas do Iguaçu hoje?", icon: <Mountain /> },
      { label: "Ir ao Paraguai", prompt: "Como atravesso para o Paraguai (Ciudad del Este)?", icon: <MapPin /> },
      { label: "Onde jantar?", prompt: "Melhor restaurante para jantar perto daqui?", icon: <Utensils /> },
    ];
  }
  if (c.includes("rio de janeiro") || c.includes("rio")) {
    return [
      { label: "Praias hoje", prompt: "Qual a melhor praia para hoje aqui no Rio?", icon: <Waves /> },
      { label: "Cristo Redentor", prompt: "Como chegar ao Cristo Redentor?", icon: <Mountain /> },
      { label: "Onde jantar?", prompt: "Melhor restaurante para jantar perto daqui?", icon: <Utensils /> },
    ];
  }
  if (c.includes("sao paulo") || c === "sp") {
    return [
      { label: "O que fazer hoje?", prompt: "O que fazer em São Paulo hoje?", icon: <CalendarDays /> },
      { label: "Melhor restaurante", prompt: "Melhor restaurante perto daqui?", icon: <Utensils /> },
      { label: "Vida noturna", prompt: "Onde curtir a noite em São Paulo?", icon: <Music /> },
    ];
  }
  if (c.includes("gramado") || c.includes("canela")) {
    return [
      { label: "Passeios hoje", prompt: "Melhores passeios em Gramado/Canela hoje?", icon: <TreePine /> },
      { label: "Fondue & vinho", prompt: "Onde comer fondue e tomar vinho na região?", icon: <Wine /> },
      { label: "Cascatas", prompt: "Como chego nas cascatas próximas?", icon: <Mountain /> },
    ];
  }
  if (c.includes("florianopolis") || c.includes("floripa")) {
    return [
      { label: "Praia hoje", prompt: "Qual a melhor praia em Floripa hoje?", icon: <Waves /> },
      { label: "Trilhas", prompt: "Trilhas legais para fazer aqui?", icon: <Mountain /> },
      { label: "Onde jantar?", prompt: "Melhor restaurante perto daqui?", icon: <Utensils /> },
    ];
  }
  if (c.includes("salvador") || c.includes("bahia")) {
    return [
      { label: "Pelourinho", prompt: "Como visitar o Pelourinho hoje?", icon: <Landmark /> },
      { label: "Praia hoje", prompt: "Qual a melhor praia em Salvador hoje?", icon: <Waves /> },
      { label: "Comida típica", prompt: "Onde comer comida baiana autêntica?", icon: <Utensils /> },
    ];
  }
  if (c.includes("belo horizonte") || c === "bh") {
    return [
      { label: "Bares hoje", prompt: "Melhores bares em BH hoje?", icon: <Wine /> },
      { label: "Inhotim", prompt: "Como chegar a Inhotim daqui?", icon: <Camera /> },
      { label: "Comida mineira", prompt: "Onde comer comida mineira autêntica?", icon: <Utensils /> },
    ];
  }
  if (c.includes("curitiba")) {
    return [
      { label: "O que fazer?", prompt: "O que fazer em Curitiba hoje?", icon: <CalendarDays /> },
      { label: "Parques", prompt: "Melhores parques para visitar?", icon: <TreePine /> },
      { label: "Onde comer?", prompt: "Melhor restaurante perto daqui?", icon: <Utensils /> },
    ];
  }
  if (c.includes("brasilia")) {
    return [
      { label: "Monumentos", prompt: "Quais monumentos visitar em Brasília hoje?", icon: <Landmark /> },
      { label: "Onde comer?", prompt: "Melhor restaurante perto daqui?", icon: <Utensils /> },
      { label: "Passeios", prompt: "Passeios interessantes para hoje?", icon: <CalendarDays /> },
    ];
  }
  if (c.includes("bonito")) {
    return [
      { label: "Passeios hoje", prompt: "Melhores passeios em Bonito hoje?", icon: <Waves /> },
      { label: "Flutuação", prompt: "Como agendar flutuação nos rios?", icon: <Waves /> },
      { label: "Onde comer?", prompt: "Melhor restaurante perto daqui?", icon: <Utensils /> },
    ];
  }
  // Genérico — evita "praia" para cidades sem praia
  return [
    { label: "O que fazer hoje?", prompt: "O que fazer hoje aqui?", icon: <CalendarDays /> },
    { label: "Onde jantar?", prompt: "Melhor restaurante perto daqui?", icon: <Utensils /> },
    { label: "Passeios", prompt: "Melhores passeios/pontos turísticos perto daqui?", icon: <Camera /> },
  ];
}

export function HomeIntelligence({
  propertyId,
  city,
  lang,
  theme,
  checkinDate,
}: {
  propertyId: string;
  city: string | null;
  country: string | null;
  lang: Lang;
  guestName: string | null;
  theme: "dark" | "light";
  checkinDate?: string | null;
}) {
  const dailyFn = useServerFn(getDailyTip);
  const liveWeatherFn = useServerFn(getLiveWeather);
  const [tip, setTip] = useState<DailyTip | null>(null);
  const [live, setLive] = useState<LiveWeather>(null);
  const [loading, setLoading] = useState(true);
  const chips = useMemo<ChipDef[]>(() => chipsForCity(city), [city]);

  // Dica do dia (IA, cacheada por dia).
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

  // Clima ao vivo + previsão 3 dias — polling a cada 5 min.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      liveWeatherFn({ data: { propertyId, fromDate: checkinDate ?? undefined } })
        .then((w) => alive && w && setLive(w))
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [propertyId, checkinDate, liveWeatherFn]);

  const hasTip = !!tip;
  if (!loading && !hasTip) return null;
  const isDark = theme === "dark";

  const weather = live ?? tip?.weather ?? null;
  const forecast = live?.forecast ?? [];

  const dayLabel = (iso: string, index: number): string => {
    if (index === 0) return "Hoje";
    try {
      const d = new Date(`${iso}T12:00:00`);
      return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase();
    } catch {
      return "—";
    }
  };

  return (
    <section className="px-4 md:px-10 lg:px-16 mt-3 md:mt-5 relative z-10">
      {weather && (
        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-3">
          <div
            className={`flex min-h-[76px] items-center gap-3 rounded-[20px] border px-4 py-3 ${
              isDark
                ? "border-white/8 bg-white/[0.035] shadow-[0_16px_40px_-28px_rgba(0,0,0,0.85)]"
                : "border-slate-900/[0.06] bg-white/55 shadow-[0_14px_35px_-28px_rgba(31,24,74,0.28)]"
            }`}
          >
            <span className="text-[34px] leading-none drop-shadow-[0_6px_16px_rgba(251,191,36,0.25)]">
              {weather.icon}
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <p className={`text-[16px] font-black leading-none tabular-nums ${isDark ? "text-white" : "text-slate-950"}`}>
                  {weather.tempC}°C
                </p>
                {live && (
                  <span className="relative flex size-1.5 shrink-0 translate-y-[-1px]">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-75" />
                    <span className="relative inline-flex rounded-full size-1.5 bg-amber-300" />
                  </span>
                )}
              </div>
              <p className={`mt-1 text-[11px] leading-snug truncate ${isDark ? "text-white/62" : "text-slate-700/80"}`}>
                {weather.label || "Clima local"}
              </p>
            </div>
          </div>
          <div
            className={`flex min-h-[76px] items-stretch rounded-[20px] border px-2 py-2 ${
              isDark
                ? "border-white/8 bg-white/[0.035] shadow-[0_16px_40px_-28px_rgba(0,0,0,0.85)]"
                : "border-slate-900/[0.06] bg-white/55 shadow-[0_14px_35px_-28px_rgba(31,24,74,0.28)]"
            }`}
          >
            {forecast.length > 0 ? (
              forecast.slice(0, 3).map((d, i) => (
                <div
                  key={d.date}
                  className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 ${
                    i < 2 ? (isDark ? "border-r border-white/6" : "border-r border-slate-900/[0.06]") : ""
                  }`}
                >
                  <span className={`text-[9px] font-black uppercase tracking-[0.14em] ${isDark ? "text-white/55" : "text-slate-600/85"}`}>
                    {dayLabel(d.date, i)}
                  </span>
                  <span className="text-[20px] leading-none">{d.icon}</span>
                  <span className={`text-[10.5px] font-bold tabular-nums leading-none ${isDark ? "text-white/92" : "text-slate-950"}`}>
                    {d.tempMax}° <span className={isDark ? "text-white/45" : "text-slate-500"}>{d.tempMin}°</span>
                  </span>
                </div>
              ))
            ) : (
              <div className={`flex-1 grid place-items-center text-[11px] ${isDark ? "text-white/50" : "text-slate-600"}`}>
                Previsão indisponível
              </div>
            )}
          </div>
        </div>
      )}
      <motion.article
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className={`relative overflow-hidden rounded-[24px] border px-4 py-4 md:px-5 md:py-5 ${
          isDark
            ? "border-fuchsia-400/20 bg-[linear-gradient(135deg,#160b23_0%,#241035_52%,#2f1440_100%)] shadow-[0_22px_60px_-30px_rgba(217,70,239,0.45)]"
            : "border-fuchsia-200/70 bg-[linear-gradient(135deg,#7c3aed_0%,#c026d3_50%,#ec4899_100%)] shadow-[0_22px_60px_-24px_rgba(217,70,239,0.42)]"
        }`}
      >
        {/* Ambient glows inside the panel */}
        {isDark ? (
          <>
            <span className="pointer-events-none absolute -top-20 -right-16 h-40 w-40 rounded-full bg-pink-500/18 blur-3xl" />
            <span className="pointer-events-none absolute -bottom-24 -left-20 h-48 w-48 rounded-full bg-violet-500/14 blur-3xl" />
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
                {/* AI sparkle avatar */}
                <div
                    className="grid size-12 shrink-0 place-items-center rounded-full border border-white/25 bg-gradient-to-br from-fuchsia-500/90 via-violet-500/90 to-pink-500/90 shadow-[0_12px_30px_-14px_rgba(217,70,239,0.55)]"
                >
                  <Sparkles className="size-6 text-white" strokeWidth={2.2} aria-hidden="true" />
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
                onClick={() =>
                  openChat(
                    tip.title
                      ? `Sobre a dica de hoje — "${tip.title}"${tip.body ? `: ${tip.body}` : ""}\n\nO que exatamente você sugere para eu aproveitar isso agora? Pode indicar lugares reais e como chegar. `
                      : "",
                  )
                }
                aria-label="Perguntar ao Concierge IA"
                className="grid size-12 shrink-0 place-items-center rounded-full bg-pink-500/90 text-white shadow-[0_12px_32px_-10px_rgba(236,72,153,0.9)] transition hover:bg-pink-400 active:scale-95"
              >
                <ArrowRight className="size-5" strokeWidth={2.2} />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2.5">
              {chips.map((c) => (
                <Chip key={c.label} icon={c.icon} label={c.label} onClick={() => openChat(c.prompt)} />
              ))}
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

