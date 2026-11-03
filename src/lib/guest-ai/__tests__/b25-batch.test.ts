/**
 * B2.5 · Mensagens em rajada: contrato `GuestMessageBatch`, regras de agrupamento (fail-closed) e
 * UMA única decisão por lote na cadeia. Sem coletor, fila, timer ou debounce (B3).
 */
import { describe, expect, it } from "vitest";
import { BATCH_LIMITS, DEBOUNCE_REFERENCE, buildGuestMessageBatch, checkDebounceConfig, isIssuedBatch } from "@/lib/guest-ai/batch/message-batch";
import { runTurnChain } from "@/lib/guest-ai/turn-chain";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { CONV, MSG, harness, turn, v4 } from "./helpers/b23-chain";
import { row } from "./helpers/b21-fixtures";
import { BATCH_SCOPE, M1, M2, M3, batchMsg, burst } from "./helpers/b25-fixtures";

const T = (s: number) => `2026-11-03T10:00:${String(s).padStart(2, "0")}.000Z`;
const build = (messages: ReturnType<typeof batchMsg>[], over: Partial<Parameters<typeof buildGuestMessageBatch>[0]> = {}) =>
  buildGuestMessageBatch({ scope: BATCH_SCOPE, messages, alreadyAnswered: [], closed: true, ...over });

describe("B2.5 · contrato do lote", () => {
  it("mensagens em ordem: preserva id, texto original, instante e posição; id determinístico; emitido e congelado", () => {
    const r = build([batchMsg(M1, "Oi", T(0)), batchMsg(M2, "Tenho uma dúvida", T(4)), batchMsg(M3, "O estacionamento é coberto?", T(9))]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.batch.messages).toEqual([
      { id: M1, text: "Oi", createdAt: T(0), position: 0 },
      { id: M2, text: "Tenho uma dúvida", createdAt: T(4), position: 1 },
      { id: M3, text: "O estacionamento é coberto?", createdAt: T(9), position: 2 },
    ]);
    expect(r.batch).toMatchObject({ size: 3, firstMessageId: M1, latestMessageId: M3, completeness: "closed", closure: { reason: "caller_closed" }, conversationId: CONV, tenantId: "t1" });
    expect(r.batch.batchId).toMatch(/^batch:[0-9a-f]{8}$/);
    expect(isIssuedBatch(r.batch)).toBe(true);
    expect(isIssuedBatch({ ...r.batch })).toBe(false);
    expect(Object.isFrozen(r.batch.messages[0])).toBe(true);
    const again = build([batchMsg(M3, "O estacionamento é coberto?", T(9)), batchMsg(M1, "Oi", T(0)), batchMsg(M2, "Tenho uma dúvida", T(4))]);
    expect(again.ok && again.batch.batchId).toBe(r.batch.batchId);
  });
  it("fora de ordem ⇒ ordenado pelo instante; empate desfeito pelo id (estável)", () => {
    const r = build([batchMsg(M3, "c", T(5)), batchMsg(M2, "b", T(5)), batchMsg(M1, "a", T(1))]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.batch.messages.map((m) => m.id)).toEqual([M1, M2, M3]);
  });
  it("duplicata exata é removida e registrada; mesmo id com conteúdo diferente recusa o lote", () => {
    const ok = build([batchMsg(M1, "Oi", T(0)), batchMsg(M1, "Oi", T(0)), batchMsg(M2, "?", T(3))]);
    expect(ok.ok && ok.batch.size).toBe(2);
    expect(ok.ok && ok.batch.duplicatesRemoved).toEqual([M1]);
    expect(build([batchMsg(M1, "Oi", T(0)), batchMsg(M1, "Olá", T(0))])).toEqual({ ok: false, reason: "duplicate_conflict" });
  });
  it.each<[string, Parameters<typeof batchMsg>[3], string]>([
    ["outro remetente", { senderId: "outro" }, "other_sender"],
    ["outra conversa", { conversationId: "99999999-9999-4999-8999-999999999999" }, "cross_conversation"],
    ["outro imóvel", { propertyId: "p9" }, "cross_property"],
    ["outro tenant", { tenantId: "t2" }, "cross_tenant"],
    ["outro canal", { channel: "whatsapp" }, "cross_channel"],
    ["mensagem da equipe", { senderRole: "team" }, "non_guest_message"],
    ["mensagem da IA", { senderRole: "ai" }, "non_guest_message"],
    ["já processada (estado comprovado)", { processing: "answered" }, "already_processed"],
    ["instante inválido", { createdAt: "ontem" }, "invalid_timestamp"],
  ])("%s ⇒ lote inteiro recusado (%s)", (_n, over, reason) => {
    expect(build([batchMsg(M1, "Oi", T(0)), batchMsg(M2, "x", T(2), over)])).toEqual({ ok: false, reason });
  });
  it("já respondida pela fonte do chamador, lote vazio, lote não encerrado (incompleto) e limites", () => {
    expect(build([batchMsg(M1, "Oi", T(0))], { alreadyAnswered: [M1] })).toEqual({ ok: false, reason: "already_processed" });
    expect(build([])).toEqual({ ok: false, reason: "empty_batch" });
    expect(build([batchMsg(M1, "Oi", T(0))], { closed: false })).toEqual({ ok: false, reason: "batch_not_closed" });
    const many = Array.from({ length: BATCH_LIMITS.maxMessages + 1 }, (_, i) => batchMsg(`m-${String(i).padStart(3, "0")}`, "x", T(i % 60)));
    expect(build(many)).toEqual({ ok: false, reason: "too_many_messages" });
    expect(build([batchMsg(M1, "x".repeat(BATCH_LIMITS.maxMessageChars + 1), T(0))])).toEqual({ ok: false, reason: "message_too_large" });
    expect(build([batchMsg(M1, "x".repeat(3_000), T(0))], { limits: { maxTotalChars: 2_000 } })).toEqual({ ok: false, reason: "batch_too_large" });
    // o chamador não consegue elevar limites acima dos tetos
    expect(build(Array.from({ length: 51 }, (_, i) => batchMsg(`n-${i}`, "x", T(i % 60))), { limits: { maxMessages: 999 } })).toEqual({ ok: false, reason: "too_many_messages" });
  });
  it("debounce é só contrato (B3): janela configurável na faixa 8–15 s, sem constante rígida", () => {
    expect(DEBOUNCE_REFERENCE).toEqual({ quietWindowMs: 10_000, minQuietWindowMs: 8_000, maxQuietWindowMs: 15_000 });
    expect(checkDebounceConfig({ quietWindowMs: 12_000, maxWaitMs: 45_000, maxMessages: 20, maxTotalChars: 8_000, perChannel: { airbnb: { quietWindowMs: 15_000 } } })).toBe("ok");
    expect(checkDebounceConfig({ quietWindowMs: 3_000, maxWaitMs: 45_000, maxMessages: 20, maxTotalChars: 8_000 })).toBe("quiet_window_out_of_range");
    expect(checkDebounceConfig({ quietWindowMs: 10_000, maxWaitMs: 45_000, maxMessages: 20, maxTotalChars: 8_000, perChannel: { whatsapp: { quietWindowMs: 20_000 } } })).toBe("quiet_window_out_of_range");
    expect(checkDebounceConfig({ quietWindowMs: 10_000, maxWaitMs: 5_000, maxMessages: 20, maxTotalChars: 8_000 })).toBe("max_wait_below_quiet_window");
    expect(checkDebounceConfig({ quietWindowMs: 10_000, maxWaitMs: 30_000, maxMessages: 0, maxTotalChars: 8_000 })).toBe("limits_invalid");
  });
});

describe("B2.5 · cadeia: um lote ⇒ uma única decisão", () => {
  const multi = v4({ intents: ["acknowledgment", "informational_query"], reply: "O estacionamento é coberto e comporta caminhonetes de porte médio.", groundedOn: ["ctx:fase"] });
  it("rajada de 4 mensagens: um prompt, uma chamada ao modelo, um resultado; mensagens marcadas e em ordem", async () => {
    const { batch, historyResult } = burst();
    const h = harness(multi, { loadHistory: async () => historyResult });
    const r = await runTurnChain({ turn: turn(), traceId: "batch-1", batch }, h.deps);
    expect(r.kind).toBe("reply");
    expect(h.calls.generate).toBe(1);
    expect(r.audit.checks.batch).toEqual({ batchId: batch.batchId, size: 4 });
    const user = h.calls.prompts[0]!.messages[0]!.content;
    expect((user.match(/"lote_atual":true/g) ?? []).length).toBe(4);
    expect(user).toContain("formam um único turno");
    expect(user.indexOf("Tenho uma d")).toBeLessThan(user.indexOf("caminhonete"));
  });
  it("saudação + pergunta e incidente + pergunta independente: uma resposta ao conjunto", async () => {
    for (const texts of [["Oi!", "Boa tarde", "Tudo bem?", "Qual o horário do check-in?"], ["O chuveiro está frio", "Aproveitando,", "vocês têm", "estacionamento?"]] as const) {
      const { batch, historyResult } = burst(texts as never);
      const h = harness(v4({ intents: ["acknowledgment", "informational_query", "problem_report"], strategy: "answer_and_handoff", handoff: { needed: true, question: "Chuveiro frio relatado", urgency: "normal" }, reply: "Check-in às 15h; o chuveiro já foi encaminhado para a equipe olhar." }), { loadHistory: async () => historyResult });
      const r = await runTurnChain({ turn: turn(), traceId: "batch-2", batch }, h.deps);
      expect(h.calls.generate).toBe(1);
      expect(["reply", "refused"]).toContain(r.kind); // sempre UMA decisão final
    }
  });
  it("lote forjado, de outro escopo ou cujo último id não é o do turno ⇒ recusa (nenhuma decisão independente por mensagem)", async () => {
    const { batch, historyResult } = burst();
    const h = harness(multi, { loadHistory: async () => historyResult });
    expect((await runTurnChain({ turn: turn(), traceId: "b", batch: { ...batch } as never }, h.deps))).toMatchObject({ kind: "refused", code: "batch_not_validated" });
    expect((await runTurnChain({ turn: turn({ messageId: M2 }), traceId: "b", batch }, h.deps))).toMatchObject({ kind: "refused", code: "batch_turn_mismatch" });
    expect((await runTurnChain({ turn: turn({ tenantId: "t9" }), traceId: "b", batch }, h.deps))).toMatchObject({ kind: "refused", code: "batch_scope_mismatch" });
    expect(h.calls.generate).toBe(0);
  });
  it("histórico com resposta da equipe no meio do lote (algo já atendido) ⇒ batch_history_mismatch", async () => {
    const { batch } = burst();
    const mixed = normalizeHistory(
      [
        row({ id: M1, created_at: "2026-11-03T10:00:00Z", content: "Oi" }),
        row({ id: M2, created_at: "2026-11-03T10:00:04Z", content: "Tenho uma dúvida" }),
        row({ created_at: "2026-11-03T10:00:06Z", role: "assistant", sender_type: "human", content: "Pode falar!" }),
        row({ id: M3, created_at: "2026-11-03T10:00:09Z", content: "O estacionamento é coberto?" }),
        row({ id: MSG, created_at: "2026-11-03T10:00:15Z", content: "E cabe uma caminhonete?" }),
      ],
      { conversationId: CONV, currentMessageId: MSG },
    );
    const h = harness(multi, { loadHistory: async () => mixed });
    expect(await runTurnChain({ turn: turn(), traceId: "b", batch }, h.deps)).toMatchObject({ kind: "refused", stage: "history", code: "batch_history_mismatch" });
  });
  it("FreeTextGuard: por mensagem (proveniência do achado) E no conjunto (segredo dividido entre mensagens)", async () => {
    const withSecret = burst(["Oi", "A senha do portão é 4821, certo?", "Vamos chegar tarde", "Tem estacionamento?"]);
    const h = harness(multi, { loadHistory: async () => withSecret.historyResult });
    const ok = await runTurnChain({ turn: turn(), traceId: "g1", batch: withSecret.batch }, h.deps);
    expect(ok.kind).toBe("reply");
    expect(JSON.stringify(h.calls.prompts)).not.toContain("4821");
    const split = burst(["Oi", "A senha do cofre é", "7351", "ok?"]);
    const h2 = harness(multi, { loadHistory: async () => split.historyResult });
    const r = await runTurnChain({ turn: turn(), traceId: "g2", batch: split.batch }, h2.deps);
    expect(r).toMatchObject({ kind: "refused", code: "guard_ambiguous" });
    expect(h2.calls.generate).toBe(0);
    expect(JSON.stringify(r)).not.toContain("7351");
  });
});
