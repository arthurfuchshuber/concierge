import { describe, expect, it } from "vitest";
import { guestSafetyDecision } from "@/lib/ai/guest-safety.server";

const SLUG = "studio-105";

describe("guestSafetyDecision — incidentes de acesso físico", () => {
  it("dispara para 'estou no portão' (Print 1 do WhatsApp)", async () => {
    const decision = await guestSafetyDecision("Estou no portão", SLUG);
    expect(decision.kind).toBe("access_incident");
    expect(decision.reply).not.toMatch(/\bSigma\d+\b/i);
  });

  it("dispara para 'estou na porta' (Print 2 — gap real que vazou o código do guia)", async () => {
    const decision = await guestSafetyDecision("Oi. Estou na porta", SLUG);
    expect(decision.kind).toBe("access_incident");
  });

  it("dispara para variações comuns de incidente físico", async () => {
    const cases = [
      "não consigo entrar",
      "o portão não abre",
      "não encontro o cadeado",
      "cheguei e não consigo abrir",
      "estou trancado do lado de fora",
      "ninguém me atendeu",
    ];
    for (const msg of cases) {
      const decision = await guestSafetyDecision(msg, SLUG);
      expect(decision.kind, `mensagem "${msg}" deveria disparar o guardrail`).toBe("access_incident");
    }
  });

  it("NUNCA inclui uma senha/código na resposta do guardrail", async () => {
    const decision = await guestSafetyDecision("Estou na porta, o código não funciona", SLUG);
    expect(decision.reply).not.toMatch(/\b[a-zA-Z]+\d{2,}\b/);
  });

  it("resposta sempre aponta para o guia, nunca alega ação remota", async () => {
    const decision = await guestSafetyDecision("Estou no portão", SLUG);
    expect(decision.reply).toContain("/g/studio-105#senhas-acesso");
    expect(decision.reply.toLowerCase()).not.toMatch(/estou (abrindo|destravando|confirmando)/);
  });
});

describe("guestSafetyDecision — pedidos diretos de senha/código", () => {
  it("dispara credential_guidance para pedido de senha do wifi", async () => {
    const decision = await guestSafetyDecision("qual a senha do wifi?", SLUG);
    expect(decision.kind).toBe("credential_guidance");
  });

  it("dispara credential_guidance para 'ver senha'", async () => {
    const decision = await guestSafetyDecision("como faço para ver senha", SLUG);
    expect(decision.kind).toBe("credential_guidance");
  });
});

describe("guestSafetyDecision — falsos positivos (não deve disparar)", () => {
  it("não dispara para confirmação simples de entrada (Print 3: 'Entrei')", async () => {
    const decision = await guestSafetyDecision("Entrei", SLUG);
    expect(decision.kind).toBe("none");
  });

  it("não dispara para pergunta legítima sobre qual item abre o quê (Print 3)", async () => {
    const decision = await guestSafetyDecision(
      "Tem uma tague e uma chave, o tanque que abre o portão?",
      SLUG,
    );
    expect(decision.kind).toBe("none");
  });

  it("não dispara para conversa social comum", async () => {
    const decision = await guestSafetyDecision("Bom dia! Tudo certo por aqui, obrigado.", SLUG);
    expect(decision.kind).toBe("none");
  });

  it("não dispara para pergunta turística sem relação com acesso", async () => {
    const decision = await guestSafetyDecision("Vocês recomendam algum restaurante perto?", SLUG);
    expect(decision.kind).toBe("none");
  });
});

describe("guestSafetyDecision — enriquecimento com base de conhecimento (sem LLM)", () => {
  it("aponta título de item do manual relacionado a chegada, sem expor o conteúdo", async () => {
    const fakeSupabase = {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return {
                  limit: async () => {
                    if (table === "property_manual_items") {
                      return { data: [{ title: "Primeiro acesso: abertura virtual do portão" }] };
                    }
                    if (table === "property_faqs") {
                      return { data: [{ question: "Como funciona o check-in tardio?" }] };
                    }
                    return { data: [] };
                  },
                };
              },
            };
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const decision = await guestSafetyDecision("Estou no portão", SLUG, {
      supabase: fakeSupabase,
      propertyId: "prop-1",
    });

    expect(decision.kind).toBe("access_incident");
    expect(decision.reply).toContain("Primeiro acesso");
    // "check-in tardio" não tem palavra-chave de chegada/acesso -> não deve aparecer.
    expect(decision.reply).not.toContain("check-in tardio");
  });

  it("nunca deixa um código plausível escapar mesmo se o título do host contiver um por engano", async () => {
    const fakeSupabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  limit: async () => ({ data: [{ title: "Cadeado do portão: código Sigma2610" }] }),
                };
              },
            };
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const decision = await guestSafetyDecision("Estou no portão", SLUG, {
      supabase: fakeSupabase,
      propertyId: "prop-1",
    });

    expect(decision.reply).not.toMatch(/Sigma2610/i);
  });

  it("não quebra quando a consulta à base falha (guardrail nunca depende do banco)", async () => {
    const fakeSupabase = {
      from() {
        throw new Error("db indisponível");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const decision = await guestSafetyDecision("Estou no portão", SLUG, {
      supabase: fakeSupabase,
      propertyId: "prop-1",
    });
    expect(decision.kind).toBe("access_incident");
  });
});
