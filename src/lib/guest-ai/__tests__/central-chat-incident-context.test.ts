/** Chat central (15/11/2026): histórico unificado entre canais da mesma reserva + chamado de ocorrência no contexto. */
import { describe, expect, it } from "vitest";
import { normalizeHistory, type HistoryRow } from "@/lib/guest-ai/history";
import { humanOwnershipOf } from "@/lib/guest-ai/context/conversation-context.server";

const row = (id: string, conv: string, role: string, sender: string, channel: string, at: string, content: string): HistoryRow => ({
  id, conversation_id: conv, role, sender_type: sender, channel, content, created_at: at,
  is_internal_note: false, delivery_status: null, attachment_type: null, attachment_duration_ms: null, attachment_transcript: null,
});

describe("histórico do chat central", () => {
  const rows = [
    row("m1", "c-wpp", "user", "guest", "whatsapp", "2026-11-15T10:00:00.000Z", "O chuveiro está sem água quente"),
    row("m2", "c-airbnb", "assistant", "human", "airbnb", "2026-11-15T10:05:00.000Z", "Vamos verificar com o técnico"),
    row("m3", "c-wpp", "user", "guest", "whatsapp", "2026-11-15T10:20:00.000Z", "E sobre o wifi, qual a senha?"),
  ];
  it("junta as conversas irmãs em ordem cronológica, cada fala com seu canal", () => {
    const r = normalizeHistory(rows, { conversationId: "c-wpp", currentMessageId: "m3", siblingConversationIds: ["c-airbnb"] });
    expect(r.status).toBe("available");
    if (r.status !== "available") return;
    expect(r.entries.map((e) => [e.speaker, e.channel])).toEqual([["guest", "whatsapp"], ["team", "airbnb"], ["guest", "whatsapp"]]);
  });
  it("conversa que não é da mesma reserva continua recusada (nunca mistura hóspedes)", () => {
    const r = normalizeHistory([...rows, row("x", "c-outro", "user", "guest", "whatsapp", "2026-11-15T10:10:00.000Z", "oi")], { conversationId: "c-wpp", currentMessageId: "m3", siblingConversationIds: ["c-airbnb"] });
    expect(r).toEqual({ status: "unavailable", reason: "scope_mismatch" });
  });
  it("sem irmãs, comportamento de sempre", () => {
    expect(normalizeHistory(rows, { conversationId: "c-wpp", currentMessageId: "m3" })).toEqual({ status: "unavailable", reason: "scope_mismatch" });
  });
});

describe("chamado de ocorrência no contexto", () => {
  it("o assunto e a gravidade chegam à posse humana; o chamado não bloqueia a IA", () => {
    const h = humanOwnershipOf([
      { id: "i1", source: "incident", topic: "Chuveiro sem água quente", status: "open", severity: "normal" },
      { id: "c", source: "conversation_status", topic: null, status: "needs_human" },
    ]);
    expect(h.openCaseCount).toBe(2);
    expect(h.cases[0]).toMatchObject({ caseId: "i1", topic: "Chuveiro sem água quente", severity: "normal" });
    expect(h.cases[1]).not.toHaveProperty("topic");
  });
});
