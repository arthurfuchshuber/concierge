import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  propertyId: z.string().uuid(),
  /* A DATA NÃO PODE DERRUBAR A PREVISÃO (11/09/2026).
   *
   * Era `.regex(/^\d{4}-\d{2}-\d{2}$/)`, e uma data fora desse formato fazia o
   * `parse` LANÇAR — ou seja, a chamada inteira falhava e o hóspede ficava com
   * "Previsão indisponível", quando o único problema era em qual dia começar a
   * contar. `fromDate` é uma preferência, não um requisito: agora o que não
   * casa é simplesmente ignorado, e a previsão começa hoje. */
  fromDate: z
    .string()
    .optional()
    .transform((v) => {
      const m = String(v ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : undefined;
    }),
});

export type ForecastDay = {
  date: string; // YYYY-MM-DD
  tempMin: number;
  tempMax: number;
  icon: string;
  label: string;
};

export type LiveWeather = {
  tempC: number;
  label: string;
  icon: string;
  observedAt: string;
  forecast: ForecastDay[]; // 3 dias (checkin + 2)
} | null;

const WEATHER_MAP: Record<number, { label: string; icon: string }> = {
  0: { label: "Céu limpo", icon: "☀️" },
  1: { label: "Sol", icon: "🌤️" },
  2: { label: "Parc. nublado", icon: "⛅" },
  3: { label: "Nublado", icon: "☁️" },
  45: { label: "Neblina", icon: "🌫️" },
  48: { label: "Neblina", icon: "🌫️" },
  51: { label: "Garoa", icon: "🌦️" },
  53: { label: "Garoa", icon: "🌦️" },
  55: { label: "Garoa", icon: "🌦️" },
  61: { label: "Chuva", icon: "🌧️" },
  63: { label: "Chuva forte", icon: "🌧️" },
  65: { label: "Chuva forte", icon: "⛈️" },
  71: { label: "Neve", icon: "🌨️" },
  73: { label: "Neve", icon: "🌨️" },
  75: { label: "Neve", icon: "🌨️" },
  80: { label: "Pancadas", icon: "🌦️" },
  81: { label: "Pancadas", icon: "🌦️" },
  82: { label: "Temporal", icon: "⛈️" },
  95: { label: "Tempestade", icon: "⛈️" },
  96: { label: "Tempestade", icon: "⛈️" },
  99: { label: "Tempestade", icon: "⛈️" },
};

export const getLiveWeather = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<LiveWeather> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("lat, lng, city, country")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (!prop) return null;

    let lat: number | null = prop.lat != null ? Number(prop.lat) : null;
    let lng: number | null = prop.lng != null ? Number(prop.lng) : null;

    // Fallback: geocode by city name via open-meteo geocoding when property has no coords.
    if ((lat == null || lng == null) && prop.city) {
      try {
        const q = encodeURIComponent(String(prop.city));
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=pt&format=json`;
        const gr = await fetch(geoUrl, { signal: AbortSignal.timeout(3000) });
        if (gr.ok) {
          const gj = (await gr.json()) as {
            results?: Array<{ latitude?: number; longitude?: number }>;
          };
          const first = gj.results?.[0];
          if (first && typeof first.latitude === "number" && typeof first.longitude === "number") {
            lat = first.latitude;
            lng = first.longitude;
          }
        }
      } catch {
        // ignore
      }
    }
    if (lat == null || lng == null) return null;

    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
        `&current=temperature_2m,weather_code` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
        `&forecast_days=10&timezone=auto`;
      /* 3,5s era o prazo herdado da chamada de `daily-tip`, que pede SÓ o
       * tempo de agora. Esta aqui pede também dez dias de previsão — resposta
       * bem maior, e o prazo curto a derrubava com frequência. Como a falha
       * caía num `.catch(() => {})` no componente, ninguém via nada além de
       * "Previsão indisponível". */
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const j = (await r.json()) as {
        current?: { time?: string; temperature_2m?: number; weather_code?: number };
        daily?: {
          time?: string[];
          weather_code?: number[];
          temperature_2m_max?: number[];
          temperature_2m_min?: number[];
        };
      };
      /* O tempo de AGORA falhar não pode levar a previsão junto: são dois
       * blocos independentes na mesma resposta, e a previsão dos próximos dias
       * é justamente a parte que o hóspede usa para decidir o passeio. */
      const c = j.current;
      const temAgora = !!c && typeof c.temperature_2m === "number";
      const m = WEATHER_MAP[c?.weather_code ?? 0] ?? { label: "Tempo estável", icon: "🌤️" };

      const daily = j.daily;
      const forecast: ForecastDay[] = [];
      if (
        daily?.time &&
        daily.weather_code &&
        daily.temperature_2m_max &&
        daily.temperature_2m_min
      ) {
        // Determina o índice de início — data do check-in se estiver no range, senão hoje.
        let startIdx = 0;
        if (data.fromDate) {
          const idx = daily.time.indexOf(data.fromDate);
          if (idx >= 0) startIdx = idx;
        }
        for (let i = startIdx; i < startIdx + 3 && i < daily.time.length; i++) {
          const wm = WEATHER_MAP[daily.weather_code[i] ?? 0] ?? { label: "—", icon: "🌤️" };
          forecast.push({
            date: daily.time[i],
            tempMin: Math.round(daily.temperature_2m_min[i]),
            tempMax: Math.round(daily.temperature_2m_max[i]),
            icon: wm.icon,
            label: wm.label,
          });
        }
      }

      if (!temAgora && forecast.length === 0) return null;

      return {
        // Sem o bloco "agora", o primeiro dia da previsão é a melhor
        // aproximação — e é melhor que um quadrante vazio.
        tempC: temAgora ? Math.round(c!.temperature_2m as number) : (forecast[0]?.tempMax ?? 0),
        label: temAgora ? m.label : (forecast[0]?.label ?? "Clima local"),
        icon: temAgora ? m.icon : (forecast[0]?.icon ?? "🌤️"),
        observedAt: c?.time ?? new Date().toISOString(),
        forecast,
      };
    } catch {
      return null;
    }
  });
