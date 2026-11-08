/**
 * Ferramenta `get_weather_forecast` — previsão do tempo REAL para o imóvel do hóspede (Etapa 3, 08/11/2026).
 *
 * - Local: SEMPRE as coordenadas do cadastro do imóvel do turno; o modelo nunca escolhe o lugar. Sem
 *   coordenadas ⇒ `sem_origem`.
 * - Fonte: Open-Meteo (público), fuso do próprio local (`timezone=auto`).
 * - Devolve agora (temperatura, sensação, condição, vento) e até 7 dias (mín/máx, chance de chuva,
 *   condição). Sem dado completo ⇒ `sem_resultado`. A IA nunca afirma tempo sem este retorno.
 */
import type { GuestTool, ToolResult } from "./contracts";

export const WEATHER_MAX_DAYS = 7;

/** Código WMO → condição em português (texto curto, sem inventar detalhe). */
const WMO: Array<[number[], string]> = [
  [[0], "céu limpo"],
  [[1], "predomínio de sol"],
  [[2], "parcialmente nublado"],
  [[3], "nublado"],
  [[45, 48], "nevoeiro"],
  [[51, 53, 55, 56, 57], "garoa"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "chuva"],
  [[71, 73, 75, 77, 85, 86], "neve"],
  [[95, 96, 99], "tempestade"],
];
export function wmoText(code: unknown): string | null {
  if (typeof code !== "number") return null;
  return WMO.find(([cs]) => cs.includes(code))?.[1] ?? null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v: number | null) => (v === null ? null : Math.round(v));

export interface WeatherArgs {
  days: number;
}

export function weatherPath(lat: number, lng: number, days: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: String(days),
  });
  return `/v1/forecast?${q.toString()}`;
}

/** Converte a resposta do Open-Meteo; `null` se faltar o essencial. */
export function parseWeather(body: unknown, days: number): Record<string, unknown> | null {
  const b = body as Record<string, any> | null;
  if (!b || typeof b !== "object") return null;
  const cur = b["current"] ?? {};
  const d = b["daily"] ?? {};
  const dates: unknown[] = Array.isArray(d["time"]) ? d["time"] : [];
  const agora = {
    temperatura_c: round(num(cur["temperature_2m"])),
    sensacao_c: round(num(cur["apparent_temperature"])),
    condicao: wmoText(cur["weather_code"]),
    vento_kmh: round(num(cur["wind_speed_10m"])),
  };
  const dias = dates.slice(0, days).flatMap((date, i) => {
    if (typeof date !== "string") return [];
    const min = round(num(d["temperature_2m_min"]?.[i]));
    const max = round(num(d["temperature_2m_max"]?.[i]));
    if (min === null || max === null) return [];
    return [
      {
        data: date,
        min_c: min,
        max_c: max,
        chance_chuva_pct: round(num(d["precipitation_probability_max"]?.[i])),
        condicao: wmoText(d["weather_code"]?.[i]),
      },
    ];
  });
  if (agora.temperatura_c === null && dias.length === 0) return null;
  return { fuso: typeof b["timezone"] === "string" ? b["timezone"] : null, agora, dias };
}

export const getWeatherForecast: GuestTool<WeatherArgs> = {
  spec: {
    name: "get_weather_forecast",
    description:
      "Previsão do tempo REAL (agora e próximos dias) no local do imóvel do hóspede. Use sempre antes de falar de clima, chuva ou temperatura; sem retorno desta consulta, não afirme previsão.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: WEATHER_MAX_DAYS, description: "Quantos dias de previsão (1 = hoje)." },
      },
      required: ["days"],
      additionalProperties: false,
    },
  },
  parse(raw) {
    const r = raw as Record<string, unknown> | null;
    const d = r && typeof r === "object" ? r["days"] : undefined;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > WEATHER_MAX_DAYS) return null;
    return { days: d };
  },
  async execute(args, ctx, deps): Promise<ToolResult> {
    if (!ctx.origin) return { ok: false, erro: "sem_origem" };
    if (!deps.external) return { ok: false, erro: "indisponivel" };
    const res = await deps.external("open_meteo", weatherPath(ctx.origin.lat, ctx.origin.lng, args.days), {
      signal: deps.signal,
    });
    if (!res.ok) return { ok: false, erro: "indisponivel" };
    const parsed = parseWeather(await res.json(), args.days);
    if (!parsed) return { ok: false, erro: "sem_resultado" };
    return { ok: true, fonte: "open-meteo", ...parsed };
  },
};
