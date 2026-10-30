import { describe, expect, it } from "vitest";
import { cardSilencesAi } from "../human-loop/silence-gate";

const now = Date.parse("2026-10-29T12:12:40Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("cardSilencesAi", () => {
  it("cartão de salvar regra (fact) nunca cala a IA", () => {
    expect(cardSilencesAi({ created_at: ago(60_000), context_snapshot: { decision: { kind: "fact" } } }, now)).toBe(false);
  });
  it("cartão de aprendizado nunca cala a IA", () => {
    expect(cardSilencesAi({ created_at: ago(60_000), context_snapshot: { host_learning: true } }, now)).toBe(false);
  });
  it("decisão operacional de menos de 2h cala", () => {
    expect(cardSilencesAi({ created_at: ago(119 * 60_000), context_snapshot: { decision: { kind: "action" } } }, now)).toBe(true);
  });
  it("decisão operacional de mais de 2h não cala", () => {
    expect(cardSilencesAi({ created_at: ago(121 * 60_000), context_snapshot: { decision: { kind: "action" } } }, now)).toBe(false);
  });
});

import { directQuestion } from "../human-loop/handoff-draft.server";
describe("directQuestion", () => {
  it("remove humor do hóspede e vai direto à dúvida", () => {
    expect(directQuestion("Andressa, satisfeita e bem-humorada, quer saber onde comprou o cobertor?")).toBe("quer saber onde comprou o cobertor?");
  });
  it("remove causa interna e confiança", () => {
    expect(directQuestion("a IA ficou em dúvida (confiança 40%). x. Pergunta: Onde fica a vaga?")).toBe("Onde fica a vaga?");
  });
});
