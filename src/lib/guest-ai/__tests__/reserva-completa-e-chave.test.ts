import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { RESERVATION_CANCELLATION_COLUMNS, RESERVATION_CARD_COLUMNS } from "@/lib/guest-ai/data/projections";

describe("dados da reserva para a IA (23/11/2026)", () => {
  it("projeção lê canal, titular e idioma; cards trazem previsões sem custo de limpeza", () => {
    expect(RESERVATION_CANCELLATION_COLUMNS).toEqual(expect.arrayContaining(["ota_name", "guest_hint", "language:raw_payload->customer->>language"]));
    expect(RESERVATION_CARD_COLUMNS).toEqual(expect.arrayContaining(["arrival_time_override", "late_checkout_time", "status"]));
    expect(RESERVATION_CARD_COLUMNS.join()).not.toMatch(/price|cents/);
  });
});

describe("local de devolução da chave (caso Ricardo, 19/11)", () => {
  it("só o local do dossiê; sem fonte encaminha; combinado da equipe prevalece", () => {
    const sys = buildSystemPrompt("airbnb");
    expect(sys).toMatch(/Onde deixar chave, controle ou tag na saída/);
    expect(sys).toMatch(/Nunca invente outro lugar da casa/);
    expect(sys).toMatch(/vale o que a equipe combinou/);
  });
});
