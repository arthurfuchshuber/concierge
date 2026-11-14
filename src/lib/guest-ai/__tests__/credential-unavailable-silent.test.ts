import { describe, expect, it, vi } from "vitest";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { fetchAccessMethod } from "@/lib/guest-ai/data/credentials.server";

const REQ = { surface: "airbnb", conversationId: "c1", messageId: "m1", expectedOwnerId: "o1" } as const;
const baseDuo = (t: string, c: unknown) => baseDeps(t, c);
const baseDeps = (text: string, creds: unknown) => ({
  env: { GUEST_AI_AUTONOMOUS: "on" },
  validate: async () => ({ propertyId: "p1", reservationId: "r1" }),
  pendingDecision: async () => false,
  humanActive: async () => false,
  generate: async () => ({
    status: "stored",
    state: "available",
    result: { text, handoffNeeded: false, handoffUrgency: null, internalQuestion: null, formalChangeRequests: [] },
  }),
  outboundContext: async () => ({ surface: "airbnb", credentials: creds, property: null, guideSlug: null }),
});

describe("T-CRED-02 · caso Jayr · credencial indisponível não vira texto furado", () => {
  it("contexto SEM credenciais (null): modelo tenta orientar a entrada ⇒ texto zerado, turno silencioso + equipe com urgência alta", async () => {
    const r = await requestGuestAiReply(REQ, baseDuo("Pode entrar pela portaria 24h. Seguem os dados: [[CREDENCIAIS]]", null) as never);
    expect(r).toMatchObject({ reply: "", handoff: true, handoffUrgency: "high" });
  });
  it("marcador sem credencial cadastrada ⇒ NENHUM texto ao hóspede + equipe com urgência alta", async () => {
    const r = await requestGuestAiReply(
      REQ,
      baseDeps("O condomínio conta com portaria 24h. Seguem as informações de acesso: [[CREDENCIAIS]]", { lockCode: null, gateCode: null, pinCode: null, wifiPassword: null, accessInstructions: null }) as never,
    );
    expect(r?.reply).toBe("");
    expect(r).toMatchObject({ handoff: true, handoffUrgency: "high" });
    expect(JSON.stringify(r)).not.toMatch(/dados de acesso eu te passo|Seguem as informações/);
  });
  it("credencial real cadastrada continua sendo entregue", async () => {
    const r = await requestGuestAiReply(REQ, baseDeps("Segue o acesso: [[CREDENCIAIS]]", { lockCode: "4821", accessInstructions: null }) as never);
    expect(r?.reply).toContain("4821");
    expect(r?.handoff).toBe(false);
  });
});

describe("método de acesso (só existência, nunca valor)", () => {
  const dbWith = (data: unknown, error: unknown = null) => ({
    from: () => ({ select: () => ({ eq: () => ({ or: () => ({ limit: async () => ({ data, error }) }) }) }) }),
  });
  it("com credencial cadastrada ⇒ autonomous; sem nenhuma ⇒ in_person", async () => {
    expect(await fetchAccessMethod({ propertyId: "p1" }, { db: dbWith([{ id: "p1" }]) as never })).toBe("autonomous");
    expect(await fetchAccessMethod({ propertyId: "p1" }, { db: dbWith([]) as never })).toBe("in_person");
  });
  it("erro de leitura ⇒ unknown (não presume modalidade)", async () => {
    expect(await fetchAccessMethod({ propertyId: "p1" }, { db: dbWith(null, { message: "x" }) as never })).toBe("unknown");
    expect(await fetchAccessMethod({ propertyId: "p1" }, { db: { from: () => { throw new Error("x"); } } as never })).toBe("unknown");
  });
  it("só seleciona `id` (nenhum segredo trafega)", async () => {
    const select = vi.fn(() => ({ eq: () => ({ or: () => ({ limit: async () => ({ data: [], error: null }) }) }) }));
    await fetchAccessMethod({ propertyId: "p1" }, { db: { from: () => ({ select }) } as never });
    expect(select).toHaveBeenCalledWith("id");
  });
});
