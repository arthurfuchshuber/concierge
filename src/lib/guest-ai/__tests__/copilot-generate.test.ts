/**
 * COPILOTO · frente 1 (motor e Gateway). A cadeia REAL (`runTurnChain`) com o gerador REAL do Copiloto e o
 * Gateway REAL (`generateGuestLlm`) — só o TRANSPORTE é falso (nenhuma rede, nenhuma chamada a modelo).
 * Cobre: sugestão disponível com contexto/intenção/avisos, chave mestra, idempotência e concorrência,
 * teto diário e por turno, escopo recusado, substituição antes da rede, falhas do provedor (indisponível,
 * timeout, resposta inválida), controles D9 (promessa de entrada antecipada sem autorização, credenciais
 * nunca no prompt) e a pausa humana (equipe no comando NÃO impede a sugestão, só avisa).
 */
import { readdirSync, readFileSync } from "node:fs";
import pathMod from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  generateCopilotSuggestion,
  projectOutcome,
  type CopilotGenerateDeps,
  type CopilotPorts,
} from "@/lib/guest-ai/copilot/generate.server";
import {
  createCopilotGenerator,
  copilotInputTokenBound,
  CopilotGeneratorStop,
} from "@/lib/guest-ai/copilot/generator.server";
import { triggerCopilotSuggestion } from "@/lib/guest-ai/copilot/trigger.server";
import {
  copilotDailyLimitUsd,
  COPILOT_DEFAULT_DAILY_COST_USD,
  copilotGenerationProperties,
  copilotPropertyAllowed,
  copilotFlags,
  copilotModelId,
  COPILOT_STATES,
  COPILOT_WARNINGS,
} from "@/lib/guest-ai/copilot/contracts";
import type {
  CopilotClaimInput,
  CopilotResultInput,
  CopilotStore,
} from "@/lib/guest-ai/copilot/store.server";
import { createCopilotStore } from "@/lib/guest-ai/copilot/store.server";
import { copilotRpcFrom, COPILOT_RPC_FUNCTIONS } from "@/lib/guest-ai/data/client.server";
import { GuestAiScopeError } from "@/lib/guest-ai/data/scope.server";
import type { ProviderOutcome, ProviderRequest } from "@/lib/guest-ai/llm/providers/types";
import { llmMessageText } from "@/lib/guest-ai/llm/contracts";
import { GUEST_AI_DEFAULT_MODEL } from "@/lib/guest-ai/orchestrator/contracts";
import type { OwnershipLoad } from "@/lib/guest-ai/data/conversation-ownership.server";
import { CONV, ctx, history, turn, v4, silence } from "./helpers/b23-chain";
import { fakeProvider, okJson } from "./helpers/copilot-provider";

const ON = { GUEST_AI_COPILOT_GENERATION: "on", GUEST_AI_COPILOT_GENERATION_PROPERTY_IDS: "p1" };
const REQ = {
  surface: "guide_chat" as const,
  conversationId: "c1",
  messageId: "m1",
  expectedOwnerId: "t1",
};
const SECRET_CANARY = "PORTA-9931-CANARIO";

/** Banco das sugestões em memória com a MESMA semântica de reivindicação da migration (uma por mensagem). */
class MemoryCopilotStore implements CopilotStore {
  rows = new Map<
    string,
    { id: string; state: string; attempt: number; result?: CopilotResultInput }
  >();
  claims: CopilotClaimInput[] = [];
  spentUsd = 0;
  stateOverride: string | null = null;
  async claim(i: CopilotClaimInput) {
    this.claims.push(i);
    const key = `${i.conversationId}:${i.triggerMessageId}`;
    const ex = this.rows.get(key);
    if (ex) return { kind: "exists" as const, suggestionId: ex.id, state: ex.state as never };
    if (this.spentUsd + i.turnCostCeilingUsd > i.dailyCostLimitUsd) {
      this.rows.set(key, { id: `s-${this.rows.size + 1}`, state: "generation_failed", attempt: 1 });
      return { kind: "daily_budget_exceeded" as const, suggestionId: `s-${this.rows.size}` };
    }
    const row = { id: `s-${this.rows.size + 1}`, state: "generating", attempt: 1 };
    this.rows.set(key, row);
    return { kind: "claimed" as const, suggestionId: row.id, attempt: 1, reclaimed: false };
  }
  async state(id: string) {
    const r = [...this.rows.values()].find((x) => x.id === id);
    if (!r) return { state: "missing" as const, attempt: 0 };
    return { state: (this.stateOverride ?? r.state) as never, attempt: r.attempt };
  }
  async store(i: CopilotResultInput) {
    const r = [...this.rows.values()].find((x) => x.id === i.suggestionId);
    if (!r) return { kind: "missing" as const };
    if (r.state !== "generating" || r.attempt !== i.attempt) return { kind: "stale" as const };
    r.state = i.state;
    r.result = i;
    this.spentUsd += i.gateway.costUsd;
    return { kind: "stored" as const };
  }
  only() {
    return [...this.rows.values()][0]!;
  }
}

function ports(
  over: Partial<CopilotPorts> = {},
  onProps?: (p: {
    onDossierEntries: (n: number) => void;
    onHistoryMessages: (n: number) => void;
  }) => void,
): CopilotGenerateDeps["ports"] {
  return (_t, _db, meta) => {
    onProps?.(meta);
    return {
      loadContext: async () => ctx(),
      loadHistory: async () => {
        const h = history();
        meta.onHistoryMessages(h.status === "available" ? h.entries.length : 0);
        return h;
      },
      loadDossiers: async () => null,
      loadStayAuthorizationSource: async () => {
        throw new Error("sem_fonte");
      },
      loadSenderIdentitySource: async () => ({
        lookup: "ok",
        conversationListingId: null,
        reservationListingId: null,
        listings: [],
        twins: [],
        prefs: [],
        accounts: [],
      }),
      ...over,
    };
  };
}

const ownershipRow = (over: Record<string, unknown> = {}): OwnershipLoad => ({
  status: "identified",
  row: {
    id: "c1",
    status: "ai",
    assigned_to: null,
    handoff_reason: null,
    handoff_urgency: null,
    handoff_at: null,
    resolved_at: null,
    ai_paused: false,
    paused_until: null,
    ...over,
  } as never,
});

function deps(
  provider: ReturnType<typeof fakeProvider>,
  over: Partial<CopilotGenerateDeps> & { store?: MemoryCopilotStore } = {},
): CopilotGenerateDeps & { store: MemoryCopilotStore } {
  const store = over.store ?? new MemoryCopilotStore();
  return {
    db: {
      from: () => {
        throw new Error("o teste não usa banco real");
      },
    },
    store,
    env: ON,
    validateTurnScope: async () => turn(),
    loadOwnership: async () => ownershipRow(),
    ports: ports(),
    provider,
    log: () => {},
    ...over,
  } as CopilotGenerateDeps & { store: MemoryCopilotStore };
}

describe("Copiloto · geração com a cadeia real e o Gateway real (transporte falso)", () => {
  it("resposta válida ⇒ sugestão DISPONÍVEL com texto, intenção, contexto e custo; uma única chamada ao provedor", async () => {
    const p = fakeProvider(okJson(v4()));
    const d = deps(p);
    const r = await generateCopilotSuggestion(REQ, d);
    expect(r).toEqual({ status: "stored", suggestionId: "s-1", state: "available", code: null });
    expect(p.calls).toBe(1);
    const res = d.store.only().result!;
    expect(res.text).toBe("O check-in começa às 15h, no horário do imóvel.");
    expect(res.intents).toEqual(["informational_query"]);
    expect(res.outcomeKind).toBe("reply");
    expect(res.context).toMatchObject({
      reservationLinked: true,
      historyMessages: 1,
      credentialPolicy: "deny",
      humanInCommand: false,
    });
    expect(res.context.stayPhase).toBeTruthy();
    expect(res.gateway.modelId).toBe(GUEST_AI_DEFAULT_MODEL);
    expect(res.gateway.inputTokens).toBe(900);
    expect(res.gateway.costUsd).toBeGreaterThan(0);
    // reivindicação com os tetos aprovados e a identidade do TURNO validado (nunca do pedido)
    expect(d.store.claims[0]).toMatchObject({
      tenantId: "t1",
      propertyId: "p1",
      conversationId: CONV,
      dailyCostLimitUsd: 3,
      turnCostCeilingUsd: 0.15,
    });
  });

  it("chave mestra desligada ⇒ nada é lido, reivindicado ou chamado", async () => {
    const p = fakeProvider(okJson(v4()));
    const d = deps(p, { env: {} });
    expect(await generateCopilotSuggestion(REQ, d)).toEqual({
      status: "skipped",
      code: "generation_off",
      detail: null,
    });
    expect(d.store.claims).toHaveLength(0);
    expect(p.calls).toBe(0);
  });

  it("idempotência: a mesma mensagem pedida duas vezes (canal + tela) e em paralelo ⇒ UMA geração", async () => {
    const p = fakeProvider(okJson(v4()));
    const store = new MemoryCopilotStore();
    const [a, b, c] = await Promise.all([
      generateCopilotSuggestion(REQ, deps(p, { store })),
      generateCopilotSuggestion(REQ, deps(p, { store })),
      generateCopilotSuggestion(REQ, deps(p, { store })),
    ]);
    expect([a, b, c].filter((x) => x.status === "stored")).toHaveLength(1);
    expect([a, b, c].filter((x) => x.status === "exists")).toHaveLength(2);
    expect(p.calls).toBe(1);
    const again = await generateCopilotSuggestion(REQ, deps(p, { store }));
    expect(again.status).toBe("exists");
    expect(p.calls).toBe(1);
  });

  it("escopo de imóveis: sem lista (ausente, vazia ou *) ⇒ TODOS os imóveis geram; lista ⇒ só os listados", async () => {
    for (const list of [undefined, "", " ", "*", " * ", " , "]) {
      const p = fakeProvider(okJson(v4()));
      const env: Record<string, string> = { GUEST_AI_COPILOT_GENERATION: "on" };
      if (list !== undefined) env.GUEST_AI_COPILOT_GENERATION_PROPERTY_IDS = list;
      const d = deps(p, { env });
      expect((await generateCopilotSuggestion(REQ, d)).status, String(list)).toBe("stored");
      expect(d.store.claims[0]).toMatchObject({ propertyId: "p1" });
    }
    for (const list of ["p2", "p2,p3", "P1"]) {
      const p = fakeProvider(okJson(v4()));
      const d = deps(p, {
        env: { GUEST_AI_COPILOT_GENERATION: "on", GUEST_AI_COPILOT_GENERATION_PROPERTY_IDS: list },
      });
      expect(await generateCopilotSuggestion(REQ, d)).toEqual({
        status: "skipped",
        code: "property_not_allowlisted",
        detail: null,
      });
      expect(d.store.claims).toHaveLength(0);
      expect(p.calls).toBe(0);
    }
    // o id vem do turno re-derivado do banco, não do pedido
    const p = fakeProvider(okJson(v4()));
    const d = deps(p, {
      env: {
        GUEST_AI_COPILOT_GENERATION: "on",
        GUEST_AI_COPILOT_GENERATION_PROPERTY_IDS: "p2, p1",
      },
    });
    expect((await generateCopilotSuggestion(REQ, d)).status).toBe("stored");
    expect(d.store.claims[0]).toMatchObject({ propertyId: "p1" });
    expect(copilotGenerationProperties({})).toBeNull();
    expect(copilotPropertyAllowed("qualquer-imovel-novo", {})).toBe(true);
  });

  it("teto diário OBRIGATÓRIO (G1/D3): sem variável ou inválida ⇒ US$ 3,00; válida ⇒ respeitada até US$ 50", async () => {
    expect(COPILOT_DEFAULT_DAILY_COST_USD).toBe(3);
    expect(copilotDailyLimitUsd({})).toBe(3);
    expect(copilotDailyLimitUsd({ GUEST_AI_COPILOT_DAILY_COST_USD: "" })).toBe(3);
    expect(copilotDailyLimitUsd({ GUEST_AI_COPILOT_DAILY_COST_USD: "   " })).toBe(3);
    expect(copilotDailyLimitUsd({ GUEST_AI_COPILOT_DAILY_COST_USD: "0" })).toBe(3);
    expect(copilotDailyLimitUsd({ GUEST_AI_COPILOT_DAILY_COST_USD: "-1" })).toBe(3);
    expect(copilotDailyLimitUsd({ GUEST_AI_COPILOT_DAILY_COST_USD: "abc" })).toBe(3);
    expect(copilotDailyLimitUsd({ GUEST_AI_COPILOT_DAILY_COST_USD: "Infinity" })).toBe(3);
    expect(copilotDailyLimitUsd({ GUEST_AI_COPILOT_DAILY_COST_USD: "5" })).toBe(5);
    expect(copilotDailyLimitUsd({ GUEST_AI_COPILOT_DAILY_COST_USD: "0.25" })).toBe(0.25);
    expect(copilotDailyLimitUsd({ GUEST_AI_COPILOT_DAILY_COST_USD: "300" })).toBe(50);
    // sem variável: o teto de US$ 3,00 vai ao banco e bloqueia o gasto alto (nenhuma chamada ao modelo)
    {
      const p = fakeProvider(okJson(v4()));
      const store = new MemoryCopilotStore();
      store.spentUsd = 50;
      const d = deps(p, { store, env: { GUEST_AI_COPILOT_GENERATION: "on" } });
      expect((await generateCopilotSuggestion(REQ, d)).status).toBe("daily_budget_exceeded");
      expect(store.claims[0]).toMatchObject({ dailyCostLimitUsd: 3 });
      expect(p.calls).toBe(0);
    }
    // sem variável e abaixo do teto padrão ⇒ gera normalmente
    {
      const p = fakeProvider(okJson(v4()));
      const store = new MemoryCopilotStore();
      store.spentUsd = 1;
      const d = deps(p, { store, env: { GUEST_AI_COPILOT_GENERATION: "on" } });
      expect((await generateCopilotSuggestion(REQ, d)).status).toBe("stored");
      expect(store.claims[0]).toMatchObject({ dailyCostLimitUsd: 3 });
    }
    // com teto configurado: atingido ⇒ nenhuma chamada
    {
      const p = fakeProvider(okJson(v4()));
      const store = new MemoryCopilotStore();
      store.spentUsd = 0.9;
      const d = deps(p, {
        store,
        env: { GUEST_AI_COPILOT_GENERATION: "on", GUEST_AI_COPILOT_DAILY_COST_USD: "1" },
      });
      expect((await generateCopilotSuggestion(REQ, d)).status).toBe("daily_budget_exceeded");
      expect(p.calls).toBe(0);
    }
  });

  it("escopo recusado no backend (mensagem de outra conversa, outro tenant) ⇒ nada é reivindicado", async () => {
    const p = fakeProvider(okJson(v4()));
    const d = deps(p, {
      validateTurnScope: async () => {
        throw new GuestAiScopeError("tenant_mismatch");
      },
    });
    expect(await generateCopilotSuggestion(REQ, d)).toEqual({
      status: "skipped",
      code: "scope_refused",
      detail: "tenant_mismatch",
    });
    expect(d.store.claims).toHaveLength(0);
    expect(p.calls).toBe(0);
  });

  it("mensagem mais nova do hóspede chegou durante a geração ⇒ a sugestão antiga NÃO chama o Gateway", async () => {
    const p = fakeProvider(okJson(v4()));
    const store = new MemoryCopilotStore();
    store.stateOverride = "superseded";
    const r = await generateCopilotSuggestion(REQ, deps(p, { store }));
    expect(p.calls).toBe(0);
    expect(r.status).toBe("stored");
    expect(store.only().result).toMatchObject({
      state: "generation_failed",
      outcomeCode: "superseded",
    });
  });

  it.each<[string, ProviderOutcome, string]>([
    [
      "provedor indisponível (5xx)",
      {
        kind: "error",
        error: { code: "provider_unavailable", retryable: true, httpStatus: 503 },
        usage: null,
        requestId: null,
      } as ProviderOutcome,
      "provider_unavailable",
    ],
    [
      "limite de requisições (429)",
      {
        kind: "error",
        error: { code: "rate_limited", retryable: true, httpStatus: 429 },
        usage: null,
        requestId: null,
      } as ProviderOutcome,
      "rate_limited",
    ],
    [
      "erro de autenticação do provedor",
      {
        kind: "error",
        error: { code: "auth", retryable: false, httpStatus: 401 },
        usage: null,
        requestId: null,
      } as ProviderOutcome,
      "auth",
    ],
  ])("%s ⇒ falha de geração com o código do Gateway; nenhum texto", async (_n, outcome, code) => {
    const p = fakeProvider(outcome);
    const d = deps(p);
    const r = await generateCopilotSuggestion(REQ, d);
    expect(r).toMatchObject({ status: "stored", state: "generation_failed" });
    const res = d.store.only().result!;
    expect(res.text).toBeNull();
    expect(res.gateway.error).toBe(code);
    expect(res.outcomeKind).toBe("technical_error");
  });

  it("resposta inválida (não-JSON / fora do contrato) ⇒ recusada pela cadeia; nada vira sugestão", async () => {
    const notJson = fakeProvider({
      kind: "ok",
      text: "Claro! O check-in é às 15h.",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      requestId: null,
    });
    const d1 = deps(notJson);
    await generateCopilotSuggestion(REQ, d1);
    expect(d1.store.only().result).toMatchObject({ state: "generation_failed", text: null });
    const wrongShape = fakeProvider(okJson({ resposta: "oi" }));
    const d2 = deps(wrongShape);
    await generateCopilotSuggestion(REQ, d2);
    expect(d2.store.only().result).toMatchObject({
      state: "generation_failed",
      text: null,
      outcomeKind: "refused",
    });
  });

  it("timeout do provedor ⇒ falha de geração dentro do prazo (o atendimento humano não espera)", async () => {
    const p = fakeProvider(() => new Promise<ProviderOutcome>(() => {}));
    const d = deps(p, { deadlineMs: 1_500 });
    const t0 = Date.now();
    const r = await generateCopilotSuggestion(REQ, d);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r).toMatchObject({ status: "stored", state: "generation_failed" });
    expect(d.store.only().result!.text).toBeNull();
  }, 20_000);

  it("D9 · promessa de ENTRADA ANTECIPADA sem autorização formal ⇒ recusada (nunca vira sugestão)", async () => {
    const early = v4({
      reply: "Pode entrar às 10h.",
      commitments: ["entrada às 10h"],
      commitmentKinds: ["early_checkin"],
      groundedOn: ["ctx:entrada_antecipada"],
    });
    const d = deps(fakeProvider(okJson(early)));
    await generateCopilotSuggestion(REQ, d);
    const res = d.store.only().result!;
    expect(res.state).toBe("generation_failed");
    expect(res.text).toBeNull();
    expect(res.outcomeCode).toBe("semantic_block");
    expect(res.warnings).toContain("unauthorized_commitment");
  });

  it("D9 · credencial no contexto ⇒ a cadeia recusa ANTES do Gateway (o modelo nunca recebe senha)", async () => {
    const p = fakeProvider(okJson(v4()));
    const leaky = ctx({ credentials: { lockCode: SECRET_CANARY } } as never);
    const d = deps(p, { ports: ports({ loadContext: async () => leaky }) });
    await generateCopilotSuggestion(REQ, d);
    expect(p.calls).toBe(0);
    expect(d.store.only().result).toMatchObject({
      state: "generation_failed",
      outcomeKind: "refused",
      text: null,
    });
  });

  it("D9 · o prompt enviado ao provedor tem a decisão D9 e nenhuma credencial", async () => {
    let seen = "";
    const p = fakeProvider(okJson(v4()));
    const orig = p.complete.bind(p);
    p.complete = async (req: ProviderRequest, s?: AbortSignal) => {
      seen = req.messages.map((m) => llmMessageText(m.content)).join("\n");
      return orig(req as never, s as never);
    };
    await generateCopilotSuggestion(REQ, deps(p));
    expect(seen).toContain("politica_d9");
    expect(seen).not.toContain(SECRET_CANARY);
    expect(seen).not.toMatch(/lock_code|gate_code|wifi_password|pin_code/);
  });

  it("D9 · texto do modelo com marca de expansão do guia ([[info:…]]) ⇒ nunca vira sugestão (a rotina humana expandiria senhas)", async () => {
    for (const reply of [
      "A senha é [[info:lock-code]].",
      "Veja [[ tag:checkin ]] aqui",
      "Wi-Fi: [[INFO:wifi]]",
    ]) {
      const d = deps(fakeProvider(okJson(v4({ reply }))));
      await generateCopilotSuggestion(REQ, d);
      const res = d.store.only().result!;
      expect(res.text).toBeNull();
      expect(res.state).toBe("generation_failed");
    }
    // mesmo que a cadeia aprovasse o texto, a projeção do Copiloto o bloqueia (defesa própria, determinística)
    const audit = {
      decision: null,
      checks: {
        unknownFacts: 0,
        sourceConflicts: 0,
        senderIdentity: null,
        dossierScope: "ok",
        credentialPolicy: "deny",
      },
    } as never;
    const situation = {
      humanAction: { needed: false, urgency: null },
      existingCase: "none",
      emergency: false,
      intents: ["informational_query"],
    };
    const blocked = projectOutcome(
      {
        kind: "reply",
        text: "As regras estão em [[info:house-rules]].",
        strategy: "answer",
        situation,
        audit,
      } as never,
      { surface: "guide_chat", humanInCommand: false, reservationLinked: true },
    );
    expect(blocked).toMatchObject({
      state: "generation_failed",
      text: null,
      outcomeCode: "template_tag_in_output",
    });
    const ok = projectOutcome(
      {
        kind: "reply",
        text: "As regras estão no guia, na seção da casa.",
        strategy: "answer",
        situation,
        audit,
      } as never,
      { surface: "guide_chat", humanInCommand: false, reservationLinked: true },
    );
    expect(ok).toMatchObject({
      state: "available",
      text: "As regras estão no guia, na seção da casa.",
    });
  });

  it("equipe no comando (IA pausada) ⇒ a sugestão AINDA é gerada para a equipe, com aviso — o veto é do envio autônomo", async () => {
    const d = deps(fakeProvider(okJson(v4())), {
      loadOwnership: async () =>
        ownershipRow({ status: "assigned", assigned_to: "u1", ai_paused: true }),
    });
    await generateCopilotSuggestion(REQ, d);
    const res = d.store.only().result!;
    expect(res.state).toBe("available");
    expect(res.context.humanInCommand).toBe(true);
    expect(res.warnings).toContain("human_in_command");
  });

  it("silêncio do modelo ⇒ sem sugestão (nada a enviar)", async () => {
    const d = deps(fakeProvider(okJson(silence())));
    await generateCopilotSuggestion(REQ, d);
    expect(d.store.only().result).toMatchObject({
      state: "no_suggestion",
      text: null,
      outcomeKind: "silence",
    });
  });

  it("falha inesperada em uma porta ⇒ técnica e fail-closed (sem texto; a linha não fica 'gerando')", async () => {
    const d = deps(fakeProvider(okJson(v4())), {
      ports: ports({
        loadHistory: async () => {
          throw new Error("boom com dado do hóspede");
        },
      }),
    });
    const r = await generateCopilotSuggestion(REQ, d);
    expect(r).toMatchObject({ status: "stored", state: "generation_failed" });
    expect(d.store.only().state).toBe("generation_failed");
    expect(JSON.stringify(d.store.only().result)).not.toContain("dado do hóspede");
  });
});

describe("Copiloto · gerador (limites próprios sobre o Gateway)", () => {
  const prompt = {
    system: "s",
    messages: [{ role: "user" as const, content: "olá" }],
    sourceIds: null,
    promptVersion: "x",
  };
  it("custo por turno acima do teto ⇒ bloqueia antes da rede", async () => {
    const p = fakeProvider(okJson(v4()));
    const g = createCopilotGenerator({
      modelId: GUEST_AI_DEFAULT_MODEL,
      maxOutputTokens: 1536,
      reasoningEffort: "low",
      remainingMs: () => 10_000,
      beforeNetwork: async () => true,
      traceId: "t",
      maxTurnCostUsd: 0.000001,
      provider: p,
      log: () => {},
    });
    await expect(g.generate(prompt, new AbortController().signal)).rejects.toMatchObject({
      code: "budget_turn_exceeded",
    });
    expect(p.calls).toBe(0);
  });
  it("uma chamada por geração; prazo esgotado e modelo fora do registro bloqueiam antes da rede", async () => {
    const p = fakeProvider(okJson(v4()));
    const mk = (over: Record<string, unknown> = {}) =>
      createCopilotGenerator({
        modelId: GUEST_AI_DEFAULT_MODEL,
        maxOutputTokens: 512,
        reasoningEffort: "low",
        remainingMs: () => 10_000,
        beforeNetwork: async () => true,
        traceId: "t",
        provider: p,
        log: () => {},
        ...over,
      });
    const g = mk();
    await g.generate(prompt, new AbortController().signal);
    await expect(g.generate(prompt, new AbortController().signal)).rejects.toBeInstanceOf(
      CopilotGeneratorStop,
    );
    await expect(
      mk({ remainingMs: () => 0 }).generate(prompt, new AbortController().signal),
    ).rejects.toMatchObject({ code: "deadline_expired" });
    await expect(
      mk({ modelId: "nao/existe" }).generate(prompt, new AbortController().signal),
    ).rejects.toMatchObject({ code: "model_unregistered" });
    expect(p.calls).toBe(1);
  });
  it("limite superior de tokens de entrada: bytes UTF-8 + moldura; prompt ilegível ⇒ 0", () => {
    expect(copilotInputTokenBound(prompt)).toBe(1 + 4 + 64 + 16 * 2); // "olá" = 4 bytes UTF-8
    expect(
      copilotInputTokenBound({ ...prompt, messages: [{ role: "user", content: 1 as never }] }),
    ).toBe(0);
  });
  it("modelo: só do registro; padrão da Guest AI", () => {
    expect(copilotModelId({})).toBe(GUEST_AI_DEFAULT_MODEL);
    expect(copilotModelId({ GUEST_AI_COPILOT_MODEL: "google/gemini-3.1-flash-lite" })).toBe(
      "google/gemini-3.1-flash-lite",
    );
    expect(copilotModelId({ GUEST_AI_COPILOT_MODEL: "x/y" })).toBe(GUEST_AI_DEFAULT_MODEL);
    expect(copilotFlags({ GUEST_AI_COPILOT_GENERATION: "1" }).generation).toBe(false);
  });
});

describe("Copiloto · porta fechada, adaptador e disparo", () => {
  it("a porta recusa qualquer RPC fora da lista fechada sem chamar o cliente", async () => {
    const rpc = vi.fn(async () => ({ data: { result: "x" }, error: null }));
    const port = copilotRpcFrom({ rpc } as never);
    expect(await port.call("copilot_edit" as never, {})).toEqual({
      data: null,
      error: { code: "copilot_rpc_not_allowed" },
    });
    expect(await port.call("shadow_trip" as never, {})).toEqual({
      data: null,
      error: { code: "copilot_rpc_not_allowed" },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(COPILOT_RPC_FUNCTIONS).not.toContain("copilot_claim_send");
    const ac = new AbortController();
    ac.abort();
    expect(
      await copilotRpcFrom({ rpc } as never, ac.signal).call("copilot_purge_expired", {}),
    ).toEqual({ data: null, error: { code: "aborted" } });
  });
  it("adaptador: respostas fora do vocabulário ⇒ erro (fail-closed)", async () => {
    const st = (data: unknown, error: unknown = null) =>
      createCopilotStore({ call: async () => ({ data, error }) });
    const claimIn = {
      tenantId: "t",
      propertyId: "p",
      conversationId: "c",
      triggerMessageId: "m",
      surface: "airbnb",
      dailyCostLimitUsd: 3,
      turnCostCeilingUsd: 0.15,
    };
    expect(
      await st({
        result: "claimed",
        suggestion_id: "s",
        generation_attempts: 2,
        reclaimed: true,
      }).claim(claimIn),
    ).toEqual({ kind: "claimed", suggestionId: "s", attempt: 2, reclaimed: true });
    expect(
      await st({ result: "exists", suggestion_id: "s", state: "available" }).claim(claimIn),
    ).toEqual({ kind: "exists", suggestionId: "s", state: "available" });
    expect(await st({ result: "invalid", reason: "scope" }).claim(claimIn)).toEqual({
      kind: "invalid",
      reason: "scope",
    });
    expect(await st({ result: "weird" }).claim(claimIn)).toEqual({ kind: "error" });
    expect(await st(null, { message: "x" }).claim(claimIn)).toEqual({ kind: "error" });
    expect(await st({ result: "claimed" }).claim(claimIn)).toEqual({ kind: "error" });
    expect(await st({ state: "generating", generation_attempts: 1 }).state("s")).toEqual({
      state: "generating",
      attempt: 1,
    });
    const resIn: CopilotResultInput = {
      suggestionId: "s",
      attempt: 1,
      state: "available",
      text: "t",
      internalQuestion: null,
      intents: [],
      strategy: null,
      handoffNeeded: false,
      handoffUrgency: null,
      outcomeKind: "reply",
      outcomeCode: null,
      warnings: [],
      context: {
        stayPhase: null,
        reservationLinked: null,
        historyMessages: null,
        dossierEntries: null,
        credentialPolicy: null,
        senderIdentity: null,
        humanInCommand: null,
      },
      gateway: {
        modelId: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: 0,
        latencyMs: null,
        error: null,
      },
    };
    expect(await st({ result: "stale" }).store(resIn)).toEqual({ kind: "stale" });
    expect(await st({ result: "stored" }).store(resIn)).toEqual({ kind: "stored" });
    expect(await st({ result: "nope" }).store(resIn)).toEqual({ kind: "error" });
  });
  it("disparo dos canais: chave desligada ou ids inválidos ⇒ não faz nada e nunca lança", () => {
    expect(() =>
      triggerCopilotSuggestion({ surface: "airbnb", conversationId: "x", messageId: "y" }, {}),
    ).not.toThrow();
    expect(() =>
      triggerCopilotSuggestion({ surface: "airbnb", conversationId: "x", messageId: "y" }, ON),
    ).not.toThrow();
  });
  it("projeção do desfecho: só vocabulários fechados; urgência/alerta e pergunta interna", () => {
    const audit = {
      decision: null,
      checks: {
        unknownFacts: 0,
        sourceConflicts: 0,
        senderIdentity: null,
        dossierScope: "ok",
        credentialPolicy: "deny",
      },
    } as never;
    const alert = projectOutcome(
      {
        kind: "urgent_internal_alert",
        situation: {
          humanAction: { needed: true, urgency: "high" },
          existingCase: "none",
          emergency: true,
          intents: ["emergency"],
        },
        audit,
      } as never,
      { surface: "whatsapp", humanInCommand: true, reservationLinked: false },
    );
    expect(alert).toMatchObject({
      state: "no_suggestion",
      handoffNeeded: true,
      handoffUrgency: "high",
    });
    expect(alert.warnings).toEqual(
      expect.arrayContaining([
        "emergency",
        "handoff_recommended",
        "human_in_command",
        "reservation_not_linked",
      ]),
    );
    const ask = projectOutcome(
      {
        kind: "human_action",
        question: "Confirmar troca de toalhas?",
        situation: {
          humanAction: { needed: true, urgency: "normal" },
          existingCase: "none",
          emergency: false,
          intents: ["operational_request"],
        },
        audit,
      } as never,
      { surface: "guide_chat", humanInCommand: false, reservationLinked: true },
    );
    expect(ask).toMatchObject({
      state: "no_suggestion",
      internalQuestion: "Confirmar troca de toalhas?",
    });
    for (const w of [...alert.warnings, ...ask.warnings]) expect(COPILOT_WARNINGS).toContain(w);
    expect(COPILOT_STATES).toContain(alert.state);
  });
});

describe("Copiloto · isolamento estático (a IA nunca envia)", () => {
  const DIR = pathMod.resolve(__dirname, "..", "copilot");
  const files = readdirSync(DIR).map((n) => pathMod.join(DIR, n));
  const noComments = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  it("copilot/ não referencia rotina de envio, provedor de canal, push, escrita de mensagem nem o slot", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const c = noComments(f);
      expect(c, f).not.toMatch(
        /deliverToAirbnbThread|sendChannexThreadMessage|sinch|sendHumanMessageToConversation|sendWhatsapp|handoff\.(server|functions)|whatsapp\.(server|functions)|sendHandoffPush|sendGuestReplyPush|sendPushToGuest/i,
      );
      expect(c, f).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
      expect(c, f).not.toMatch(/slot\.server|requestGuestAiReply/);
      expect(c, f).not.toMatch(/supabaseAdmin|integrations\/supabase/);
    }
  });
  it("slot.server.ts continua devolvendo null e sem importar o Copiloto", async () => {
    const slot = readFileSync(pathMod.resolve(__dirname, "..", "slot.server.ts"), "utf8");
    expect(slot).not.toMatch(/copilot/);
    const { requestGuestAiReply } = await import("@/lib/guest-ai/slot.server");
    await expect(
      requestGuestAiReply({ surface: "airbnb", conversationId: "c", messageId: "m" }),
    ).resolves.toBeNull();
  });
  it("os canais só importam o DISPARO (trigger), nunca o serviço de geração direto, e o disparo vem antes do fallback inalterado", () => {
    const SRC = pathMod.resolve(__dirname, "..", "..", "..");
    for (const f of [
      "routes/api/public/guide-chat.ts",
      "routes/api/public/whatsapp/sinch-webhook.ts",
      "lib/channex-messages.server.ts",
    ]) {
      const c = readFileSync(pathMod.join(SRC, f), "utf8");
      expect(c, f).toMatch(/guest-ai\/copilot\/trigger\.server/);
      expect(c, f).not.toMatch(
        /copilot\/generate\.server|copilot\/generator\.server|copilot\/store\.server/,
      );
      expect(c.indexOf("triggerCopilotSuggestion("), f).toBeLessThan(
        c.indexOf("requestGuestAiReply("),
      );
      expect(c, f).toMatch(/NO_AI_HANDOFF_REASON/);
    }
  });
});

describe("Copiloto · visão (fotos do hóspede na cadeia real)", () => {
  const IMG = "data:image/jpeg;base64,/9j/AAAA";
  const withImage = () =>
    history("A fechadura está assim, o que faço?", [
      { role: "user", sender_type: "guest", attachment_type: "image", content: "" },
    ]);
  const imageEntry = () => {
    const h = withImage();
    if (h.status !== "available") throw new Error("histórico indisponível");
    return { h, e: h.entries.find((x) => x.media?.kind === "image")! };
  };
  const capture = () => {
    const seen: ProviderRequest[] = [];
    const p = fakeProvider(okJson(v4()));
    const orig = p.complete.bind(p);
    p.complete = async (req: ProviderRequest, s?: AbortSignal) => {
      seen.push(req);
      return orig(req as never, s as never);
    };
    return { p, seen };
  };
  const imageParts = (req: ProviderRequest) =>
    req.messages.flatMap((m) =>
      typeof m.content === "string" ? [] : m.content.filter((x) => x.type === "image_url"),
    );

  it("foto do hóspede no histórico ⇒ vai ao modelo como `image_url`, legendada com o id citável da mensagem", async () => {
    const { h, e } = imageEntry();
    const { p, seen } = capture();
    let calls = 0;
    const d = deps(p, {
      ports: ports({ loadHistory: async () => h }),
      loadImages: async () => {
        calls += 1;
        return [
          {
            status: "loaded",
            messageId: e.messageId,
            at: e.at,
            dataUrl: IMG,
            width: 800,
            height: 600,
            bytes: 1000,
            tokenBound: 1_120,
          },
        ];
      },
    });
    const r = await generateCopilotSuggestion(REQ, d);
    expect(r).toMatchObject({ status: "stored", state: "available" });
    expect(calls).toBe(1);
    expect(imageParts(seen[0]!)).toEqual([{ type: "image_url", image_url: { url: IMG } }]);
    expect(seen[0]!.messages.map((m) => llmMessageText(m.content)).join("\n")).toContain(
      `Foto 1 — mensagem ${e.ref}`,
    );
  });

  it("sem foto no histórico ⇒ nenhuma consulta de imagem; prompt só texto", async () => {
    const { p, seen } = capture();
    let calls = 0;
    const d = deps(p, { loadImages: async () => ((calls += 1), []) });
    await generateCopilotSuggestion(REQ, d);
    expect(calls).toBe(0);
    expect(seen[0]!.messages.every((m) => typeof m.content === "string")).toBe(true);
  });

  it("falha ao carregar a foto ⇒ sugestão gerada mesmo assim, com `[imagem não carregada]` no prompt", async () => {
    const { p, seen } = capture();
    const d = deps(p, {
      ports: ports({ loadHistory: async () => withImage() }),
      loadImages: async () => {
        throw new Error("storage fora");
      },
    });
    const r = await generateCopilotSuggestion(REQ, d);
    expect(r).toMatchObject({ status: "stored", state: "available" });
    expect(imageParts(seen[0]!)).toEqual([]);
    expect(seen[0]!.messages.map((m) => llmMessageText(m.content)).join("\n")).toContain(
      "[imagem não carregada]",
    );
  });

  it("foto com falha de leitura (`failed`) ⇒ aviso com o id citável; nenhuma imagem enviada", async () => {
    const { h, e } = imageEntry();
    const { p, seen } = capture();
    const d = deps(p, {
      ports: ports({ loadHistory: async () => h }),
      loadImages: async () => [
        { status: "failed", messageId: e.messageId, at: e.at, reason: "download_failed" },
      ],
    });
    await generateCopilotSuggestion(REQ, d);
    expect(imageParts(seen[0]!)).toEqual([]);
    expect(seen[0]!.messages.map((m) => llmMessageText(m.content)).join("\n")).toContain(
      `[imagem não carregada] — mensagem ${e.ref}`,
    );
  });
});

describe("Copiloto · memória do hóspede recorrente na cadeia real", () => {
  const capture = () => {
    const seen: ProviderRequest[] = [];
    const p = fakeProvider(okJson(v4()));
    const orig = p.complete.bind(p);
    p.complete = async (req: ProviderRequest, s?: AbortSignal) => {
      seen.push(req);
      return orig(req as never, s as never);
    };
    return { p, seen };
  };
  const text = (req: ProviderRequest) =>
    req.messages.map((m) => llmMessageText(m.content)).join("\n");

  it("hóspede recorrente ⇒ o prompt leva o bloco do perfil com estadias e preferências", async () => {
    const { p, seen } = capture();
    const d = deps(p, {
      ports: ports({
        loadGuestProfile: async () => ({
          status: "found",
          via: "ota",
          stayCount: 2,
          lastStayCheckout: "2026-05-10",
          notes: [{ categoria: "preferencia", texto: "Pede travesseiros extras" }],
        }),
      }),
    });
    expect(await generateCopilotSuggestion(REQ, d)).toMatchObject({
      status: "stored",
      state: "available",
    });
    const t = text(seen[0]!);
    expect(t).toContain("<perfil_do_hospede>");
    expect(t).toContain('"status":"recorrente"');
    expect(t).toContain("Pede travesseiros extras");
  });

  it("falha ao ler o perfil ⇒ sugestão gerada mesmo assim, perfil `indisponivel`", async () => {
    const { p, seen } = capture();
    const d = deps(p, {
      ports: ports({
        loadGuestProfile: async () => {
          throw new Error("tabela ausente");
        },
      }),
    });
    expect(await generateCopilotSuggestion(REQ, d)).toMatchObject({
      status: "stored",
      state: "available",
    });
    expect(text(seen[0]!)).toContain('"status":"indisponivel"');
  });

  it("sem porta de perfil (comportamento anterior) ⇒ nenhum bloco de perfil", async () => {
    const { p, seen } = capture();
    await generateCopilotSuggestion(REQ, deps(p));
    const user = seen[0]!.messages
      .filter((m) => m.role === "user")
      .map((m) => llmMessageText(m.content))
      .join("\n");
    expect(user).not.toContain("<perfil_do_hospede>");
  });
});
