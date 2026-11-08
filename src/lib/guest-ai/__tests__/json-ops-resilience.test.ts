/**
 * Incidente de 08/11/2026 (07:18 UTC): a OpenAI recusou com 400 a chamada do Copiloto —
 * "Response input messages must contain the word 'json' in some form to use 'text.format' of type json_object" —
 * e, sem decisão, a baixa de check-out ("Check out feito" / "Saímos e deixamos chave conforme instruções") não rodou.
 * (a) o prompt montado sempre traz "JSON" na mensagem do usuário;
 * (b) o transporte garante "json" na entrada quando o formato é JSON (nos dois fios);
 * (c) failover para o Reserva só em erro recuperável (5xx, rede, 429, 400 de formato JSON); outros 4xx fecham;
 * (d) as mensagens reais de saída da hóspede viram `checkout_done` aplicado.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runTurnChain } from "@/lib/guest-ai/turn-chain";
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import { failure } from "@/lib/guest-ai/llm/errors";
import { modelSpec } from "@/lib/guest-ai/llm/models";
import type { LlmMessage } from "@/lib/guest-ai/llm/contracts";
import type {
  LlmProvider,
  ProviderOutcome,
  ProviderRequest,
} from "@/lib/guest-ai/llm/providers/types";
import {
  JSON_WORD_GUARD,
  buildChatBody,
  buildResponsesBody,
  createLovableGatewayProvider,
  ensureJsonWord,
  isJsonFormatRejection,
  readErrorSnippet,
} from "@/lib/guest-ai/llm/providers/lovable-gateway.server";
import { evaluateOpsSignals, type OpsPolicyInput } from "@/lib/guest-ai/ops/policy";
import { runOps, type OpsRunInput } from "@/lib/guest-ai/ops/executor.server";
import type { OpsState } from "@/lib/guest-ai/data/ops-state.server";
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { harness, turn, v6 } from "./helpers/b23-chain";

const ROOT = path.resolve(__dirname, "..");

// ───────────── (a) composer ─────────────

describe("(a) o prompt montado sempre cita JSON na mensagem do usuário", () => {
  it("turno real: a mensagem do usuário termina pedindo o formato JSON", async () => {
    const h = harness(v6());
    await runTurnChain({ turn: turn(), traceId: "json-1" }, h.deps);
    const user = h.calls.prompts[0]!.messages.map((m) => m.content).join("\n");
    expect(user).toMatch(/estritamente no formato JSON exigido pelas instruções de sistema/);
    expect(/json/i.test(user)).toBe(true);
  });

  it("os dois fechamentos (mensagem única e lote) citam JSON", () => {
    const src = readFileSync(path.join(ROOT, "composer.ts"), "utf8");
    expect(src).toContain(
      "produza uma única decisão para todas, estritamente no formato JSON exigido pelas instruções de sistema.",
    );
    expect(src).toContain(
      "(atual: true) estritamente no formato JSON exigido pelas instruções de sistema.",
    );
    expect(src).not.toMatch(/[^O] no formato exigido pelas instruções de sistema/);
  });
});

// ───────────── (b) transporte ─────────────

const GPT = modelSpec("openai/gpt-6-astra")!;
const GEMINI = modelSpec("google/gemini-3.8-flash")!;
const preq = (messages: LlmMessage[], over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  spec: GPT,
  messages,
  maxOutputTokens: 300,
  reasoningEffort: "auto",
  responseFormat: "json",
  temperature: null,
  ...over,
});
const NO_JSON: LlmMessage[] = [
  { role: "system", content: "Responda em JSON." }, // o system/instructions NÃO conta para a OpenAI
  { role: "user", content: "Check out feito" },
];
const inputText = (b: Record<string, unknown>) => JSON.stringify(b["input"] ?? b["messages"]);

describe("(b) o transporte garante 'json' na entrada quando o formato é JSON", () => {
  it("responses: sem 'json' nas mensagens de entrada ⇒ instrução anexada à última mensagem do usuário", () => {
    const b = buildResponsesBody(preq(NO_JSON));
    expect(/json/i.test(inputText(b))).toBe(true);
    const input = b["input"] as Array<{ content: Array<{ text: string }> }>;
    expect(input.at(-1)!.content[0]!.text).toBe(`Check out feito${JSON_WORD_GUARD}`);
    expect(b["instructions"]).toBe("Responda em JSON.");
  });

  it("chat/completions: mesma garantia", () => {
    const b = buildChatBody(preq(NO_JSON, { spec: GEMINI }));
    const msgs = b["messages"] as Array<{ role: string; content: string }>;
    expect(msgs.at(-1)!.content).toBe(`Check out feito${JSON_WORD_GUARD}`);
  });

  it("já tem 'json' (qualquer caixa) ⇒ nada muda; formato texto ⇒ nada muda", () => {
    const withJson: LlmMessage[] = [
      { role: "user", content: "Responda no formato Json, por favor" },
    ];
    expect(ensureJsonWord(withJson, "json")).toBe(withJson);
    expect(ensureJsonWord(NO_JSON, "text")).toBe(NO_JSON);
    const b = buildResponsesBody(preq(NO_JSON, { responseFormat: "text" }));
    expect(inputText(b)).not.toMatch(/json/i);
  });

  it("mensagem com foto (partes): a instrução entra como parte de texto, sem tocar a imagem", () => {
    const parts: LlmMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "vazou" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ] as never,
      },
    ];
    const out = ensureJsonWord(parts, "json");
    const content = out[0]!.content as Array<{ type: string; text?: string }>;
    expect(content).toHaveLength(3);
    expect(content[1]!.type).toBe("image_url");
    expect(content[2]).toEqual({ type: "text", text: JSON_WORD_GUARD.trim() });
  });

  it("sem mensagem de usuário (só tool) ⇒ acrescenta uma mensagem de usuário com a instrução", () => {
    const out = ensureJsonWord([{ role: "system", content: "x" }], "json");
    expect(out.at(-1)).toEqual({ role: "user", content: JSON_WORD_GUARD.trim() });
  });
});

// ───────────── (c) failover ─────────────

function scripted(outcomes: ProviderOutcome[]) {
  const seen: ProviderRequest[] = [];
  const provider: LlmProvider = {
    id: "fake",
    async complete(req) {
      seen.push(req);
      return outcomes[seen.length - 1] ?? outcomes.at(-1)!;
    },
  };
  return { seen, provider };
}
const ok = (): ProviderOutcome => ({
  kind: "ok",
  text: '{"ok":true}',
  finishReason: "stop",
  usage: null,
  requestId: "r",
});
const err = (code: Parameters<typeof failure>[0], status: number): ProviderOutcome => ({
  kind: "error",
  error: failure(code, status),
  usage: null,
  requestId: null,
});
const req = (signal = new AbortController().signal) => ({
  purpose: "guest_reply" as const,
  model: "openai/gpt-6-astra",
  messages: [{ role: "user" as const, content: "Check out feito (responda em JSON)" }],
  maxOutputTokens: 500,
  responseFormat: "json" as const,
  timeoutMs: 15_000,
  signal,
});
// espera curta (pausa entre tentativas) roda já; o prazo longo do turno nunca dispara no teste
const instant = {
  schedule: (fn: () => void, ms: number) => {
    if (ms <= 2_000) queueMicrotask(fn);
    return () => {};
  },
};

describe("(c) failover para o Reserva só em erro recuperável do provedor (Etapa 0)", () => {
  it.each([
    ["5xx", "provider_unavailable", 503],
    ["rede", "network", null],
    ["429", "rate_limited", 429],
    ["400 específico de formato JSON", "json_format_rejected", 400],
  ] as const)("%s ⇒ 2ª tentativa no Reserva e o turno segue", async (_l, code, status) => {
    const { seen, provider } = scripted([err(code, status as number), ok()]);
    const r = await generateGuestLlm(req(), { provider, log: () => {}, ...instant });
    expect(r.ok).toBe(true);
    expect(seen.map((s) => s.spec.id)).toEqual(["openai/gpt-6-astra", "google/gemini-3.8-flash"]);
    expect(r.telemetry.model).toBe("google/gemini-3.8-flash");
  });

  it("outros 4xx ⇒ falha fechada no Titular, sem nova tentativa às cegas", async () => {
    for (const [code, status] of [
      ["bad_request", 400],
      ["bad_request", 422],
      ["auth", 401],
      ["auth", 403],
      ["billing", 402],
      ["model_unavailable", 404],
      ["invalid_response", 409],
    ] as const) {
      const { seen, provider } = scripted([err(code, status), ok()]);
      const r = await generateGuestLlm(req(), { provider, log: () => {}, ...instant });
      expect(r.ok, code).toBe(false);
      expect(!r.ok && r.error.code, code).toBe(code);
      expect(seen.map((s) => s.spec.id), code).toEqual(["openai/gpt-6-astra"]);
    }
  });

  it("o Reserva também falha ⇒ falha fechada com código fixo, logada, sem exceção", async () => {
    const logs: Array<{ outcome: string; code: string | null }> = [];
    const { seen, provider } = scripted([err("json_format_rejected", 400), err("json_format_rejected", 400)]);
    const r = await generateGuestLlm(req(), { provider, log: (e) => logs.push(e), ...instant });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe("json_format_rejected");
    expect(seen).toHaveLength(2);
    expect(logs.at(-1)).toMatchObject({ outcome: "error", code: "json_format_rejected" });
  });
});

describe("(c2) o provedor reconhece SÓ o 400 de formato JSON (corpo lido limitado, nunca logado)", () => {
  const body400 = (text: string) => new Response(text, { status: 400 });
  it("mensagem real da OpenAI ⇒ json_format_rejected", async () => {
    const real =
      "Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.";
    expect(isJsonFormatRejection(await readErrorSnippet(body400(JSON.stringify({ error: { message: real } }))))).toBe(true);
  });
  it("400 genérico ⇒ não é a recusa de formato", async () => {
    expect(isJsonFormatRejection(await readErrorSnippet(body400('{"error":{"message":"max_tokens too large"}}')))).toBe(false);
    expect(isJsonFormatRejection("")).toBe(false);
  });
  it("leitura limitada a 4 KB", async () => {
    expect((await readErrorSnippet(body400("x".repeat(50_000)))).length).toBeLessThanOrEqual(4096);
  });
  it("fio completo: 400 de formato num pedido JSON vira json_format_rejected; em pedido texto, bad_request", async () => {
    const mk = () =>
      createLovableGatewayProvider({
        getApiKey: () => "k",
        fetch: async () =>
          new Response('{"error":{"message":"messages must contain the word json to use response_format json_object"}}', {
            status: 400,
          }),
      });
    const spec = modelSpec("openai/gpt-6-astra")!;
    const base = { spec, messages: [{ role: "user", content: "oi" }], maxOutputTokens: 100 } as unknown as ProviderRequest;
    const json = await mk().complete({ ...base, responseFormat: "json" } as ProviderRequest, new AbortController().signal);
    expect(json.kind === "error" && json.error.code).toBe("json_format_rejected");
    const text = await mk().complete({ ...base, responseFormat: "text" } as ProviderRequest, new AbortController().signal);
    expect(text.kind === "error" && text.error.code).toBe("bad_request");
  });
});

// ───────────── (d) checkout_done ─────────────

const TZ = "America/Sao_Paulo";
const CHECKOUT_DAY = new Date("2026-11-08T07:18:00Z"); // 04:18 em São Paulo, dia da saída
const MSGS = ["Check out feito", "Saímos e deixamos chave conforme instruções"];
const departure = (quote: string): ModelDecision =>
  ({
    ...(v6() as unknown as ModelDecision),
    hospitalityMilestone: { kind: "checkout_confirmed", evidence: ["hist:guest:h1"] },
    milestoneQuote: quote,
    intents: ["departure_confirmation"],
  }) as ModelDecision;
const card = {
  status: "pending",
  doneAt: null,
  arrivalTimeOverride: null,
  arrivalTimeSource: null,
  mutedUntil: null,
  lateCheckoutTime: null,
  lateCheckoutApprovedAt: null,
};
const policyInput = (text: string): OpsPolicyInput => ({
  decision: departure(text),
  history: [
    { ref: "hist:team:h0", messageId: "t0", speaker: "team", text: "Boa viagem!" },
    { ref: "hist:guest:h1", messageId: "m1", speaker: "guest", text },
  ],
  phase: "post_checkout",
  timezone: TZ,
  now: CHECKOUT_DAY,
  reservation: {
    id: "r1",
    status: "confirmed",
    checkinDate: "2026-11-04",
    checkoutDate: "2026-11-08",
  },
  conversation: {
    status: "needs_human",
    assignedTo: null,
    handoffReason: "PADRAO",
    handoffUrgency: null,
    aiPaused: false,
    pausedUntil: null,
  },
  cards: { checkin: null, checkout: card },
  property: {
    checkinTime: "15:00",
    checkinTimeMax: "22:00",
    checkoutTime: "11:00",
    checkoutTimeMin: "06:00",
  },
  defaultHandoffReason: "PADRAO",
});

const TURN = {
  surface: "airbnb",
  conversationId: "c1000000-0000-4000-8000-000000000001",
  messageId: "e1000000-0000-4000-8000-000000000001",
  propertyId: "b1000000-0000-4000-8000-000000000001",
  tenantId: "a1000000-0000-4000-8000-000000000001",
  guestSessionId: "airbnb:x",
  conversationStatus: "needs_human",
  reservationId: "r1000000-0000-4000-8000-000000000001",
  messageCreatedAt: null,
} as unknown as ValidatedTurn;
const STATE: OpsState = {
  conversation: {
    status: "needs_human",
    assignedTo: null,
    handoffReason: "x",
    handoffUrgency: null,
    aiPaused: false,
    pausedUntil: null,
  },
  reservation: {
    id: "r1000000-0000-4000-8000-000000000001",
    status: "confirmed",
    checkinDate: "2026-11-04",
    checkoutDate: "2026-11-08",
  },
  cards: { checkin: null, checkout: card },
  property: {
    checkinTime: "15:00",
    checkinTimeMax: null,
    checkoutTime: "11:00",
    checkoutTimeMin: null,
  },
};
const runInput = (text: string): OpsRunInput => ({
  turn: TURN,
  decision: {
    ...departure(text),
    hospitalityMilestone: { kind: "checkout_confirmed", evidence: ["hist:guest:h1"] },
  },
  history: {
    status: "available",
    entries: [
      {
        ref: "hist:guest:h1",
        messageId: TURN.messageId,
        speaker: "guest",
        text,
        channel: "airbnb",
        at: "",
        media: null,
        delivery: "delivered",
        current: true,
      },
    ],
  } as never,
  phase: "post_checkout",
  timezone: TZ,
  suggestionId: "s1",
});
function fakeRpc() {
  const calls: string[] = [];
  return {
    calls,
    rpc: {
      call: async (fn: string) => {
        calls.push(fn);
        if (fn === "guest_ai_ops_claim")
          return { data: { result: "claimed", id: "id-1" }, error: null };
        return {
          data: { result: fn === "guest_ai_ops_finish" ? "finished" : "recorded" },
          error: null,
        };
      },
    } as never,
  };
}

describe("(d) confirmação de saída da hóspede ⇒ checkout_done aplicado", () => {
  it.each(MSGS)("política: '%s' ⇒ checkout_done would_apply", (text) => {
    const r = evaluateOpsSignals(policyInput(text));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      action: "checkout_done",
      outcome: "would_apply",
      code: null,
      evidenceMessageId: "m1",
    });
  });

  it.each(MSGS)("executor live: '%s' ⇒ claim → apply(checkout_done) → finish", async (text) => {
    const r = fakeRpc();
    const apply = vi.fn(async () => ({
      ok: true as const,
      cardAfter: { exists: true, status: "done", done_at: "2026-11-08T07:18:05Z" },
    }));
    const out = await runOps(runInput(text), {
      env: { GUEST_AI_OPS_MODE: "live" },
      rpc: r.rpc,
      loadState: async () => STATE,
      now: () => CHECKOUT_DAY,
      apply,
    });
    expect(out).toMatchObject({ status: "done", mode: "live", applied: 1, failed: 0 });
    expect(apply).toHaveBeenCalledTimes(1);
    expect((apply.mock.calls as unknown as Array<[unknown]>)[0]![0]).toMatchObject({ action: "checkout_done" });
    expect(r.calls).toEqual(["guest_ai_ops_claim", "guest_ai_ops_finish"]);
  });

  it.each(MSGS)("executor shadow: '%s' ⇒ só registro, nenhuma escrita no card", async (text) => {
    const r = fakeRpc();
    const apply = vi.fn();
    const out = await runOps(runInput(text), {
      env: { GUEST_AI_OPS_MODE: "shadow" },
      rpc: r.rpc,
      loadState: async () => STATE,
      now: () => CHECKOUT_DAY,
      apply: apply as never,
    });
    expect(out).toMatchObject({ mode: "shadow" });
    expect(apply).not.toHaveBeenCalled();
    expect(r.calls).toContain("guest_ai_ops_record");
    expect(r.calls).not.toContain("guest_ai_ops_claim");
  });

  it("live com falha na escrita do card ⇒ contabilizada e finalizada, nunca silenciosa", async () => {
    const r = fakeRpc();
    const apply = vi.fn(async () => ({ ok: false as const, code: "apply_failed" }));
    const out = await runOps(runInput(MSGS[0]!), {
      env: { GUEST_AI_OPS_MODE: "live" },
      rpc: r.rpc,
      loadState: async () => STATE,
      now: () => CHECKOUT_DAY,
      apply: apply as never,
    });
    expect(out).toMatchObject({ mode: "live", applied: 0, refused: 1 });
    expect(r.calls).toEqual(["guest_ai_ops_claim", "guest_ai_ops_finish"]); // auditado como "refused" + código
  });
});
