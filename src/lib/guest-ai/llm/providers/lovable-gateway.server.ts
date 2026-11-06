/**
 * F2-A — Transporte do Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1`, `LOVABLE_API_KEY`).
 *
 * Dois formatos de fio, escolhidos pelo registro de modelos:
 *  - `chat`      → POST /chat/completions (não streaming)
 *  - `responses` → POST /responses com `stream: true` (os modelos OpenAI do gateway são servidos
 *                  assim); o resultado vem do evento terminal `response.completed`.
 *
 * Segurança:
 *  - a chave só vai no cabeçalho; nunca em log, erro ou resultado;
 *  - o corpo de respostas de ERRO nunca é lido (pode ecoar o prompt); só o status HTTP;
 *  - tamanho máximo de resposta lida (`MAX_BODY_BYTES`) para não segurar memória por um provedor
 *    defeituoso.
 */
import { classifyHttpStatus, failure } from "../errors";
import { llmMessageText, type LlmFinishReason, type LlmMessage, type LlmMessageContent } from "../contracts";
import type { FetchLike, LlmProvider, ProviderOutcome, ProviderRequest, RawUsage } from "./types";

export const LOVABLE_GATEWAY_BASE_URL = "https://ai.gateway.lovable.dev/v1";
export const MAX_BODY_BYTES = 2_000_000;

export interface LovableGatewayOptions {
  /** Lê a chave a cada chamada (rotação sem reinício). `null`/vazio ⇒ `config_missing`. */
  getApiKey: () => string | null | undefined;
  fetch?: FetchLike;
  baseUrl?: string;
}

type Json = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

function requestIdOf(res: Response): string | null {
  const id = res.headers.get("x-request-id") ?? res.headers.get("x-lovable-request-id");
  return id && /^[\w.:-]{1,128}$/.test(id) ? id : null;
}

/** Lê o corpo com teto de bytes. Lança `body_too_large` se passar do teto. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("body_too_large");
    }
    out += decoder.decode(chunk.value, { stream: true });
  }
  return out + decoder.decode();
}

// ───────────────────────── chat/completions ─────────────────────────

/** Conteúdo no formato de `/chat/completions`: texto puro ou partes `text` / `image_url`. */
function chatContent(content: LlmMessageContent): string | Json[] {
  if (typeof content === "string") return content;
  return content.map((p) =>
    p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: p.image_url.url } },
  );
}

export function buildChatBody(req: ProviderRequest): Json {
  const body: Json = {
    model: req.spec.id,
    messages: req.messages.map((m) => ({ role: m.role, content: chatContent(m.content) })),
    max_tokens: req.maxOutputTokens,
    stream: false,
  };
  if (req.reasoningEffort !== "none") body["reasoning_effort"] = req.reasoningEffort;
  if (req.temperature !== null && req.spec.supportsTemperature) body["temperature"] = req.temperature;
  if (req.responseFormat === "json") body["response_format"] = { type: "json_object" };
  return body;
}

function chatFinish(v: unknown): LlmFinishReason {
  if (v === "stop" || v === "end_turn") return "stop";
  if (v === "length" || v === "max_tokens") return "length";
  if (v === "content_filter" || v === "safety") return "content_filter";
  return "other";
}

function chatText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content.map((p) => obj(p)).filter((p): p is Json => !!p && typeof p["text"] === "string");
    return parts.map((p) => p["text"] as string).join("");
  }
  return content == null ? "" : null;
}

export function parseChatPayload(payload: unknown): Omit<Extract<ProviderOutcome, { kind: "ok" }>, "requestId"> | null {
  const root = obj(payload);
  const choice = obj(Array.isArray(root?.["choices"]) ? (root!["choices"] as unknown[])[0] : null);
  const message = obj(choice?.["message"]);
  if (!root || !choice || !message) return null;
  const text = chatText(message["content"]);
  if (text === null) return null;
  const u = obj(root["usage"]);
  const details = obj(u?.["completion_tokens_details"]);
  const usage: RawUsage | null = u
    ? {
        inputTokens: num(u["prompt_tokens"]),
        outputTokens: num(u["completion_tokens"]),
        reasoningTokens: num(details?.["reasoning_tokens"]) ?? num(u["reasoning_tokens"]),
        totalTokens: num(u["total_tokens"]),
      }
    : null;
  return { kind: "ok", text, finishReason: chatFinish(choice["finish_reason"]), usage };
}

// ───────────────────────── responses (streaming) ─────────────────────────

/** Partes no formato de `/responses`: `input_text`/`output_text` e `input_image` (Data URL). */
function responsesContent(m: LlmMessage): Json[] {
  const textType = m.role === "assistant" ? "output_text" : "input_text";
  if (typeof m.content === "string") return [{ type: textType, text: m.content }];
  return m.content.map((p) =>
    p.type === "text" ? { type: textType, text: p.text } : { type: "input_image", image_url: p.image_url.url },
  );
}

export function buildResponsesBody(req: ProviderRequest): Json {
  const system = req.messages.filter((m) => m.role === "system").map((m) => llmMessageText(m.content)).join("\n\n");
  const rest: LlmMessage[] = req.messages.filter((m) => m.role !== "system");
  const body: Json = {
    model: req.spec.id,
    input: rest.map((m) => ({
      type: "message",
      role: m.role,
      content: responsesContent(m),
    })),
    max_output_tokens: req.maxOutputTokens,
    stream: true,
    store: false,
  };
  if (system) body["instructions"] = system;
  if (req.reasoningEffort !== "none") body["reasoning"] = { effort: req.reasoningEffort };
  if (req.temperature !== null && req.spec.supportsTemperature) body["temperature"] = req.temperature;
  if (req.responseFormat === "json") body["text"] = { format: { type: "json_object" } };
  return body;
}

function responsesUsage(response: Json | null): RawUsage | null {
  const u = obj(response?.["usage"]);
  if (!u) return null;
  const details = obj(u["output_tokens_details"]);
  return {
    inputTokens: num(u["input_tokens"]),
    outputTokens: num(u["output_tokens"]),
    reasoningTokens: num(details?.["reasoning_tokens"]),
    totalTokens: num(u["total_tokens"]),
  };
}

function responsesText(response: Json, deltas: string): string {
  if (typeof response["output_text"] === "string") return response["output_text"];
  const output = Array.isArray(response["output"]) ? (response["output"] as unknown[]) : [];
  const texts: string[] = [];
  for (const item of output) {
    const it = obj(item);
    if (it?.["type"] !== "message" || !Array.isArray(it["content"])) continue;
    for (const c of it["content"] as unknown[]) {
      const part = obj(c);
      if (part?.["type"] === "output_text" && typeof part["text"] === "string") texts.push(part["text"]);
    }
  }
  return texts.length > 0 ? texts.join("") : deltas;
}

/**
 * Interpreta o fluxo SSE inteiro (já lido). Terminal esperado: `response.completed`,
 * `response.incomplete` ou `response.failed`. Sem terminal ⇒ fluxo interrompido ⇒ truncado.
 */
export function parseResponsesStream(raw: string): ProviderOutcome {
  let deltas = "";
  let terminal: { type: string; response: Json | null } | null = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let evt: Json | null = null;
    try {
      evt = obj(JSON.parse(data));
    } catch {
      continue; // linha parcial/corrompida: ignorada; a ausência de terminal decide
    }
    const type = typeof evt?.["type"] === "string" ? (evt!["type"] as string) : "";
    if (type === "response.output_text.delta" && typeof evt!["delta"] === "string") deltas += evt!["delta"];
    if (type === "response.completed" || type === "response.incomplete" || type === "response.failed" || type === "error") {
      terminal = { type, response: obj(evt!["response"]) };
    }
  }
  if (!terminal) return { kind: "error", error: failure("truncated_response"), usage: null, requestId: null };
  const usage = responsesUsage(terminal.response);
  if (terminal.type === "response.failed" || terminal.type === "error" || !terminal.response) {
    return { kind: "error", error: failure("provider_unavailable"), usage, requestId: null };
  }
  const resp = terminal.response;
  if (terminal.type === "response.incomplete" || resp["status"] === "incomplete") {
    const reason = obj(resp["incomplete_details"])?.["reason"];
    const finishReason: LlmFinishReason = reason === "content_filter" ? "content_filter" : reason === "max_output_tokens" ? "length" : "other";
    return { kind: "ok", text: responsesText(resp, deltas), finishReason, usage, requestId: null };
  }
  return { kind: "ok", text: responsesText(resp, deltas), finishReason: "stop", usage, requestId: null };
}

// ───────────────────────── provedor ─────────────────────────

export function createLovableGatewayProvider(opts: LovableGatewayOptions): LlmProvider {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const base = opts.baseUrl ?? LOVABLE_GATEWAY_BASE_URL;
  return {
    id: "lovable-gateway",
    async complete(req: ProviderRequest, signal: AbortSignal): Promise<ProviderOutcome> {
      const key = opts.getApiKey();
      if (!key) return { kind: "error", error: failure("config_missing"), usage: null, requestId: null };
      const isChat = req.spec.wire === "chat";
      let res: Response;
      try {
        res = await doFetch(`${base}/${isChat ? "chat/completions" : "responses"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
          body: JSON.stringify(isChat ? buildChatBody(req) : buildResponsesBody(req)),
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw err;
        return { kind: "error", error: failure("network"), usage: null, requestId: null };
      }
      const requestId = requestIdOf(res);
      if (!res.ok) {
        // Corpo de erro descartado sem leitura (pode conter eco do prompt).
        await res.body?.cancel().catch(() => undefined);
        return { kind: "error", error: classifyHttpStatus(res.status), usage: null, requestId };
      }
      let raw: string;
      try {
        raw = await readCapped(res);
      } catch (err) {
        if (signal.aborted) throw err;
        const code = err instanceof Error && err.message === "body_too_large" ? "invalid_response" : "truncated_response";
        return { kind: "error", error: failure(code), usage: null, requestId };
      }
      if (!isChat) return { ...parseResponsesStream(raw), requestId };
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        // JSON cortado no meio = resposta truncada; corpo que nem começa como JSON = inválido.
        const code = raw.trim().startsWith("{") ? "truncated_response" : "invalid_response";
        return { kind: "error", error: failure(code), usage: null, requestId };
      }
      const parsed = parseChatPayload(payload);
      if (!parsed) return { kind: "error", error: failure("invalid_response"), usage: null, requestId };
      return { ...parsed, requestId };
    },
  };
}
