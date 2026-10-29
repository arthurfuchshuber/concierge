import { describe, expect, it } from "vitest";
import { previousTurnSucceeded, renderPrecedents, scrubExample, selectPrecedents, type PrecedentMatch } from "../memory/precedents";

const base: PrecedentMatch = {
  id: "p1", scope: "tenant", propertyId: null, situation: "Número de hóspedes diverge da reserva",
  conduct: "Orientar ajuste na plataforma", exampleReply: null, why: null, source: "autonomous_success",
  confidence: 0.72, successCount: 1, failureCount: 0, similarity: 0.8,
};

describe("repertório de precedentes", () => {
  it("só aprende quando a IA resolveu sozinha e o hóspede seguiu sem reclamar", () => {
    const ok = { previousEscalated: false, previousApproved: true, previousConfidence: 0.99, currentSentiment: "neutro", currentMessage: "No total, 4 pessoas" };
    expect(previousTurnSucceeded(ok)).toBe(true);
    expect(previousTurnSucceeded({ ...ok, previousEscalated: true })).toBe(false);
    expect(previousTurnSucceeded({ ...ok, currentSentiment: "negativo" })).toBe(false);
    expect(previousTurnSucceeded({ ...ok, currentMessage: "não foi isso que perguntei" })).toBe(false);
  });

  it("descarta situação pouco parecida e precedente com mais falhas que acertos", () => {
    expect(selectPrecedents([{ ...base, similarity: 0.4 }])).toHaveLength(0);
    expect(selectPrecedents([{ ...base, confidence: 0.3, successCount: 0, failureCount: 6 }])).toHaveLength(0);
    expect(selectPrecedents([base])).toHaveLength(1);
  });

  it("precedente nunca autoriza preço nem exceção", () => {
    expect(renderPrecedents([base])).toContain("não autoriza preço, desconto, exceção de horário");
  });

  it("remove código de reserva e telefone dos exemplos", () => {
    const s = scrubExample("Reserva HMJWR89CZ2, tel 5511989222625");
    expect(s).not.toContain("HMJWR89CZ2");
    expect(s).not.toContain("5511989222625");
  });
});
