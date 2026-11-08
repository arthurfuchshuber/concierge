/**
 * B2.4 · Invariante absoluto: entrada antecipada e saída tardia só com autorização FORMAL, válida e
 * comprovada. O modelo nunca cria autorização. D13 (credenciais) ≠ autorização de horário.
 */
import { describe, expect, it } from "vitest";
import { evaluateStayAuthorizations, type StayAuthorizationInput, type StayCardRow } from "@/lib/guest-ai/policy/stay-authorizations";
import { resolveDomain } from "@/lib/guest-ai/dossier/authority";
import { runTurnChain } from "@/lib/guest-ai/turn-chain";
import { harness, turn, v6 } from "./helpers/b23-chain";

const NOW = "2026-11-03T12:00:00Z";
const card = (over: Partial<StayCardRow> = {}): StayCardRow => ({ kind: "checkout", status: "pending", property_id: "p1", reservation_id: "r1", ...over });
const R6 = { late_checkout_time: "13:00", late_checkout_approved_at: "2026-11-02T15:00:00Z", late_checkout_by: "00000000-0000-4000-8000-0000000000aa" };
const D13 = { credentials_released_at: "2026-11-02T10:00:00Z", credentials_released_by: "00000000-0000-4000-8000-0000000000bb" };
const input = (over: Partial<StayAuthorizationInput> = {}): StayAuthorizationInput => ({
  turn: { propertyId: "p1", reservationId: "r1" },
  lookup: "ok",
  reservation: { id: "r1", property_id: "p1", status: "confirmed", checkin_date: "2026-11-04", checkout_date: "2026-11-07" },
  stayReservationIds: [],
  property: { timezone: "America/Sao_Paulo", checkOutTime: "11:00" },
  cards: [],
  now: NOW,
  ...over,
});
const late = (over: Partial<StayAuthorizationInput> = {}) => evaluateStayAuthorizations(input(over)).lateCheckout;
const early = (over: Partial<StayAuthorizationInput> = {}) => evaluateStayAuthorizations(input(over)).earlyCheckin;

describe("B2.4 · horários padrão: anúncio × cadastro", () => {
  it("igual ⇒ confirmado; diferente ⇒ vale o cadastro e o anúncio fica divergente", () => {
    const c = (v: string, src: "official_property_record" | "listing_public") => ({ domain: "checkin_time_standard" as const, propertyId: "p1", value: v, source: src, sourceRef: src, observedAt: null, validUntil: null, temporal: "current" as const });
    expect(resolveDomain("checkin_time_standard", "p1", [c("15:00", "official_property_record"), c("15:00", "listing_public")], NOW)).toMatchObject({ status: "confirmed", divergent: [] });
    const diff = resolveDomain("checkin_time_standard", "p1", [c("15:00", "official_property_record"), c("14:00", "listing_public")], NOW);
    expect(diff).toMatchObject({ status: "confirmed", value: "15:00" });
    expect(diff.divergent).toHaveLength(1);
  });
});

describe("B2.4 · saída tardia (R6)", () => {
  it("sem R6 ⇒ absent; cartão com horário padrão/previsão (inclusive 'staff') ⇒ absent", () => {
    expect(late()).toEqual({ status: "not_authorized", reason: "absent" });
    expect(late({ cards: [card({ arrival_time_override: "14:00", arrival_time_source: "staff" })] })).toEqual({ status: "not_authorized", reason: "absent" });
  });
  it("R6 válido ⇒ autorizado com data, horário e momento de aprovação", () => {
    expect(late({ cards: [card(R6)] })).toEqual({ status: "authorized", date: "2026-11-07", time: "13:00", approvedAt: "2026-11-02T15:00:00.000Z", source: "guest_arrival_status.late_checkout" });
  });
  it("R6 de reserva irmã da MESMA estadia (comprovada) vale; de outra reserva/outro imóvel, não", () => {
    expect(late({ stayReservationIds: ["r1b"], cards: [card({ ...R6, reservation_id: "r1b" })] }).status).toBe("authorized");
    expect(late({ cards: [card({ ...R6, reservation_id: "r9" })] })).toEqual({ status: "not_authorized", reason: "other_reservation" });
    expect(late({ cards: [card({ ...R6, property_id: "p9" })] })).toEqual({ status: "not_authorized", reason: "other_property" });
  });
  it("R6 revogado: colunas limpas ⇒ absent; limpeza parcial ⇒ incomplete; sem autor ⇒ incomplete", () => {
    expect(late({ cards: [card({ late_checkout_time: null, late_checkout_approved_at: null, late_checkout_by: null })] }).status).toBe("not_authorized");
    expect(late({ cards: [card({ ...R6, late_checkout_approved_at: null })] })).toEqual({ status: "not_authorized", reason: "incomplete" });
    expect(late({ cards: [card({ ...R6, late_checkout_by: "" })] })).toEqual({ status: "not_authorized", reason: "incomplete" });
  });
  it("integridade temporal e de horário", () => {
    expect(late({ cards: [card({ ...R6, late_checkout_time: "25:99" })] })).toEqual({ status: "not_authorized", reason: "invalid_time" });
    expect(late({ cards: [card({ ...R6, late_checkout_approved_at: "ontem" })] })).toEqual({ status: "not_authorized", reason: "approval_timestamp_invalid" });
    expect(late({ cards: [card({ ...R6, late_checkout_approved_at: "2026-11-05T10:00:00Z" })] })).toEqual({ status: "not_authorized", reason: "approval_in_future" });
    expect(late({ cards: [card({ ...R6, late_checkout_time: "10:30" })] })).toEqual({ status: "not_authorized", reason: "not_after_official" });
    expect(late({ cards: [card({ ...R6, late_checkout_time: "11:00" })] })).toEqual({ status: "not_authorized", reason: "not_after_official" });
  });
  it("informação conflitante: duas autorizações formais com horários diferentes ⇒ conflicting", () => {
    expect(late({ cards: [card(R6), card({ ...R6, late_checkout_time: "15:00" })] })).toEqual({ status: "not_authorized", reason: "conflicting" });
    // mesma autorização duplicada não é conflito
    expect(late({ cards: [card(R6), card(R6)] }).status).toBe("authorized");
  });
  it("fuso inválido, horário oficial inválido e consulta indisponível ⇒ não autorizado", () => {
    expect(late({ property: { timezone: "GMT-3", checkOutTime: "11:00" }, cards: [card(R6)] })).toEqual({ status: "not_authorized", reason: "invalid_timezone" });
    expect(late({ property: { timezone: "America/Sao_Paulo", checkOutTime: null }, cards: [card(R6)] })).toEqual({ status: "not_authorized", reason: "official_time_invalid" });
    expect(late({ lookup: "failed", cards: [card(R6)] })).toEqual({ status: "not_authorized", reason: "lookup_unavailable" });
  });
  it.each<[string, Partial<StayAuthorizationInput>, string]>([
    ["sem reserva", { reservation: null }, "no_reservation"],
    ["reserva diferente da do turno", { reservation: { id: "r9", property_id: "p1", status: "confirmed", checkin_date: "2026-11-04", checkout_date: "2026-11-07" } }, "reservation_mismatch"],
    ["reserva de outro imóvel", { reservation: { id: "r1", property_id: "p9", status: "confirmed", checkin_date: "2026-11-04", checkout_date: "2026-11-07" } }, "property_mismatch"],
    ["reserva cancelada", { reservation: { id: "r1", property_id: "p1", status: "cancelled", checkin_date: "2026-11-04", checkout_date: "2026-11-07" } }, "reservation_cancelled"],
    ["status não confirmado", { reservation: { id: "r1", property_id: "p1", status: "blocked", checkin_date: "2026-11-04", checkout_date: "2026-11-07" } }, "reservation_invalid"],
    ["no-show no cartão", { cards: [card({ kind: "checkin", status: "no_show" }), card(R6)] }, "no_show"],
    ["checkout já confirmado", { cards: [card({ ...R6, status: "done" })] }, "checkout_confirmed"],
  ])("estado de reserva incompatível (%s) ⇒ %s", (_n, over, reason) => {
    expect(late({ cards: [card(R6)], ...over })).toEqual({ status: "not_authorized", reason });
  });
});

describe("B2.4 · entrada antecipada (sem fonte formal; D13 é acesso, não horário)", () => {
  it("sem D13 ⇒ no_authorization_source", () => {
    expect(early()).toEqual({ status: "not_authorized", reason: "no_authorization_source" });
  });
  it("com D13 VÁLIDA (credenciais liberadas) ⇒ continua NÃO autorizada; D13 só é registrada como acesso", () => {
    const r = evaluateStayAuthorizations(input({ cards: [card({ kind: "checkin", ...D13 })] }));
    expect(r.earlyCheckin).toEqual({ status: "not_authorized", reason: "no_authorization_source" });
    expect(r.credentialManualRelease).toBe("released");
  });
  it("D13 revogada (autor apagado), de outro imóvel ou previsão de chegada ⇒ não liberada e não autorizada", () => {
    expect(evaluateStayAuthorizations(input({ cards: [card({ kind: "checkin", ...D13, credentials_released_by: null })] })).credentialManualRelease).toBe("not_released");
    expect(evaluateStayAuthorizations(input({ cards: [card({ kind: "checkin", ...D13, property_id: "p9" })] })).credentialManualRelease).toBe("not_released");
    expect(early({ cards: [card({ kind: "checkin", arrival_time_override: "09:00", arrival_time_source: "staff" })] }).status).toBe("not_authorized");
  });
  it("D13 de outra reserva com reserva do turno incompatível ⇒ motivo da reserva", () => {
    expect(early({ reservation: null, cards: [card({ kind: "checkin", ...D13, reservation_id: "r9" })] })).toEqual({ status: "not_authorized", reason: "no_reservation" });
  });
});

describe("B2.4 · o modelo não consegue criar autorização (cadeia completa)", () => {
  const T0 = Date.parse(NOW);
  const src = (cards: StayCardRow[]) => async () => ({ reservation: input().reservation, stayReservationIds: [], property: input().property, cards });
  // B2.5: compromisso temporal declara o horário (promisedTimes), comparado com o R6
  const lateReply = v6({ reply: "Pode sair às 13h.", commitments: ["saída às 13h"], commitmentKinds: ["late_checkout"], groundedOn: ["ctx:saida_tardia"], promisedTimes: [{ kind: "late_checkout", date: "2026-11-07", time: "13:00", timezone: "America/Sao_Paulo" }] });
  const earlyReply = v6({ reply: "Pode entrar às 10h.", commitments: ["entrada às 10h"], commitmentKinds: ["early_checkin"], groundedOn: ["ctx:entrada_antecipada"] });

  it("compromisso de saída tardia SEM R6 ⇒ recusado; COM R6 válido ⇒ aprovado (e o fato aparece no prompt)", async () => {
    const none = harness(lateReply, { now: () => T0, loadStayAuthorizationSource: src([]) });
    const r1 = await runTurnChain({ turn: turn(), traceId: "s1" }, none.deps);
    expect(r1).toMatchObject({ kind: "refused", code: "semantic_block" });
    expect(r1.audit.decision?.unauthorizedKinds).toEqual(["late_checkout"]);
    const ok = harness(lateReply, { now: () => T0, loadStayAuthorizationSource: src([card(R6)]) });
    const r2 = await runTurnChain({ turn: turn(), traceId: "s2" }, ok.deps);
    expect(r2.kind).toBe("reply");
    expect(r2.audit.checks.stayAuthorizations).toEqual({ earlyCheckin: "no_authorization_source", lateCheckout: "authorized" });
    expect(ok.calls.prompts[0]!.messages[0]!.content).toContain('"status":"autorizada_formalmente","data":"2026-11-07","horario":"13:00"');
  });
  it("compromisso de entrada antecipada é recusado mesmo com D13 válida", async () => {
    const h = harness(earlyReply, { now: () => T0, loadStayAuthorizationSource: src([card({ kind: "checkin", ...D13 })]) });
    const r = await runTurnChain({ turn: turn(), traceId: "s3" }, h.deps);
    expect(r).toMatchObject({ kind: "refused", code: "semantic_block" });
    expect(h.calls.prompts[0]!.messages[0]!.content).toContain("credenciais_liberadas_nao_autorizam_horario_de_entrada");
  });
  it("fonte de autorização indisponível ⇒ nada autorizado (o turno segue, a promessa não)", async () => {
    const h = harness(lateReply, { now: () => T0, loadStayAuthorizationSource: async () => { throw new Error("db"); } });
    const r = await runTurnChain({ turn: turn(), traceId: "s4" }, h.deps);
    expect(r).toMatchObject({ kind: "refused", code: "semantic_block" });
    expect(r.audit.checks.stayAuthorizations).toEqual({ earlyCheckin: "lookup_unavailable", lateCheckout: "lookup_unavailable" });
  });
  it("a fonte não consegue trocar a identidade: reserva/imóvel vêm do turno validado", async () => {
    const h = harness(lateReply, {
      now: () => T0,
      loadStayAuthorizationSource: async () => ({ reservation: { id: "r9", property_id: "p9", status: "confirmed", checkin_date: "2026-11-04", checkout_date: "2026-11-07" }, stayReservationIds: [], property: input().property, cards: [card({ ...R6, reservation_id: "r9", property_id: "p9" })] }),
    });
    const r = await runTurnChain({ turn: turn(), traceId: "s5" }, h.deps);
    expect(r.kind).toBe("refused");
    expect(r.audit.checks.stayAuthorizations?.lateCheckout).toBe("reservation_mismatch");
  });
});
