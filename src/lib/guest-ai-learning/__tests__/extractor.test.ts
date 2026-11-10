/**
 * Etapa 3 (10/11/2026): extrator de candidatos do Documento Vivo.
 * Cobre: candidato válido nasce pendente (RPC guest_ai_learning_propose), recusa de segredo, recusa de fato
 * pontual, isolamento por imóvel, gatilhos (checkout, atendimento resolvido pela equipe) e fail-closed.
 */
import { describe, expect, it, vi } from "vitest";
import { buildLearningPrompt, parseLearningOutput, type TranscriptMessage } from "../extractor";
import {
  extractAndProposeLearnings,
  learnFromResolvedConversation,
  speakerFromRow,
} from "../extractor.server";
import { proposeLearningCandidate } from "@/lib/guest-ai-learning.server";
import { evaluateCandidate } from "@/lib/guest-ai/learning/learning";
import type { LlmProvider, ProviderOutcome, ProviderRequest } from "@/lib/guest-ai/llm/providers/types";

const ON = { GUEST_AI_LEARNING_EXTRACTOR: "on" };
const P1 = "prop-1";
const P2 = "prop-2";

const CONV: TranscriptMessage[] = [
  { id: "a1", speaker: "guest", text: "O Wi-Fi não pega na varanda." },
  { id: "a2", speaker: "team", text: "Ligue o repetidor branco que fica atrás da TV da sala." },
  { id: "a3", speaker: "guest", text: "Liguei e funcionou, obrigado!" },
];

function provider(body: unknown): LlmProvider & { calls: number; seen: ProviderRequest[] } {
  const p = {
    id: "fake",
    calls: 0,
    seen: [] as ProviderRequest[],
    async complete(req: ProviderRequest): Promise<ProviderOutcome> {
      p.calls += 1;
      p.seen.push(req);
      return { kind: "ok", text: JSON.stringify(body), finishReason: "stop", usage: { inputTokens: 800, outputTokens: 100, totalTokens: 900 }, requestId: "r" };
    },
  };
  return p;
}

/** Banco falso do RPC: guarda o que foi proposto (o banco real grava `pending`). */
function fakeDb() {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    db: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: `entry-${calls.length}`, error: null });
      },
    },
  };
}

const out = (...c: Array<{ categoria: string; fato: string; evidencias: string[]; confirmacao_hospede?: boolean }>) => ({ candidatos: c });
const WIFI = { categoria: "equipamentos", fato: "O Wi-Fi da varanda depende do repetidor branco atrás da TV da sala.", evidencias: ["m2", "m3"], confirmacao_hospede: true };

describe("1) candidato válido nasce PENDENTE pela RPC existente", () => {
  it("propõe via guest_ai_learning_propose com o imóvel do gatilho e a evidência real, e aprova na hora", async () => {
    const f = fakeDb();
    const approve = vi.fn(async () => true);
    const r = await extractAndProposeLearnings(
      { trigger: "checkout_done", propertyId: P1, messages: CONV, traceId: "t" },
      { env: ON, provider: provider(out(WIFI)), propose: (c) => proposeLearningCandidate(c, { db: f.db }), approve, log: () => {} },
    );
    expect(r).toMatchObject({ status: "done", proposed: 1, approved: 1, duplicates: 0 });
    // governança por exceção (10/11/2026): entra aprovado na hora, em nome do dono do imóvel do gatilho
    expect(approve).toHaveBeenCalledWith("entry-1", P1);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.fn).toBe("guest_ai_learning_propose");
    expect(f.calls[0]!.args).toEqual({
      p_property_id: P1,
      p_category: "equipamentos",
      p_statement: WIFI.fato,
      p_source: "guest_confirmation",
      p_evidence_refs: ["a2", "a3"],
    });
    // nenhum caminho do extrator aprova: só a RPC de PROPOSTA (que grava `pending`) é chamada
    expect(f.calls.every((c) => c.fn === "guest_ai_learning_propose")).toBe(true);
  });

  it("sem confirmação do hóspede, a origem é o gatilho (checkout ou resolução da equipe)", async () => {
    const f = fakeDb();
    await extractAndProposeLearnings(
      { trigger: "incident_resolved", propertyId: P1, messages: CONV, traceId: "t" },
      { env: ON, provider: provider(out({ ...WIFI, confirmacao_hospede: false, evidencias: ["m2"] })), propose: (c) => proposeLearningCandidate(c, { db: f.db }), log: () => {} },
    );
    expect(f.calls[0]!.args["p_source"]).toBe("incident_resolved");
  });
});

describe("2) segredo/credencial nunca é aprendido (D9)", () => {
  it("o modelo nunca recebe o valor do segredo: a conversa passa pelo varredor antes", async () => {
    const p = provider(out());
    await extractAndProposeLearnings(
      {
        trigger: "checkout_done",
        propertyId: P1,
        messages: [
          { id: "s1", speaker: "guest", text: "Qual a senha do Wi-Fi?" },
          { id: "s2", speaker: "team", text: "A senha do Wi-Fi é Varanda#2024 e o código do portão é 4471." },
        ],
        traceId: "t",
      },
      { env: ON, provider: p, propose: vi.fn(), log: () => {} },
    );
    const sent = JSON.stringify(p.seen[0]!.messages);
    expect(sent).not.toContain("Varanda#2024");
    expect(sent).not.toContain("4471");
  });

  it("fato com senha/código proposto pelo modelo é recusado e nada chega à RPC", async () => {
    const f = fakeDb();
    const r = await extractAndProposeLearnings(
      { trigger: "checkout_done", propertyId: P1, messages: CONV, traceId: "t" },
      {
        env: ON,
        provider: provider(out({ categoria: "acesso_e_chegada", fato: "A senha da fechadura da porta principal é 482913 e não muda.", evidencias: ["m2"] })),
        propose: (c) => proposeLearningCandidate(c, { db: f.db }),
        log: () => {},
      },
    );
    expect(r.proposed).toBe(0);
    expect(r.refused["contains_secret"]).toBe(1);
    expect(f.calls).toHaveLength(0);
  });
});

describe("3) fato pontual/efêmero é recusado", () => {
  it.each([
    ["data", "A limpeza extra foi feita em 08/11 a pedido da equipe."],
    ["horário da estadia", "O check-in desta reserva ficou para 14h30 por causa do voo."],
    ["valor", "A taxa de pet cobrada foi de R$ 150 nesta estadia."],
    ["telefone", "Para reparos chamar o eletricista no 45 99999-1234."],
    ["referência à estadia", "Hoje a água quente demorou para chegar no chuveiro."],
    ["nome de hóspede", "A Dona Maria achou o colchão do quarto duro demais."],
    ["preferência de um hóspede", "O hóspede prefere toalhas extras no banheiro social."],
  ])("%s", async (_, fato) => {
    const f = fakeDb();
    const r = await extractAndProposeLearnings(
      { trigger: "checkout_done", propertyId: P1, messages: CONV, traceId: "t" },
      { env: ON, provider: provider(out({ categoria: "duvidas_frequentes", fato, evidencias: ["m2"] })), propose: (c) => proposeLearningCandidate(c, { db: f.db }), log: () => {} },
    );
    expect(r.proposed).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
});

describe("4) isolamento estrito por imóvel", () => {
  it("o imóvel sempre vem do gatilho; o modelo não tem como apontar outro", async () => {
    const f = fakeDb();
    await extractAndProposeLearnings(
      { trigger: "checkout_done", propertyId: P2, messages: CONV, traceId: "t" },
      // mesmo que o modelo invente campos de imóvel, eles são ignorados
      { env: ON, provider: provider({ candidatos: [{ ...WIFI, imovel: P1, property_id: P1 }] }), propose: (c) => proposeLearningCandidate(c, { db: f.db }), log: () => {} },
    );
    expect(f.calls.map((c) => c.args["p_property_id"])).toEqual([P2]);
  });

  it("evidência de outro imóvel é recusada pelo núcleo (cross_property)", () => {
    const r = evaluateCandidate({
      propertyId: P1,
      category: "equipamentos",
      statement: WIFI.fato,
      evidence: { source: "checkout_done", propertyId: P2, refs: ["a2"], closed: true },
    });
    expect(r).toEqual({ ok: false, code: "cross_property" });
  });

  it("evidência fora da conversa do gatilho (id inventado) descarta o candidato", async () => {
    const propose = vi.fn();
    const r = await extractAndProposeLearnings(
      { trigger: "checkout_done", propertyId: P1, messages: CONV, traceId: "t" },
      { env: ON, provider: provider(out({ ...WIFI, evidencias: ["m99"] })), propose, log: () => {} },
    );
    expect(propose).not.toHaveBeenCalled();
    expect(r.refused["unknown_evidence"]).toBe(1);
  });
});

describe("validação, custo e fail-closed", () => {
  it("desligado (sem GUEST_AI_LEARNING_EXTRACTOR=on): não chama modelo nem RPC", async () => {
    for (const env of [{}, { GUEST_AI_LEARNING_EXTRACTOR: "ON" }, { GUEST_AI_LEARNING_EXTRACTOR: "true" }]) {
      const p = provider(out(WIFI));
      const propose = vi.fn();
      const r = await extractAndProposeLearnings({ trigger: "checkout_done", propertyId: P1, messages: CONV, traceId: "t" }, { env, provider: p, propose, log: () => {} });
      expect(r.status).toBe("off");
      expect(p.calls).toBe(0);
      expect(propose).not.toHaveBeenCalled();
    }
  });

  it("sem conversa de hóspede E de equipe: não chama o modelo", async () => {
    const p = provider(out(WIFI));
    const r = await extractAndProposeLearnings(
      { trigger: "checkout_done", propertyId: P1, messages: [{ id: "x", speaker: "guest", text: "Oi" }], traceId: "t" },
      { env: ON, provider: p, propose: vi.fn(), log: () => {} },
    );
    expect(r).toMatchObject({ status: "skipped", reason: "no_conversation" });
    expect(p.calls).toBe(0);
  });

  it("confirmação do hóspede sem nenhuma evidência do hóspede é descartada", () => {
    const prompt = buildLearningPrompt("checkout_done", CONV)!;
    const r = parseLearningOutput(out({ ...WIFI, evidencias: ["m2"], confirmacao_hospede: true }), prompt, "checkout_done");
    expect(r.candidates).toHaveLength(0);
    expect(r.dropped).toEqual(["guest_confirmation_without_guest"]);
  });

  it("categoria fora da lista, resposta malformada e no máximo 5 candidatos", () => {
    const prompt = buildLearningPrompt("checkout_done", CONV)!;
    expect(parseLearningOutput(out({ ...WIFI, categoria: "senhas" }), prompt, "checkout_done").dropped).toEqual(["category_invalid"]);
    expect(parseLearningOutput("x", prompt, "checkout_done")).toEqual({ candidates: [], dropped: ["malformed"] });
    const many = parseLearningOutput({ candidatos: Array.from({ length: 9 }, () => WIFI) }, prompt, "checkout_done");
    expect(many.candidates).toHaveLength(5);
  });

  it("o modelo vê apelidos (m1, m2…), nunca os ids reais", () => {
    const prompt = buildLearningPrompt("checkout_done", CONV)!;
    const text = JSON.stringify(prompt.messages);
    expect(text).toContain("[m1]");
    expect(text).not.toContain("a1");
  });

  it("falha do modelo: nada é proposto e nada lança", async () => {
    const p: LlmProvider = { id: "f", complete: async () => ({ kind: "error", error: { code: "bad_request", retryable: false } as never, usage: null, requestId: null }) };
    const propose = vi.fn();
    const r = await extractAndProposeLearnings({ trigger: "checkout_done", propertyId: P1, messages: CONV, traceId: "t" }, { env: ON, provider: p, propose, log: () => {} });
    expect(r.status).toBe("failed");
    expect(propose).not.toHaveBeenCalled();
  });
});

describe("gatilho: atendimento resolvido pela equipe", () => {
  function admin(conv: Record<string, unknown> | null, rows: Array<Record<string, unknown>>) {
    const q = (data: unknown) => {
      const b: Record<string, unknown> = {};
      for (const k of ["select", "eq", "order", "limit"]) b[k] = () => b;
      b["maybeSingle"] = async () => ({ data });
      b["then"] = (res: (v: unknown) => unknown) => res({ data });
      return b;
    };
    return { from: (t: string) => (t === "property_chat_conversations" ? q(conv) : q(rows)) };
  }
  const ROWS = [
    { id: "a3", role: "user", sender_type: "guest", content: "Liguei e funcionou, obrigado!", is_internal_note: false },
    { id: "a2", role: "assistant", sender_type: "human", content: "Ligue o repetidor branco atrás da TV da sala.", is_internal_note: false },
    { id: "a1", role: "user", sender_type: "guest", content: "O Wi-Fi não pega na varanda.", is_internal_note: false },
  ];

  it("conversa resolvida com atuação da equipe ⇒ propõe com o imóvel DA CONVERSA", async () => {
    const propose = vi.fn(async () => ({ ok: true as const, id: "e1", duplicate: false }));
    const r = await learnFromResolvedConversation("c1", {
      env: ON,
      admin: admin({ id: "c1", property_id: P2, status: "resolved", handoff_at: "2026-11-10T10:00:00Z", assigned_to: null }, ROWS),
      provider: provider(out(WIFI)),
      propose,
      log: () => {},
    });
    expect(r?.proposed).toBe(1);
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ propertyId: P2, evidence: expect.objectContaining({ propertyId: P2 }) }));
  });

  it("sem atuação da equipe, não resolvida ou desligado ⇒ não chama o modelo", async () => {
    for (const [env, conv] of [
      [ON, { id: "c1", property_id: P1, status: "resolved", handoff_at: null, assigned_to: null }],
      [ON, { id: "c1", property_id: P1, status: "open", handoff_at: "x", assigned_to: null }],
      [{}, { id: "c1", property_id: P1, status: "resolved", handoff_at: "x", assigned_to: null }],
    ] as const) {
      const p = provider(out(WIFI));
      const r = await learnFromResolvedConversation("c1", { env, admin: admin(conv, ROWS), provider: p, propose: vi.fn(), log: () => {} });
      expect(r === null || r.status !== "done").toBe(true);
      expect(p.calls).toBe(0);
    }
  });

  it("mapeamento dos falantes", () => {
    expect(speakerFromRow({ role: "user", sender_type: "guest" })).toBe("guest");
    expect(speakerFromRow({ role: "assistant", sender_type: "human" })).toBe("team");
    expect(speakerFromRow({ role: "assistant", sender_type: "ai" })).toBe("ai");
    expect(speakerFromRow({ is_internal_note: true, role: "assistant", sender_type: "human" })).toBe("internal_note");
  });
});
