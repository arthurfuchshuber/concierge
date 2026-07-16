import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({ propertyId: z.string().uuid() });

export type LiveWeather = {
  tempC: number;
  label: string;
  icon: string;
  observedAt: string; // ISO — quando o clima foi observado pela Open-Meteo
} | null;

const WEATHER_MAP: Record<number, { label: string; icon: string }> = {
  0: { label: "Céu limpo", icon: "☀️" },
  1: { label: "Predominantemente sol", icon: "🌤️" },
  2: { label: "Parcialmente nublado", icon: "⛅" },
  3: { label: "Nublado", icon: "☁️" },
  45: { label: "Neblina", icon: "🌫️" },
  48: { label: "Neblina", icon: "🌫️" },
  51: { label: "Garoa leve", icon: "🌦️" },
  53: { label: "Garoa", icon: "🌦️" },
  55: { label: "Garoa densa", icon: "🌦️" },
  61: { label: "Chuva", icon: "🌧️" },
  63: { label: "Chuva forte", icon: "🌧️" },
  65: { label: "Chuva intensa", icon: "⛈️" },
  71: { label: "Neve", icon: "🌨️" },
  73: { label: "Neve", icon: "🌨️" },
  75: { label: "Neve intensa", icon: "🌨️" },
  80: { label: "Pancadas de chuva", icon: "🌦️" },
  81: { label: "Pancadas fortes", icon: "🌦️" },
  82: { label: "Temporal de chuva", icon: "⛈️" },
  95: { label: "Tempestade", icon: "⛈️" },
  96: { label: "Tempestade com granizo", icon: "⛈️" },
  99: { label: "Tempestade severa", icon: "⛈️" },
};

// Server fn leve — SEM IA e SEM cache: pega direto da Open-Meteo (gratuito, sem chave)
// para permitir polling client-side em tempo real (a cada ~5 min).
export const getLiveWeather = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<LiveWeather> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("lat, lng")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (!prop || prop.lat == null || prop.lng == null) return null;

    try {
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${Number(prop.lat)}&longitude=${Number(prop.lng)}&current=temperature_2m,weather_code&timezone=auto`,
        { signal: AbortSignal.timeout(3500) },
      );
      if (!r.ok) return null;
      const j = (await r.json()) as {
        current?: { time?: string; temperature_2m?: number; weather_code?: number };
      };
      const c = j.current;
      if (!c || typeof c.temperature_2m !== "number") return null;
      const m = WEATHER_MAP[c.weather_code ?? 0] ?? { label: "Tempo estável", icon: "🌤️" };
      return {
        tempC: Math.round(c.temperature_2m),
        label: m.label,
        icon: m.icon,
        observedAt: c.time ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  });
