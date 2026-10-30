import { describe, expect, it } from "vitest";
import { previousTurnSucceeded, renderPrecedents, scrubExample, selectPrecedents, shouldSupersede, type PrecedentMatch } from "../memory/precedents";

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

describe("recência, camadas e fase da estadia", () => {
  const older = { ...base, id: "old", topic: "divergencia_numero_hospedes", conduct: "Escalar para a equipe", updatedAt: "2026-10-01T00:00:00Z" };
  const newer = { ...base, id: "new", topic: "Divergência número hóspedes", conduct: "Orientar ajuste na plataforma", updatedAt: "2026-10-29T00:00:00Z" };

  it("mesmo assunto e camada: só o mais recente chega à IA", () => {
    const out = selectPrecedents([older, newer]);
    expect(out.map((p) => p.id)).toEqual(["new"]);
  });

  it("imóvel vence conta, mesmo sendo mais antigo", () => {
    const prop = { ...older, id: "prop", scope: "property" as const };
    expect(selectPrecedents([prop, newer]).map((p) => p.id)).toEqual(["prop"]);
  });

  it("assuntos diferentes convivem", () => {
    expect(selectPrecedents([older, { ...newer, topic: "pedido_senha_antecipado" }])).toHaveLength(2);
  });

  it("precedente de pré-check-in não vale no dia do check-in", () => {
    const pre = { ...base, phases: ["pre_checkin"] };
    expect(selectPrecedents([pre], 3, "checkin_day")).toHaveLength(0);
    expect(selectPrecedents([pre], 3, "pre_checkin")).toHaveLength(1);
    expect(selectPrecedents([{ ...base, phases: [] }], 3, "checkin_day")).toHaveLength(1);
  });

  it("conduta diferente no mesmo assunto e camada substitui a vigente", () => {
    expect(shouldSupersede({ sameTopic: true, sameLayer: true, similarity: 0.7 })).toBe(true);
    expect(shouldSupersede({ sameTopic: true, sameLayer: true, similarity: 0.95 })).toBe(false);
    expect(shouldSupersede({ sameTopic: false, sameLayer: true, similarity: 0.7 })).toBe(false);
  });
});
