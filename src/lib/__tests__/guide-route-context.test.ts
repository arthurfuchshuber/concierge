/**
 * Distância por TRAJETO (Google Maps, Pilar 2) e contexto do item do guia conferido no servidor (Pilar 4).
 * Puro / bancos falsos.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  carryServerRoutes,
  distanceMatrixPath,
  parseDistanceMatrix,
  routeFields,
  ROUTE_MAX_DESTINATIONS,
} from "@/lib/route-distance";
import { parseGuideContextInput, resolveGuideContext } from "@/lib/guide-context.server";
import { cityNewsItemId } from "@/lib/city-news-window";

const O = { lat: -27.59, lng: -48.55 };
const D = { lat: -27.6, lng: -48.56 };

describe("distância por trajeto (Distance Matrix pelo gateway)", () => {
  it("caminho da API: origem, destinos (até 25), modo e unidades; recusa coordenadas inválidas", () => {
    const p = distanceMatrixPath(O, [D, D], "walking");
    expect(p.startsWith("/maps/api/distancematrix/json?")).toBe(true);
    const q = new URLSearchParams(p.split("?")[1]);
    expect(q.get("origins")).toBe("-27.590000,-48.550000");
    expect(q.get("destinations")).toBe("-27.600000,-48.560000|-27.600000,-48.560000");
    expect(q.get("mode")).toBe("walking");
    expect(q.get("units")).toBe("metric");
    expect(() => distanceMatrixPath(O, [], "walking")).toThrow();
    expect(() => distanceMatrixPath(O, Array(ROUTE_MAX_DESTINATIONS + 1).fill(D), "walking")).toThrow();
    expect(() => distanceMatrixPath({ lat: 91, lng: 0 }, [D], "walking")).toThrow();
    expect(() => distanceMatrixPath(O, [{ lat: Number.NaN, lng: 0 }], "driving")).toThrow();
  });

  it("lê um trecho por destino; sem rota ou resposta inválida ⇒ null (nunca lança)", () => {
    const json = {
      status: "OK",
      rows: [
        {
          elements: [
            { status: "OK", distance: { value: 452.4 }, duration: { value: 361 } },
            { status: "ZERO_RESULTS" },
            { status: "OK", distance: { value: -1 } },
          ],
        },
      ],
    };
    expect(parseDistanceMatrix(json, 3, "walking")).toEqual([{ meters: 452, seconds: 361, mode: "walking" }, null, null]);
    expect(parseDistanceMatrix({ status: "REQUEST_DENIED" }, 2, "walking")).toEqual([null, null]);
    expect(parseDistanceMatrix(null, 1, "driving")).toEqual([null]);
  });

  it("campos gravados: metros do trajeto, minutos do próprio trajeto, mesmo formato de texto do guia", () => {
    expect(routeFields({ meters: 452, seconds: 361, mode: "walking" }, null)).toEqual({
      distance_meters: 452,
      distance_text: "452 m · 6 min a pé",
      walk_minutes: 6,
      drive_minutes: null,
      distance_kind: "route",
    });
    expect(routeFields({ meters: 1820, seconds: 1500, mode: "walking" }, { meters: 2100, seconds: 300, mode: "driving" })).toEqual({
      distance_meters: 1820,
      distance_text: "1.8 km · 5 min de carro",
      walk_minutes: 25,
      drive_minutes: 5,
      distance_kind: "route",
    });
    // sem rota a pé: o trajeto de carro é a distância (nunca linha reta)
    expect(routeFields({ meters: 5300, seconds: 600, mode: "driving" }, { meters: 5300, seconds: 600, mode: "driving" })).toMatchObject({
      distance_meters: 5300,
      walk_minutes: null,
      drive_minutes: 10,
      distance_kind: "route",
    });
  });

  it("salvar o guia nunca marca valor do aparelho como trajeto; mantém a medição do servidor para o mesmo lugar", () => {
    const before = [
      { scope: "nearby", place_id: "A", distance_kind: "route", distance_meters: 420, distance_text: "420 m · 5 min a pé", walk_minutes: 5, drive_minutes: null, last_synced_at: "2026-11-06T00:00:00Z" },
      { scope: "nearby", place_id: "B", distance_kind: "straight_line", distance_meters: 300, distance_text: "x", walk_minutes: 4, drive_minutes: null, last_synced_at: null },
    ];
    const incoming = [
      { scope: "nearby", place_id: "A", name: "A", distance_meters: 999, distance_kind: "route" },
      { scope: "nearby", place_id: "B", name: "B", distance_meters: 999, distance_kind: "route" },
      { scope: "nearby", place_id: null, name: "Manual", distance_meters: 50, distance_kind: "route" },
      { scope: "city", place_id: "A", name: "A cidade", distance_meters: 1 },
    ];
    const out = carryServerRoutes(before, incoming);
    expect(out[0]).toMatchObject({ distance_kind: "route", distance_meters: 420, walk_minutes: 5, last_synced_at: "2026-11-06T00:00:00Z" });
    expect(out[1]).toMatchObject({ distance_kind: null, distance_meters: 999 });
    expect(out[2]).toMatchObject({ distance_kind: null, distance_meters: 50 });
    expect(out[3]).toMatchObject({ distance_kind: null });
  });

  it("a sincronização do servidor grava trajeto e marca linha reta quando não há rota; o editor preserva o servidor", () => {
    const maps = readFileSync(path.resolve(__dirname, "..", "maps.functions.ts"), "utf8");
    expect(maps).toMatch(/Object\.assign\(patch, routeFields\(leg\.walk, leg\.drive\)\)/);
    expect(maps).toMatch(/patch\.distance_kind = "straight_line"/);
    const props = readFileSync(path.resolve(__dirname, "..", "properties.functions.ts"), "utf8");
    expect(props).toMatch(/carryServerRoutes\(\(stored \?\? \[\]\) as StoredRouteRow\[\], uniqueRecs\)/);
  });
});

// ─────────────────────────── contexto do item do guia ───────────────────────────

const PROP = { id: "p1", city: "Florianópolis", country: "Brasil" };
const UUID = "0f0f0f0f-1111-4222-8333-444455556666";

function fakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => (r[k] ?? null) === v));
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        is: (k: string, v: unknown) => (filters.push([k, v]), q),
        gte: () => q,
        lte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      };
      return q;
    },
  } as never;
}

describe("contexto do item do guia (conferido no servidor)", () => {
  it("forma do pedido: só tipo + id no formato certo", () => {
    expect(parseGuideContextInput({ kind: "city_event", id: "evt-0a1b2c3d" })).toEqual({ kind: "city_event", id: "evt-0a1b2c3d" });
    expect(parseGuideContextInput({ kind: "place", id: `rec:${UUID}` })).toEqual({ kind: "place", id: `rec:${UUID}` });
    expect(parseGuideContextInput({ kind: "place", id: `cref:${UUID.toUpperCase()}` })).toEqual({ kind: "place", id: `cref:${UUID}` });
    for (const bad of [{ kind: "place", id: "rec:1" }, { kind: "city_event", id: "x" }, { kind: "x", id: "evt-0a1b2c3d" }, "evt", null])
      expect(parseGuideContextInput(bad)).toBeNull();
  });

  it("evento: só se estiver na edição vigente da cidade do imóvel; nome/categoria vêm do servidor", async () => {
    const item = { title: "Festival de Jazz", category: "evento", startDate: "2026-11-07", endDate: "2026-11-08" };
    const db = fakeDb({ city_daily_news: [{ city_key: "florianopolis", items: [item], date: "2026-11-05" }] });
    const now = new Date("2026-11-06T15:00:00Z");
    expect(await resolveGuideContext(db, PROP, { kind: "city_event", id: cityNewsItemId(item) }, now)).toEqual({
      kind: "city_event",
      id: cityNewsItemId(item),
      name: "Festival de Jazz",
      type: "evento",
      category: "evento",
    });
    expect(await resolveGuideContext(db, PROP, { kind: "city_event", id: "evt-00000000" }, now)).toBeNull();
    // outra cidade ⇒ nada
    expect(await resolveGuideContext(db, { ...PROP, city: "Curitiba" }, { kind: "city_event", id: cityNewsItemId(item) }, now)).toBeNull();
    // evento já encerrado ⇒ nada
    expect(await resolveGuideContext(db, PROP, { kind: "city_event", id: cityNewsItemId(item) }, new Date("2026-11-20T15:00:00Z"))).toBeNull();
  });

  it("recomendação: do próprio imóvel (Aqui pertinho) ou das referências da cidade dele; de outro imóvel ⇒ nada", async () => {
    const db = fakeDb({
      property_recommendations: [
        { id: UUID, property_id: "p1", scope: "nearby", name: "Padaria", type: "cafe", category: "Cafés" },
        { id: "aaaaaaaa-1111-4222-8333-444455556666", property_id: "p2", scope: "nearby", name: "De outro" },
      ],
      city_reference_group_members: [],
      city_references: [
        { id: "bbbbbbbb-1111-4222-8333-444455556666", property_id: "p1", group_id: null, is_hidden: false, name: "Mirante", type: "attraction", category: "Atrações" },
        { id: "cccccccc-1111-4222-8333-444455556666", property_id: "p1", group_id: null, is_hidden: true, name: "Oculto" },
      ],
    });
    expect(await resolveGuideContext(db, PROP, { kind: "place", id: `rec:${UUID}` })).toEqual({ kind: "place", id: `rec:${UUID}`, name: "Padaria", type: "cafe", category: "Cafés" });
    expect(await resolveGuideContext(db, PROP, { kind: "place", id: "rec:aaaaaaaa-1111-4222-8333-444455556666" })).toBeNull();
    expect(await resolveGuideContext(db, PROP, { kind: "place", id: "cref:bbbbbbbb-1111-4222-8333-444455556666" })).toMatchObject({ name: "Mirante" });
    expect(await resolveGuideContext(db, PROP, { kind: "place", id: "cref:cccccccc-1111-4222-8333-444455556666" })).toBeNull();
  });

  it("o chat do guia grava só o contexto conferido; o evento da Home manda o item tocado", () => {
    const route = readFileSync(path.resolve(__dirname, "..", "..", "routes", "api", "public", "guide-chat.ts"), "utf8");
    expect(route).toMatch(/gc\.resolveGuideContext\(/);
    expect(route).toMatch(/\.\.\.\(guideContext \? \{ guide_context: guideContext \} : \{\}\)/);
    const feed = readFileSync(path.resolve(__dirname, "..", "..", "components", "guide", "CityNewsFeed.tsx"), "utf8");
    expect(feed).toMatch(/kind: "city_event",\s+id: cityNewsItemId\(item\)/);
    const chat = readFileSync(path.resolve(__dirname, "..", "..", "components", "GuideAiChat.tsx"), "utf8");
    expect(chat).toMatch(/guideContext: takeGuideContext\(\)/);
  });
});
