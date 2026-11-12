/**
 * Fallback sem emudecimento (12/11/2026, caso Gilmar — Studio 103): "Porém não consigo acesso a senha wifi" às
 * 20h30 do dia do check-in. A geração estourou o prazo e o fallback, que só tratava pedidos de horário, devolveu
 * texto vazio: o hóspede ficou sem resposta no Airbnb.
 */
import { describe, expect, it, vi } from "vitest";
import { CONTINGENCY_REASON, CONTINGENCY_REPLY, GENERATION_FALLBACK_MS, requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { COPILOT_AUTO_CALL_MAX_MS } from "@/lib/guest-ai/copilot/generate.server";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";

const REQ = { surface: "airbnb" as const, conversationId: "c1", messageId: "m1" };
const deps = (over: Record<string, unknown>) => ({
  env: { GUEST_AI_AUTONOMOUS: "on" },
  validate: async () => ({ propertyId: "p1" }),
  humanActive: async () => false,
  pendingDecision: async () => false,
  generationTimeoutMs: 20,
  ...over,
});
const hang = () => new Promise(() => {});

describe("tempos", () => {
  it("chamada elástica com 20 s e corrida do slot com 25 s (teto da resposta ao hóspede)", () => {
    expect(COPILOT_AUTO_CALL_MAX_MS).toBe(20_000);
    expect(GENERATION_FALLBACK_MS).toBe(25_000);
  });
});

describe("dúvida operacional com o modelo fora do ar", () => {
  it("caso Gilmar (Wi-Fi) + timeout ⇒ aviso ao hóspede e equipe com urgência alta; nunca texto vazio", async () => {
    const openDecision = vi.fn();
    const r = await requestGuestAiReply(REQ, deps({ generate: hang, loadBurst: async () => ["Porém não consigo acesso a senha wifi"], openDecision }) as never);
    expect(openDecision).not.toHaveBeenCalled();
    expect(r?.reply).not.toBe("");
    expect(r).toEqual({ reply: CONTINGENCY_REPLY, handoff: true, handoffReason: CONTINGENCY_REASON, handoffUrgency: "high" });
  });
  it("geração que falha (erro ou resultado inválido) ⇒ mesmo aviso", async () => {
    for (const generate of [async () => { throw new Error("gateway"); }, async () => ({ status: "failed" })]) {
      const r = await requestGuestAiReply(REQ, deps({ generate, loadBurst: async () => ["O chuveiro não esquenta"] }) as never);
      expect(r).toMatchObject({ reply: CONTINGENCY_REPLY, handoff: true, handoffUrgency: "high" });
    }
  });
  it("falha até para ler a mensagem ⇒ ainda assim não fica mudo", async () => {
    const r = await requestGuestAiReply(REQ, deps({ generate: hang, loadBurst: async () => { throw new Error("db"); } }) as never);
    expect(r).toMatchObject({ reply: CONTINGENCY_REPLY, handoff: true, handoffUrgency: "high" });
  });
  it("só cortesia ('ok, obrigado') ⇒ silêncio como no fluxo normal, só a equipe é avisada", async () => {
    const r = await requestGuestAiReply(REQ, deps({ generate: hang, loadBurst: async () => ["Ok, obrigado!"] }) as never);
    expect(r).toMatchObject({ reply: "", handoff: true, handoffUrgency: "normal" });
  });
  it("o aviso não promete prazo nem inventa justificativa", () => {
    expect(CONTINGENCY_REPLY).not.toMatch(/instantes|já já|minutos|o quanto antes|de imediato|limpeza/i);
  });
});

describe("cinco pilares da verdade no roteiro", () => {
  const sys = buildSystemPrompt("airbnb");
  it("dossiê, documento vivo, reserva, calendário e fontes integradas, cada um soberano no seu assunto", () => {
    expect(sys).toMatch(/Cinco pilares da verdade/);
    for (const p of ["(1) Dossiê do imóvel", "(2) Documento vivo", "(3) Detalhes da reserva", "(4) Calendário de ocupação", "(5) Fontes integradas"]) expect(sys).toContain(p);
    expect(sys).toMatch(/nunca vale contra ele em senhas, liberação de credenciais, valores, horários oficiais ou exceções/);
  });
  it("dúvida de acesso: responde do dossiê; credenciais liberadas vão pelo marcador, sem rodeios", () => {
    expect(sys).toMatch(/Dúvida operacional ou de acesso durante a estadia ou no check-in/);
    expect(sys).toMatch(/entregue o que o hóspede precisa pelo marcador de credenciais, sem rodeios/);
  });
});
