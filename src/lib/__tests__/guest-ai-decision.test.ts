/**
 * DECISÃO HUMANA COM 1 CLIQUE (10/11/2026): detecção do pedido de exceção ⇒ decisão + silêncio da IA; silêncio
 * absoluto com decisão pendente; clique ⇒ ação oficial + UMA resposta; duplo clique barrado; "Eu assumo" sem
 * envio; nenhum rótulo proibido na tela.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildDecisionOptions,
  buildDecisionQuestion,
  decidedHeadline,
  decisionHandoffReason,
  decisionKindFromRequests,
  extractRequestedTime,
  isDecisionHandoffReason,
} from "@/lib/guest-ai-decision";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { decideHumanDecision, openHumanDecision, hasPendingDecision, type DecisionDb } from "@/lib/guest-ai-decision.server";
import { fallbackDecisionReply, generateDecisionReply, type DecisionReplyInput } from "@/lib/guest-ai-decision-reply.server";

const SRC = path.resolve(__dirname, "../..");
const ON = { GUEST_AI_AUTONOMOUS: "on" };
const REQ = { surface: "guide_chat" as const, conversationId: "c1", messageId: "m1" };

// ─────────────── banco falso (só o que o servidor usa) ───────────────
type Rows = Record<string, Array<Record<string, unknown>>>;
function fakeDb(rows: Rows, rpc: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const db: DecisionDb = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      let insertRow: Record<string, unknown> | null = null;
      const match = () => (rows[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        neq: () => q,
        in: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: match(), error: null }),
        maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: insertRow ? { id: "new-id" } : (match()[0] ?? null), error: null }),
        update: (p: Record<string, unknown>) => ((patch = p), q),
        insert: (r: Record<string, unknown>) => ((insertRow = r), inserts.push({ table, row: r }), q),
        then: (res: (v: unknown) => unknown) => {
          if (patch) updates.push({ table, patch });
          return Promise.resolve({ data: match(), error: null }).then(res);
        },
      };
      return q;
    },
    rpc(fn, args) {
      calls.push({ fn, args });
      const r = rpc(fn, args);
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };
  return { db, calls, updates, inserts };
}

const DECISION = {
  id: "d1",
  property_id: "p1",
  conversation_id: "c1",
  trigger_message_id: "m1",
  kind: "late_checkout",
  question_text: "Mariana pede saída às 13h. Aprovar como cortesia?",
  options: buildDecisionOptions("late_checkout", "13:00"),
  status: "decided",
  decided_option_id: "approve",
  decided_by: "u1",
  decided_at: "2026-11-10T17:02:00Z",
  ai_reply_status: "pending",
  ai_reply_message_id: null,
  created_at: "2026-11-10T17:00:00Z",
};
const BASE_ROWS = (): Rows => ({
  guest_ai_human_decisions: [DECISION],
  property_chat_conversations: [
    { id: "c1", property_id: "p1", guest_name: "Mariana Souza", guest_session_id: "guest-abc", reservation_id: "r1", status: "needs_human" },
  ],
  properties: [{ id: "p1", name: "Studio 104", owner_id: "t1", checkout_time: "11:00", checkin_time: "15:00", wifi_password: "senha-wifi-123", lock_code: "4321" }],
  property_chat_messages: [{ id: "m1", conversation_id: "c1", content: "Posso sair às 13h amanhã?" }],
  guest_arrival_status: [{ id: "card-1", reservation_id: "r1", kind: "checkout", late_checkout_time: null }],
  property_reservations: [{ id: "r1", checkout_date: "2026-11-11" }],
});
const claimed = (optionId: string) => (fn: string) =>
  fn === "guest_ai_decision_claim"
    ? { data: { result: "claimed", id: "d1", kind: "late_checkout", option: DECISION.options.find((o) => o.id === optionId) } }
    : fn === "guest_ai_decision_mark_reply"
      ? { data: { result: "marked" } }
      : { data: null };

// ─────────────── parte pura ───────────────
describe("Decisão · parte pura", () => {
  it("só exceções do dia a dia viram decisão (datas, preço e cancelamento seguem o encaminhamento normal)", () => {
    expect(decisionKindFromRequests(["late_checkout"])).toBe("late_checkout");
    expect(decisionKindFromRequests(["early_checkin"])).toBe("early_checkin");
    expect(decisionKindFromRequests(["other_conditions"])).toBe("operational_concession");
    expect(decisionKindFromRequests(["dates", "price", "cancellation", "guest_count"])).toBeNull();
    expect(decisionKindFromRequests([])).toBeNull();
  });

  it("lê o horário pedido em pt/en", () => {
    expect(extractRequestedTime("Posso sair às 13h amanhã?")).toBe("13:00");
    expect(extractRequestedTime("dá pra ficar até 13h30?")).toBe("13:30");
    expect(extractRequestedTime("check out at 1pm please")).toBe("13:00");
    expect(extractRequestedTime("can we leave at 12:45?")).toBe("12:45");
    expect(extractRequestedTime("posso sair mais tarde?")).toBeNull();
  });

  it("botões: 2–4, rótulos curtos (cabem a 360px), sem rótulos proibidos", () => {
    for (const [kind, t] of [["late_checkout", "13:00"], ["late_checkout", null], ["early_checkin", "10:00"], ["operational_concession", null]] as const) {
      const opts = buildDecisionOptions(kind, t);
      expect(opts.length).toBeGreaterThanOrEqual(2);
      expect(opts.length).toBeLessThanOrEqual(4);
      for (const o of opts) {
        expect(o.label.length).toBeLessThanOrEqual(26);
        expect(o.label).not.toMatch(/Pr:|Propriet[aá]rio\(a\):/);
        expect(o.id).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
      }
      expect(opts.some((o) => o.ai_intent === "assume")).toBe(true);
    }
    expect(buildDecisionOptions("late_checkout", "13:00")[0]).toMatchObject({ label: "Aprovar 13h (cortesia)", time: "13:00" });
  });

  it("pergunta curta (≤ 45 palavras) com horário oficial e entrada no mesmo dia", () => {
    const q = buildDecisionQuestion({
      kind: "late_checkout", guestName: "Mariana Souza", time: "13:00", officialCheckout: "11:00", officialCheckin: null,
      sameDayArrival: false, internalQuestion: null, guestMessage: null,
    });
    expect(q).toBe("Mariana pede saída às 13h (oficial 11h). Não há entrada no mesmo dia. Aprovar como cortesia?");
    const long = buildDecisionQuestion({
      kind: "operational_concession", guestName: null, time: null, officialCheckout: null, officialCheckin: null,
      sameDayArrival: null, internalQuestion: null, guestMessage: "palavra ".repeat(200),
    });
    expect(long.split(/\s+/).length).toBeLessThanOrEqual(46);
  });

  it("motivo do chamado identifica a decisão na bolha; carimbo do estado decidido", () => {
    const r = decisionHandoffReason("late_checkout", "13:00");
    expect(r).toBe("Decisão pendente · late check-out às 13h");
    expect(isDecisionHandoffReason(r)).toBe(true);
    expect(isDecisionHandoffReason("Encaminhado para atendimento humano.")).toBe(false);
    expect(decidedHeadline(DECISION as never, "Arthur")).toBe("Late check-out aprovado · 13h");
    expect(decidedHeadline({ ...DECISION, decided_option_id: "assume" } as never, "Arthur")).toBe("Arthur assumiu a conversa");
  });
});

// ─────────────── slot: silêncio e abertura ───────────────
const stored = (over: Record<string, unknown> = {}) => ({
  status: "stored",
  state: "available",
  result: { text: "Vou verificar com a equipe!", handoffNeeded: false, handoffUrgency: null, internalQuestion: null, formalChangeRequests: ["late_checkout"], ...over },
});
const slotDeps = (over: Record<string, unknown> = {}) => ({
  env: ON,
  validate: async () => ({ propertyId: "p1" }),
  humanActive: async () => false,
  pendingDecision: async () => false,
  ...over,
});

describe("Decisão · slot (silêncio absoluto da IA)", () => {
  it("decisão pendente ⇒ silêncio, sem gerar (sem custo de modelo)", async () => {
    const generate = vi.fn();
    const r = await requestGuestAiReply(REQ, slotDeps({ pendingDecision: async () => true, generate }) as never);
    expect(r).toEqual({ reply: "", handoff: false });
    expect(generate).not.toHaveBeenCalled();
  });

  it("pedido de exceção ⇒ abre a decisão e push prioritário; o texto VALIDADO do modelo é preservado (diretiva 11/11/2026)", async () => {
    const openDecision = vi.fn(async () => ({ opened: true, reason: "Decisão pendente · late check-out às 13h" }));
    const r = await requestGuestAiReply(REQ, slotDeps({ generate: async () => stored(), openDecision }) as never);
    expect(openDecision).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "c1", triggerMessageId: "m1", formalChangeRequests: ["late_checkout"] }));
    expect(r).toEqual({ reply: "Vou verificar com a equipe!", handoff: true, handoffReason: "Decisão pendente · late check-out às 13h", handoffUrgency: "high" });
  });

  it("pedido de exceção sem texto do modelo ⇒ encaminhamento silencioso, sem texto fixo (diretiva 11/11/2026)", async () => {
    const openDecision = vi.fn(async () => ({ opened: true, reason: "Decisão pendente · late check-out às 13h" }));
    const r = await requestGuestAiReply(REQ, slotDeps({ generate: async () => stored({ text: "" }), openDecision }) as never);
    expect(r).toEqual({ reply: "", handoff: true, handoffReason: "Decisão pendente · late check-out às 13h", handoffUrgency: "high" });
  });

  it("já havia decisão pendente/aberta para a mensagem ⇒ continua em silêncio", async () => {
    const r = await requestGuestAiReply(REQ, slotDeps({ generate: async () => stored(), openDecision: async () => ({ opened: false, code: "exists", reason: "Decisão pendente · x" }) }) as never);
    expect(r?.reply).toBe("");
  });

  it("late check-out já autorizado ou falha ao abrir (tabela ausente) ⇒ responde e AINDA avisa a equipe (alteração formal)", async () => {
    for (const code of ["already_authorized", "error", "not_an_exception"]) {
      const r = await requestGuestAiReply(REQ, slotDeps({ generate: async () => stored(), openDecision: async () => ({ opened: false, code }) }) as never);
      expect(r, code).toEqual({ reply: "Vou verificar com a equipe!", handoff: true, handoffReason: "Pedido de alteração formal: late check-out", handoffUrgency: "normal" });
    }
  });

  it("cancelamento/datas/valor: a IA responde ao hóspede E a equipe é SEMPRE avisada, mesmo sem o modelo marcar encaminhamento", async () => {
    const reply = "Sinto muito pelo imprevisto! O cancelamento é feito pelo próprio Airbnb, em 'Alterar ou cancelar'.";
    const openDecision = vi.fn(async () => ({ opened: false, code: "not_an_exception" }));
    const r = await requestGuestAiReply(
      REQ,
      slotDeps({ generate: async () => stored({ text: reply, formalChangeRequests: ["cancellation"], handoffNeeded: false }), openDecision }) as never,
    );
    expect(r).toEqual({ reply, handoff: true, handoffReason: "Pedido de alteração formal: cancelamento", handoffUrgency: "normal" });
    const multi = await requestGuestAiReply(
      REQ,
      slotDeps({ generate: async () => stored({ text: "ok", formalChangeRequests: ["dates", "price"], handoffNeeded: true, handoffUrgency: "high", internalQuestion: "Hóspede quer mudar as datas; aceitar?" }), openDecision }) as never,
    );
    expect(multi).toEqual({ reply: "ok", handoff: true, handoffReason: "Hóspede quer mudar as datas; aceitar?", handoffUrgency: "high" });
    // sem texto (falha/silêncio) com alteração formal ⇒ encaminha mesmo assim
    const silent = await requestGuestAiReply(
      REQ,
      slotDeps({ generate: async () => ({ status: "stored", state: "no_suggestion", result: { text: null, handoffNeeded: false, handoffUrgency: null, internalQuestion: null, formalChangeRequests: ["guest_count"] } }), openDecision }) as never,
    );
    expect(silent).toMatchObject({ reply: "", handoff: true, handoffReason: "Pedido de alteração formal: número de hóspedes" });
  });

  it("sem pedido formal ⇒ resposta normal, nenhuma decisão", async () => {
    const openDecision = vi.fn();
    const r = await requestGuestAiReply(REQ, slotDeps({ generate: async () => stored({ text: "O Wi-Fi fica na sala.", formalChangeRequests: [] }), openDecision }) as never);
    expect(r).toEqual({ reply: "O Wi-Fi fica na sala.", handoff: false });
    expect(openDecision).not.toHaveBeenCalled();
  });
});

// ─────────────── servidor: abrir ───────────────
describe("Decisão · abertura no servidor", () => {
  it("monta pergunta e botões e chama a RPC de abertura", async () => {
    const rows = BASE_ROWS();
    const f = fakeDb(rows, (fn) => (fn === "guest_ai_decision_open" ? { data: { result: "opened", id: "d9" } } : { data: null }));
    const r = await openHumanDecision({ conversationId: "c1", triggerMessageId: "m1", formalChangeRequests: ["late_checkout"], internalQuestion: null }, { db: f.db });
    expect(r).toMatchObject({ opened: true, id: "d9", kind: "late_checkout", reason: "Decisão pendente · late check-out às 13h" });
    const call = f.calls.find((c) => c.fn === "guest_ai_decision_open")!;
    expect(call.args).toMatchObject({ p_tenant_id: "t1", p_property_id: "p1", p_conversation_id: "c1", p_trigger_message_id: "m1", p_kind: "late_checkout" });
    expect(String(call.args["p_question_text"])).toMatch(/^Mariana pede saída às 13h \(oficial 11h\)/);
    expect((call.args["p_options"] as Array<{ id: string }>).map((o) => o.id)).toEqual(["approve", "charge", "decline", "assume"]);
  });

  it("late check-out já concedido no card ⇒ não abre decisão", async () => {
    const rows = BASE_ROWS();
    rows["guest_arrival_status"]![0]!["late_checkout_time"] = "13:00";
    const f = fakeDb(rows, () => ({ data: null }));
    const r = await openHumanDecision({ conversationId: "c1", triggerMessageId: "m1", formalChangeRequests: ["late_checkout"], internalQuestion: null }, { db: f.db });
    expect(r).toEqual({ opened: false, code: "already_authorized" });
    expect(f.calls).toHaveLength(0);
  });

  it("leitura da pendência falhando (tabela ainda não aplicada) ⇒ não silencia a IA", async () => {
    const db = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: "relation does not exist" } }) }) }) }) }) };
    expect(await hasPendingDecision("c1", { db: db as never })).toBe(false);
  });
});

// ─────────────── servidor: o clique ───────────────
describe("Decisão · clique (1 toque)", () => {
  it("aprovar late check-out ⇒ RPC oficial em nome de quem clicou + UMA resposta da IA + conversa sai da fila", async () => {
    const f = fakeDb(BASE_ROWS(), claimed("approve"));
    const reply = vi.fn(async (_i: DecisionReplyInput) => ({ text: "Tudo certo, Mariana! Pode sair até as 13h.", source: "model" as const }));
    const deliver = vi.fn(async (_p: unknown) => "msg-ai-1");
    const r = await decideHumanDecision({ decisionId: "d1", optionId: "approve", userId: "u1" }, { db: f.db, reply, deliver });
    expect(r).toEqual({ ok: true, outcome: "replied", replySource: "model" });
    expect(f.calls.find((c) => c.fn === "guest_ai_decision_claim")!.args).toEqual({ p_decision_id: "d1", p_actor: "u1", p_option_id: "approve" });
    expect(f.calls.find((c) => c.fn === "internal_set_late_checkout")!.args).toEqual({ _arrival_status_id: "card-1", _actor: "u1", _time: "13:00" });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]![0]).toMatchObject({ kind: "late_checkout", intent: "approve", time: "13:00", officialCheckout: "11:00" });
    expect(reply.mock.calls[0]![0].forbiddenValues).toEqual(["senha-wifi-123", "4321"]);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith({ conversationId: "c1", session: "guest-abc", propertyId: "p1", text: "Tudo certo, Mariana! Pode sair até as 13h." });
    expect(f.calls.find((c) => c.fn === "guest_ai_decision_mark_reply")!.args).toEqual({ p_decision_id: "d1", p_status: "sent", p_message_id: "msg-ai-1" });
    expect(f.updates.find((u) => u.table === "property_chat_conversations")!.patch).toMatchObject({ status: "ai", handoff_reason: null });
  });

  it("duplo clique: o segundo é barrado pelo banco — nenhuma ação, nenhuma resposta", async () => {
    const f = fakeDb(BASE_ROWS(), (fn) => (fn === "guest_ai_decision_claim" ? { data: { result: "already_decided", decided_by: "u1", decided_option_id: "approve" } } : { data: null }));
    const reply = vi.fn();
    const deliver = vi.fn();
    const r = await decideHumanDecision({ decisionId: "d1", optionId: "decline", userId: "u2" }, { db: f.db, reply, deliver });
    expect(r).toMatchObject({ ok: false, code: "already_decided", decidedBy: "u1" });
    expect(f.calls.map((c) => c.fn)).toEqual(["guest_ai_decision_claim"]);
    expect(reply).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("\"Eu assumo a conversa\" ⇒ conversa de quem clicou, IA em silêncio (nada vai ao hóspede)", async () => {
    const f = fakeDb(BASE_ROWS(), claimed("assume"));
    const reply = vi.fn();
    const deliver = vi.fn();
    const r = await decideHumanDecision({ decisionId: "d1", optionId: "assume", userId: "u1" }, { db: f.db, reply, deliver });
    expect(r).toEqual({ ok: true, outcome: "silent" });
    expect(reply).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(f.calls.find((c) => c.fn === "internal_set_late_checkout")).toBeUndefined();
    expect(f.calls.find((c) => c.fn === "guest_ai_decision_mark_reply")!.args).toMatchObject({ p_status: "silent" });
    expect(f.updates[0]).toMatchObject({ table: "property_chat_conversations", patch: { status: "assigned", assigned_to: "u1" } });
  });

  it("recusar ⇒ sem ação no card, UMA resposta gentil", async () => {
    const f = fakeDb(BASE_ROWS(), claimed("decline"));
    const deliver = vi.fn(async () => "msg-2");
    const r = await decideHumanDecision({ decisionId: "d1", optionId: "decline", userId: "u1" }, { db: f.db, reply: async (i) => ({ text: fallbackDecisionReply(i), source: "fallback" }), deliver });
    expect(r).toMatchObject({ ok: true, outcome: "replied" });
    expect(f.calls.find((c) => c.fn === "internal_set_late_checkout")).toBeUndefined();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("banco recusa o late check-out (permissão/horário) ⇒ NADA é dito ao hóspede", async () => {
    for (const [msg, code] of [["late_checkout_forbidden", "not_authorized"], ["late_checkout_must_be_after_official", "late_checkout_rejected"]] as const) {
      const f = fakeDb(BASE_ROWS(), (fn) => (fn === "internal_set_late_checkout" ? { error: { message: msg } } : claimed("approve")(fn)));
      const deliver = vi.fn();
      const r = await decideHumanDecision({ decisionId: "d1", optionId: "approve", userId: "u1" }, { db: f.db, reply: vi.fn(), deliver });
      expect(r).toEqual({ ok: false, code });
      expect(deliver).not.toHaveBeenCalled();
      expect(f.calls.find((c) => c.fn === "guest_ai_decision_mark_reply")!.args).toMatchObject({ p_status: "error" });
    }
  });

  it("entrega falhou ⇒ decisão fica, resposta marcada como erro, conversa continua na fila", async () => {
    const f = fakeDb(BASE_ROWS(), claimed("charge"));
    const r = await decideHumanDecision({ decisionId: "d1", optionId: "charge", userId: "u1" }, { db: f.db, reply: async () => ({ text: "x", source: "fallback" }), deliver: async () => null });
    expect(r).toEqual({ ok: true, outcome: "reply_failed", code: "delivery_failed" });
    expect(f.calls.find((c) => c.fn === "guest_ai_decision_mark_reply")!.args).toMatchObject({ p_status: "error" });
    expect(f.updates.find((u) => u.table === "property_chat_conversations")).toBeUndefined();
  });
});

// ─────────────── resposta única da IA ───────────────
describe("Decisão · resposta da IA (D9)", () => {
  const input: DecisionReplyInput = {
    kind: "late_checkout", intent: "approve", time: "13:00", officialCheckout: "11:00", officialCheckin: "15:00",
    guestName: "Mariana", guestMessage: "Posso sair às 13h?", propertyName: "Studio 104", forbiddenValues: ["4321", "senha-wifi-123"],
  };
  const ok = (text: string) => ({ ok: true as const, text, finishReason: "stop" as const, telemetry: {} as never });

  it("usa o texto do modelo quando seguro; credenciais vão como valores proibidos", async () => {
    const llm = vi.fn(async (_m: unknown, _f: readonly string[]) => ok("Oi, Mariana! Pode sair até as 13h, com calma."));
    const r = await generateDecisionReply(input, { llm });
    expect(r).toEqual({ text: "Oi, Mariana! Pode sair até as 13h, com calma.", source: "model" });
    expect(llm.mock.calls[0]![1]).toEqual(["4321", "senha-wifi-123"]);
    expect(JSON.stringify(llm.mock.calls[0]![0])).not.toMatch(/4321|senha-wifi-123/);
  });

  it("saída com credencial, link ou falha do modelo ⇒ texto padrão (nunca vazio, nunca credencial)", async () => {
    for (const llm of [async () => ok("Código 4321, pode sair 13h"), async () => ok("veja https://x.y"), async () => ({ ok: false as const, error: { code: "timeout" as const, retryable: true, httpStatus: null }, telemetry: {} as never }), async () => { throw new Error("x"); }]) {
      const r = await generateDecisionReply(input, { llm: llm as never });
      expect(r.source).toBe("fallback");
      expect(r.text).toMatch(/13h/);
      expect(r.text).not.toMatch(/4321|senha/);
    }
  });
});

// ─────────────── tela e guardas estáticas ───────────────
describe("Decisão · tela e infraestrutura", () => {
  const card = readFileSync(path.join(SRC, "components/handoff/DecisionCard.tsx"), "utf8");
  it("cartão: sem rótulos proibidos, botões empilhados de largura total, carregando/desativado e aviso de concorrência", () => {
    expect(card).not.toMatch(/Pr:|Propriet[aá]rio\(a\):/);
    expect(card).toMatch(/flex flex-col gap-2/);
    expect(card).toMatch(/w-full/);
    expect(card).toMatch(/disabled=\{busy\}/);
    expect(card).toMatch(/animate-spin/);
    expect(card).toMatch(/Já decidido/);
    expect(card).toMatch(/IA em silêncio até a decisão/);
  });
  it("chat e bolhas usam o cartão; a tabela está no tempo real", () => {
    expect(readFileSync(path.join(SRC, "components/handoff/ConversationView.tsx"), "utf8")).toMatch(/<DecisionCard/);
    expect(readFileSync(path.join(SRC, "components/handoff/QuickChatBubbles.tsx"), "utf8")).toMatch(/Decisão pendente/);
    expect(readFileSync(path.join(SRC, "components/LiveSync.tsx"), "utf8")).toMatch(/"guest_ai_human_decisions"/);
  });
  it("encerrar a conversa expira a decisão pendente", () => {
    expect(readFileSync(path.join(SRC, "lib/handoff.functions.ts"), "utf8")).toMatch(/expirePendingDecisions\(data\.conversationId\)/);
  });
});
