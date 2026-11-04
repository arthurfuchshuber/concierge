/**
 * B3.2 · `loadSenderIdentitySource` real (somente leitura) + política B2.5. Matriz B32-01..12.
 * Banco falso em memória (fixture de leitura); nada de produção é consultado.
 */
import { describe, expect, it } from "vitest";
import { loadSenderIdentitySource } from "@/lib/guest-ai/data/sender-identity.server";
import { resolveSenderIdentity, type SenderIdentitySource } from "@/lib/guest-ai/policy/sender-identity";
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { fakeDb, type Row } from "./helpers/b3-fake-db";
import { CH_MAPPED, CH_PREF, LISTING, PROPERTY, TENANT, TWIN, senderSource } from "./helpers/b25-fixtures";

const THREAD = "0f9c7d2e-thread-0001";
const CONV = "11111111-1111-4111-8111-111111111111";
const turn = (over: Partial<ValidatedTurn> = {}) =>
  issue("turn", { surface: "airbnb", conversationId: CONV, messageId: "22222222-2222-4222-8222-222222222222", propertyId: PROPERTY, tenantId: TENANT, guestSessionId: `airbnb:${THREAD}`, conversationStatus: "ai", reservationId: null, messageCreatedAt: null, ...over }) as ValidatedTurn;
const NOW = "2026-11-03T12:00:00.000Z";
const resolve = (src: SenderIdentitySource, t = turn()) => resolveSenderIdentity({ tenantId: t.tenantId, propertyId: t.propertyId, surface: t.surface, source: src, now: NOW });

/** Banco coerente: thread no imóvel (cx-1 = anúncio principal), gêmeo ativo, preferência e contas do tenant. */
function world(over: Partial<Record<string, Row[]>> = {}) {
  const T = "payload->payload->>message_thread_id";
  return {
    channex_raw_records: [
      { entity_type: "webhook:message", [T]: THREAD, channex_property_id: "cx-1" },
      { entity_type: "webhook:message", [T]: THREAD, channex_property_id: "cx-1" },
      { entity_type: "webhook:message", [T]: "outra-thread", channex_property_id: "cx-9" },
      { entity_type: "airbnb_sender_pref", channex_id: LISTING, owner_id: TENANT, channel_id: CH_PREF, updated_at: "2026-11-01T00:00:00Z" },
      { entity_type: "airbnb_sender_pref", channex_id: TWIN, owner_id: TENANT, channel_id: CH_PREF, updated_at: "2026-11-01T00:00:00Z" },
    ],
    property_listing_raw_data: [{ property_id: PROPERTY, owner_id: TENANT, airbnb_listing_id: LISTING, channex_channel_id: CH_MAPPED, channex_property_id: "cx-1" }],
    channex_twin_links: [{ owner_id: TENANT, property_id: PROPERTY, primary_listing_id: LISTING, twin_listing_id: TWIN, twin_channex_property_id: "cx-2", status: "active" }],
    airbnb_accounts: [
      { owner_id: TENANT, channex_channel_id: CH_PREF, status: "active" },
      { owner_id: TENANT, channex_channel_id: CH_MAPPED, status: "active" },
    ],
    ...over,
  } as Record<string, Row[]>;
}

describe("B3.2 · identidade do remetente/envio — loader real + política", () => {
  it("B32-01 · preferência explícita coerente ⇒ host_preference (fim a fim pelo loader)", async () => {
    const { db, writes } = fakeDb(world());
    const src = await loadSenderIdentitySource(turn(), { db });
    const r = resolve(src);
    expect(r).toMatchObject({ status: "resolved", source: "host_preference", senderChannelId: CH_PREF, listingId: LISTING, primaryListingId: LISTING, sendAuthorization: "not_granted", delivery: "not_sent" });
    expect(writes).toEqual([]);
  });
  it("B32-02 · preferência inválida (sem canal) NÃO cai para a conta mapeada", async () => {
    const w = world();
    w.channex_raw_records = w.channex_raw_records.map((r) => (r.entity_type === "airbnb_sender_pref" && r.channex_id === LISTING ? { ...r, channel_id: null } : r));
    const r = resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(w).db }));
    expect(r).toMatchObject({ status: "invalid", reason: "preference_invalid", senderChannelId: null });
  });
  it("B32-03 · sem preferência e anúncio com conta única ⇒ listing_mapped_channel", async () => {
    const w = world();
    w.channex_raw_records = w.channex_raw_records.filter((r) => r.entity_type !== "airbnb_sender_pref");
    expect(resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(w).db }))).toMatchObject({ status: "resolved", source: "listing_mapped_channel", senderChannelId: CH_MAPPED });
  });
  it("B32-04 · mapeamentos divergentes ⇒ ambiguous (contas do anúncio e anúncios da thread)", async () => {
    const w = world({
      property_listing_raw_data: [
        { property_id: PROPERTY, owner_id: TENANT, airbnb_listing_id: LISTING, channex_channel_id: CH_MAPPED, channex_property_id: "cx-1" },
        { property_id: PROPERTY, owner_id: TENANT, airbnb_listing_id: LISTING, channex_channel_id: "ch-outra", channex_property_id: "cx-1" },
      ],
    });
    w.channex_raw_records = w.channex_raw_records.filter((r) => r.entity_type !== "airbnb_sender_pref");
    expect(resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(w).db }))).toMatchObject({ status: "ambiguous", reason: "multiple_mapped_channels" });
    // thread com mensagens de duas propriedades Channex de anúncios diferentes ⇒ nunca escolhe um
    const w2 = world({ property_listing_raw_data: [...world().property_listing_raw_data, { property_id: PROPERTY, owner_id: TENANT, airbnb_listing_id: "1003", channex_channel_id: CH_MAPPED, channex_property_id: "cx-3" }] });
    w2.channex_raw_records.push({ entity_type: "webhook:message", "payload->payload->>message_thread_id": THREAD, channex_property_id: "cx-3" });
    expect(resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(w2).db }))).toMatchObject({ status: "ambiguous", reason: "listing_ambiguous" });
  });
  it("B32-05 · anúncio de outro imóvel ⇒ invalid", async () => {
    const w = world({ property_listing_raw_data: [{ property_id: "p-outro", owner_id: TENANT, airbnb_listing_id: LISTING, channex_channel_id: CH_MAPPED, channex_property_id: "cx-1" }] });
    expect(resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(w).db }))).toMatchObject({ status: "invalid", reason: "listing_property_mismatch" });
  });
  it("B32-06 · tenant divergente (anúncio, preferência ou conta de outro tenant) ⇒ invalid", async () => {
    const a = world({ property_listing_raw_data: [{ property_id: PROPERTY, owner_id: "t2", airbnb_listing_id: LISTING, channex_channel_id: CH_MAPPED, channex_property_id: "cx-1" }] });
    expect(resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(a).db }))).toMatchObject({ status: "invalid", reason: "listing_other_tenant" });
    const b = world();
    b.channex_raw_records = b.channex_raw_records.map((r) => (r.entity_type === "airbnb_sender_pref" ? { ...r, owner_id: "t2" } : r));
    expect(resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(b).db }))).toMatchObject({ status: "invalid", reason: "preference_other_tenant" });
    const c = world({ airbnb_accounts: [{ owner_id: "t2", channex_channel_id: CH_PREF, status: "active" }] });
    expect(resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(c).db }))).toMatchObject({ status: "invalid", reason: "channel_other_tenant" });
  });
  it("B32-07 · conta inativa ⇒ unavailable (channel_inactive)", async () => {
    const w = world({ airbnb_accounts: [{ owner_id: TENANT, channex_channel_id: CH_PREF, status: "disconnected" }] });
    expect(resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(w).db }))).toMatchObject({ status: "unavailable", reason: "channel_inactive" });
  });
  it("B32-08 · gêmeo inativo não é evidência: thread só do gêmeo inativo ⇒ anúncio não identificado", async () => {
    const w = world({ channex_twin_links: [{ owner_id: TENANT, property_id: PROPERTY, primary_listing_id: LISTING, twin_listing_id: TWIN, twin_channex_property_id: "cx-2", status: "inactive" }] });
    w.channex_raw_records = w.channex_raw_records.map((r) => (r.entity_type === "webhook:message" && r.channex_property_id === "cx-1" ? { ...r, channex_property_id: "cx-2" } : r));
    const src = await loadSenderIdentitySource(turn(), { db: fakeDb(w).db });
    expect(src.conversationListingCandidates).toEqual([]); // o loader nem considera o gêmeo inativo
    const r = resolve(src);
    expect(r.status).not.toBe("resolved");
    expect(r).toMatchObject({ reason: "listing_unidentified" });
  });
  it("B32-09 · ausência de sender_user_id não é prova de nada: o loader nem lê essa coluna", async () => {
    const { db, calls } = fakeDb(world());
    await loadSenderIdentitySource(turn(), { db });
    for (const c of calls) expect(String(c.select)).not.toMatch(/sender_user_id|content|message\b|payload\s*(,|$)/);
  });
  it("B32-10 · falha de consulta (erro ou exceção) ⇒ unavailable/lookup_failed", async () => {
    const fails: Array<Parameters<typeof fakeDb>[1]> = [{ fail: { channex_raw_records: true } }, { fail: { airbnb_accounts: true } }, { throwOn: ["property_listing_raw_data"] }];
    for (const fail of fails) {
      const r = resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(world(), fail).db }));
      expect(r).toMatchObject({ status: "unavailable", reason: "lookup_failed" });
    }
  });
  it("B32-11 · identidade ambígua/indeterminada nunca vira resolvida (preventivo)", async () => {
    const src: SenderIdentitySource = { ...senderSource(), conversationListingCandidates: [LISTING, "1003"] };
    expect(resolve(src)).toMatchObject({ status: "ambiguous", senderChannelId: null });
    // thread sem nenhum bruto ⇒ não identificado (nunca presume o anúncio do imóvel)
    const w = world();
    w.channex_raw_records = w.channex_raw_records.filter((r) => r.entity_type !== "webhook:message");
    expect(resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(w).db }))).toMatchObject({ status: "unavailable", reason: "listing_unidentified" });
  });
  it("B32-12 · dados coerentes: identidade consistente e rastreável (fonte, anúncio, principal)", async () => {
    const r1 = resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(world()).db }));
    const r2 = resolve(await loadSenderIdentitySource(turn(), { db: fakeDb(world()).db }));
    expect(r1).toEqual(r2);
    expect(r1).toMatchObject({ validation: "validated", resolvedAt: NOW, version: expect.stringMatching(/^sender-identity\./) });
  });
  it("fora do Airbnb: nenhuma consulta e not_applicable", async () => {
    const { db, calls } = fakeDb(world());
    const t = turn({ surface: "guide_chat", guestSessionId: "sess" });
    expect(resolve(await loadSenderIdentitySource(t, { db }), t)).toMatchObject({ status: "not_applicable" });
    expect(calls).toEqual([]);
  });
  it("sessão Airbnb malformada ⇒ falha fechada sem consulta; turno forjado ⇒ recusado", async () => {
    const { db, calls } = fakeDb(world());
    expect(resolve(await loadSenderIdentitySource(turn({ guestSessionId: "airbnb:" }), { db }))).toMatchObject({ status: "unavailable" });
    expect(calls).toEqual([]);
    await expect(loadSenderIdentitySource({ ...turn() } as ValidatedTurn, { db })).rejects.toThrow();
  });
  it("consultas filtram pela thread do turno e por tipo de registro; preferência só por caminhos JSON", async () => {
    const { db, calls } = fakeDb(world());
    await loadSenderIdentitySource(turn(), { db });
    const raw = calls.find((c) => c.table === "channex_raw_records" && c.filters.some(([, k]) => k === "payload->payload->>message_thread_id"))!;
    expect(raw.filters).toContainEqual(["eq", "payload->payload->>message_thread_id", THREAD]);
    expect(raw.filters).toContainEqual(["eq", "entity_type", "webhook:message"]);
    const pref = calls.find((c) => c.filters.some(([, k, v]) => k === "entity_type" && v === "airbnb_sender_pref"))!;
    expect(pref.select).toBe("channex_id, owner_id:payload->>owner_id, channel_id:payload->>channel_id, updated_at:payload->>updated_at");
    const acc = calls.find((c) => c.table === "airbnb_accounts")!;
    expect(acc.select).toBe("owner_id, channex_channel_id, status");
  });
});
