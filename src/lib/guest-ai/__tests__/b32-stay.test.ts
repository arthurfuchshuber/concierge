/**
 * B3.2 · `loadStayAuthorizationSource` real (somente leitura) + R6 + histórico de revogação + G.2 +
 * fuso com origem declarada. Matriz B32-13..37 (e T-G2-13..21 da B3.0 Rev. 2). Fixtures sintéticas.
 */
import { describe, expect, it } from "vitest";
import { loadStayAuthorizationSource } from "@/lib/guest-ai/data/stay-authorization.server";
import { SENSITIVE_PROPERTY_COLUMNS } from "@/lib/guest-ai/data/projections";
import {
  checkRequestedLateCheckout,
  classifyStayAuthorizationSource,
  evaluateStayAuthorizations,
  type StayAuthorization,
} from "@/lib/guest-ai/policy/stay-authorizations";
import { resolvePropertyTimezone } from "@/lib/guest-ai/policy/timezone-source";
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { fakeDb, type Row } from "./helpers/b3-fake-db";

const P = "p1";
const T = "t1";
const R = "r1";
const turn = (over: Partial<ValidatedTurn> = {}) =>
  issue("turn", { surface: "guide_chat", conversationId: "c1", messageId: "m1", propertyId: P, tenantId: T, guestSessionId: "sess", conversationStatus: "ai", reservationId: R, messageCreatedAt: null, ...over }) as ValidatedTurn;
const NOW = "2026-11-06T12:00:00.000Z";
const APPROVED = "2026-11-05T15:00:00.000Z";
const OFFICIAL_AT = "2026-11-07T14:00:00.000Z"; // 11:00 em America/Sao_Paulo

const card = (over: Row = {}): Row => ({ id: "card-out", property_id: P, reservation_id: R, kind: "checkout", status: "pending", late_checkout_time: "13:00", late_checkout_approved_at: APPROVED, late_checkout_by: "u-staff", ...over });
const audit = (action: string, created_at: string, entity_id = "card-out"): Row => ({ id: `a-${action}-${created_at}`, entity_type: "guest_arrival_status", entity_id, action: `guest_arrival_status.late_checkout.${action}`, created_at });

function world(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    properties: [{ id: P, owner_id: T, country: "Brasil", state: "PR", city: "Foz do Iguaçu", checkout_time: "11:00" }],
    property_reservations: [{ id: R, property_id: P, status: "confirmed", source: "airbnb", checkin_date: "2026-11-04", checkout_date: "2026-11-07" }],
    guest_arrival_status: [card()],
    audit_logs: [audit("approve", APPROVED)],
    ...over,
  };
}
async function evaluate(w: Record<string, Row[]>, t = turn(), now = NOW, opts?: Parameters<typeof fakeDb>[1]) {
  const src = await loadStayAuthorizationSource(t, { db: fakeDb(w, opts).db });
  return evaluateStayAuthorizations({ ...src, lookup: "ok", turn: { propertyId: t.propertyId, reservationId: t.reservationId }, now }).lateCheckout;
}

describe("B3.2 · autorização de estadia — loader real + R6 + histórico", () => {
  it("B32-13/B32-19 · reserva confirmada, cartão aprovado, sem revogação ⇒ autorizado (fonte confirmed)", async () => {
    const a = await evaluate(world());
    expect(a).toEqual({ status: "authorized", date: "2026-11-07", time: "13:00", approvedAt: APPROVED, source: "guest_arrival_status.late_checkout" });
    expect(classifyStayAuthorizationSource(a)).toBe("confirmed");
  });
  it("B32-14 · reserva inexistente ⇒ negação (not_applicable)", async () => {
    const a = await evaluate(world({ property_reservations: [] }));
    expect(a).toEqual({ status: "not_authorized", reason: "no_reservation" });
    expect(classifyStayAuthorizationSource(a)).toBe("not_applicable");
    expect(await evaluate(world(), turn({ reservationId: null }))).toEqual({ status: "not_authorized", reason: "no_reservation" });
  });
  it("B32-15 · reserva de outro imóvel ⇒ negação (conflito)", async () => {
    const a = await evaluate(world({ property_reservations: [{ id: R, property_id: "p2", status: "confirmed", checkin_date: "2026-11-04", checkout_date: "2026-11-07" }] }));
    expect(a).toEqual({ status: "not_authorized", reason: "property_mismatch" });
    expect(classifyStayAuthorizationSource(a)).toBe("conflict");
  });
  it("B32-16 · reserva cancelada ⇒ negação", async () => {
    expect(await evaluate(world({ property_reservations: [{ id: R, property_id: P, status: "cancelled", checkin_date: "2026-11-04", checkout_date: "2026-11-07" }] }))).toEqual({ status: "not_authorized", reason: "reservation_cancelled" });
  });
  it("B32-17 · no-show (reserva ou cartão de check-in) ⇒ negação", async () => {
    expect(await evaluate(world({ property_reservations: [{ id: R, property_id: P, status: "no_show", checkin_date: "2026-11-04", checkout_date: "2026-11-07" }] }))).toMatchObject({ status: "not_authorized", reason: "no_show" });
    expect(await evaluate(world({ guest_arrival_status: [card(), card({ id: "card-in", kind: "checkin", status: "no_show", late_checkout_time: null, late_checkout_approved_at: null, late_checkout_by: null })] }))).toMatchObject({ reason: "no_show" });
  });
  it("B32-18 · checkout confirmado ⇒ negação", async () => {
    expect(await evaluate(world({ guest_arrival_status: [card({ status: "done" })] }))).toEqual({ status: "not_authorized", reason: "checkout_confirmed" });
  });
  it("B32-20 / T-G2-17 · revogação registrada depois da aprovação lida ⇒ negação (nunca reativa)", async () => {
    const a = await evaluate(world({ audit_logs: [audit("approve", APPROVED), audit("revoke", "2026-11-05T16:00:00.000Z")] }));
    expect(a).toEqual({ status: "not_authorized", reason: "revoked_after_approval" });
    expect(classifyStayAuthorizationSource(a)).toBe("conflict");
    // revogação NO MESMO instante da aprovação lida também nega
    expect(await evaluate(world({ audit_logs: [audit("revoke", APPROVED)] }))).toMatchObject({ reason: "revoked_after_approval" });
    // revogação ANTERIOR seguida de nova aprovação (colunas novas) ⇒ autorizado
    expect(await evaluate(world({ audit_logs: [audit("approve", "2026-11-04T10:00:00.000Z"), audit("revoke", "2026-11-04T11:00:00.000Z"), audit("approve", APPROVED)] }))).toMatchObject({ status: "authorized" });
  });
  it("B32-21 · histórico conflitante (duas autorizações, evento ilegível) ⇒ conflict e negação", async () => {
    const two = await evaluate(world({ guest_arrival_status: [card(), card({ id: "card-out-2", late_checkout_time: "15:00" })], audit_logs: [] }));
    expect(two).toEqual({ status: "not_authorized", reason: "conflicting" });
    expect(classifyStayAuthorizationSource(two)).toBe("conflict");
    const bad = await evaluate(world({ audit_logs: [audit("approve", "não-é-data")] }));
    expect(bad).toEqual({ status: "not_authorized", reason: "history_inconsistent" });
  });
  it("B32-22 · aprovação expirada (horário autorizado já passou) ⇒ stale e negação", async () => {
    const a = await evaluate(world(), turn(), "2026-11-07T16:30:00.000Z");
    expect(a).toEqual({ status: "not_authorized", reason: "expired" });
    expect(classifyStayAuthorizationSource(a)).toBe("stale");
  });
  it("B32-23 / T-G2-13..16 · fuso ausente, ambíguo ou inválido ⇒ negação", async () => {
    for (const p of [
      { country: "Brasil", state: null }, // país com vários fusos sem estado (T-G2-13)
      { country: "Brasil", state: "AM" }, // estado com dois fusos (T-G2-15)
      { country: "Chile", state: "RS" }, // país fora da tabela
      { country: null, state: "PR" },
    ]) {
      const a = await evaluate(world({ properties: [{ id: P, owner_id: T, checkout_time: "11:00", ...p }] }));
      expect(a, JSON.stringify(p)).toEqual({ status: "not_authorized", reason: "invalid_timezone" });
    }
  });
  it("B32-24 · `arrival_time_source = staff` (previsão) sozinho nunca autoriza", async () => {
    const a = await evaluate(world({ guest_arrival_status: [card({ late_checkout_time: null, late_checkout_approved_at: null, late_checkout_by: null, arrival_time_override: "14:00", arrival_time_source: "staff" })], audit_logs: [] }));
    expect(a).toEqual({ status: "not_authorized", reason: "absent" });
  });
  it("B32-25 · nenhuma coluna de credencial é lida (projeções explícitas, sem *)", async () => {
    const { db, calls } = fakeDb(world());
    await loadStayAuthorizationSource(turn(), { db });
    expect(calls.length).toBeGreaterThan(3);
    for (const c of calls) {
      expect(c.select, c.table).toBeTruthy();
      expect(String(c.select)).not.toMatch(/\*/);
      for (const s of SENSITIVE_PROPERTY_COLUMNS) expect(String(c.select)).not.toMatch(new RegExp(`\\b${s}\\b`));
      expect(String(c.select)).not.toMatch(/metadata|user_email|\bip\b|guest_contacts|amount/);
    }
  });
  it("B32-26 · falha de leitura nunca autoriza: cartões/reserva ⇒ erro (cadeia ⇒ indisponível); histórico ⇒ negado", async () => {
    await expect(loadStayAuthorizationSource(turn(), { db: fakeDb(world(), { fail: { guest_arrival_status: true } }).db })).rejects.toThrow();
    await expect(loadStayAuthorizationSource(turn(), { db: fakeDb(world(), { throwOn: ["property_reservations"] }).db })).rejects.toThrow();
    expect(await evaluate(world(), turn(), NOW, { fail: { audit_logs: true } })).toEqual({ status: "not_authorized", reason: "history_unavailable" });
    expect(await evaluate(world(), turn(), NOW, { throwOn: ["audit_logs"] })).toEqual({ status: "not_authorized", reason: "history_unavailable" });
  });
  it("ordem obrigatória: colunas dos cartões ANTES do histórico; histórico filtrado pelos ids dos cartões e pelas ações do R6", async () => {
    const { db, calls } = fakeDb(world());
    await loadStayAuthorizationSource(turn(), { db });
    const iCards = calls.findIndex((c) => c.table === "guest_arrival_status");
    const iAudit = calls.findIndex((c) => c.table === "audit_logs");
    expect(iCards).toBeGreaterThanOrEqual(0);
    expect(iAudit).toBeGreaterThan(iCards);
    expect(calls[iAudit]!.filters).toEqual(expect.arrayContaining([["eq", "entity_type", "guest_arrival_status"], ["in", "entity_id", ["card-out"]], ["like", "action", "guest_arrival_status.late_checkout.%"]]));
    expect(calls[iCards]!.filters).toEqual(expect.arrayContaining([["eq", "property_id", P], ["in", "reservation_id", [R]]]));
  });
  it("T-G2-20 · aprovação feita na inserção (sem evento): vale pelas colunas — o histórico só nega", async () => {
    expect(await evaluate(world({ audit_logs: [] }))).toMatchObject({ status: "authorized" });
  });
  it("T-G2-21 · cartão excluído ⇒ ausente", async () => {
    expect(await evaluate(world({ guest_arrival_status: [], audit_logs: [] }))).toEqual({ status: "not_authorized", reason: "absent" });
  });
  it("imóvel de outro tenant ⇒ erro de escopo (nunca lê a reserva)", async () => {
    const { db, calls } = fakeDb(world({ properties: [{ id: P, owner_id: "t2", country: "Brasil", state: "PR", checkout_time: "11:00" }] }));
    await expect(loadStayAuthorizationSource(turn(), { db })).rejects.toThrow("property_scope_mismatch");
    expect(calls.map((c) => c.table)).toEqual(["properties"]);
  });
});

describe("B3.2 · fuso IANA com origem declarada (B3.0 Rev. 2 §6.2)", () => {
  it("T-G2-14 · estado com fuso único ⇒ verified_state; país de fuso único ⇒ single_zone_country", () => {
    expect(resolvePropertyTimezone({ country: "Brasil", state: "PR" })).toEqual({ status: "resolved", timezone: "America/Sao_Paulo", source: "verified_state", ambiguous: false });
    expect(resolvePropertyTimezone({ country: "Brazil", state: "sp" })).toMatchObject({ timezone: "America/Sao_Paulo" });
    expect(resolvePropertyTimezone({ country: "Brasil", state: "MT" })).toMatchObject({ timezone: "America/Cuiaba" });
    expect(resolvePropertyTimezone({ country: "Paraguay", state: null })).toMatchObject({ timezone: "America/Asuncion", source: "single_zone_country" });
  });
  it("T-G2-13/15/16 · país com vários fusos sem estado, estado multi-fuso, país desconhecido ⇒ não resolvido", () => {
    expect(resolvePropertyTimezone({ country: "Brasil", state: null })).toMatchObject({ status: "unresolved", reason: "state_missing" });
    for (const s of ["AM", "PA", "PE"]) expect(resolvePropertyTimezone({ country: "Brasil", state: s })).toMatchObject({ status: "unresolved", reason: "state_multi_zone" });
    expect(resolvePropertyTimezone({ country: "Chile", state: null })).toMatchObject({ reason: "country_unknown" });
    expect(resolvePropertyTimezone({ country: "Brasil", state: "XX" })).toMatchObject({ reason: "state_unknown" });
  });
  it("coluna explícita: válida e coerente ⇒ explicit; offset fixo ou divergente ⇒ não resolvido", () => {
    expect(resolvePropertyTimezone({ explicit: "America/Sao_Paulo", country: "Brasil", state: "PR" })).toMatchObject({ source: "explicit" });
    expect(resolvePropertyTimezone({ explicit: "America/Manaus", country: "Brasil", state: "AM" })).toMatchObject({ status: "resolved", source: "explicit" });
    expect(resolvePropertyTimezone({ explicit: "UTC", country: "Brasil", state: null })).toMatchObject({ reason: "explicit_invalid" });
    expect(resolvePropertyTimezone({ explicit: "America/Manaus", country: "Brasil", state: "PR" })).toMatchObject({ reason: "explicit_conflict" });
  });
});

describe("B3.2 · G.2 — `oficial < solicitado ≤ autorizado` (comparação temporal)", () => {
  const authz: StayAuthorization = { status: "authorized", date: "2026-11-07", time: "13:00", approvedAt: APPROVED, source: "guest_arrival_status.late_checkout" };
  const g2 = (req: Partial<{ date: unknown; time: unknown; timezone: unknown; reservationId: string | null; propertyId: string | null }>, over: Partial<Parameters<typeof checkRequestedLateCheckout>[0]> = {}) =>
    checkRequestedLateCheckout({ requested: { date: "2026-11-07", time: "12:00", timezone: "America/Sao_Paulo", ...req }, authorization: authz, turn: { reservationId: R, propertyId: P }, propertyTimezone: "America/Sao_Paulo", officialCheckoutAt: OFFICIAL_AT, ...over });
  it("B32-27 · antes do teto (e depois do oficial) ⇒ dentro", () => expect(g2({ time: "12:00" })).toMatchObject({ status: "within_authorized" }));
  it("B32-28 · igual ao teto ⇒ dentro", () => expect(g2({ time: "13:00" })).toMatchObject({ status: "within_authorized", authorizedAt: "2026-11-07T16:00:00.000Z" }));
  it("B32-29 · depois do teto ⇒ negação (inclusive 1 minuto)", () => {
    expect(g2({ time: "13:01" })).toEqual({ status: "denied", reason: "above_authorized" });
    expect(g2({ time: "14:30" })).toEqual({ status: "denied", reason: "above_authorized" });
  });
  it("igual ou anterior ao oficial ⇒ não é saída tardia", () => {
    expect(g2({ time: "11:00" })).toEqual({ status: "denied", reason: "not_after_official" });
    expect(g2({ time: "10:00" })).toEqual({ status: "denied", reason: "not_after_official" });
    expect(g2({}, { officialCheckoutAt: null })).toEqual({ status: "denied", reason: "official_unavailable" });
  });
  it("B32-30/31 · reserva ou imóvel divergente ⇒ negação", () => {
    expect(g2({ reservationId: "r2" })).toEqual({ status: "denied", reason: "scope_mismatch" });
    expect(g2({ propertyId: "p2" })).toEqual({ status: "denied", reason: "scope_mismatch" });
    expect(g2({}, { turn: { reservationId: null, propertyId: P } })).toEqual({ status: "denied", reason: "scope_mismatch" });
  });
  it("B32-32 · data local divergente (virada de data) ⇒ negação", () => {
    expect(g2({ date: "2026-11-08", time: "00:30" })).toEqual({ status: "denied", reason: "date_mismatch" });
    expect(g2({ date: "2026-11-06" })).toEqual({ status: "denied", reason: "date_mismatch" });
  });
  it("B32-33 · fuso inválido ou diferente do imóvel ⇒ negação (nunca compara texto)", () => {
    expect(g2({}, { propertyTimezone: "GMT-3" })).toEqual({ status: "denied", reason: "timezone_invalid" });
    expect(g2({}, { propertyTimezone: null })).toEqual({ status: "denied", reason: "timezone_invalid" });
    expect(g2({ timezone: "America/Manaus" })).toEqual({ status: "denied", reason: "timezone_mismatch" });
    expect(g2({ time: "12h" })).toEqual({ status: "denied", reason: "requested_invalid" });
    expect(g2({ time: "25:00" })).toEqual({ status: "denied", reason: "requested_invalid" });
  });
  it("B32-34 · horário inexistente (salto do horário de verão) ⇒ negação", () => {
    const ny: StayAuthorization = { ...authz, date: "2026-03-08", time: "05:00" } as StayAuthorization;
    const r = checkRequestedLateCheckout({ requested: { date: "2026-03-08", time: "02:30", timezone: "America/New_York" }, authorization: ny, turn: { reservationId: R, propertyId: P }, propertyTimezone: "America/New_York", officialCheckoutAt: "2026-03-08T05:00:00.000Z" });
    expect(r).toEqual({ status: "denied", reason: "requested_nonexistent" });
  });
  it("B32-35 · horário ambíguo (volta do horário de verão) ⇒ negação sem desambiguação formal", () => {
    const ny: StayAuthorization = { ...authz, date: "2026-11-01", time: "03:00" } as StayAuthorization;
    const r = checkRequestedLateCheckout({ requested: { date: "2026-11-01", time: "01:30", timezone: "America/New_York" }, authorization: ny, turn: { reservationId: R, propertyId: P }, propertyTimezone: "America/New_York", officialCheckoutAt: "2026-11-01T04:00:00.000Z" });
    expect(r).toEqual({ status: "denied", reason: "requested_ambiguous" });
    const amb: StayAuthorization = { ...authz, date: "2026-11-01", time: "01:30" } as StayAuthorization;
    expect(checkRequestedLateCheckout({ requested: { date: "2026-11-01", time: "01:15", timezone: "America/New_York" }, authorization: amb, turn: { reservationId: R, propertyId: P }, propertyTimezone: "America/New_York", officialCheckoutAt: "2026-11-01T04:00:00.000Z" }).status).toBe("denied");
  });
  it("B32-36/37 · revogação posterior ou conflito entre autorizações ⇒ a G.2 nega (autorização ausente)", async () => {
    const revoked = await evaluate(world({ audit_logs: [audit("revoke", "2026-11-05T16:00:00.000Z")] }));
    expect(g2({}, { authorization: revoked })).toEqual({ status: "denied", reason: "not_authorized" });
    const conflict = await evaluate(world({ guest_arrival_status: [card(), card({ id: "x", late_checkout_time: "15:00" })], audit_logs: [] }));
    expect(g2({}, { authorization: conflict })).toEqual({ status: "denied", reason: "not_authorized" });
    expect(g2({}, { authorization: null })).toEqual({ status: "denied", reason: "not_authorized" });
  });
});
