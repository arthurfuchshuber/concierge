import { describe, expect, it } from "vitest";
import {
  buildDecisionSpec,
  canBecomeKnowledge,
  guestWantsEarlyCheckin,
} from "../human-loop/decision-options";
import { detectStayCompletion } from "../stay-completion-detect";

describe("decisões por botões", () => {
  it("dúvida de comodidade vira botões e pode virar conhecimento", () => {
    const s = buildDecisionSpec("Oi, tem ferro de passar?");
    expect(s.kind).toBe("fact");
    expect(s.options).toContain("Não tem");
    expect(canBecomeKnowledge(s.kind)).toBe(true);
  });
  it("decisão operacional nunca vira conhecimento", () => {
    expect(canBecomeKnowledge("operational")).toBe(false);
  });
  it("chegada às 09:09 antes do check-in das 15h é pedido de antecipação", () => {
    expect(guestWantsEarlyCheckin(["chego amanhã por volta das 09:09 da manhã em foz!"], 15)).toBe(true);
  });
  it("chegada depois do check-in não é antecipação", () => {
    expect(guestWantsEarlyCheckin(["chegamos às 18h"], 15)).toBe(false);
  });
  it("'Deu tudo certo!' confirma check-in", () => {
    expect(detectStayCompletion("Deu tudo certo!", "")).toBe("checkin");
  });
});
