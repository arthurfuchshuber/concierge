/**
 * Camada única de acesso ao Lovable AI Gateway.
 *
 * Isola o transporte (chat completions vs Responses API), o streaming, o
 * round-trip de tool calling e a contabilidade de tokens/custo. Nenhum outro
 * arquivo deve chamar o gateway diretamente.
 */
import { estimateCostUsd, isResponsesModel, modelFor, type AiTask } from "./models";

const BASE = "https://ai.gateway.lovable.dev/v1";

export type Usage = { inputTokens: number; outputTokens: number; costUsd: number };

export const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

export function mergeUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

function apiKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY não configurada.");
  return key;
}

export class AiGatewayError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AiGatewayError";
  }
}

function throwForStatus(status: number, body: string): never {
  if (status === 429) throw new AiGatewayError(429, "Muitas requisições de IA em pouco tempo.");
  if (status === 402) throw new AiGatewayError(402, "Créditos de IA esgotados.");
  console.error("[ai-gateway] erro", status, body.slice(0, 500));
  throw new AiGatewayError(status, "Serviço de IA indisponível no momento.");
}

// ───────────────────────── Chat completions (modelos não-OpenAI) ─────────────────────────

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function chatText(
  task: AiTask,
  messages: ChatMessage[],
  opts?: { json?: boolean; signal?: AbortSignal },
): Promise<{ text: string; usage: Usage; model: string }> {
  const model = modelFor(task);

  // Modelos OpenAI são servidos pela Responses API (streaming obrigatório).
  if (isResponsesModel(model)) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const run = await runAgent({
      task,
      instructions: opts?.json
        ? `${system}\n\nResponda APENAS com JSON válido, sem cercas de código.`
        : system,
      input: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          type: "message",
          role: m.role,
          content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
        })),
      tools: [],
      maxSteps: 1,
      signal: opts?.signal,
    });
    return { text: run.text, usage: run.usage, model: run.model };
  }

  const res = await fetch(`${BASE}/chat/completions`, {

    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey() },
    signal: opts?.signal,
    body: JSON.stringify({
      model,
      messages,
      ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const inputTokens = json.usage?.prompt_tokens ?? 0;
  const outputTokens = json.usage?.completion_tokens ?? 0;
  return {
    text: (json.choices?.[0]?.message?.content ?? "").trim(),
    model,
    usage: { inputTokens, outputTokens, costUsd: estimateCostUsd(model, inputTokens, outputTokens) },
  };
}

/** Chat com saída JSON. Retorna `null` quando o modelo devolve algo inválido. */
export async function chatJson<T>(
  task: AiTask,
  messages: ChatMessage[],
  opts?: { signal?: AbortSignal },
): Promise<{ data: T | null; usage: Usage; model: string }> {
  const { text, usage, model } = await chatText(task, messages, { json: true, signal: opts?.signal });
  try {
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return { data: JSON.parse(cleaned) as T, usage, model };
  } catch {
    return { data: null, usage, model };
  }
}

// ───────────────────────── Embeddings ─────────────────────────

const EMBED_BATCH = 90;

export async function embedTexts(texts: string[]): Promise<{ vectors: number[][]; usage: Usage }> {
  const model = modelFor("embeddings");
  const vectors: number[][] = [];
  let usage = EMPTY_USAGE;

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = await fetch(`${BASE}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey() },
      body: JSON.stringify({ model, input: batch }),
    });
    if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
    const json = (await res.json()) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
      usage?: { prompt_tokens?: number };
    };
    const sorted = (json.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const row of sorted) vectors.push(row.embedding ?? []);
    const inputTokens = json.usage?.prompt_tokens ?? 0;
    usage = mergeUsage(usage, {
      inputTokens,
      outputTokens: 0,
      costUsd: estimateCostUsd(model, inputTokens, 0),
    });
  }

  return { vectors, usage };
}

export async function embedOne(text: string): Promise<{ vector: number[] | null; usage: Usage }> {
  const { vectors, usage } = await embedTexts([text]);
  return { vector: vectors[0] ?? null, usage };
}

// ───────────────────────── Responses API (modelos OpenAI, com tool calling) ─────────────────────────

export type AgentTool = {
  name: string;
  description: string;
  /** JSON Schema estrito: additionalProperties false, todas as props em `required`. */
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

type ResponsesItem = Record<string, unknown> & { type?: string };

type ResponsesPayload = {
  output?: ResponsesItem[];
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  status?: string;
};

async function postResponses(body: unknown, signal?: AbortSignal): Promise<ResponsesPayload> {
  const res = await fetch(`${BASE}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey() },
    signal,
    body: JSON.stringify(body),
  });
  if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
  if (!res.body) throw new AiGatewayError(502, "Resposta vazia do serviço de IA.");

  // A Responses API sempre roda em streaming (runs de raciocínio estouram o
  // timeout de request quando bufferizadas). Acumulamos os eventos SSE e
  // usamos o payload terminal `response.completed`.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: ResponsesPayload | null = null;
  let textFallback = "";

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const evt = JSON.parse(raw) as { type?: string; delta?: string; response?: ResponsesPayload };
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          textFallback += evt.delta;
        } else if ((evt.type === "response.completed" || evt.type === "response.incomplete") && evt.response) {
          completed = evt.response;
        }
      } catch {
        /* evento parcial — ignora */
      }
    }
  }

  if (completed) return completed;
  return { output: [], output_text: textFallback };
}

export type AgentToolCall = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs?: number;
  /** Quantas ferramentas rodaram em paralelo nesta rodada. */
  parallelBatch?: number;
};


export type AgentRun = {
  text: string;
  toolCalls: AgentToolCall[];
  usage: Usage;
  model: string;
  steps: number;
};

/**
 * Executa o agente (Responses API) com round-trip completo de ferramentas.
 * O modelo decide quais tools acionar; executamos e devolvemos os resultados
 * até que ele produza a resposta final.
 */
export async function runAgent(params: {
  task?: AiTask;
  instructions: string;
  input: ResponsesItem[];
  tools: AgentTool[];
  maxSteps?: number;
  reasoningEffort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<AgentRun> {
  const model = modelFor(params.task ?? "agent");
  const maxSteps = params.maxSteps ?? 5;
  const toolMap = new Map(params.tools.map((t) => [t.name, t]));
  const toolDefs = params.tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: true,
  }));

  let input: ResponsesItem[] = [...params.input];
  let usage = EMPTY_USAGE;
  const toolCalls: AgentToolCall[] = [];
  let text = "";
  let steps = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    steps = step + 1;
    const payload = await postResponses(
      {
        model,
        instructions: params.instructions,
        input,
        stream: true,
        store: false,
        ...(toolDefs.length ? { tools: toolDefs, tool_choice: "auto" } : {}),
        reasoning: { effort: params.reasoningEffort ?? "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
      },
      params.signal,
    );

    const inputTokens = payload.usage?.input_tokens ?? 0;
    const outputTokens = payload.usage?.output_tokens ?? 0;
    usage = mergeUsage(usage, {
      inputTokens,
      outputTokens,
      costUsd: estimateCostUsd(model, inputTokens, outputTokens),
    });

    const output = payload.output ?? [];
    const functionCalls = output.filter((item) => item.type === "function_call");

    const messageText = output
      .filter((item) => item.type === "message")
      .flatMap((item) => ((item as { content?: Array<{ type?: string; text?: string }> }).content ?? []))
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    if (messageText) text = messageText;
    else if (!functionCalls.length && payload.output_text) text = payload.output_text.trim();

    if (!functionCalls.length) break;

    // Reenviamos os itens retornados (incluindo raciocínio, verbatim) seguidos
    // dos resultados das ferramentas — exigência do contrato stateless.
    input = [...input, ...output];

    // Parallel Tool Calling: ferramentas da mesma rodada são independentes
    // entre si, então executamos todas simultaneamente. A ordem dos outputs
    // é preservada para casar com os `call_id` na ordem original.
    const settled = await Promise.all(
      functionCalls.map(async (call) => {
        const name = String((call as { name?: string }).name ?? "");
        const callId = String((call as { call_id?: string }).call_id ?? "");
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String((call as { arguments?: string }).arguments ?? "{}"));
        } catch {
          args = {};
        }
        const tool = toolMap.get(name);
        const startedAt = Date.now();
        let result: unknown;
        try {
          result = tool ? await tool.execute(args) : { error: `Ferramenta desconhecida: ${name}` };
        } catch (err) {
          result = { error: err instanceof Error ? err.message : "Falha ao executar a ferramenta." };
        }
        return { name, callId, args, result, durationMs: Date.now() - startedAt };
      }),
    );

    for (const call of settled) {
      toolCalls.push({
        name: call.name,
        args: call.args,
        result: call.result,
        durationMs: call.durationMs,
        parallelBatch: settled.length,
      });
      input.push({
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(call.result ?? null).slice(0, 20000),
      });
    }

  }

  return { text, toolCalls, usage, model, steps };
}

export { isResponsesModel };
