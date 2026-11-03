/**
 * B2.5 · `ai_paused` como veto absoluto. Com a IA pausada: nunca resposta ao hóspede; emergência
 * comprovada vira só `urgent_internal_alert` (intenção estruturada, `notified: false`); sem evidência,
 * reclamação comum ou estado ilegível ⇒ nenhuma resposta.
 */
import { describe, expect, it } from "vitest";
import { runTurnChain, evaluatePausedDecision } from "@/lib/guest-ai/turn-chain";
import { deriveHumanOwnership } from "@/lib/guest-ai/orchestrator/case-ownership";
import { parseDecision } from "@/lib/guest-ai/orchestrator/decision";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { currentRef, harness, history, turn, v4 } from "./helpers/b23-chain";
import { burst, ownershipRow } from "./helpers/b25-fixtures";

const T0 = Date.parse("2026-11-03T12:00:00Z");
const PAUSED = ownershipRow({ ai_paused: true });
const quiet = (over: Record<string, unknown> = {}) => v4({ strategy: "silence", reply: "", shouldReply: false, intents: ["acknowledgment"], groundedOn: [], ...over });
const emergency = (over: Record<string, unknown> = {}) =>
  quiet({ strategy: "handoff", intents: ["emergency"], handoff: { needed: true, question: "Hóspede relata cheiro forte de gás na cozinha", urgency: "high" }, groundedOn: [currentRef()], ...over });
const run = async (decision: unknown, own = PAUSED, over: Parameters<typeof harness>[1] = {}, batch?: ReturnType<typeof burst>) => {
  const h = harness(decision, { now: () => T0, loadConversationOwnership: async () => own, ...(batch ? { loadHistory: async () => batch.historyResult } : {}), ...over });
  const r = await runTurnChain({ turn: turn(), traceId: "p-1", ...(batch ? { batch: batch.batch } : {}) }, h.deps);
  return { r, h };
};

describe("B2.5 · pausa: veto absoluto à resposta", () => {
  it("tentativa de resposta durante a pausa ⇒ recusada (nenhum texto), mesmo com resposta 'perfeita'", async () => {
    const { r } = await run(v4());
    expect(r).toMatchObject({ kind: "refused", code: "reply_during_pause", delivery: "not_sent", effectsExecuted: false });
    expect("text" in r).toBe(false);
  });
  it("shouldReply=true com reply vazio ⇒ também recusado", async () => {
    expect((await run(quiet({ shouldReply: true }))).r).toMatchObject({ code: "reply_during_pause" });
  });
  it("silêncio ⇒ `paused`, alerta 'none'", async () => {
    const { r } = await run(quiet());
    expect(r.kind).toBe("paused");
    expect(r.audit.checks.pause).toBe("active");
    expect(r.audit.checks.alert).toBe("none");
  });
  it("compromisso, intenção de credencial ou estratégia de resposta durante a pausa ⇒ decisão inválida", async () => {
    expect((await run(quiet({ commitments: ["x"], commitmentKinds: ["team_relay"] }))).r).toMatchObject({ code: "paused_decision_invalid" });
    expect((await run(quiet({ strategy: "clarify" }))).r).toMatchObject({ code: "paused_decision_invalid" });
  });
  it("pausa temporária vigente bloqueia; vencida não", async () => {
    expect((await run(v4(), ownershipRow({ paused_until: "2026-11-03T13:00:00Z" }))).r).toMatchObject({ code: "reply_during_pause" });
    expect((await run(v4(), ownershipRow({ paused_until: "2026-11-03T11:00:00Z" }))).r.kind).toBe("reply");
  });
  it("estado de pausa ilegível ⇒ desconhecido ⇒ recusa no contexto, antes do modelo", async () => {
    for (const own of [ownershipRow({ paused_until: "amanhã" }), ownershipRow({ ai_paused: "sim" as never })]) {
      const { r, h } = await run(v4(), own);
      expect(r).toMatchObject({ kind: "refused", stage: "context", code: "human_ownership_inconsistent" });
      expect(h.calls.generate).toBe(0);
    }
    expect(deriveHumanOwnership(ownershipRow({ paused_until: "2026-11-04T00:00:00Z" }), "relógio-quebrado")).toMatchObject({ state: "unknown", aiPausedByTeam: true });
  });
  it("falha na leitura da pausa ⇒ técnico/recusa, nunca resposta", async () => {
    const { r } = await run(v4(), PAUSED, { loadConversationOwnership: async () => { throw new Error("db"); } });
    expect(["refused", "technical_error"]).toContain(r.kind);
  });
});

describe("B2.5 · emergência durante a pausa ⇒ só alerta interno estruturado", () => {
  it("emergência com encaminhamento urgente e evidência na mensagem do hóspede ⇒ urgent_internal_alert (nada notificado)", async () => {
    const { r } = await run(emergency(), PAUSED, { loadHistory: async () => history("Socorro, cheiro forte de gás na cozinha!") });
    expect(r.kind).toBe("urgent_internal_alert");
    if (r.kind !== "urgent_internal_alert") return;
    expect(r.alert).toEqual({ kind: "urgent_internal_alert", priority: "critical", conversationId: turn().conversationId, propertyId: "p1", tenantId: "t1", evidenceRefs: [currentRef()], notified: false, delivery: "not_sent", effectsExecuted: false });
    expect(Object.isFrozen(r.alert)).toBe(true);
    expect("text" in r).toBe(false);
    expect(r.audit.checks.alert).toBe("raised");
  });
  it("emergência sem evidência citada ⇒ pausa com 'insufficient_evidence' (nunca resposta)", async () => {
    const { r } = await run(emergency({ groundedOn: ["ctx:checkin_oficial"] }));
    expect(r.kind).toBe("paused");
    expect(r.audit.checks.alert).toBe("insufficient_evidence");
  });
  it("emergência sem urgência alta ou sem pergunta ⇒ pausa com evidência insuficiente", async () => {
    expect((await run(emergency({ handoff: { needed: true, question: "q", urgency: "normal" } }))).r.audit.checks.alert).toBe("insufficient_evidence");
    expect((await run(emergency({ handoff: { needed: false, question: null, urgency: null } }))).r.kind).toBe("paused");
  });
  it("reclamação/desconforto sem emergência ⇒ pausa (não vira alerta)", async () => {
    const { r } = await run(quiet({ strategy: "handoff", intents: ["problem_report"], handoff: { needed: true, question: "Barulho do vizinho", urgency: "high" }, groundedOn: [currentRef()] }));
    expect(r.kind).toBe("paused");
    expect(r.audit.checks.alert).toBe("none");
  });
  it("emergência com texto ao hóspede ⇒ recusada (alerta não autoriza resposta)", async () => {
    expect((await run(emergency({ reply: "Saia do imóvel agora, já avisei a equipe!", shouldReply: true }))).r).toMatchObject({ code: "reply_during_pause" });
  });
  it("pergunta interna com segredo ⇒ decisão inválida (guard)", async () => {
    const d = parseDecision(emergency({ handoff: { needed: true, question: "senha do cofre 4471", urgency: "high" } })) as unknown as { ok: true; decision: never };
    const unsafe = { scan: () => ({ status: "blocked" as const }) } as never;
    expect(evaluatePausedDecision(d.decision, new Set([currentRef()]), null, unsafe)).toEqual({ kind: "refused", code: "paused_decision_invalid" });
    expect(evaluatePausedDecision(d.decision, new Set([currentRef()]), null, null)).toEqual({ kind: "refused", code: "paused_decision_invalid" });
  });
  it("evidência no lote: refs de mensagens ANTIGAS (fora do lote) não sustentam alerta; do lote, sim", async () => {
    const b = burst(["Oi", "Tem cheiro de gás aqui", "Muito forte", "Socorro"]);
    const inBatch = await run(emergency({ groundedOn: ["hist:guest:h2"] }), PAUSED, {}, b);
    expect(inBatch.r.kind).toBe("urgent_internal_alert");
    const d = parseDecision(emergency({ groundedOn: ["hist:guest:h1"] })) as unknown as { ok: true; decision: never };
    const ids = new Set(["hist:guest:h1", "hist:guest:h2", "hist:guest:h3"]);
    const oneMsg = { ...b.batch, size: 2 } as never;
    expect(evaluatePausedDecision(d.decision, ids, oneMsg, SECRET_SCRUBBER)).toEqual({ kind: "paused", insufficientEvidence: true });
  });
  it("o alerta não depende de nenhuma porta de notificação (não existe porta de efeito na cadeia)", async () => {
    const { r, h } = await run(emergency(), PAUSED, { loadHistory: async () => history("Gás vazando!") });
    expect(r.kind).toBe("urgent_internal_alert");
    expect(Object.keys(h.deps).some((k) => /notif|send|dispatch|ticket|alert/i.test(k))).toBe(false);
  });
});
