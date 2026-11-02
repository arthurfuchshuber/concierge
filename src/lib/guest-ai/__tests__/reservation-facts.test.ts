import { describe, expect, it } from "vitest";
import { deriveReservationFacts, type ArrivalStatusRow, type ReservationRow } from "@/lib/guest-ai/data/reservation-facts";
import { deriveStayPhase } from "@/lib/guest-ai/policy/phase";
import { decideAudiences, evaluateCaseGate, evaluateCredentialAccess } from "@/lib/guest-ai/policy/engine";
import { normalizeReservationStatus, isNoShowStatus } from "@/lib/guest-ai/policy/status";

const res: ReservationRow = { id: "r1", property_id: "p1", status: "confirmed", source: "channex", checkin_date: "2026-11-10", checkout_date: "2026-11-12" };
const row = (o: Partial<ArrivalStatusRow>): ArrivalStatusRow => ({
  kind: "checkin",
  status: "pending",
  done_at: null,
  concluded_at: null,
  arrival_time_override: null,
  arrival_date_override: null,
  arrival_time_source: null,
  reservation_id: "r1",
  log_id: null,
  ...o,
});

describe("fatos da reserva (estados reais do banco)", () => {
  it("sem reserva ⇒ exists=false", () => {
    expect(deriveReservationFacts(null, []).exists).toBe(false);
  });
  it("no-show do cartão de check-in, inclusive gravado só no formulário (log) da mesma estadia", () => {
    expect(deriveReservationFacts(res, [row({ status: "no_show" })]).noShow).toBe(true);
    expect(deriveReservationFacts(res, [row({ status: "no_show", reservation_id: null, log_id: "l1" })]).noShow).toBe(true);
    expect(deriveReservationFacts(res, [row({ status: "no_show" })]).checkinCard).toEqual({ released: false, noShow: true });
  });
  it("checkout confirmado: status done, done_at ou concluded_at do cartão de SAÍDA", () => {
    expect(deriveReservationFacts(res, [row({ kind: "checkout", status: "done" })]).checkoutConfirmed).toBe(true);
    const f = deriveReservationFacts(res, [row({ kind: "checkout", status: "pending", concluded_at: "2026-11-12T13:00:00Z" })]);
    expect(f).toMatchObject({ checkoutConfirmed: true, confirmedCheckoutAt: "2026-11-12T13:00:00Z" });
    expect(deriveReservationFacts(res, [row({ kind: "checkout", done_at: "2026-11-12T12:00:00Z" })]).confirmedCheckoutAt).toBe("2026-11-12T12:00:00Z");
  });
  it("concluded_at em cartão de CHECK-IN não é checkout (lá só esconde o cartão)", () => {
    const f = deriveReservationFacts(res, [row({ kind: "checkin", status: "pending", concluded_at: "2026-11-09T00:00:00Z" })]);
    expect(f.checkoutConfirmed).toBe(false);
  });
  it("R6 · DEFEITO REPRODUZIDO: previsão com origem 'staff' (inclusive horário vindo do hóspede) NÃO é autorização", () => {
    // equipe mudou só a data; o horário 18:00 tinha sido sugerido pelo hóspede; a origem virou 'staff'
    const defeito = row({ kind: "checkout", arrival_time_source: "staff", arrival_time_override: "18:00", arrival_date_override: "2026-11-12" });
    expect(deriveReservationFacts(res, [defeito]).authorizedLateCheckout).toBeNull();
    for (const source of ["staff", "guest", "ai", null]) {
      expect(deriveReservationFacts(res, [row({ kind: "checkout", arrival_time_source: source, arrival_time_override: "14:00" })]).authorizedLateCheckout).toBeNull();
    }
  });
  it("R6 · só a autorização FORMAL completa (horário + momento + autor) vale, na data de checkout da reserva", () => {
    const formal = { late_checkout_time: "15:00", late_checkout_approved_at: "2026-11-11T10:00:00Z", late_checkout_by: "u-1" };
    expect(deriveReservationFacts(res, [row({ kind: "checkout", ...formal })]).authorizedLateCheckout).toEqual({ date: "2026-11-12", time: "15:00" });
    // a data prevista do cartão não muda a data da autorização
    expect(deriveReservationFacts(res, [row({ kind: "checkout", arrival_date_override: "2026-11-20", ...formal })]).authorizedLateCheckout).toEqual({ date: "2026-11-12", time: "15:00" });
    // incompleta / revogada / inválida / em cartão de check-in ⇒ nada
    expect(deriveReservationFacts(res, [row({ kind: "checkout", ...formal, late_checkout_by: null })]).authorizedLateCheckout).toBeNull();
    expect(deriveReservationFacts(res, [row({ kind: "checkout", ...formal, late_checkout_approved_at: null })]).authorizedLateCheckout).toBeNull();
    expect(deriveReservationFacts(res, [row({ kind: "checkout", late_checkout_time: null, late_checkout_approved_at: null, late_checkout_by: null })]).authorizedLateCheckout).toBeNull();
    expect(deriveReservationFacts(res, [row({ kind: "checkout", ...formal, late_checkout_time: "25:99" })]).authorizedLateCheckout).toBeNull();
    expect(deriveReservationFacts(res, [row({ kind: "checkin", ...formal })]).authorizedLateCheckout).toBeNull();
  });
  it("liberação manual (D13) só com registro credentials_released_at no cartão de CHECK-IN; nunca presumida", () => {
    expect(deriveReservationFacts(res, [row({ status: "done", arrival_time_source: "staff" })]).checkinCard?.released).toBe(false);
    expect(deriveReservationFacts(res, [row({ credentials_released_at: "2026-11-05T10:00:00Z", credentials_released_by: "u-1" })]).checkinCard?.released).toBe(true);
    // sem autor registrado (ex.: usuário apagado) a liberação não é comprovada
    expect(deriveReservationFacts(res, [row({ credentials_released_at: "2026-11-05T10:00:00Z", credentials_released_by: null })]).checkinCard?.released).toBe(false);
    expect(deriveReservationFacts(res, [row({ credentials_released_at: "" })]).checkinCard?.released).toBe(false);
    // registro em cartão de SAÍDA não é liberação de check-in
    expect(deriveReservationFacts(res, [row({ kind: "checkout", credentials_released_at: "2026-11-05T10:00:00Z" })]).checkinCard).toBeNull();
    expect(
      deriveReservationFacts(res, [row({ kind: "checkin" }), row({ kind: "checkout", credentials_released_at: "2026-11-05T10:00:00Z", credentials_released_by: "u-1" })]).checkinCard,
    ).toEqual({ released: false, noShow: false });
    expect(deriveReservationFacts(res, []).manualReleaseSource).toBe("guest_arrival_status.credentials_released_at");
  });
});

describe("status normalizados", () => {
  it("reservas", () => {
    expect(normalizeReservationStatus("confirmed")).toBe("valid");
    expect(normalizeReservationStatus("Cancelled")).toBe("cancelled");
    expect(normalizeReservationStatus("cancelled_duplicate")).toBe("cancelled");
    expect(normalizeReservationStatus("blocked")).toBe("invalid");
    expect(normalizeReservationStatus(null)).toBe("invalid");
  });
  it("no-show", () => {
    for (const s of ["no_show", "NO-SHOW", "não compareceu", "nao_comparecera"]) expect(isNoShowStatus(s)).toBe(true);
    for (const s of ["pending", "done", null]) expect(isNoShowStatus(s)).toBe(false);
  });
});

describe("fase da hospedagem (derivada no servidor)", () => {
  const base = { exists: true, status: "confirmed", noShow: false, checkoutConfirmed: false, checkInAt: new Date("2026-11-10T18:00:00Z"), closeAt: new Date("2026-11-12T14:00:00Z") };
  it("sem reserva = inquiry; cancelada; no-show; desconhecida", () => {
    expect(deriveStayPhase({ ...base, exists: false, now: new Date() })).toBe("inquiry");
    expect(deriveStayPhase({ ...base, status: "cancelled", now: new Date() })).toBe("cancelled");
    expect(deriveStayPhase({ ...base, noShow: true, now: new Date() })).toBe("no_show");
    expect(deriveStayPhase({ ...base, status: "blocked", now: new Date() })).toBe("unknown");
    expect(deriveStayPhase({ ...base, checkInAt: null, now: new Date() })).toBe("unknown");
  });
  it("pré, durante e pós", () => {
    expect(deriveStayPhase({ ...base, now: new Date("2026-11-09T00:00:00Z") })).toBe("pre_stay");
    expect(deriveStayPhase({ ...base, now: new Date("2026-11-10T18:00:00Z") })).toBe("in_stay");
    expect(deriveStayPhase({ ...base, now: new Date("2026-11-12T14:00:01Z") })).toBe("post_checkout");
    expect(deriveStayPhase({ ...base, checkoutConfirmed: true, now: new Date("2026-11-11T00:00:00Z") })).toBe("post_checkout");
  });
});

describe("Policy Engine", () => {
  it("audiências: P sempre; G só com reserva ativa; I nunca", () => {
    expect(decideAudiences({ stayExists: false, status: null, phase: "inquiry", noShow: false }).audiences).toEqual(["P"]);
    expect(decideAudiences({ stayExists: true, status: "confirmed", phase: "pre_stay", noShow: false }).audiences).toEqual(["P", "G"]);
    expect(decideAudiences({ stayExists: true, status: "confirmed", phase: "in_stay", noShow: false }).audiences).toEqual(["P", "G"]);
    for (const phase of ["post_checkout", "cancelled", "no_show", "unknown"] as const) {
      expect(decideAudiences({ stayExists: true, status: "confirmed", phase, noShow: false }).audiences).toEqual(["P"]);
    }
    expect(decideAudiences({ stayExists: true, status: "confirmed", phase: "in_stay", noShow: true }).audiences).toEqual(["P"]);
  });
  it("D9 → vocabulário do engine (permitido / negado / insuficiente / inconsistente)", () => {
    const r = (reason: string, allowed = false) => ({ decision: allowed ? "allow" : "deny", allowed, reason, evaluatedAt: "x" }) as never;
    expect(evaluateCredentialAccess(r("within_release_window", true)).kind).toBe("allowed");
    expect(evaluateCredentialAccess(r("no_show")).kind).toBe("denied");
    expect(evaluateCredentialAccess(r("missing_timezone")).kind).toBe("insufficient_context");
    expect(evaluateCredentialAccess(r("invalid_operational_state")).kind).toBe("inconsistent_context");
  });
  it("chamado aberto NUNCA bloqueia a conversa: só o assunto relacionado fica com a equipe", () => {
    const open = [{ id: "c1", source: "conversation_status" as const, topic: null, status: "needs_human" }];
    expect(evaluateCaseGate(open, "independent")).toEqual({ aiMayAnswer: true, humanOwnsTopic: false, needsClarification: false, caseId: null });
    expect(evaluateCaseGate(open, "related")).toEqual({ aiMayAnswer: true, humanOwnsTopic: true, needsClarification: false, caseId: "c1" });
    expect(evaluateCaseGate(open, "ambiguous")).toMatchObject({ aiMayAnswer: true, humanOwnsTopic: false, needsClarification: true });
    expect(evaluateCaseGate(open, "new")).toMatchObject({ aiMayAnswer: true, humanOwnsTopic: false });
    expect(evaluateCaseGate([], "related")).toMatchObject({ aiMayAnswer: true, humanOwnsTopic: false });
  });
});
