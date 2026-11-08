/**
 * Tool calling ponta a ponta no gerador do Copiloto e no transporte do gateway (sem rede):
 * 1ª chamada pede consulta → executor (6 s, falha graciosa) → resultados como mensagens `tool` →
 * 2ª chamada só com a resposta final (ferramentas proibidas). Custo somado e conferido no teto do turno.
 */
import { describe, expect, it } from "vitest";
import type { ComposedPrompt } from "@/lib/guest-ai/orchestrator/contracts";
import {
  createCopilotGenerator,
  CopilotGeneratorStop,
} from "@/lib/guest-ai/copilot/generator.server";
import type {
  LlmProvider,
  ProviderOutcome,
  ProviderRequest,
} from "@/lib/guest-ai/llm/providers/types";
import {
  buildChatBody,
  buildResponsesBody,
  parseChatPayload,
  parseResponsesStream,
} from "@/lib/guest-ai/llm/providers/lovable-gateway.server";
import { modelSpec } from "@/lib/guest-ai/llm/models";
import type { GuestToolContext } from "@/lib/guest-ai/tools/contracts";
import { fakeMaps, PLACES_RESPONSE } from "./fake-maps";

const MODEL = "openai/gpt-6-astra";
const CTX: GuestToolContext = {
  origin: { lat: -25.5163, lng: -54.5854 },
  city: "Foz do Iguaçu",
  region: "PR",
  country: "Brasil",
  surface: "guide_chat",
};
const prompt = (): ComposedPrompt => ({
  system: "Você é o concierge.",
  messages: [{ role: "user", content: "Somos um casal, queremos pizza hoje. O que indica?" }],
  sourceIds: null,
  promptVersion: "t",
});
const usage = { inputTokens: 2_000, outputTokens: 300, totalTokens: 2_300 };
const toolTurn = (
  calls: Array<{ id: string; name: string; arguments: string }>,
): ProviderOutcome => ({
  kind: "ok",
  text: "",
  finishReason: "tool_calls",
  toolCalls: calls,
  usage,
  requestId: "r1",
});
const finalTurn = (reply: string): ProviderOutcome => ({
  kind: "ok",
  text: JSON.stringify({ reply }),
  finishReason: "stop",
  usage,
  requestId: "r2",
});

function scripted(outcomes: ProviderOutcome[]) {
  const seen: ProviderRequest[] = [];
  const provider: LlmProvider = {
    id: "fake",
    async complete(req) {
      seen.push(req);
      return outcomes[seen.length - 1] ?? finalTurn("extra");
    },
  };
  return { seen, provider };
}

const gen = (
  provider: LlmProvider,
  over: Partial<Parameters<typeof createCopilotGenerator>[0]> = {},
) =>
  createCopilotGenerator({
    modelId: MODEL,
    maxOutputTokens: 4_096,
    minOutputTokens: 1_536,
    reasoningEffort: "auto",
    remainingMs: () => 20_000,
    beforeNetwork: async () => true,
    traceId: "s-1",
    provider,
    log: () => {},
    ...over,
  });

const PLACES_CALL = {
  id: "call_p",
  name: "search_city_places",
  arguments: JSON.stringify({ query: "pizzaria", category: "gastronomia" }),
};

describe("gerador do Copiloto com ferramentas", () => {
  it("consulta real ⇒ 2ª chamada recebe os resultados (distância de trajeto) e devolve a resposta final", async () => {
    const { seen, provider } = scripted([
      toolTurn([PLACES_CALL]),
      finalTurn("A Pizzaria Perto fica a 420 m daqui."),
    ]);
    const maps = fakeMaps({
      places: PLACES_RESPONSE,
      walk: (d) => (d.startsWith("-25.516100") ? { meters: 420 } : { meters: 2_600 }),
      drive: () => ({ meters: 3_100 }),
    });
    const g = gen(provider, { loadToolContext: async () => CTX, toolHttp: maps.http });
    const text = await g.generate(prompt(), new AbortController().signal);
    expect(JSON.parse(text)).toEqual({ reply: "A Pizzaria Perto fica a 420 m daqui." });
    expect(seen).toHaveLength(2);
    // 1ª: ferramentas oferecidas, o modelo escolhe
    expect(seen[0]!.tools!.map((t) => t.name)).toEqual([
      "search_city_places",
      "calculate_property_distance",
    ]);
    expect(seen[0]!.toolChoice).toBe("auto");
    // 2ª: chamada do modelo + resultado real; ferramentas proibidas (força a resposta final), JSON exigido
    const msgs = seen[1]!.messages;
    expect(msgs.at(-2)).toMatchObject({ role: "assistant", toolCalls: [PLACES_CALL] });
    const tool = msgs.at(-1)!;
    expect(tool).toMatchObject({ role: "tool", toolCallId: "call_p" });
    const result = JSON.parse(tool.content as string);
    expect(result.resultados[0]).toMatchObject({
      nome: "Pizzaria Perto",
      distancia_m: 420,
      distancia_texto: "420 m",
    });
    expect(seen[1]!.toolChoice).toBe("none");
    expect(seen[1]!.responseFormat).toBe("json");
    const t = g.telemetry();
    expect(t).toMatchObject({
      status: "called",
      toolRounds: 1,
      toolCalls: 1,
      toolFailures: 0,
      calls: 2,
      inputTokens: 4_000,
      outputTokens: 600,
    });
    expect(t.costUsd).toBeGreaterThan(0);
    expect(t.costUsd).toBeLessThanOrEqual(0.15);
  });

  it("falha da API externa ⇒ resultado `indisponivel` (sem distância) e o turno segue normalmente", async () => {
    const { seen, provider } = scripted([
      toolTurn([
        PLACES_CALL,
        {
          id: "call_r",
          name: "calculate_property_distance",
          arguments: JSON.stringify({ destination_address_or_coords: "Cataratas do Iguaçu" }),
        },
      ]),
      finalTurn("Posso indicar algumas opções no centro; confira o trajeto no Google Maps."),
    ]);
    const maps = fakeMaps({ throwError: true });
    const g = gen(provider, { loadToolContext: async () => CTX, toolHttp: maps.http });
    const text = await g.generate(prompt(), new AbortController().signal);
    expect(JSON.parse(text).reply).toMatch(/Google Maps/);
    const tools = seen[1]!.messages.filter((m) => m.role === "tool");
    expect(tools.map((m) => JSON.parse(m.content as string))).toEqual([
      { ok: false, erro: "indisponivel" },
      { ok: false, erro: "indisponivel" },
    ]);
    for (const m of tools) expect(m.content).not.toMatch(/distancia/);
    expect(g.telemetry()).toMatchObject({
      status: "called",
      toolRounds: 1,
      toolCalls: 2,
      toolFailures: 2,
    });
  });

  it("modelo responde direto: uma chamada só, como antes", async () => {
    const { seen, provider } = scripted([finalTurn("Oi!")]);
    const g = gen(provider, { loadToolContext: async () => CTX, toolHttp: fakeMaps({}).http });
    await g.generate(prompt(), new AbortController().signal);
    expect(seen).toHaveLength(1);
    expect(g.telemetry()).toMatchObject({ toolRounds: 0, toolCalls: 0, calls: 1 });
  });

  it("sem origem do imóvel (ou falha ao lê-la): nenhuma ferramenta é oferecida — pedido idêntico ao de antes", async () => {
    for (const loadToolContext of [
      undefined,
      async () => null,
      async () => Promise.reject(new Error("db")),
    ]) {
      const { seen, provider } = scripted([finalTurn("ok")]);
      const g = gen(provider, loadToolContext ? { loadToolContext } : {});
      await g.generate(prompt(), new AbortController().signal);
      expect(seen[0]!.tools ?? []).toEqual([]);
      expect(seen[0]!.toolChoice).toBeUndefined();
    }
  });

  it("duas chamadas não cabem no teto do turno ⇒ segue sem ferramentas", async () => {
    const { seen, provider } = scripted([finalTurn("ok")]);
    // teto que comporta UMA chamada no recuo, mas não duas
    const big: ComposedPrompt = {
      ...prompt(),
      messages: [{ role: "user", content: "x".repeat(30_000) }],
    };
    const g = gen(provider, {
      loadToolContext: async () => CTX,
      toolHttp: fakeMaps({}).http,
      maxTurnCostUsd: 0.06,
    });
    await g.generate(big, new AbortController().signal);
    expect(seen[0]!.tools ?? []).toEqual([]);
    expect(g.telemetry().toolsOffered).toEqual([]);
  });

  it("hóspede mandou mensagem nova durante a consulta ⇒ 2ª chamada não sai (superseded)", async () => {
    const { seen, provider } = scripted([toolTurn([PLACES_CALL]), finalTurn("x")]);
    let checks = 0;
    const g = gen(provider, {
      loadToolContext: async () => CTX,
      toolHttp: fakeMaps({ places: PLACES_RESPONSE, walk: () => ({ meters: 300 }) }).http,
      beforeNetwork: async () => ++checks === 1,
    });
    await expect(g.generate(prompt(), new AbortController().signal)).rejects.toMatchObject({
      code: "superseded",
    });
    expect(seen).toHaveLength(1);
  });

  it("2ª chamada que insiste em ferramenta (ou falha) ⇒ gateway_failed, nada parcial", async () => {
    const { provider } = scripted([toolTurn([PLACES_CALL]), toolTurn([PLACES_CALL])]);
    const g = gen(provider, {
      loadToolContext: async () => CTX,
      toolHttp: fakeMaps({ places: PLACES_RESPONSE }).http,
    });
    await expect(g.generate(prompt(), new AbortController().signal)).rejects.toBeInstanceOf(
      CopilotGeneratorStop,
    );
    expect(g.telemetry()).toMatchObject({
      status: "failed",
      error: "invalid_response",
      toolRounds: 1,
    });
  });

  it("pedido de ferramenta sem ferramentas oferecidas é recusado pelo gateway", async () => {
    const { provider } = scripted([toolTurn([PLACES_CALL])]);
    const g = gen(provider);
    await expect(g.generate(prompt(), new AbortController().signal)).rejects.toMatchObject({
      code: "gateway_failed",
    });
    expect(g.telemetry().error).toBe("invalid_response");
  });
});

describe("transporte do gateway: ferramentas nos dois formatos de fio", () => {
  const tools = [
    {
      name: "search_city_places",
      description: "Busca lugares reais.",
      parameters: { type: "object", properties: {} },
    },
  ];
  const messages = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "pizza?" },
    { role: "assistant" as const, content: "", toolCalls: [PLACES_CALL] },
    { role: "tool" as const, toolCallId: "call_p", content: '{"ok":true}' },
  ];

  it("chat/completions: tools, tool_choice, tool_calls e mensagens role tool", () => {
    const body = buildChatBody({
      spec: modelSpec("google/gemini-3.8-flash")!,
      messages,
      maxOutputTokens: 500,
      reasoningEffort: "auto",
      responseFormat: "json",
      temperature: null,
      tools,
      toolChoice: "none",
    });
    expect(body["tools"]).toEqual([{ type: "function", function: tools[0] }]);
    expect(body["tool_choice"]).toBe("none");
    const msgs = body["messages"] as Array<Record<string, unknown>>;
    expect(msgs[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_p",
          type: "function",
          function: { name: "search_city_places", arguments: PLACES_CALL.arguments },
        },
      ],
    });
    expect(msgs[3]).toEqual({ role: "tool", tool_call_id: "call_p", content: '{"ok":true}' });
  });

  it("responses: function_call / function_call_output e tools no formato da Responses API", () => {
    const body = buildResponsesBody({
      spec: modelSpec(MODEL)!,
      messages,
      maxOutputTokens: 500,
      reasoningEffort: "auto",
      responseFormat: "json",
      temperature: null,
      tools,
      toolChoice: "auto",
    });
    expect(body["tools"]).toEqual([{ type: "function", ...tools[0] }]);
    expect(body["tool_choice"]).toBe("auto");
    const input = body["input"] as Array<Record<string, unknown>>;
    expect(input[1]).toEqual({
      type: "function_call",
      call_id: "call_p",
      name: "search_city_places",
      arguments: PLACES_CALL.arguments,
    });
    expect(input[2]).toEqual({
      type: "function_call_output",
      call_id: "call_p",
      output: '{"ok":true}',
    });
  });

  it("sem ferramentas: corpo idêntico ao de antes (campos ausentes)", () => {
    const body = buildChatBody({
      spec: modelSpec("google/gemini-3.8-flash")!,
      messages: messages.slice(0, 2),
      maxOutputTokens: 500,
      reasoningEffort: "auto",
      responseFormat: "json",
      temperature: null,
    });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("lê pedidos de ferramenta nas duas respostas", () => {
    const chat = parseChatPayload({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "search_city_places", arguments: '{"query":"pizza"}' },
              },
            ],
          },
        },
      ],
    });
    expect(chat).toMatchObject({
      finishReason: "tool_calls",
      toolCalls: [{ id: "c1", name: "search_city_places", arguments: '{"query":"pizza"}' }],
    });
    const sse = `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "function_call", call_id: "c2", name: "calculate_property_distance", arguments: '{"destination_address_or_coords":"Cataratas"}' }] } })}\n`;
    expect(parseResponsesStream(sse)).toMatchObject({
      kind: "ok",
      finishReason: "tool_calls",
      toolCalls: [{ id: "c2", name: "calculate_property_distance" }],
    });
  });
});

describe("tempo da resposta final protegido", () => {
  it("com pouco prazo, as ferramentas cedem (tempo_esgotado) e a 2ª chamada ainda sai", async () => {
    const { seen, provider } = scripted([
      toolTurn([PLACES_CALL]),
      finalTurn("Confira no Google Maps."),
    ]);
    const maps = fakeMaps({ places: PLACES_RESPONSE });
    // restam 5 s: menos que a reserva da resposta final (6 s) ⇒ nenhuma consulta sai
    const g = gen(provider, {
      loadToolContext: async () => CTX,
      toolHttp: maps.http,
      remainingMs: () => 5_000,
    });
    await g.generate(prompt(), new AbortController().signal);
    expect(maps.calls).toHaveLength(0);
    expect(JSON.parse(seen[1]!.messages.at(-1)!.content as string)).toEqual({
      ok: false,
      erro: "tempo_esgotado",
    });
    expect(g.telemetry()).toMatchObject({ status: "called", toolFailures: 1 });
  });
});
