/**
 * Camada única de acesso ao Lovable AI Gateway.
 *
 * Isola o transporte (chat completions vs Responses API), o streaming, o
 * round-trip de tool calling e a contabilidade de tokens/custo. Nenhum outro
 * arquivo deve chamar o gateway diretamente.
 */
import { estimateCostUsd, isResponsesModel, modelFor, type AiTask } from "./models";
import { cached, cacheKeyOf } from "./cache.server";

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

/**
 * fetch com um retry curto para falhas transitórias (5xx ou erro de rede).
 * NUNCA retenta se o cancelamento veio do próprio signal do caller (timeout
 * intencional) — nesse caso, insistir só atrasaria uma resposta que já vai
 * ser abandonada. 429/402 não são retentados aqui: já têm tratamento próprio
 * em `throwForStatus` e retry imediato só pioraria rate limit/billing.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: { retries?: number; backoffMs?: number },
): Promise<Response> {
  const retries = opts?.retries ?? 1;
  const backoffMs = opts?.backoffMs ?? 400;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      return res;
    } catch (err) {
      if (init.signal?.aborted || attempt >= retries) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
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
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
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
          content: [
            { type: m.role === "assistant" ? "output_text" : "input_text", text: m.content },
          ],
        })),
      tools: [],
      maxSteps: 1,
      signal: opts?.signal,
    });
    return { text: run.text, usage: run.usage, model: run.model };
  }

  const res = await fetchWithRetry(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey() },
    // Classificação/validação são curtas por natureza, mas o corte não pode
    // ser apertado: um pico do provedor virava resposta perdida para o
    // hóspede. 120s é folga larga, não um relógio disputando com o modelo.
    signal: opts?.signal ?? AbortSignal.timeout(120_000),

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
    usage: {
      inputTokens,
      outputTokens,
      costUsd: estimateCostUsd(model, inputTokens, outputTokens),
    },
  };
}

/** Chat com saída JSON. Retorna `null` quando o modelo devolve algo inválido. */
export async function chatJson<T>(
  task: AiTask,
  messages: ChatMessage[],
  opts?: { signal?: AbortSignal },
): Promise<{ data: T | null; usage: Usage; model: string }> {
  const { text, usage, model } = await chatText(task, messages, {
    json: true,
    signal: opts?.signal,
  });
  try {
    const cleaned = text
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    return { data: JSON.parse(cleaned) as T, usage, model };
  } catch {
    return { data: null, usage, model };
  }
}

// ───────────────────────── Embeddings ─────────────────────────

/**
 * O modelo de embeddings do gateway aceita apenas UM texto por requisição
 * (lotes retornam 404). Compensamos com concorrência controlada.
 */
const EMBED_CONCURRENCY = 6;

export async function embedTexts(texts: string[]): Promise<{ vectors: number[][]; usage: Usage }> {
  const model = modelFor("embeddings");
  const vectors: number[][] = new Array(texts.length).fill(null).map(() => [] as number[]);
  let usage = EMPTY_USAGE;

  async function embedAt(index: number): Promise<void> {
    const res = await fetchWithRetry(`${BASE}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey() },
      body: JSON.stringify({ model, input: texts[index] }),
    });
    if (!res.ok) throwForStatus(res.status, await res.text().catch(() => ""));
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
      usage?: { prompt_tokens?: number };
    };
    vectors[index] = json.data?.[0]?.embedding ?? [];
    const inputTokens = json.usage?.prompt_tokens ?? 0;
    usage = mergeUsage(usage, {
      inputTokens,
      outputTokens: 0,
      costUsd: estimateCostUsd(model, inputTokens, 0),
    });
  }

  for (let i = 0; i < texts.length; i += EMBED_CONCURRENCY) {
    const slice = texts.slice(i, i + EMBED_CONCURRENCY).map((_, k) => embedAt(i + k));
    await Promise.all(slice);
  }

  return { vectors, usage };
}

/** Validade do embedding em cache: a mesma frase gera sempre o mesmo vetor. */
const EMBED_CACHE_TTL_MS = 30 * 60 * 1000;

export async function embedOne(text: string): Promise<{ vector: number[] | null; usage: Usage }> {
  // Perguntas frequentes chegam repetidas palavra por palavra de hóspedes
  // diferentes. O vetor de uma frase é determinístico — recalcular é pagar de
  // novo pelo mesmo resultado. O custo só é contabilizado na primeira vez.
  const key = `embed:${cacheKeyOf(text)}`;
  let missUsage = EMPTY_USAGE;
  const vector = await cached(key, EMBED_CACHE_TTL_MS, async () => {
    const { vectors, usage } = await embedTexts([text]);
    missUsage = usage;
    return vectors[0] ?? null;
  });
  return { vector, usage: missUsage };
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

/**
 * `onTextDelta` repassa cada pedaço de texto ASSIM QUE ELE CHEGA.
 *
 * Os eventos já chegavam — `response.output_text.delta`, token a token — e
 * eram jogados num buffer que só era lido no fim. Era exatamente por isso que
 * a resposta parecia lenta comparada ao ChatGPT: não é que lá o modelo seja
 * mais rápido, é que lá a primeira palavra aparece em ~300ms e continua
 * saindo, enquanto aqui a tela ficava vários segundos em branco e depois
 * despejava o texto pronto. Mesmo tempo total, percepção oposta.
 *
 * O callback nunca pode derrubar a chamada: quem escuta é uma conexão SSE que
 * pode cair no meio (o hóspede fecha a aba). Por isso o try/catch mudo.
 */
async function postResponses(
  body: unknown,
  signal?: AbortSignal,
  onTextDelta?: (delta: string) => void,
): Promise<ResponsesPayload> {
  const res = await fetchWithRetry(`${BASE}/responses`, {
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
        const evt = JSON.parse(raw) as {
          type?: string;
          delta?: string;
          response?: ResponsesPayload;
        };
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
          textFallback += evt.delta;
          if (onTextDelta) {
            try {
              onTextDelta(evt.delta);
            } catch {
              /* quem escuta pode ter ido embora — nunca derruba a geração */
            }
          }
        } else if (
          (evt.type === "response.completed" || evt.type === "response.incomplete") &&
          evt.response
        ) {
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
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  signal?: AbortSignal;
  /**
   * Recebe o texto da resposta conforme ele é escrito, para a interface poder
   * mostrar em vez de esperar. Ver `postResponses`.
   *
   * O agente pode dar VÁRIAS voltas (uma por rodada de ferramentas), e cada
   * volta pode escrever texto. Por isso vem junto o número do passo: quem
   * escuta descarta o que veio de um passo anterior quando um novo começa a
   * escrever — senão o preâmbulo de uma rodada intermediária ficaria colado na
   * resposta final.
   */
  onTextDelta?: (delta: string, step: number) => void;
}): Promise<AgentRun> {
  const model = modelFor(params.task ?? "agent");
  const maxSteps = params.maxSteps ?? 5;
  /**
   * SEM RELÓGIO CONTRA O RACIOCÍNIO (22/09/2026).
   *
   * Aqui havia `AbortSignal.timeout(90_000)`. Com esforço máximo e várias
   * rodadas de ferramentas, um turno legítimo do hóspede passa de 90s — e o
   * relógio cortava o trabalho no meio: o gateway seguia cobrando e o hóspede
   * recebia "não consegui responder agora" (foi o que aconteceu com a Caroline
   * às 08:27 de 22/09). Só o caller cancela, e só quando alguém desiste de
   * verdade; a rota SSE mantém a conexão viva mostrando cada etapa.
   */
  const signal = params.signal;

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
  const readCache = new Map<string, unknown>();
  let lastEndedWithTools = false;

  for (let step = 0; step < maxSteps; step += 1) {
    steps = step + 1;
    lastEndedWithTools = false;
    const payload = await postResponses(
      {
        model,
        instructions: params.instructions,
        input,
        stream: true,
        store: false,
        ...(toolDefs.length ? { tools: toolDefs, tool_choice: "auto" } : {}),
        reasoning: { effort: params.reasoningEffort ?? "max", summary: "auto" },
        include: ["reasoning.encrypted_content"],
      },
      signal,
      params.onTextDelta ? (d) => params.onTextDelta?.(d, steps) : undefined,
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
      .flatMap(
        (item) => (item as { content?: Array<{ type?: string; text?: string }> }).content ?? [],
      )
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
        // Mesma consulta de leitura repetida na mesma resposta: reaproveita.
        const cacheKey = `${name}:${JSON.stringify(args)}`;
        const cacheable = !name.startsWith("preparar_") && !name.startsWith("definir_");
        let result: unknown;
        if (cacheable && readCache.has(cacheKey)) {
          result = readCache.get(cacheKey);
        } else {
          try {
            result = tool ? await tool.execute(args) : { error: `Ferramenta desconhecida: ${name}` };
            if (cacheable) readCache.set(cacheKey, result);
          } catch (err) {
            result = {
              error: err instanceof Error ? err.message : "Falha ao executar a ferramenta.",
            };
          }
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
    lastEndedWithTools = true;
  }

  // Esgotou os passos ainda chamando ferramentas e sem texto: uma rodada final
  // curta, sem ferramentas, para resumir o que achou e perguntar o que falta —
  // em vez de "não consegui responder agora" (25/09/2026).
  if (!text && lastEndedWithTools && !signal?.aborted) {
    try {
      steps += 1;
      const finalStep = steps;
      const payload = await postResponses(
        {
          model,
          instructions:
            params.instructions +
            "\n\nAGORA: não há mais ferramentas nesta resposta. Em até 3 frases, diga o que você encontrou e faça UMA pergunta objetiva sobre o que falta para concluir. Nunca invente dados.",
          input,
          stream: true,
          store: false,
          ...(toolDefs.length ? { tools: toolDefs, tool_choice: "none" } : {}),
          reasoning: { effort: "low", summary: "auto" },
          include: ["reasoning.encrypted_content"],
        },
        signal,
        params.onTextDelta ? (d) => params.onTextDelta?.(d, finalStep) : undefined,
      );
      const inT = payload.usage?.input_tokens ?? 0;
      const outT = payload.usage?.output_tokens ?? 0;
      usage = mergeUsage(usage, {
        inputTokens: inT,
        outputTokens: outT,
        costUsd: estimateCostUsd(model, inT, outT),
      });
      text =
        (payload.output ?? [])
          .filter((item) => item.type === "message")
          .flatMap(
            (item) => (item as { content?: Array<{ type?: string; text?: string }> }).content ?? [],
          )
          .filter((c) => c.type === "output_text")
          .map((c) => c.text ?? "")
          .join("")
          .trim() || (payload.output_text ?? "").trim();
    } catch {
      /* segue com o texto vazio; o caller tem a própria frase de apoio */
    }
  }

  return { text, toolCalls, usage, model, steps };
}

export { isResponsesModel };
