import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; payload?: any; filters: Array<[string, unknown]> }>,
  rows: {} as Record<string, any[]>,
  errors: {} as Record<string, string>,
  sequence: [] as string[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      const call = { table, op: "select", payload: undefined as any, filters: [] as Array<[string, unknown]> };
      const builder: any = new Proxy({}, {
        get(_target, method: string) {
          if (method === "then") return (resolve: (value: unknown) => void) => {
            state.calls.push(call);
            state.sequence.push(`${table}:${call.op}`);
            resolve({ data: state.rows[table] ?? [], error: state.errors[table] ? { message: state.errors[table] } : null });
          };
          if (method === "maybeSingle") return async () => {
            state.calls.push(call);
            return { data: state.rows[table]?.[0] ?? null, error: null };
          };
          return (...args: any[]) => {
            if (["upsert", "insert", "update"].includes(method)) { call.op = method; call.payload = args[0]; }
            if (["eq", "gte", "lte", "in"].includes(method)) call.filters.push([args[0], args[1]]);
            return builder;
          };
        },
      });
      return builder;
    },
  },
}));
vi.mock("@/lib/channex-messages.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/channex-messages.server")>(),
  linkAirbnbConversationsForBooking: vi.fn(),
}));
vi.mock("@/lib/stay-dedup.server", () => ({ reconcileIcalForProperty: vi.fn() }));
vi.mock("@/lib/channex-mapping.server", () => ({ syncPilotAvailability: vi.fn().mockResolvedValue(undefined) }));

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runFullSync } from "@/lib/channex-ari.server";
import { puxarFeedReservas } from "@/lib/channex-webhook.server";
import { resolveListing } from "@/lib/channex-messages.server";

const input = { propertyId: "ch-property", roomTypeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ratePlanId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", countOfRooms: 1, baseRate: 100, weekendRate: 120, defaultMinStay: 1 };
const listing = { property_id: "internal-property", owner_id: "owner", airbnb_listing_id: "listing-1", channex_room_type_id: input.roomTypeId, airbnb_ai_enabled: true };
const message = { messageId: "msg", text: "Oi", sender: "guest", threadId: null, bookingId: "booking-1", channexPropertyId: null, guestName: null };

beforeEach(() => {
  state.calls.length = 0;
  state.sequence.length = 0;
  state.rows = {};
  state.errors = {};
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("full sync com fonte oficial", () => {
  it("aborta sem imóvel resolvido e não escreve calendário/outbox", async () => {
    await expect(runFullSync(input, null)).rejects.toThrow("imóvel interno do quarto Channex não identificado");
    expect(state.calls.some(c => c.op !== "select")).toBe(false);
  });
  it("aborta quando a leitura de ocupação falha", async () => {
    state.rows.property_listing_raw_data = [{ property_id: "internal-property" }];
    state.errors.property_reservations = "offline";
    await expect(runFullSync(input, null)).rejects.toThrow("falha ao ler ocupação oficial: offline");
    expect(state.calls.some(c => c.op !== "select")).toBe(false);
  });
  it("desconta checkin inclusive e checkout exclusivo e filtra imóvel, fonte e status", async () => {
    const start = new Date().toISOString().slice(0, 10);
    const checkout = new Date(`${start}T00:00:00Z`);
    checkout.setUTCDate(checkout.getUTCDate() + 2);
    const end = checkout.toISOString().slice(0, 10);
    state.rows.property_listing_raw_data = [{ property_id: "internal-property" }];
    state.rows.property_reservations = [{ checkin_date: start, checkout_date: end }];
    await runFullSync(input, null);
    const query = state.calls.find(c => c.table === "property_reservations");
    expect(query?.filters).toEqual([["property_id", "internal-property"], ["source", "channex"], ["status", "confirmed"], ["checkout_date", start]]);
    const days = state.calls.filter(c => c.table === "channex_ari_calendar" && c.op === "upsert").flatMap(c => c.payload);
    expect(days[0].availability).toBe(0);
    expect(days[1].availability).toBe(0);
    expect(days[2].date).toBe(end);
    expect(days[2].availability).toBe(1);
    expect(state.calls.some(c => c.table === "reservas")).toBe(false);
  });
});

describe("revisão recebida pelo feed de webhooks", () => {
  const revision = { id: "revision-1", type: "booking_revision", attributes: {
    booking_id: "booking-1", unique_id: "unique-1", ota_reservation_code: "CODE-1", status: "new",
    arrival_date: "2026-11-14", departure_date: "2026-11-15", customer: { name: "Teste" },
    rooms: [{ room_type_id: input.roomTypeId, rate_plan_id: input.ratePlanId }],
  } };
  function mockNetwork(feedRevision = revision) {
    vi.stubEnv("CHANNEX_API_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/ack")) state.sequence.push("ACK");
      return new Response(JSON.stringify(url.endsWith("/feed") ? { data: [feedRevision] } : {}), { status: 200 });
    }));
    state.rows.property_listing_raw_data = [{ property_id: "internal-property" }];
  }
  it("grava oficial → raw → ACK, sem tocar tabelas legadas", async () => {
    mockNetwork();
    expect(await puxarFeedReservas()).toEqual({ recebidas: 1, processadas: 1, falhas: [] });
    const write = state.calls.find(c => c.table === "property_reservations" && c.op === "upsert");
    expect(write?.payload).toMatchObject({ external_uid: "booking-1", source: "channex", status: "confirmed", guest_contacts: { code: "CODE-1" } });
    expect(state.calls.some(c => ["reservas", "propriedades"].includes(c.table))).toBe(false);
    const official = state.sequence.indexOf("property_reservations:upsert");
    const raw = state.sequence.indexOf("channex_raw_records:upsert");
    const ack = state.sequence.indexOf("ACK");
    expect(official).toBeGreaterThanOrEqual(0);
    expect(raw).toBeGreaterThan(official);
    expect(ack).toBeGreaterThan(raw);
  });
  it("não envia ACK se a gravação oficial falhar", async () => {
    mockNetwork();
    state.errors.property_reservations = "write failed";
    expect((await puxarFeedReservas()).falhas).toEqual(["write failed"]);
    expect(state.sequence).not.toContain("ACK");
  });
  it.each([
    ["imóvel", "imóvel não resolvido"],
    ["booking_id", "bookingId ausente"],
    ["arrival_date", "data de entrada ausente"],
    ["departure_date", "data de saída ausente"],
  ])("registra revisão sem %s e mantém raw → ACK sem gravar reserva", async (missing, motivo) => {
    const attributes = { ...revision.attributes };
    if (missing !== "imóvel") Reflect.deleteProperty(attributes, missing);
    const unmapped = { ...revision, attributes };
    mockNetwork(unmapped);
    if (missing === "imóvel") state.rows.property_listing_raw_data = [];
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await puxarFeedReservas()).toEqual({ recebidas: 1, processadas: 1, falhas: [] });
      expect(state.calls.some(c => c.table === "property_reservations" && c.op === "upsert")).toBe(false);
      const raw = state.calls.filter(c => c.table === "channex_raw_records" && c.op === "upsert").flatMap(c => c.payload);
      expect(raw.map(r => r.entity_type)).toEqual(["booking_revision_unmapped", "booking_revision"]);
      expect(raw[0]).toMatchObject({ channex_id: "revision-1", source: "webhook", payload: expect.objectContaining(attributes) });
      expect(state.sequence.lastIndexOf("channex_raw_records:upsert")).toBeLessThan(state.sequence.indexOf("ACK"));
      expect(state.sequence).toContain("ACK");
      expect(log).toHaveBeenCalledExactlyOnceWith(
        "[channex] reserva sem imóvel/datas — não gravada em property_reservations",
        { bookingId: missing === "booking_id" ? null : "booking-1", otaCode: "CODE-1", roomTypeId: input.roomTypeId, motivo },
      );
    } finally {
      log.mockRestore();
    }
  });
});

describe("resolveListing usa reservas oficiais", () => {
  it("resolve pelo property_id da reserva Channex", async () => {
    state.rows.property_listing_raw_data = [listing];
    state.rows.property_reservations = [{ property_id: listing.property_id }];
    expect(await resolveListing(supabaseAdmin, message)).toEqual(listing);
    const query = state.calls.find(c => c.table === "property_reservations");
    expect(query?.filters).toEqual([["external_uid", "booking-1"], ["source", "channex"]]);
    expect(state.calls.some(c => c.table === "reservas")).toBe(false);
  });
  it("mantém o fallback do par gêmeo pelo property_id", async () => {
    state.rows.property_listing_raw_data = [listing];
    state.rows.property_reservations = [{ property_id: "twin-property" }];
    state.rows.channex_twin_links = [{ property_id: "twin-property", primary_listing_id: listing.airbnb_listing_id }];
    expect(await resolveListing(supabaseAdmin, message)).toEqual(listing);
    expect(state.calls.find(c => c.table === "channex_twin_links")?.filters).toContainEqual(["property_id", "twin-property"]);
  });
  it("não adivinha quando a reserva não identifica o anúncio", async () => {
    state.rows.property_listing_raw_data = [listing];
    expect(await resolveListing(supabaseAdmin, message)).toBeNull();
  });
});