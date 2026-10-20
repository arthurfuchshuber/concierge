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

import { isTakeoverOption, TAKEOVER_OPTION } from "../human-loop/decision-options";
describe("assumir a conversa", () => {
  it("dúvida aberta oferece 'Eu assumo a conversa' e ela é reconhecida", () => {
    const s = buildDecisionSpec("Qual a senha do wifi?");
    expect(s.options).toContain(TAKEOVER_OPTION);
    expect(isTakeoverOption(TAKEOVER_OPTION)).toBe(true);
    expect(isTakeoverOption("Sim")).toBe(false);
  });
});

import { buildDecisionSpec as build2, readDecisionSpec as read2 } from "@/lib/ai/human-loop/decision-options";
describe("perguntas abertas", () => {
  it("dias de coleta de lixo não recebem Sim/Não", () => {
    const s = build2("Quais são os dias da coleta de lixo aqui na rua?");
    expect(s.options).toEqual([]);
    expect(read2({ decision: s })).toBeNull();
  });
  it("pergunta de amenidade mantém botões", () => {
    expect(build2("Tem ferro de passar?").options).toContain("Não tem");
  });
});
