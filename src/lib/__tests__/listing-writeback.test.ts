import { describe, expect, it } from "vitest";
import { buildWriteback, diffBidirectional, hourOf, mergeIntoSettings } from "@/lib/listing-writeback";

const current = {
  booking_setting: {
    instant_booking_allowed_category: "everyone",
    check_in_time_start: "14",
    cancellation_policy_settings: { cancellation_policy_category: "moderate", non_refundable_price_factor: 0.9 },
    guest_controls: { allows_pets_as_host: true, pet_capacity: 2 },
  },
  pricing_setting: { currency: "BRL", default_daily_price: 300, guests_included: 2, price_per_extra_person: 30 },
};

describe("envio de volta ao Airbnb", () => {
  it("horário só em hora cheia", () => {
    expect(hourOf("15:00")).toEqual({ ok: true, hour: "15" });
    expect(hourOf("15:30").ok).toBe(false);
  });
  it("monta update_booking_setting no formato da Channex", () => {
    const r = buildWriteback({ channelId: "c1", mappingId: "m1", current, patch: { checkin_time: "15:00", checkout_time: "11:00", cancellation_category: "firm" } });
    expect(r.errors).toEqual([]);
    expect(r.requests).toHaveLength(1);
    const q = r.requests[0]!;
    expect(q.path).toBe("/channels/c1/execute/update_booking_setting");
    expect((q.body as any).channel_rate_plan_id).toBe("m1");
    expect((q.body as any).data).toMatchObject({ instant_booking_allowed_category: "everyone", check_in_time_start: "15", check_out_time: 11 });
    expect((q.body as any).data.cancellation_policy_settings).toEqual({ cancellation_policy_category: "firm", non_refundable_price_factor: 0.9 });
  });
  it("não desliga reserva instantânea nem aceita minutos", () => {
    const r = buildWriteback({ channelId: "c1", mappingId: "m1", current, patch: { instant_booking: false, checkin_time: "15:30" } });
    expect(r.requests).toHaveLength(0);
    expect(r.errors).toHaveLength(2);
  });
  it("preço respeita os limites e mescla o que já existe", () => {
    const ok = buildWriteback({ channelId: "c1", mappingId: "m1", current, patch: { pricing: { default_daily_price: 350 } } });
    expect(ok.requests[0]!.isPricing).toBe(true);
    expect((ok.requests[0]!.body as any).pricing_settings).toMatchObject({ currency: "BRL", default_daily_price: 350, guests_included: 2, price_per_extra_person: 30 });
    const bad = buildWriteback({ channelId: "c1", mappingId: "m1", current, patch: { pricing: { default_daily_price: 5 } } });
    expect(bad.requests).toHaveLength(0);
  });
  it("estadia mínima/máxima vai em availability_settings", () => {
    const r = buildWriteback({ channelId: "c1", mappingId: "m1", current, patch: { availability: { default_min_nights: 2 } } });
    expect(r.requests[0]!.path).toBe("/channels/c1/mappings/m1/availability_settings");
  });
  it("publicar e despublicar", () => {
    expect(buildWriteback({ channelId: "c1", mappingId: "m1", current, patch: { published: false } }).requests[0]!.path).toBe("/channels/c1/execute/unpublish");
    expect(buildWriteback({ channelId: "c1", mappingId: "m1", current, patch: { published: true } }).requests[0]!.path).toBe("/channels/c1/execute/publish");
  });
  it("diff só pega o que mudou no imóvel", () => {
    const before = { checkin_time: "14:00:00", checkin_time_max: "23:00:00", checkout_time: "11:00:00", airbnb_cancellation_category: "moderate" };
    expect(diffBidirectional(before, { checkin_time: "14:00", checkout_time: "11:00" })).toEqual({});
    expect(diffBidirectional(before, { checkin_time: "15:00", airbnb_cancellation_category: "firm" })).toEqual({ checkin_time: "15:00", cancellation_category: "firm" });
  });
  it("reflete o enviado em raw_settings", () => {
    const r = buildWriteback({ channelId: "c1", mappingId: "m1", current, patch: { checkout_time: "10:00" } });
    const next = mergeIntoSettings(current, r.requests[0]!);
    expect(next.booking_setting.check_out_time).toBe(10);
    expect(next.booking_setting.check_in_time_start).toBe("14");
  });
});
