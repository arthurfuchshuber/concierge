/**
 * Etapa 3 (08/11/2026) — ferramentas de clima (Open-Meteo) e voos (AviationStack).
 * Mesmo padrão de Places/Routes: só consulta, prazo de 6 s, falha vira código fixo, nunca inventa;
 * mais cache curto, disjuntor, teto de chamadas por turno e voos indisponíveis sem o segredo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWeatherForecast, parseWeather, wmoText, weatherPath } from "../weather";
import { FLIGHT_CODE, getFlightStatus, parseFlights } from "../flights";
import { toolSpecsFor } from "../registry";
import { executeToolCalls } from "../executor";
import {
  BREAKER_FAILURES,
  createExternalHttp,
  EXTERNAL_CACHE_TTL_MS,
  externalToolAvailability,
} from "../external-http.server";
import { TOOL_MAX_CALLS_PER_TURN, type ExternalHttp, type GuestToolContext } from "../contracts";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";

const CTX: GuestToolContext = {
  origin: { lat: -25.5163, lng: -54.5854 },
  city: "Foz do Iguaçu",
  region: "PR",
  country: "Brasil",
  surface: "whatsapp",
};
const signal = new AbortController().signal;
const METEO = {
  timezone: "America/Sao_Paulo",
  current: { temperature_2m: 27.4, apparent_temperature: 29.1, weather_code: 2, wind_speed_10m: 9.6 },
  daily: {
    time: ["2026-11-08", "2026-11-09"],
    weather_code: [61, 0],
    temperature_2m_max: [31.2, 30],
    temperature_2m_min: [20.4, 19.6],
    precipitation_probability_max: [80, 5],
  },
};
const FLIGHT = {
  data: [
    {
      flight_date: "2026-11-08",
      flight_status: "active",
      airline: { name: "LATAM Airlines" },
      flight: { iata: "LA3456" },
      departure: { iata: "GRU", airport: "Guarulhos", scheduled: "2026-11-08T14:00:00+00:00", estimated: "2026-11-08T14:20:00+00:00", delay: 20, terminal: "2", gate: "B12" },
      arrival: { iata: "IGU", airport: "Cataratas", scheduled: "2026-11-08T15:45:00+00:00", estimated: "2026-11-08T16:05:00+00:00" },
    },
  ],
};
const ext = (body: unknown, ok = true): ExternalHttp => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));

describe("clima", () => {
  it("parse do Open-Meteo: agora + dias, condição em português, fuso do local", () => {
    const r = parseWeather(METEO, 2)!;
    expect(r).toMatchObject({
      fuso: "America/Sao_Paulo",
      agora: { temperatura_c: 27, sensacao_c: 29, condicao: "parcialmente nublado", vento_kmh: 10 },
    });
    expect(r["dias"]).toEqual([
      { data: "2026-11-08", min_c: 20, max_c: 31, chance_chuva_pct: 80, condicao: "chuva" },
      { data: "2026-11-09", min_c: 20, max_c: 30, chance_chuva_pct: 5, condicao: "céu limpo" },
    ]);
    expect(wmoText(95)).toBe("tempestade");
    expect(parseWeather({}, 2)).toBeNull();
  });

  it("local = coordenadas do imóvel (nunca do modelo); sem coordenadas ⇒ sem_origem", async () => {
    expect(getWeatherForecast.parse({ days: 3 })).toEqual({ days: 3 });
    expect(getWeatherForecast.parse({ days: 9 })).toBeNull();
    expect(getWeatherForecast.parse({ days: 2, latitude: 0 })).toEqual({ days: 2 }); // extra ignorado: local vem do cadastro
    const e = ext(METEO);
    const ok = await getWeatherForecast.execute({ days: 2 }, CTX, { http: vi.fn(), external: e, signal });
    expect(ok.ok).toBe(true);
    expect((e as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe(weatherPath(-25.5163, -54.5854, 2));
    expect(await getWeatherForecast.execute({ days: 2 }, { ...CTX, origin: null }, { http: vi.fn(), external: e, signal })).toEqual({ ok: false, erro: "sem_origem" });
  });

  it("falha do provedor ⇒ indisponivel; sem transporte ⇒ indisponivel", async () => {
    expect(await getWeatherForecast.execute({ days: 1 }, CTX, { http: vi.fn(), external: ext(null, false), signal })).toEqual({ ok: false, erro: "indisponivel" });
    expect(await getWeatherForecast.execute({ days: 1 }, CTX, { http: vi.fn(), signal })).toEqual({ ok: false, erro: "indisponivel" });
  });
});

describe("voos", () => {
  it("código IATA validado; data opcional no formato certo", () => {
    expect(getFlightStatus.parse({ flight_iata: "la 3456" })).toEqual({ flight: "LA3456", date: null });
    expect(getFlightStatus.parse({ flight_iata: "G31234", date: "2026-11-08" })).toEqual({ flight: "G31234", date: "2026-11-08" });
    expect(getFlightStatus.parse({ flight_iata: "voo da tarde" })).toBeNull();
    expect(getFlightStatus.parse({ flight_iata: "LA3456", date: "amanhã" })).toBeNull();
    expect(FLIGHT_CODE.test("AD4567")).toBe(true);
  });

  it("parse do AviationStack: situação em português, horários como o provedor informa, atraso", () => {
    const [v] = parseFlights(FLIGHT, null);
    expect(v).toMatchObject({
      situacao: "em voo",
      companhia: "LATAM Airlines",
      voo: "LA3456",
      partida: { aeroporto: "GRU", estimado: "2026-11-08T14:20:00+00:00", atraso_min: 20, portao: "B12" },
      chegada: { aeroporto: "IGU", estimado: "2026-11-08T16:05:00+00:00" },
    });
    expect(parseFlights(FLIGHT, "2026-11-09")).toEqual([]);
  });

  it("sem voo ⇒ sem_resultado; provedor fora ⇒ indisponivel", async () => {
    expect(await getFlightStatus.execute({ flight: "LA1", date: null }, CTX, { http: vi.fn(), external: ext({ data: [] }), signal })).toEqual({ ok: false, erro: "sem_resultado" });
    expect(await getFlightStatus.execute({ flight: "LA1", date: null }, CTX, { http: vi.fn(), external: ext(null, false), signal })).toEqual({ ok: false, erro: "indisponivel" });
  });
});

describe("oferta das ferramentas e segredo", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sem AVIATIONSTACK_API_KEY a ferramenta de voos nem é oferecida; clima precisa das coordenadas", () => {
    vi.stubEnv("AVIATIONSTACK_API_KEY", "");
    expect(externalToolAvailability()).toEqual({ weather: true, flights: false });
    expect(toolSpecsFor(CTX, externalToolAvailability()).map((t) => t.name)).toEqual([
      "search_city_places",
      "calculate_property_distance",
      "get_weather_forecast",
    ]);
    expect(toolSpecsFor({ ...CTX, origin: null }, { weather: true, flights: false }).map((t) => t.name)).toEqual(["search_city_places"]);
    vi.stubEnv("AVIATIONSTACK_API_KEY", "k");
    expect(toolSpecsFor(CTX, externalToolAvailability()).map((t) => t.name)).toContain("get_flight_status");
  });

  it("transporte sem segredo ⇒ lança (executor converte em indisponivel), sem ir à rede", async () => {
    vi.stubEnv("AVIATIONSTACK_API_KEY", "");
    const f = vi.fn();
    const http = createExternalHttp({ fetch: f as never });
    await expect(http("aviationstack", "/v1/flights?flight_iata=LA1", { signal })).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("transporte: chave fora do caminho devolvido, cache curto e disjuntor", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("a chave só vai na URL do pedido; o resultado nunca a contém", async () => {
    vi.stubEnv("AVIATIONSTACK_API_KEY", "SEGREDO123");
    const f = vi.fn(async () => new Response(JSON.stringify(FLIGHT), { status: 200 }));
    const http = createExternalHttp({ fetch: f as never });
    const r = await http("aviationstack", "/v1/flights?flight_iata=LA3456", { signal });
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("access_key=SEGREDO123");
    expect(JSON.stringify(await r.json())).not.toContain("SEGREDO123");
  });

  it("prazos de cache (10/11/2026): clima 60 min, voos 10 min", () => {
    expect(EXTERNAL_CACHE_TTL_MS).toEqual({ open_meteo: 60 * 60_000, aviationstack: 10 * 60_000 });
  });

  it("cache do clima: 59 min ainda no cache; depois de 60 min vai à rede de novo", async () => {
    let t = 0;
    const f = vi.fn(async () => new Response(JSON.stringify(METEO), { status: 200 }));
    const http = createExternalHttp({ fetch: f as never, now: () => t });
    await http("open_meteo", "/v1/forecast?x=1", { signal });
    t = 59 * 60_000;
    await http("open_meteo", "/v1/forecast?x=1", { signal });
    expect(f).toHaveBeenCalledTimes(1);
    t = 60 * 60_000 + 1;
    await http("open_meteo", "/v1/forecast?x=1", { signal });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("cache de voos: 9 min ainda no cache; depois de 10 min vai à rede de novo", async () => {
    vi.stubEnv("AVIATIONSTACK_API_KEY", "k");
    let t = 0;
    const f = vi.fn(async () => new Response(JSON.stringify(FLIGHT), { status: 200 }));
    const http = createExternalHttp({ fetch: f as never, now: () => t });
    await http("aviationstack", "/v1/flights?flight_iata=LA3456", { signal });
    t = 9 * 60_000;
    await http("aviationstack", "/v1/flights?flight_iata=LA3456", { signal });
    expect(f).toHaveBeenCalledTimes(1);
    t = 10 * 60_000 + 1;
    await http("aviationstack", "/v1/flights?flight_iata=LA3456", { signal });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("disjuntor: falhas seguidas abrem por 60 s (sem rede); depois tenta de novo", async () => {
    let t = 0;
    const f = vi.fn(async () => new Response("x", { status: 503 }));
    const http = createExternalHttp({ fetch: f as never, now: () => t });
    for (let i = 0; i < BREAKER_FAILURES; i++) await http("open_meteo", `/p${i}`, { signal });
    await expect(http("open_meteo", "/p9", { signal })).rejects.toThrow("breaker_open");
    expect(f).toHaveBeenCalledTimes(BREAKER_FAILURES);
    t = 61_000;
    await http("open_meteo", "/p10", { signal });
    expect(f).toHaveBeenCalledTimes(BREAKER_FAILURES + 1);
  });

  it("erro do AviationStack com status 200 ({ error }) é falha e não entra no cache", async () => {
    vi.stubEnv("AVIATIONSTACK_API_KEY", "k");
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { code: "usage_limit_reached" } }), { status: 200 }));
    const http = createExternalHttp({ fetch: f as never });
    expect((await http("aviationstack", "/v1/flights?flight_iata=LA1", { signal })).ok).toBe(false);
    await http("aviationstack", "/v1/flights?flight_iata=LA1", { signal });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("teto de custo por turno", () => {
  it(`no máximo ${TOOL_MAX_CALLS_PER_TURN} chamadas da mesma ferramenta; o excedente nem sai para a rede`, async () => {
    const e = ext(METEO);
    const calls = Array.from({ length: TOOL_MAX_CALLS_PER_TURN + 2 }, (_, i) => ({
      id: `c${i}`,
      name: "get_weather_forecast",
      arguments: JSON.stringify({ days: 1 }),
    }));
    const out = await executeToolCalls(calls, CTX, { http: vi.fn(), external: e, signal, remainingMs: () => 10_000 });
    expect(out.filter((o) => o.ok)).toHaveLength(TOOL_MAX_CALLS_PER_TURN);
    expect(out.filter((o) => o.error === "limite_atingido")).toHaveLength(2);
    expect(e).toHaveBeenCalledTimes(TOOL_MAX_CALLS_PER_TURN);
  });
});

describe("prompt: nunca afirmar voo ou tempo sem retorno da consulta", () => {
  it("regra presente", () => {
    const sys = buildSystemPrompt("whatsapp");
    expect(sys).toMatch(/Nunca afirme horário de voo nem previsão do tempo sem o retorno da consulta/);
  });
});
