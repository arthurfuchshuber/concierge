/**
 * Chegada fora da janela de check-in (caso Ary, 11/11/2026): "Devido a um atraso no voo, infelizmente, iremos
 * chegar após as 23!" num imóvel com check-in das 15h às 23h. A geração travou, o fallback leu "chegar … 23" como
 * ENTRADA ANTECIPADA e mandou um texto fixo falando de limpeza. Agora:
 *  - o extrator compara com os horários oficiais: chegada depois do início nunca é antecipada; depois do limite é
 *    chegada tardia (concessão operacional para a equipe);
 *  - nenhum texto fixo vai ao hóspede: só o texto validado do modelo; sem ele, encaminhamento silencioso;
 *  - o roteiro manda acolher, citar o horário do dossiê e dizer que vai verificar internamente com a equipe, sem
 *    "não se preocupe" nem limpeza; o validador aceita esse repasse quando há encaminhamento.
 * O comportamento do modelo é guiado pelo roteiro; aqui se conferem o roteiro, as travas e o fluxo do slot.
 */
import { describe, expect, it, vi } from "vitest";
import { buildDecisionQuestion, parseBurstRequests, parseExceptionRequests, requestsFromBurst } from "@/lib/guest-ai-decision";
import { openHumanDecision, type DecisionDb } from "@/lib/guest-ai-decision.server";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { renderPersona } from "@/lib/guest-ai/persona";
import { checkReplyAgainstDecision } from "@/lib/guest-ai/validation/commitment-text";
import { v3 } from "./helpers/b23-chain";

const ARY = "Devido a um atraso no voo, infelizmente, iremos chegar após as 23! Espero não haver problemas";
const TIMES = { officialCheckin: "15:00", officialCheckinMax: "23:00", officialCheckout: "11:00" };
const ARY_REPLY =
  "Sinto pelo atraso no voo, Ary. Nosso horário oficial de check-in vai até as 23h. Vou verificar internamente com nossa equipe a possibilidade de viabilizar a sua recepção nesse horário e te retorno por aqui.";

describe("extrator com os horários oficiais", () => {
  it("caso Ary: chegada depois do limite é chegada tardia, nunca entrada antecipada", () => {
    const r = parseExceptionRequests(ARY, TIMES);
    expect(r.early).toBeNull();
    expect(r.lateArrival).toEqual({ time: "23:00", day: null });
    expect(requestsFromBurst(r)).toEqual(["other_conditions"]);
  });
  it("mesmo sem horários (fallback sem banco), atraso/'após' nunca vira antecipada", () => {
    const r = parseBurstRequests([ARY, "Chegaremos por volta de meia noite!"], { strict: true });
    expect(r.early).toBeNull();
    expect(r.lateArrival).toMatchObject({ time: "00:00" });
  });
  it("chegada dentro da janela (18h) é previsão normal: nenhuma exceção", () => {
    const r = parseExceptionRequests("Vamos chegar por volta das 18h", TIMES);
    expect(r).toEqual({ early: null, late: null, arrivalInWindow: true });
    expect(requestsFromBurst(r)).toEqual([]);
  });
  it("entrada antes do check-in continua antecipada; saída até o horário oficial não é tardia", () => {
    expect(parseExceptionRequests("Dá para fazer check-in às 10h?", TIMES).early).toEqual({ time: "10:00", day: null });
    expect(parseExceptionRequests("Vamos sair às 10h", TIMES).late).toBeNull();
    expect(parseExceptionRequests("Posso sair às 14h?", TIMES).late).toEqual({ time: "14:00", day: null });
  });
});

// banco falso mínimo para openHumanDecision
function fakeDb(guestTexts: string[], rpcOut: unknown = { result: "opened", id: "d1" }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rows: Record<string, Array<Record<string, unknown>>> = {
    property_chat_conversations: [{ id: "c1", property_id: "p1", guest_name: "Ary Souza", reservation_id: null }],
    properties: [{ id: "p1", owner_id: "o1", checkin_time: "15:00", checkin_time_max: "23:00", checkout_time: "11:00" }],
    property_chat_messages: guestTexts.map((t, i) => ({ id: `m${i + 1}`, conversation_id: "c1", content: t, sender_type: "guest", is_internal_note: false, created_at: `2026-11-12T02:0${i}:00Z` })),
  };
  const db = {
    from(table: string) {
      const f: Array<[string, unknown]> = [];
      const match = () => (rows[table] ?? []).filter((r) => f.every(([k, v]) => r[k] === v));
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => (f.push([k, v]), q),
        neq: () => q,
        lte: () => q,
        gte: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: [...match()].reverse(), error: null }),
        maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => (calls.push({ fn, args }), { data: rpcOut, error: null }),
  } as unknown as DecisionDb;
  return { db, calls };
}

describe("cartão da equipe", () => {
  it("caso Ary: mesmo rotulado como early_checkin, vira recepção tardia (concessão) com o limite do imóvel", async () => {
    const { db, calls } = fakeDb([ARY]);
    const r = await openHumanDecision({ conversationId: "c1", triggerMessageId: "m1", formalChangeRequests: ["early_checkin"], internalQuestion: null }, { db });
    expect(r).toMatchObject({ opened: true, kind: "operational_concession" });
    const open = calls.find((c) => c.fn === "guest_ai_decision_open")!;
    expect(open.args["p_question_text"]).toBe("Ary avisa que vai chegar por volta das 23h (check-in até 23h). Viabilizar a recepção tardia?");
    expect((open.args["p_options"] as Array<{ label: string }>)[0]!.label).toBe("Receber mais tarde");
  });
  it("chegada dentro da janela rotulada como early_checkin ⇒ não abre cartão", async () => {
    const { db, calls } = fakeDb(["Vamos chegar por volta das 18h"]);
    const r = await openHumanDecision({ conversationId: "c1", triggerMessageId: "m1", formalChangeRequests: ["early_checkin"], internalQuestion: null }, { db });
    expect(r).toEqual({ opened: false, code: "not_an_exception" });
    expect(calls.some((c) => c.fn === "guest_ai_decision_open")).toBe(false);
  });
  it("pergunta do cartão de recepção tardia", () => {
    const q = buildDecisionQuestion({ kind: "operational_concession", guestName: "Ary", time: null, officialCheckout: "11:00", officialCheckin: "15:00", sameDayArrival: null, internalQuestion: null, guestMessage: ARY, lateArrival: { time: "00:00", day: null }, officialCheckinMax: "23:00" });
    expect(q).toBe("Ary avisa que vai chegar por volta das 0h (check-in até 23h). Viabilizar a recepção tardia?");
  });
});

describe("slot: só o texto validado do modelo; nunca texto fixo", () => {
  const deps = (over: Record<string, unknown>) => ({ env: { GUEST_AI_AUTONOMOUS: "on" }, validate: async () => ({ propertyId: "p1" }), humanActive: async () => false, pendingDecision: async () => false, ...over });
  const REQ = { surface: "airbnb" as const, conversationId: "c1", messageId: "m1" };
  it("caso Ary com texto do modelo: o texto vai inteiro, com decisão aberta e urgência alta", async () => {
    const openDecision = vi.fn(async () => ({ opened: true, reason: "Decisão pendente · concessão" }));
    const r = await requestGuestAiReply(
      REQ,
      deps({ generate: async () => ({ status: "stored", state: "available", result: { text: ARY_REPLY, handoffNeeded: true, handoffUrgency: "high", internalQuestion: null, formalChangeRequests: ["other_conditions"] } }), openDecision }) as never,
    );
    expect(r).toEqual({ reply: ARY_REPLY, handoff: true, handoffReason: "Decisão pendente · concessão", handoffUrgency: "high" });
    expect(r?.reply).not.toMatch(/não se preocupe|pode vir com calma|sem problema|limpeza/i);
  });
  it("geração travada (o que aconteceu com o Ary): cartão para a equipe e NENHUM texto ao hóspede", async () => {
    const openDecision = vi.fn(async () => ({ opened: true, reason: "Decisão pendente · concessão" }));
    const r = await requestGuestAiReply(REQ, deps({ generate: () => new Promise(() => {}), generationTimeoutMs: 20, loadBurst: async () => [ARY], openDecision }) as never);
    expect(openDecision).toHaveBeenCalledWith(expect.objectContaining({ formalChangeRequests: ["other_conditions"] }));
    expect(r).toEqual({ reply: "", handoff: true, handoffReason: "Decisão pendente · concessão", handoffUrgency: "high" });
  });
});

describe("validador: 'vou verificar internamente com a equipe' com encaminhamento é aceito", () => {
  const ev = { credentialReleaseAllowed: false, lateCheckoutAuthorizedTime: null, humanOwnershipActive: false };
  const ctx = { officialCheckin: "15:00", officialCheckout: "11:00" };
  it("com handoff.needed: sem bloqueio, mesmo sem rótulo team_relay", () => {
    const d = v3({ reply: ARY_REPLY, handoff: { needed: true, question: "Receber o Ary depois das 23h?", urgency: "high" }, commitmentKinds: [] });
    expect(checkReplyAgainstDecision(d as never, ctx, ev).blocks).toEqual([]);
  });
  it("sem encaminhamento: continua bloqueado (promessa de repasse sem ação estruturada)", () => {
    const d = v3({ reply: ARY_REPLY, handoff: { needed: false, question: null, urgency: null }, commitmentKinds: [] });
    expect(checkReplyAgainstDecision(d as never, ctx, ev).blocks).toContain("text_commitment_undeclared");
  });
});

describe("roteiro e persona", () => {
  const sys = buildSystemPrompt("airbnb");
  it("chegada fora da janela: acolhe, cita o horário do dossiê, verifica com a equipe, sem permissividade nem limpeza", () => {
    expect(sys).toMatch(/Chegada fora da janela de check-in/);
    expect(sys).toMatch(/Chegada dentro da janela é previsão normal/);
    expect(sys).toMatch(/nunca diga que não há problema, que pode vir com calma/);
    expect(sys).toMatch(/vai verificar internamente com a equipe a possibilidade de viabilizar a recepção/);
    expect(sys).toMatch(/handoff\.needed true com urgência alta, declare team_relay e registre other_conditions/);
    expect(sys).toMatch(/Não fale em limpeza ou preparação do imóvel para quem vai chegar tarde/);
  });
  it("exceção calibrada à proibição de muletas: verificação interna sóbria em pedidos de exceção", () => {
    expect(sys).toMatch(/Exceção calibrada: diante de um pedido de exceção ou de um imprevisto fora das regras da casa/);
    expect(renderPersona()).toMatch(/Chegada depois do limite de check-in pede acolhimento sóbrio/);
  });
});
