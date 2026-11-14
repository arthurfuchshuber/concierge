/**
 * CONVERSAS DE OURO (auditoria 14/11/2026). Cada caso é um incidente real ou um risco conhecido, com o resultado
 * que o hóspede PODE ver. Toda regra nova do roteiro deve ganhar um caso aqui antes de entrar no prompt; a poda
 * futura do roteiro (≈70 mil caracteres) só vale se esta suíte continuar verde.
 */
import { describe, expect, it } from "vitest";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { evaluateSendBarrier, barrierGate, type BarrierInput } from "@/lib/guest-ai/send-barrier";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { GENERATION_FALLBACK_MS } from "@/lib/guest-ai/slot.server";

const REQ = { surface: "airbnb", conversationId: "c1", messageId: "m1", expectedOwnerId: "o1" } as const;
const SOUL = /dados de acesso eu te passo|Seguem as informações de acesso|já acionei nossa equipe|\[\[|\{\{/i;

const turn = (text: string | null, over: Record<string, unknown> = {}, creds: unknown = null) => ({
  env: { GUEST_AI_AUTONOMOUS: "on" },
  validate: async () => ({ propertyId: "p1", reservationId: "r1" }),
  pendingDecision: async () => false,
  humanActive: async () => false,
  generate: async () => ({
    status: "stored",
    state: text === null ? "no_suggestion" : "available",
    result: { text, handoffNeeded: false, handoffUrgency: null, internalQuestion: null, formalChangeRequests: [] },
  }),
  outboundContext: async () => ({ surface: "airbnb", credentials: creds, property: null, guideSlug: null }),
  ...over,
});
const run = (t: ReturnType<typeof turn>) => requestGuestAiReply(REQ, t as never);

describe("OURO 1 · caso Jayr (14/11/2026): atendente fala durante a geração", () => {
  const base: BarrierInput = {
    triggerId: "g1",
    triggerCreatedAt: "2026-11-14T18:09:39.000Z",
    rowsAfter: [],
    conversation: { status: "assigned", ai_paused: false, paused_until: null, assigned_to: "u1" },
    pausedNow: false,
  };
  it("anfitrião respondeu 30 s depois do hóspede ⇒ a IA NÃO envia", () => {
    const rows = [{ id: "h1", created_at: "2026-11-14T18:10:09.000Z", role: "assistant", sender_type: "human" }];
    expect(barrierGate(evaluateSendBarrier({ ...base, rowsAfter: rows }))).toMatchObject({ allowed: false });
  });
  it("conversa assumida sem mensagem nova ⇒ a IA NÃO envia", () => {
    expect(barrierGate(evaluateSendBarrier(base))).toEqual({ allowed: false, reason: "human_ownership" });
  });
});

describe("OURO 2 · acesso ao imóvel", () => {
  it("imóvel sem credencial + modelo promete entrada pela portaria ⇒ silêncio e equipe", async () => {
    const r = await run(turn("O condomínio tem portaria 24h, é só se identificar. Seguem os dados: [[CREDENCIAIS]]"));
    expect(r).toMatchObject({ reply: "", handoff: true, handoffUrgency: "high" });
  });
  it("credencial liberada pela D9 ⇒ entrega normal, sem tag crua", async () => {
    const r = await run(turn("Sua senha da porta: [[CREDENCIAIS]]", {}, { lockCode: "4821", accessInstructions: null }));
    expect(r?.reply).toContain("4821");
    expect(r?.reply).not.toMatch(SOUL);
  });
});

describe("OURO 3 · silêncio inteligente e discrição", () => {
  it("agradecimento sem pergunta ⇒ silêncio (nada a acrescentar)", async () => {
    const r = await run(turn(null));
    expect(r).toMatchObject({ reply: "" });
    expect(r?.handoff).toBeFalsy();
  });
  it("equipe atendendo ⇒ silêncio, sem aviso repetido", async () => {
    expect(await run(turn("Olá!", { humanActive: async () => true }))).toEqual({ reply: "", handoff: false });
  });
  it("posse incerta ⇒ não arrisca", async () => {
    expect(await run(turn("Olá!", { humanActive: async () => null }))).toMatchObject({ reply: "", handoff: true });
  });
});

describe("OURO 4 · falha técnica nunca vira SAC para o hóspede", () => {
  it("geração lançou erro ⇒ texto vazio + equipe, sem frase pronta", async () => {
    const r = await run(turn("x", { generate: async () => { throw new Error("gateway"); } }));
    expect(r).toMatchObject({ reply: "", handoff: true });
    expect(JSON.stringify(r)).not.toMatch(SOUL);
  });
  it("escopo recusado ⇒ texto vazio + equipe", async () => {
    const r = await run(turn("x", { validate: async () => { throw new Error("scope"); } }));
    expect(r).toMatchObject({ reply: "", handoff: true });
  });
});

describe("OURO 5 · nenhuma tag crua chega ao hóspede", () => {
  it("tags desconhecidas e residuais são removidas", async () => {
    const r = await run(turn("O check-in é às 15h. {{handoff}} [[algo:x]]"));
    expect(r?.reply ?? "").not.toMatch(/\{\{|\[\[/);
  });
});

describe("OURO 6 · invariantes do roteiro (todas as superfícies)", () => {
  for (const surface of ["airbnb", "whatsapp", "guide_chat"] as const) {
    it(`${surface}: humano prevalece, portaria não é método, sem SAC, sem credencial no texto`, () => {
      const p = buildSystemPrompt(surface);
      expect(p).toMatch(/orientação humana PREVALECE categoricamente/);
      expect(p).toMatch(/Comodidades do condomínio .* não definem o método de entrada/);
      expect(p).toContain("ctx:metodo_de_acesso");
      expect(p).not.toMatch(/se houver portaria presencial.{0,40}cite a portaria/i);
      expect(p).not.toMatch(/já acionei nossa equipe/i);
    });
  }
});

describe("OURO 7 · emergência de pessoas (números oficiais, gov.br/Anatel)", () => {
  for (const surface of ["airbnb", "whatsapp", "guide_chat"] as const) {
    it(`${surface}: protocolo presente com os números oficiais e handoff alto`, () => {
      const p = buildSystemPrompt(surface);
      for (const n of ["SAMU 192", "Bombeiros 193", "Polícia Militar 190", "Defesa Civil 199", "180", "188"]) expect(p).toContain(n);
      expect(p).toMatch(/EMERGÊNCIA DE PESSOAS tem prioridade/);
      expect(p).toMatch(/handoff com urgência alta/);
      expect(p).toMatch(/nunca fica em silêncio/);
      expect(p).not.toMatch(/diga (em primeira pessoa )?que (está|vai) avisando? a equipe/);
    });
  }
});

describe("OURO 8 · prazo de geração", () => {
  it("o slot espera até 30 s (decisão do titular), igual ao corte do gateway", () => {
    expect(GENERATION_FALLBACK_MS).toBe(30_000);
  });
});
