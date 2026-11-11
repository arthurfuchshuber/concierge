/**
 * DECISÃO HUMANA RESILIENTE (11/11/2026, caso Clarisse): rajada de mensagens (saída 16h dia 23 + entrada 10h dia 19),
 * fallback determinístico sem modelo, resposta ao hóspede com os horários oficiais e auto-resolução quando a equipe
 * responde por conta própria.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildDecisionAckText,
  buildDecisionQuestion,
  extractRequestedDay,
  parseBurstRequests,
  parseExceptionRequests,
  requestsFromBurst,
} from "@/lib/guest-ai-decision";
import { openHumanDecision, resolvePendingDecisionsOnHumanMessage, type DecisionDb } from "@/lib/guest-ai-decision.server";
import { GENERATION_FALLBACK_MS, requestGuestAiReply } from "@/lib/guest-ai/slot.server";

const SRC = path.resolve(__dirname, "../..");
const REQ = { surface: "airbnb" as const, conversationId: "c1", messageId: "m2", expectedOwnerId: "o1" };
const M1 = "Gostaria de saber se consigo sair do ap as 16 hs do dia 23";
const M2 = "E entrar as 10 hs do dia 19";

describe("extração da rajada (determinística)", () => {
  it("cada mensagem vira o pedido certo, com horário e dia", () => {
    expect(parseExceptionRequests(M1)).toEqual({ late: { time: "16:00", day: 23 }, early: null });
    expect(parseExceptionRequests(M2)).toEqual({ late: null, early: { time: "10:00", day: 19 } });
    expect(extractRequestedDay("sair no dia 23")).toBe(23);
  });
  it("a rajada junta os dois sem mesclar nem sobrepor (o caso Clarisse)", () => {
    const b = parseBurstRequests([M1, M2]);
    expect(b).toEqual({ late: { time: "16:00", day: 23 }, early: { time: "10:00", day: 19 } });
    expect(requestsFromBurst(b)).toEqual(["late_checkout", "early_checkin"]);
  });
  it("uma mensagem com os dois pedidos também separa", () => {
    expect(parseExceptionRequests("Queria entrar às 10h do dia 19 e sair às 16h do dia 23")).toEqual({
      late: { time: "16:00", day: 23 },
      early: { time: "10:00", day: 19 },
    });
  });
  it("estrito (sem modelo): dúvida simples não abre decisão; pedido com horário ou flexibilidade abre", () => {
    expect(parseExceptionRequests("Qual o horário do check-in?", { strict: true })).toEqual({ late: null, early: null });
    expect(parseExceptionRequests("Onde fica o check-out?", { strict: true })).toEqual({ late: null, early: null });
    expect(parseExceptionRequests("Dá para fazer late check-out?", { strict: true }).late).not.toBeNull();
    expect(parseExceptionRequests("Posso chegar mais cedo?", { strict: true }).early).not.toBeNull();
    expect(parseExceptionRequests("Consigo sair às 14h?", { strict: true }).late).toEqual({ time: "14:00", day: null });
  });
  it("o cartão lista os dois pedidos com precisão", () => {
    const q = buildDecisionQuestion({
      kind: "operational_concession",
      guestName: "Clarisse Stuckert",
      time: null,
      officialCheckout: "11:00",
      officialCheckin: "15:00",
      sameDayArrival: null,
      internalQuestion: null,
      guestMessage: null,
      late: { time: "16:00", day: 23 },
      early: { time: "10:00", day: 19 },
    });
    expect(q).toBe("Clarisse pede entrada às 10h no dia 19 (oficial 15h) e saída às 16h no dia 23 (oficial 11h). Aprovar os dois como cortesia?");
  });
});

describe("resposta imediata ao hóspede (fim do silêncio)", () => {
  const ack = buildDecisionAckText({
    guestName: "Clarisse Stuckert",
    officialCheckin: "15:00",
    officialCheckout: "11:00",
    late: { time: "16:00", day: 23 },
    early: { time: "10:00", day: 19 },
  });
  it("informa horários oficiais, o motivo e o registro do pedido; sem promessa, sem recusa, sem prazo", () => {
    expect(ack).toMatch(/^Clarisse, o horário oficial da casa é check-in a partir das 15h e check-out até as 11h/);
    expect(ack).toMatch(/limpeza e a preparação do imóvel/);
    expect(ack).toMatch(/Registrei o seu pedido de saída às 16h no dia 23 e entrada às 10h no dia 19/);
    expect(ack).not.toMatch(/não (é possível|conseguimos)|aprovad|em até|minutos|hoje ainda|desculp|sinto muito/i);
    expect(ack).not.toMatch(/!/);
  });
  it("sem horários cadastrados, não inventa", () => {
    const t = buildDecisionAckText({ guestName: null, officialCheckin: null, officialCheckout: null, late: { time: null, day: null }, early: null });
    expect(t).not.toMatch(/\d/);
    expect(t).toMatch(/Registrei o seu pedido de saída/);
  });
});

// ─────────────── banco falso mínimo ───────────────
type Rows = Record<string, Array<Record<string, unknown>>>;
function fakeDb(rows: Rows, rpc: (fn: string, args: Record<string, unknown>) => { data?: unknown } = () => ({ data: null })) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db: DecisionDb = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const match = () => (rows[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        neq: () => q,
        gte: () => q,
        lte: () => q,
        in: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: match(), error: null }),
        maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: match(), error: null }).then(res),
      };
      return q;
    },
    rpc(fn, args) {
      calls.push({ fn, args });
      return Promise.resolve({ data: rpc(fn, args).data ?? null, error: null });
    },
  };
  return { db, calls };
}
const ROWS = (): Rows => ({
  property_chat_conversations: [{ id: "c1", property_id: "p1", guest_name: "Clarisse Stuckert", reservation_id: null }],
  properties: [{ id: "p1", name: "Studio 105", owner_id: "t1", checkout_time: "11:00", checkin_time: "15:00" }],
  // ordem decrescente (como a consulta pede): mais nova primeiro; a resposta da IA/equipe encerra a rajada
  property_chat_messages: [
    { id: "m2", conversation_id: "c1", content: M2, sender_type: "guest", created_at: "2026-11-11T14:32:59Z" },
    { id: "m1", conversation_id: "c1", content: M1, sender_type: "guest", created_at: "2026-11-11T14:32:27Z" },
    { id: "m0", conversation_id: "c1", content: "Oii", sender_type: "ai", created_at: "2026-11-11T14:28:42Z" },
  ],
});

describe("openHumanDecision · rajada", () => {
  it("modelo rotulou só a última mensagem como late_checkout ⇒ um cartão com os DOIS pedidos corretos", async () => {
    const f = fakeDb(ROWS(), (fn) => (fn === "guest_ai_decision_open" ? { data: { result: "opened", id: "d1" } } : { data: null }));
    const r = await openHumanDecision(
      { conversationId: "c1", triggerMessageId: "m2", formalChangeRequests: ["late_checkout"], internalQuestion: null },
      { db: f.db },
    );
    expect(r).toMatchObject({ opened: true, kind: "operational_concession" });
    const call = f.calls.find((c) => c.fn === "guest_ai_decision_open")!;
    expect(String(call.args["p_question_text"])).toBe(
      "Clarisse pede entrada às 10h no dia 19 (oficial 15h) e saída às 16h no dia 23 (oficial 11h). Aprovar os dois como cortesia?",
    );
    expect((call.args["p_options"] as Array<{ label: string }>)[0]!.label).toBe("Aprovar os dois (cortesia)");
    expect(r.opened && r.ack).toMatchObject({ officialCheckin: "15:00", officialCheckout: "11:00", late: { time: "16:00", day: 23 }, early: { time: "10:00", day: 19 } });
  });
  it("só a entrada: o tipo vira early_checkin (não 'late check-out às 10h')", async () => {
    const rows = ROWS();
    rows["property_chat_messages"] = [rows["property_chat_messages"]![0]!];
    const f = fakeDb(rows, (fn) => (fn === "guest_ai_decision_open" ? { data: { result: "opened", id: "d1" } } : { data: null }));
    const r = await openHumanDecision(
      { conversationId: "c1", triggerMessageId: "m2", formalChangeRequests: ["late_checkout"], internalQuestion: null },
      { db: f.db },
    );
    expect(r).toMatchObject({ opened: true, kind: "early_checkin" });
    expect(String(f.calls.find((c) => c.fn === "guest_ai_decision_open")!.args["p_question_text"])).toMatch(/entrada às 10h no dia 19 \(oficial 15h\)/);
  });
});

describe("slot · fallback determinístico (sem modelo)", () => {
  const base = (over: Record<string, unknown> = {}) => ({
    env: { GUEST_AI_AUTONOMOUS: "on" },
    validate: async () => ({ propertyId: "p1" }),
    humanActive: async () => false,
    pendingDecision: async () => false,
    loadBurst: async () => [M1, M2],
    ...over,
  });
  const ack = { guestName: "Clarisse Stuckert", officialCheckin: "15:00", officialCheckout: "11:00", late: { time: "16:00", day: 23 }, early: { time: "10:00", day: 19 } };

  it("geração que trava ⇒ em até o teto abre a decisão e responde (nunca fica muda)", async () => {
    expect(GENERATION_FALLBACK_MS).toBeLessThanOrEqual(25_000);
    const openDecision = vi.fn(async () => ({ opened: true, reason: "Decisão pendente · pedido de exceção", ack }));
    const r = await requestGuestAiReply(
      REQ,
      base({ generate: () => new Promise(() => {}), generationTimeoutMs: 20, openDecision }) as never,
    );
    expect(openDecision).toHaveBeenCalledWith(expect.objectContaining({ formalChangeRequests: ["late_checkout", "early_checkin"] }));
    expect(r).toMatchObject({ handoff: true, handoffUrgency: "high" });
    expect(r?.reply).toMatch(/Registrei o seu pedido de saída às 16h no dia 23 e entrada às 10h no dia 19/);
  });
  it("geração que falha (erro/resultado inválido) ⇒ mesmo fallback", async () => {
    for (const generate of [async () => { throw new Error("gateway"); }, async () => ({ status: "failed" })]) {
      const openDecision = vi.fn(async () => ({ opened: true, reason: "Decisão pendente · x", ack }));
      const r = await requestGuestAiReply(REQ, base({ generate, openDecision }) as never);
      expect(openDecision).toHaveBeenCalledTimes(1);
      expect(r?.reply).not.toBe("");
    }
  });
  it("sem pedido de exceção na mensagem ⇒ encaminhamento de sempre, sem decisão nem texto", async () => {
    const openDecision = vi.fn();
    const r = await requestGuestAiReply(
      REQ,
      base({ generate: async () => ({ status: "failed" }), loadBurst: async () => ["Qual o horário do check-in?"], openDecision }) as never,
    );
    expect(openDecision).not.toHaveBeenCalled();
    expect(r).toMatchObject({ reply: "", handoff: true });
  });
  it("já há decisão aberta: o fallback não duplica nem fala de novo", async () => {
    const r = await requestGuestAiReply(
      REQ,
      base({ generate: async () => ({ status: "failed" }), openDecision: async () => ({ opened: false, code: "pending_exists", reason: "Decisão pendente · x" }) }) as never,
    );
    expect(r).toMatchObject({ reply: "", handoff: true });
  });
});

describe("auto-resolução quando a equipe responde", () => {
  const decisions = () => [
    {
      id: "d1",
      conversation_id: "c1",
      status: "pending",
      tenant_id: "t1",
      options: [
        { id: "approve", ai_intent: "approve" },
        { id: "assume", ai_intent: "assume" },
      ],
    },
  ];
  it("decisão pendente vira 'assumida' (opção assume, sem resposta da IA) usando as RPCs", async () => {
    const f = fakeDb({ guest_ai_human_decisions: decisions() }, (fn) => (fn === "guest_ai_decision_claim" ? { data: { result: "claimed" } } : { data: { result: "marked" } }));
    expect(await resolvePendingDecisionsOnHumanMessage("c1", { actorUserId: "u9" }, { db: f.db })).toBe(1);
    expect(f.calls[0]).toEqual({ fn: "guest_ai_decision_claim", args: { p_decision_id: "d1", p_actor: "u9", p_option_id: "assume" } });
    expect(f.calls[1]).toEqual({ fn: "guest_ai_decision_mark_reply", args: { p_decision_id: "d1", p_status: "silent", p_message_id: null } });
  });
  it("mensagem sincronizada do Airbnb (sem usuário): vale o titular da decisão", async () => {
    const f = fakeDb({ guest_ai_human_decisions: decisions() }, (fn) => (fn === "guest_ai_decision_claim" ? { data: { result: "claimed" } } : { data: null }));
    await resolvePendingDecisionsOnHumanMessage("c1", {}, { db: f.db });
    expect(f.calls[0]!.args["p_actor"]).toBe("t1");
  });
  it("já decidida por outro (corrida) ou sem pendência: não faz nada e não lança", async () => {
    const f = fakeDb({ guest_ai_human_decisions: decisions() }, () => ({ data: { result: "already_decided" } }));
    expect(await resolvePendingDecisionsOnHumanMessage("c1", {}, { db: f.db })).toBe(0);
    expect(f.calls.map((c) => c.fn)).toEqual(["guest_ai_decision_claim"]);
    expect(await resolvePendingDecisionsOnHumanMessage("c1", {}, { db: fakeDb({}).db })).toBe(0);
  });
  it("ligada ao envio pelo painel/Copiloto e à mensagem do anfitrião vinda do Airbnb", () => {
    const send = readFileSync(path.join(SRC, "lib/handoff-send.server.ts"), "utf8");
    expect(send).toMatch(/resolvePendingDecisionsOnHumanMessage\(data\.conversationId, \{ actorUserId: userId \}\)/);
    const channex = readFileSync(path.join(SRC, "lib/channex-messages.server.ts"), "utf8");
    expect(channex).toMatch(/if \(!automated\) \{\s*try \{\s*const \{ resolvePendingDecisionsOnHumanMessage \}/);
  });
});

describe("dock fixo no chat", () => {
  const view = readFileSync(path.join(SRC, "components/handoff/ConversationView.tsx"), "utf8");
  const card = readFileSync(path.join(SRC, "components/handoff/DecisionCard.tsx"), "utf8");
  it("o painel pendente fica acima do campo de digitação; no fluxo só um aviso", () => {
    expect(view).toMatch(/<DecisionDock[\s\S]*?\/>\s*\n\s*\{status !== "resolved" && !canChat/);
    expect(view.match(/variant="ref"/g)?.length).toBe(2);
    expect(card).toMatch(/border-amber-500\/40 bg-amber-500\/10/);
    expect(card).toMatch(/data-testid=\{dock \? "decision-dock"/);
  });
  it("ao decidir, o dock mostra o sucesso na hora", () => {
    expect(card).toMatch(/onResolved\?\.\(r\.message \?\? ""\)/);
    expect(card).toMatch(/data-state="resolved"/);
  });
});
