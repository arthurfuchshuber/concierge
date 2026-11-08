/**
 * Tool calling da IA Guest (07/11/2026) — ferramentas de consulta Google Places e rotas.
 * (a) schemas e validação; (b) sucesso com Places/rotas falsos; (c) falha/prazo sem números inventados;
 * (d) slot continua null e nada de credenciais/D9 passa pelas ferramentas.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateLlmRequest } from "@/lib/guest-ai/llm/gateway.server";
import {
  TOOL_RESULT_MAX_CHARS,
  TOOL_TIMEOUT_MS,
  type GuestToolContext,
} from "@/lib/guest-ai/tools/contracts";
import { GUEST_TOOLS, getGuestTool, toolSpecsFor } from "@/lib/guest-ai/tools/registry";
import { executeToolCalls, serializeToolResult } from "@/lib/guest-ai/tools/executor";
import {
  parsePlaces,
  placesRequestBody,
  searchCityPlaces,
} from "@/lib/guest-ai/tools/google-places";
import {
  anchoredDestination,
  calculatePropertyDistance,
  formatDistance,
  routesFromProperty,
} from "@/lib/guest-ai/tools/google-routes";
import { originFrom } from "@/lib/guest-ai/data/property-origin.server";
import { fakeMaps, PLACES_RESPONSE } from "./fake-maps";

const CTX: GuestToolContext = {
  origin: { lat: -25.5163, lng: -54.5854 },
  city: "Foz do Iguaçu",
  region: "PR",
  country: "Brasil",
  surface: "guide_chat",
};
const signal = () => new AbortController().signal;
const call = (name: string, args: unknown, id = "call_1") => ({
  id,
  name,
  arguments: typeof args === "string" ? args : JSON.stringify(args),
});
const noTime = (s: string) =>
  expect(s).not.toMatch(/minut|min\b|segund|seconds|duration|duracao|tempo|hora/i);

// ───────────── (a) schemas ─────────────

describe("(a) schemas das ferramentas", () => {
  it("registro tem exatamente as quatro ferramentas, com schema de objeto e nomes válidos", () => {
    expect([...GUEST_TOOLS.keys()].sort()).toEqual([
      "calculate_property_distance",
      "get_flight_status",
      "get_weather_forecast",
      "search_city_places",
    ]);
    for (const t of GUEST_TOOLS.values()) {
      expect(t.spec.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
      expect(t.spec.parameters["type"]).toBe("object");
      expect(t.spec.parameters["additionalProperties"]).toBe(false);
      expect(t.spec.description.length).toBeGreaterThan(20);
    }
    expect(searchCityPlaces.spec.parameters).toMatchObject({
      required: ["query"],
      properties: {
        category: { enum: ["gastronomia", "conveniencia", "saude", "lazer"] },
        open_now: { type: "boolean" },
      },
    });
    expect(calculatePropertyDistance.spec.parameters).toMatchObject({
      required: ["destination_address_or_coords"],
    });
  });

  it("o gateway aceita as declarações (mesmo contrato para qualquer ferramenta futura)", () => {
    const v = validateLlmRequest({
      purpose: "guest_reply",
      model: "openai/gpt-6-astra",
      messages: [{ role: "user", content: "onde comer pizza?" }],
      maxOutputTokens: 1_000,
      tools: toolSpecsFor(CTX),
      toolChoice: "auto",
    });
    expect(v?.provider.tools?.map((t) => t.name)).toEqual([
      "search_city_places",
      "calculate_property_distance",
    ]);
  });

  it("gateway recusa ferramenta malformada, resultado órfão e escolha sem ferramentas", () => {
    const base = {
      purpose: "guest_reply" as const,
      model: "openai/gpt-6-astra",
      maxOutputTokens: 1_000,
    };
    const user = { role: "user" as const, content: "oi" };
    expect(
      validateLlmRequest({
        ...base,
        messages: [user],
        tools: [{ name: "Bad-Name", description: "x", parameters: { type: "object" } }],
      }),
    ).toBeNull();
    expect(
      validateLlmRequest({
        ...base,
        messages: [user],
        tools: [{ name: "ok_tool", description: "d", parameters: { type: "string" } }],
      }),
    ).toBeNull();
    expect(validateLlmRequest({ ...base, messages: [user], toolChoice: "auto" })).toBeNull();
    // resultado de ferramenta sem a chamada correspondente
    expect(
      validateLlmRequest({
        ...base,
        tools: toolSpecsFor(CTX),
        messages: [user, { role: "tool", toolCallId: "call_x", content: "{}" }],
      }),
    ).toBeNull();
    // chamada + resultado coerentes
    expect(
      validateLlmRequest({
        ...base,
        tools: toolSpecsFor(CTX),
        toolChoice: "none",
        messages: [
          user,
          {
            role: "assistant",
            content: "",
            toolCalls: [call("search_city_places", { query: "pizza" })],
          },
          { role: "tool", toolCallId: "call_1", content: "{}" },
        ],
      }),
    ).not.toBeNull();
  });

  it("parse valida tudo o que vem do modelo", () => {
    expect(
      searchCityPlaces.parse({ query: "pizza", category: "gastronomia", open_now: true }),
    ).toEqual({ query: "pizza", category: "gastronomia", city: null, openNow: true });
    expect(searchCityPlaces.parse({ query: "p" })).toBeNull();
    expect(searchCityPlaces.parse({ query: "pizza", category: "boate" })).toBeNull();
    expect(searchCityPlaces.parse({ query: "pizza", open_now: "sim" })).toBeNull();
    expect(searchCityPlaces.parse(null)).toBeNull();
    expect(
      calculatePropertyDistance.parse({ destination_address_or_coords: "Cataratas do Iguaçu" }),
    ).toEqual({ destination: "Cataratas do Iguaçu" });
    expect(calculatePropertyDistance.parse({ destination_address_or_coords: "x" })).toBeNull();
    expect(calculatePropertyDistance.parse({})).toBeNull();
  });

  it("ferramentas oferecidas dependem da origem do imóvel", () => {
    expect(toolSpecsFor(null)).toEqual([]);
    expect(toolSpecsFor({ ...CTX, origin: null, city: null })).toEqual([]);
    expect(toolSpecsFor({ ...CTX, origin: null }).map((t) => t.name)).toEqual([
      "search_city_places",
    ]);
    expect(toolSpecsFor(CTX).map((t) => t.name)).toEqual([
      "search_city_places",
      "calculate_property_distance",
    ]);
  });

  it("coordenadas do cadastro: inválidas ou 0,0 ⇒ sem origem", () => {
    expect(originFrom(-25.5, -54.5)).toEqual({ lat: -25.5, lng: -54.5 });
    expect(originFrom("-25.5", "-54.5")).toEqual({ lat: -25.5, lng: -54.5 });
    expect(originFrom(0, 0)).toBeNull();
    expect(originFrom(null, -54)).toBeNull();
    expect(originFrom(95, 10)).toBeNull();
  });
});

// ───────────── (b) sucesso ─────────────

describe("(b) Places e rotas reais (transporte falso)", () => {
  it("busca: fechados fora, distância real de trajeto, do mais próximo para o mais distante, sem tempo", async () => {
    const { http, calls } = fakeMaps({
      places: PLACES_RESPONSE,
      walk: (d) => (d.startsWith("-25.516100") ? { meters: 420 } : { meters: 2_600 }),
      drive: () => ({ meters: 3_100 }),
    });
    const r = await searchCityPlaces.execute(searchCityPlaces.parse({ query: "pizzaria" })!, CTX, {
      http,
      signal: signal(),
    });
    expect(r.ok).toBe(true);
    const items = (r as unknown as { resultados: Array<Record<string, unknown>> }).resultados;
    expect(items.map((i) => i["nome"])).toEqual(["Pizzaria Perto", "Pizzaria Longe"]);
    expect(items[0]).toMatchObject({
      distancia_m: 420,
      distancia_texto: "420 m",
      modalidade: "a_pe",
      aberto_agora: false,
      nota_google: 4.8,
      total_avaliacoes_google: 230,
    });
    expect(items[1]).toMatchObject({
      distancia_m: 3_100,
      distancia_texto: "3,1 km",
      modalidade: "carro",
      link_google_maps: "https://maps.google.com/?cid=111",
    });
    // link de host não oficial descartado
    expect(items[0]).not.toHaveProperty("link_google_maps");
    noTime(JSON.stringify(r));
    // origem = coordenadas do imóvel; viés ao redor dele; cidade na busca
    const body = JSON.parse(calls[0]!.body!);
    expect(body.textQuery).toBe("pizzaria em Foz do Iguaçu, PR, Brasil");
    expect(body.locationBias.circle.center).toEqual({ latitude: -25.5163, longitude: -54.5854 });
    expect(calls[0]!.headers!["X-Goog-FieldMask"]).toMatch(/currentOpeningHours\.openNow/);
    expect(calls.some((c) => c.path.includes("origins=-25.516300%2C-54.585400"))).toBe(true);
  });

  it("Airbnb: nenhum link no resultado", async () => {
    const { http } = fakeMaps({ places: PLACES_RESPONSE, walk: () => ({ meters: 300 }) });
    const r = await searchCityPlaces.execute(
      searchCityPlaces.parse({ query: "pizzaria" })!,
      { ...CTX, surface: "airbnb" },
      { http, signal: signal() },
    );
    expect(JSON.stringify(r)).not.toMatch(/link_google_maps|https?:/);
  });

  it("open_now e cidade diferente: filtro enviado e sem viés no imóvel", () => {
    const b = placesRequestBody(
      { query: "parrilla", category: "gastronomia", city: "Puerto Iguazú", openNow: true },
      CTX,
    );
    expect(b).toMatchObject({ openNow: true, textQuery: "parrilla em Puerto Iguazú, PR, Brasil" });
    expect(b).not.toHaveProperty("locationBias");
  });

  it("rota: a pé até 1 km; acima, de carro; só distância e modalidade", async () => {
    const near = fakeMaps({ walk: () => ({ meters: 640, seconds: 480 }) });
    const r1 = await calculatePropertyDistance.execute({ destination: "Padaria Central" }, CTX, {
      http: near.http,
      signal: signal(),
    });
    expect(r1).toEqual({
      ok: true,
      destino: "Padaria Central",
      distancia_m: 640,
      distancia_texto: "640 m",
      modalidade: "a_pe",
    });
    expect(near.calls).toHaveLength(1);
    const far = fakeMaps({
      walk: () => ({ meters: 18_400 }),
      drive: () => ({ meters: 21_750, seconds: 1_500 }),
    });
    const r2 = await calculatePropertyDistance.execute(
      { destination: "Cataratas do Iguaçu" },
      CTX,
      { http: far.http, signal: signal() },
    );
    expect(r2).toEqual({
      ok: true,
      destino: "Cataratas do Iguaçu",
      distancia_m: 21_750,
      distancia_texto: "21,8 km",
      modalidade: "carro",
    });
    noTime(JSON.stringify([r1, r2]));
    // destino sem a cidade recebe a cidade do imóvel (evita homônimo)
    expect(decodeURIComponent(far.calls[0]!.path.replace(/\+/g, " "))).toContain(
      "Cataratas do Iguaçu, Foz do Iguaçu, PR, Brasil",
    );
  });

  it("formatação e ancoragem do destino", () => {
    expect(formatDistance(420)).toBe("420 m");
    expect(formatDistance(1_000)).toBe("1,0 km");
    expect(formatDistance(1_849)).toBe("1,8 km");
    expect(anchoredDestination("-25.6953, -54.4367", CTX)).toBe("-25.695300,-54.436700");
    expect(anchoredDestination("Shopping Catuaí, Foz do Iguaçu", CTX)).toBe(
      "Shopping Catuaí, Foz do Iguaçu",
    );
  });

  it("parsePlaces ignora o que não serve (sem nome, fechado, nota fora da escala)", () => {
    const out = parsePlaces({
      places: [
        { displayName: {} },
        { displayName: { text: "X" }, rating: 9, businessStatus: "CLOSED_TEMPORARILY" },
        { displayName: { text: "Y" }, rating: 9 },
      ],
    });
    expect(out).toEqual([expect.objectContaining({ name: "Y", rating: null })]);
  });
});

// ───────────── (c) falhas ─────────────

describe("(c) falha, prazo e indisponibilidade: o turno segue e nenhum metro é inventado", () => {
  const ctxNoOrigin = { ...CTX, origin: null };

  it("prazo: ferramenta que não responde é cortada em 6 s ⇒ tempo_esgotado", async () => {
    const { http } = fakeMaps({ hang: true });
    let fire: (() => void) | null = null;
    let scheduledMs = 0;
    const p = executeToolCalls(
      [
        call("calculate_property_distance", {
          destination_address_or_coords: "Marco das Três Fronteiras",
        }),
      ],
      CTX,
      {
        http,
        signal: signal(),
        remainingMs: () => 20_000,
        schedule: (fn, ms) => {
          fire = fn;
          scheduledMs = ms;
          return () => {};
        },
      },
    );
    await Promise.resolve();
    expect(scheduledMs).toBe(TOOL_TIMEOUT_MS);
    fire!();
    const [o] = await p;
    expect(o).toMatchObject({ ok: false, error: "tempo_esgotado" });
    expect(JSON.parse(o!.content)).toEqual({ ok: false, erro: "tempo_esgotado" });
    expect(o!.content).not.toMatch(/distancia/);
  });

  it("prazo nunca passa do que resta do turno", async () => {
    const { http } = fakeMaps({ hang: true });
    let scheduledMs = 0;
    const p = executeToolCalls([call("search_city_places", { query: "farmácia" })], CTX, {
      http,
      signal: signal(),
      remainingMs: () => 2_500,
      schedule: (fn, ms) => {
        scheduledMs = ms;
        queueMicrotask(fn);
        return () => {};
      },
    });
    await p;
    expect(scheduledMs).toBe(2_500);
  });

  it("rede caiu, HTTP de erro, sem origem, sem resultado, sem rota: códigos fixos, sem número", async () => {
    const run = async (
      name: string,
      args: unknown,
      opts: Parameters<typeof fakeMaps>[0],
      ctx = CTX,
    ) => {
      const { http } = fakeMaps(opts);
      const [o] = await executeToolCalls([call(name, args)], ctx, {
        http,
        signal: signal(),
        remainingMs: () => 20_000,
      });
      return o!;
    };
    expect((await run("search_city_places", { query: "pizza" }, { throwError: true })).error).toBe(
      "indisponivel",
    );
    expect((await run("search_city_places", { query: "pizza" }, { placesStatus: 500 })).error).toBe(
      "indisponivel",
    );
    expect(
      (await run("search_city_places", { query: "pizza" }, { places: { places: [] } })).error,
    ).toBe("sem_resultado");
    expect(
      (
        await run(
          "calculate_property_distance",
          { destination_address_or_coords: "Cataratas" },
          {},
          ctxNoOrigin,
        )
      ).error,
    ).toBe("sem_origem");
    expect(
      (
        await run(
          "calculate_property_distance",
          { destination_address_or_coords: "Cataratas" },
          { walk: () => null, drive: () => null },
        )
      ).error,
    ).toBe("sem_rota");
    expect(
      (
        await run(
          "calculate_property_distance",
          { destination_address_or_coords: "Cataratas" },
          { matrixStatus: 503 },
        )
      ).error,
    ).toBe("indisponivel");
    // trajeto absurdo (Google achou um homônimo em outro estado) ⇒ sem rota
    expect(
      (
        await run(
          "calculate_property_distance",
          { destination_address_or_coords: "Cataratas" },
          { walk: () => ({ meters: 900_000 }), drive: () => ({ meters: 900_000 }) },
        )
      ).error,
    ).toBe("sem_rota");
  });

  it("busca segue mesmo se as rotas falharem: distância null, nunca estimada", async () => {
    const { http } = fakeMaps({ places: PLACES_RESPONSE, matrixStatus: 500 });
    const [o] = await executeToolCalls([call("search_city_places", { query: "pizzaria" })], CTX, {
      http,
      signal: signal(),
      remainingMs: () => 20_000,
    });
    const r = JSON.parse(o!.content);
    expect(r.ok).toBe(true);
    for (const it of r.resultados)
      expect(it).toMatchObject({ distancia_m: null, distancia_texto: null, modalidade: null });
  });

  it("ferramenta desconhecida, JSON quebrado e argumento inválido nunca derrubam", async () => {
    const { http, calls } = fakeMaps({});
    const out = await executeToolCalls(
      [
        call("delete_reservation", {}, "c1"),
        call("search_city_places", "{quebrado", "c2"),
        call("search_city_places", { query: "" }, "c3"),
      ],
      CTX,
      { http, signal: signal(), remainingMs: () => 20_000 },
    );
    expect(out.map((o) => [o.callId, o.error])).toEqual([
      ["c1", "ferramenta_desconhecida"],
      ["c2", "argumentos_invalidos"],
      ["c3", "argumentos_invalidos"],
    ]);
    expect(calls).toHaveLength(0);
  });

  it("turno cancelado ⇒ nada sai para a rede", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { http, calls } = fakeMaps({});
    const [o] = await executeToolCalls([call("search_city_places", { query: "pizza" })], CTX, {
      http,
      signal: ctrl.signal,
      remainingMs: () => 20_000,
    });
    expect(o!.error).toBe("tempo_esgotado");
    expect(calls).toHaveLength(0);
  });

  it("resultado grande é encurtado (sem cortar o JSON) até o teto", () => {
    const big = {
      ok: true as const,
      resultados: Array.from({ length: 50 }, (_, i) => ({
        nome: `Lugar ${i}`,
        endereco: "x".repeat(150),
      })),
    };
    const s = serializeToolResult(big);
    expect(s.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(JSON.parse(s).resultados.length).toBeLessThan(50);
  });

  it("routesFromProperty sem origem válida não consulta nada", async () => {
    const { http, calls } = fakeMaps({});
    expect(await routesFromProperty({ lat: 0, lng: 0 }, ["x"], http, signal())).toEqual([null]);
    expect(calls).toHaveLength(0);
  });
});

// ───────────── (d) isolamento ─────────────

describe("(d) slot continua null; D9 e credenciais fora das ferramentas", () => {
  const ROOT = path.resolve(__dirname, "..", "..");
  it("slot.server.ts devolve null e não conhece ferramentas", async () => {
    const slot = readFileSync(path.join(ROOT, "slot.server.ts"), "utf8");
    expect(slot).not.toMatch(/tools|executeToolCalls|google/i);
    const { requestGuestAiReply } = await import("@/lib/guest-ai/slot.server");
    await expect(
      requestGuestAiReply({ surface: "guide_chat" as never, conversationId: "c", messageId: "m" }),
    ).resolves.toBeNull();
  });

  it("o contexto das ferramentas só tem origem e localidade (nada de reserva, hóspede ou credencial)", () => {
    const src = readFileSync(path.join(ROOT, "tools", "contracts.ts"), "utf8");
    const start = src.indexOf("{", src.indexOf("export interface GuestToolContext")) + 1;
    const iface = src.slice(start, src.indexOf("\n}", start));
    expect(iface).toMatch(/origin/);
    expect(iface).not.toMatch(/reserv|guest|credential|senha|wifi|pin|lock|gate/i);
    const gen = readFileSync(path.join(ROOT, "copilot", "generate.server.ts"), "utf8");
    expect(gen).toMatch(
      /return \{ origin: o\.origin, city: o\.city, region: o\.region, country: o\.country, surface: turn\.surface \};/,
    );
  });

  it("política D9 não é tocada pelas ferramentas", () => {
    for (const f of [
      "contracts.ts",
      "executor.ts",
      "registry.ts",
      "google-places.ts",
      "google-routes.ts",
      "google-maps.server.ts",
    ]) {
      const c = readFileSync(path.join(ROOT, "tools", f), "utf8");
      expect(c, f).not.toMatch(
        /credential-policy|evaluateCredential|CredentialGrant|fetchSensitiveCredentials/,
      );
    }
  });

  it("a projeção da origem só lê coordenadas e localidade", async () => {
    const { PROPERTY_ORIGIN_COLUMNS, SENSITIVE_PROPERTY_COLUMNS } =
      await import("@/lib/guest-ai/data/projections");
    expect([...PROPERTY_ORIGIN_COLUMNS]).toEqual([
      "id",
      "owner_id",
      "lat",
      "lng",
      "city",
      "state",
      "country",
    ]);
    for (const c of SENSITIVE_PROPERTY_COLUMNS)
      expect(PROPERTY_ORIGIN_COLUMNS as readonly string[]).not.toContain(c);
  });

  it("getGuestTool só devolve ferramentas registradas", () => {
    expect(getGuestTool("search_city_places")).not.toBeNull();
    expect(getGuestTool("run_sql")).toBeNull();
  });
});
