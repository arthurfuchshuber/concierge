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
