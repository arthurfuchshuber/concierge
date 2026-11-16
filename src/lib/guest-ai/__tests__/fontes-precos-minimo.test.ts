import { describe, expect, it } from "vitest";
import { guestFacingPrices, pickNormalized } from "@/lib/guest-ai/data/listing-normalized";
import { assessPeriod, periodFactValue, type StayRules } from "@/lib/guest-ai/calendar-occupancy";

// Linhas reais do anúncio "Apê Aconchegante" (produção, 16/11/2026).
const PRECOS = [
  "Diária base: R$ 1000,00",
  "Hóspedes incluídos na diária: 4",
  "Por hóspede adicional: R$ 90,00 por noite",
  "Diária de fim de semana: R$ 1000,00",
  "PASS_THROUGH_MANAGEMENT_FEE R$ 0,00 por reserva",
  "Taxa de limpeza R$ 260,00 por reserva",
  "Taxa de pet R$ 90,00 por noite por pet",
].join("\n");

describe("preços do anúncio que chegam à IA", () => {
  it("tira diária base, diária de fim de semana e repasse interno; mantém as taxas cobradas", () => {
    const out = guestFacingPrices(PRECOS);
    expect(out).not.toMatch(/Di[aá]ria base|fim de semana|PASS_THROUGH|1000/);
    expect(out).toContain("Taxa de limpeza R$ 260,00 por reserva");
    expect(out).toContain("Por hóspede adicional: R$ 90,00 por noite");
    expect(out).toContain("Taxa de pet R$ 90,00 por noite por pet");
    expect(out).toContain("Hóspedes incluídos na diária: 4");
  });
  it("o recorte vale no caminho único de leitura do anúncio (pickNormalized)", () => {
    const n = pickNormalized({ facts: [{ key: "precos", title: "Preços", content: PRECOS }, { key: "regras", title: "Regras", content: "Diária base: texto livre" }] }, null);
    expect(n!.facts.find((f) => f.key === "precos")!.content).not.toContain("Diária base");
    // só o fato de preços é recortado
    expect(n!.facts.find((f) => f.key === "regras")!.content).toBe("Diária base: texto livre");
  });
});

describe("mínimo de noites: datas da própria consulta do Airbnb", () => {
  // Caso Larissa (16/11/2026): Studio 103, consulta de 1 noite (18→19/11); a regra sincronizada dizia 2.
  const rules: StayRules = { defaultMinNights: 2, seasonal: [{ start: "2026-11-02", end: "2026-11-18", minNights: 2 }], dayOfWeekMin: null, maxDaysNotice: 270 };
  const occ = { occupiedRanges: [], today: "2026-11-16" };
  const period = { checkin: "2026-11-18", checkout: "2026-11-19", nights: 1 };

  it("sem ser a consulta, a regra sincronizada vale (abaixo do mínimo ⇒ não reservável)", () => {
    const a = assessPeriod(occ, period, rules);
    expect(a.minNights).toBe(2);
    expect(a.meetsMinNights).toBe(false);
    expect(a.bookable).toBe("nao");
  });
  it("as datas da consulta já foram aceitas pelo Airbnb com as regras condicionais: cumpre o mínimo", () => {
    const a = assessPeriod(occ, period, rules, { platformAccepted: true });
    expect(a.meetsMinNights).toBe(true);
    expect(a.minNights).toBe(1);
    expect(a.bookable).toBe("sim");
    const f = periodFactValue(a);
    expect(f["cumpre_minimo"]).toBe(true);
    expect(String(f["regras_de_estadia"])).toMatch(/Airbnb já as aceitou/);
  });
  it("noite ocupada continua impedindo, mesmo nas datas da consulta", () => {
    const busy = { occupiedRanges: [{ checkin: "2026-11-18", checkout: "2026-11-20", status: "confirmed" }], today: "2026-11-16" } as never;
    expect(assessPeriod(busy, period, rules, { platformAccepted: true }).bookable).toBe("nao");
  });
  it("datas passadas nunca contam como aceitas", () => {
    const a = assessPeriod({ occupiedRanges: [], today: "2026-11-20" }, period, rules, { platformAccepted: true });
    expect(a.platformAccepted).toBeUndefined();
    expect(a.bookable).toBe("nao");
  });
});

import { checkReplyAgainstDecision } from "@/lib/guest-ai/validation/commitment-text";
import { calendarShowsAvailability } from "@/lib/guest-ai/validation/semantic-validator";

describe("disponibilidade com fonte no calendário (caso Pamela, 16/11/2026)", () => {
  // Pamela escreveu "19 a 22/11"; a noite de 19 estava ocupada; a consulta dela era 20→23, livre.
  const reply = "Boa noite, Pamela! A noite do dia 19 já está reservada, mas o apartamento está disponível para as datas de 20 a 23 de novembro, que você selecionou.";
  const decision = { reply, commitmentKinds: [], handoff: { needed: false }, promisedTimes: [] } as never;
  const ev = { credentialReleaseAllowed: false, lateCheckoutAuthorizedTime: null, humanOwnershipActive: false };
  const ctx = { officialCheckin: "15:00", officialCheckout: "11:00", inquiry: true };

  it("sem calendário do sistema, afirmar disponibilidade segue recusado", () => {
    expect(checkReplyAgainstDecision(decision, ctx, ev).blocks).toContain("text_commitment_undeclared");
  });
  it("com o calendário mostrando noites livres, a afirmação tem fonte e passa", () => {
    expect(checkReplyAgainstDecision(decision, ctx, { ...ev, calendarAvailability: true }).blocks).not.toContain("text_commitment_undeclared");
  });
  it("calendário: só conta com noites livres e reserváveis consultadas pelo sistema", () => {
    expect(calendarShowsAvailability(undefined)).toBe(false);
    expect(calendarShowsAvailability({ status: "unavailable" })).toBe(false);
    const base = { status: "available", propertyId: "p", today: "2026-11-16", windowStart: "2026-11-16", windowEnd: "2026-12-16", occupiedRanges: [], sameDayTurnovers: [], stay: null, mentionedDates: [] } as never as Record<string, unknown>;
    expect(calendarShowsAvailability(base as never)).toBe(false);
    expect(calendarShowsAvailability({ ...base, requested: { bookable: "nao" }, nearestWindows: [] } as never)).toBe(false);
    expect(calendarShowsAvailability({ ...base, requested: { bookable: "nao" }, nearestWindows: [{ checkin: "2026-11-20", checkout: "2026-11-23", nights: 3 }] } as never)).toBe(true);
    expect(calendarShowsAvailability({ ...base, requested: { bookable: "sim" } } as never)).toBe(true);
  });
});
