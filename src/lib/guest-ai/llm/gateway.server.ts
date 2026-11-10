/**
 * F2-A — LLM GATEWAY do ConciergeIA Guest.
 *
 * `generateGuestLlm(request)` é o ÚNICO ponto pelo qual o Guest AI fala com um modelo.
 * Garantias:
 *  - NUNCA lança: toda falha vira `{ ok: false, error: { code } }` (fail-closed; o chamador
 *    segue o fallback humano).
 *  - Prazo total rígido (padrão e máximo 15 s) com AbortSignal; vale também para provedor que
 *    ignore o sinal (corrida contra o prazo).
 *  - Nova tentativa só para falha recuperável do provedor (5xx/rede no mesmo modelo; 5xx/rede/429/400 de
 *    formato JSON trocando para o Reserva), uma vez, e só se ainda houver prazo. Outros 4xx: falha fechada.
 *  - Contrato validado ANTES da rede: modelo registrado, limites, esforço de raciocínio
 *    suportado, `forbiddenValues` ausentes das mensagens.
 *  - Resposta truncada, filtrada, vazia ou com JSON inválido = falha (nada parcial sai daqui).
 *  - Telemetria completa (tokens, raciocínio, latência, tentativas, custo) e log por lista branca.
 *
 * Nada aqui é chamado pelo `slot.server.ts` (continua devolvendo fallback humano) nem envia
 * mensagens a canais. Não usa `src/lib/llm/`.
 */
import {
  ESTIMATED_TOKENS_PER_IMAGE,
  LIMITS,
  LLM_IMAGE_DATA_URL_PREFIXES,
  ZERO_USAGE,
  llmMessageText,
  type LlmFailure,
  type LlmMessage,
  type LlmRequest,
  type LlmResult,
  type LlmErrorCode,
  type LlmTelemetry,
  type LlmToolCall,
  type LlmToolChoice,
  type LlmToolSpec,
  type LlmUsage,
  type ReasoningEffort,
} from "./contracts";
import { failure, isTransient, type ClassifiedError } from "./errors";
import { estimateCostUsd, estimateTokensFromChars, guestFallbackModel, modelSpec, type ModelSpec } from "./models";
import { createLovableGatewayProvider } from "./providers/lovable-gateway.server";
import type { LlmProvider, ProviderOutcome, ProviderRequest, RawUsage } from "./providers/types";
import { buildLogEvent, defaultLlmLogger, type LlmLogger } from "./telemetry";

export const RETRY_BACKOFF_MS = 250;
/** Só tenta de novo se sobrar pelo menos isto do prazo. */
export const MIN_RETRY_BUDGET_MS = 3_000;
export const MAX_ATTEMPTS = 2;

export interface GatewayDeps {
  provider?: LlmProvider;
  /** Relógio monotônico em ms (padrão `performance.now`). */
  now?: () => number;
  /** Agenda `fn` em `ms`; devolve o cancelador (padrão setTimeout). */
  schedule?: (fn: () => void, ms: number) => () => void;
  log?: LlmLogger;
}

const ROLES = new Set(["system", "user", "assistant", "tool"]);
/** Falhas do Titular (não transitórias) que acionam o Reserva. */
export const FALLBACK_ON: ReadonlySet<LlmErrorCode> = new Set<LlmErrorCode>([
  "provider_unavailable", // 5xx
  "network", // sem resposta HTTP (queda/timeout de conexão)
  "timeout",
  "rate_limited", // 429
  "json_format_rejected", // o 400 específico de formato JSON
]);
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const TOOL_CALL_ID = /^[\w.:-]{1,128}$/;
const TOOL_CHOICES = new Set<LlmToolChoice>(["auto", "none"]);

/** Ferramentas declaradas válidas (nome único, descrição, schema de objeto). `null` ⇒ inválido. */
function validateTools(tools: unknown): readonly LlmToolSpec[] | null {
  if (tools === undefined) return [];
  if (!Array.isArray(tools) || tools.length > LIMITS.maxTools) return null;
  const names = new Set<string>();
  for (const t of tools as readonly unknown[]) {
    const x = t as Partial<LlmToolSpec> | null;
    if (!x || typeof x !== "object") return null;
    if (typeof x.name !== "string" || !TOOL_NAME.test(x.name) || names.has(x.name)) return null;
    if (typeof x.description !== "string" || !x.description.trim() || x.description.length > 1_024) return null;
    const p = x.parameters as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object" || Array.isArray(p) || p["type"] !== "object") return null;
    names.add(x.name);
  }
  return tools as readonly LlmToolSpec[];
}

/** Chamada de ferramenta bem formada (id, nome, argumentos dentro do teto). */
function validToolCall(c: unknown): c is LlmToolCall {
  const x = c as Partial<LlmToolCall> | null;
  return (
    !!x &&
    typeof x.id === "string" &&
    TOOL_CALL_ID.test(x.id) &&
    typeof x.name === "string" &&
    TOOL_NAME.test(x.name) &&
    typeof x.arguments === "string" &&
    x.arguments.length <= LIMITS.maxToolArgumentsChars
  );
}
const EFFORTS = new Set<ReasoningEffort>(["none", "auto", "low", "medium", "high"]);
const TRACE_ID = /^[\w.:-]{1,80}$/;

let defaultProvider: LlmProvider | null = null;
function getDefaultProvider(): LlmProvider {
  defaultProvider ??= createLovableGatewayProvider({ getApiKey: () => process.env["LOVABLE_API_KEY"] });
  return defaultProvider;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export interface ValidatedRequest {
  spec: ModelSpec;
  provider: ProviderRequest;
  timeoutMs: number;
  inputChars: number;
  /** Partes de imagem da requisição (0 = só texto). */
  imageCount: number;
}

/** Parte de imagem válida: só Data URL base64 de JPEG/PNG/WebP, com conteúdo. */
function validImageUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const prefix = LLM_IMAGE_DATA_URL_PREFIXES.find((p) => url.startsWith(p));
  return !!prefix && url.length > prefix.length;
}

/** Validação pura do contrato. `null` ⇒ `invalid_request` (motivo não é exposto: código fixo). */
export function validateLlmRequest(req: LlmRequest): ValidatedRequest | null {
  if (!req || typeof req !== "object") return null;
  const spec = typeof req.model === "string" ? modelSpec(req.model) : null;
  if (!spec) return null;
  if (!Array.isArray(req.messages) || req.messages.length === 0 || req.messages.length > LIMITS.maxMessages) return null;
  let inputChars = 0;
  let imageCount = 0;
  let imageChars = 0;
  const openCalls = new Set<string>();
  for (const m of req.messages as readonly LlmMessage[]) {
    if (!m || !ROLES.has(m.role)) return null;
    // chamadas de ferramenta só em `assistant`; resultado (`tool`) só responde a uma chamada anterior
    if (m.toolCalls !== undefined) {
      if (m.role !== "assistant" || !Array.isArray(m.toolCalls) || m.toolCalls.length === 0 || m.toolCalls.length > LIMITS.maxToolCalls) return null;
      for (const c of m.toolCalls) {
        if (!validToolCall(c)) return null;
        openCalls.add(c.id);
        inputChars += c.arguments.length;
      }
    }
    if (m.role === "tool") {
      if (typeof m.toolCallId !== "string" || !openCalls.has(m.toolCallId) || typeof m.content !== "string") return null;
    } else if (m.toolCallId !== undefined) return null;
    if (typeof m.content === "string") {
      inputChars += m.content.length;
      continue;
    }
    // partes multimodais: lista não vazia; imagens só em mensagem do usuário
    if (!Array.isArray(m.content) || m.content.length === 0) return null;
    for (const part of m.content as readonly unknown[]) {
      const p = part as { type?: unknown; text?: unknown; image_url?: { url?: unknown } } | null;
      if (!p || typeof p !== "object") return null;
      if (p.type === "text") {
        if (typeof p.text !== "string") return null;
        inputChars += p.text.length;
      } else if (p.type === "image_url") {
        if (m.role !== "user" || !p.image_url || !validImageUrl(p.image_url.url)) return null;
        imageCount += 1;
        imageChars += p.image_url.url.length;
      } else return null;
    }
  }
  if (inputChars === 0 || inputChars > LIMITS.maxTotalChars) return null;
  const tools = validateTools(req.tools);
  if (tools === null) return null;
  const toolChoice: LlmToolChoice = req.toolChoice ?? "auto";
  if (!TOOL_CHOICES.has(toolChoice)) return null;
  if (req.toolChoice !== undefined && tools.length === 0) return null;
  // resultado de ferramenta exige as ferramentas declaradas na mesma requisição
  if (openCalls.size > 0 && tools.length === 0) return null;
  if (imageCount > LIMITS.maxImageParts || imageChars > LIMITS.maxImageDataUrlChars) return null;
  if (!req.messages.some((m) => m.role === "user")) return null;
  const maxOut = Math.min(LIMITS.maxOutputTokens, spec.maxOutputTokens);
  if (!Number.isInteger(req.maxOutputTokens) || req.maxOutputTokens < 1 || req.maxOutputTokens > maxOut) return null;
  const effort: ReasoningEffort = req.reasoningEffort ?? "none";
  if (!EFFORTS.has(effort)) return null;
  if (effort !== "none" && effort !== "auto" && !(spec.reasoningEfforts as readonly string[]).includes(effort)) return null;
  if (imageCount > 0 && !spec.supportsImages) return null;
  const format = req.responseFormat ?? "text";
  if (format !== "text" && format !== "json") return null;
  if (format === "json" && !spec.supportsJson) return null;
  let temperature: number | null = null;
  if (req.temperature !== undefined) {
    if (typeof req.temperature !== "number" || !Number.isFinite(req.temperature) || req.temperature < 0 || req.temperature > 2) return null;
    temperature = req.temperature;
  }
  let timeoutMs: number = LIMITS.defaultTimeoutMs;
  if (req.timeoutMs !== undefined) {
    if (typeof req.timeoutMs !== "number" || !Number.isFinite(req.timeoutMs)) return null;
    timeoutMs = Math.min(LIMITS.maxTimeoutMs, Math.max(LIMITS.minTimeoutMs, Math.floor(req.timeoutMs)));
  }
  return {
    spec,
    timeoutMs,
    inputChars,
    imageCount,
    provider: {
      spec,
      messages: req.messages,
      maxOutputTokens: req.maxOutputTokens,
      reasoningEffort: effort,
      responseFormat: format,
      temperature,
      // sem ferramentas o pedido ao transporte fica idêntico ao de antes (campos ausentes)
      ...(tools.length > 0 ? { tools, toolChoice } : {}),
    },
  };
}

/** Algum valor proibido aparece em alguma mensagem? (comparação literal, sem normalização). */
export function containsForbidden(messages: readonly LlmMessage[], forbidden: readonly string[] | undefined): boolean {
  if (!forbidden || forbidden.length === 0) return false;
  const values = forbidden.filter((v) => typeof v === "string" && v.length > 0);
  return messages.some((m) => {
    if (!m || (typeof m.content !== "string" && !Array.isArray(m.content))) return false;
    const args = Array.isArray(m.toolCalls) ? m.toolCalls.map((c) => (typeof c?.arguments === "string" ? c.arguments : "")).join("\n") : "";
    const text = `${llmMessageText(m.content)}\n${args}`;
    return values.some((v) => text.includes(v));
  });
}

/** Normaliza o uso informado; sem uso confiável, estima por caracteres e marca `estimated`. */
export function normalizeUsage(raw: RawUsage | null, inputChars: number, outputChars: number, imageCount = 0): LlmUsage {
  if (raw && raw.inputTokens !== undefined && raw.outputTokens !== undefined) {
    const reasoning = Math.min(raw.reasoningTokens ?? 0, raw.outputTokens);
    return {
      inputTokens: raw.inputTokens,
      outputTokens: raw.outputTokens,
      reasoningTokens: reasoning,
      totalTokens: raw.totalTokens ?? raw.inputTokens + raw.outputTokens,
      source: "provider",
    };
  }
  const input = estimateTokensFromChars(inputChars) + Math.max(0, imageCount) * ESTIMATED_TOKENS_PER_IMAGE;
  const output = estimateTokensFromChars(outputChars);
  return { inputTokens: input, outputTokens: output, reasoningTokens: 0, totalTokens: input + output, source: "estimated" };
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  if (a.source === "none") return b;
  if (b.source === "none") return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    source: a.source === "provider" && b.source === "provider" ? "provider" : "estimated",
  };
}

/** Remove cercas ```json … ``` antes do parse. */
export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {
    return { ok: false };
  }
}

class Deadline {
  readonly controller = new AbortController();
  private cancelTimer: () => void;
  private reason: "timeout" | "aborted" | null = null;
  private readonly onExternal = () => this.fire("aborted");
  constructor(
    ms: number,
    schedule: NonNullable<GatewayDeps["schedule"]>,
    private readonly external?: AbortSignal,
  ) {
    this.cancelTimer = schedule(() => this.fire("timeout"), ms);
    if (external) {
      if (external.aborted) this.fire("aborted");
      else external.addEventListener("abort", this.onExternal, { once: true });
    }
  }
  private fire(reason: "timeout" | "aborted") {
    if (this.reason) return;
    this.reason = reason;
    this.controller.abort(reason);
  }
  get firedReason() {
    return this.reason;
  }
  /** Promessa que rejeita quando o prazo dispara (corrida contra provedor que ignore o sinal). */
  race<T>(p: Promise<T>): Promise<T> {
    if (this.reason) return Promise.reject(new Error(this.reason));
    return Promise.race([
      p,
      new Promise<never>((_, reject) => this.controller.signal.addEventListener("abort", () => reject(new Error(this.reason ?? "aborted")), { once: true })),
    ]);
  }
  sleep(ms: number, schedule: NonNullable<GatewayDeps["schedule"]>): Promise<void> {
    return this.race(new Promise<void>((resolve) => void schedule(resolve, ms)));
  }
  dispose() {
    this.cancelTimer();
    this.external?.removeEventListener("abort", this.onExternal);
  }
}

export async function generateGuestLlm(request: LlmRequest, deps: GatewayDeps = {}): Promise<LlmResult> {
  const now = deps.now ?? (() => performance.now());
  const schedule = deps.schedule ?? defaultSchedule;
  const log = deps.log ?? defaultLlmLogger;
  const started = now();
  const traceId = typeof request?.traceId === "string" && TRACE_ID.test(request.traceId) ? request.traceId : null;
  const purpose = request?.purpose ?? "test";

  const telemetryBase = (provider: string, model: string, attempts: number, usage: LlmUsage, spec: ModelSpec | null, requestId: string | null): LlmTelemetry => ({
    provider,
    model,
    purpose,
    latencyMs: Math.max(0, Math.round(now() - started)),
    attempts,
    usage,
    costUsd: spec ? estimateCostUsd(spec, usage.inputTokens, usage.outputTokens) : 0,
    providerRequestId: requestId,
    traceId,
  });

  const emit = (result: LlmResult, extra: { timeoutMs: number; effort: ReasoningEffort; format: "text" | "json"; messageCount: number; inputChars: number; outputChars: number }) => {
    try {
      log(
        buildLogEvent({
          outcome: result.ok ? "ok" : "error",
          code: result.ok ? null : result.error.code,
          httpStatus: result.ok ? null : result.error.httpStatus,
          telemetry: result.telemetry,
          timeoutMs: extra.timeoutMs,
          reasoningEffort: extra.effort,
          responseFormat: extra.format,
          messageCount: extra.messageCount,
          inputChars: extra.inputChars,
          outputChars: extra.outputChars,
        }),
      );
    } catch {
      /* log nunca derruba a chamada */
    }
    return result;
  };

  const fail = (c: ClassifiedError, t: LlmTelemetry): LlmFailure => ({ ok: false, error: { code: c.code, retryable: c.retryable, httpStatus: c.httpStatus }, telemetry: t });

  try {
    const v = validateLlmRequest(request);
    const messageCount = Array.isArray(request?.messages) ? request.messages.length : 0;
    if (!v) {
      const registered = typeof request?.model === "string" && modelSpec(request.model) ? request.model : "unregistered";
      return emit(fail(failure("invalid_request"), telemetryBase("none", registered, 0, ZERO_USAGE, null, null)), {
        timeoutMs: 0, effort: "none", format: "text", messageCount, inputChars: 0, outputChars: 0,
      });
    }
    const extraBase = { timeoutMs: v.timeoutMs, effort: v.provider.reasoningEffort, format: v.provider.responseFormat, messageCount, inputChars: v.inputChars };
    if (containsForbidden(request.messages, request.forbiddenValues)) {
      return emit(fail(failure("sensitive_content_blocked"), telemetryBase("none", v.spec.id, 0, ZERO_USAGE, v.spec, null)), { ...extraBase, outputChars: 0 });
    }

    const provider = deps.provider ?? getDefaultProvider();
    const deadline = new Deadline(v.timeoutMs, schedule, request.signal);
    let usage: LlmUsage = ZERO_USAGE;
    let attempts = 0;
    let requestId: string | null = null;
    let lastError: ClassifiedError = failure("internal_error");
    // Reserva automática do Titular (ver `GUEST_AI_FALLBACK_MODELS`), Etapa 0 de 08/11/2026: a 2ª tentativa vai
    // para o Reserva SÓ em erro recuperável do provedor — 5xx, rede/timeout, 429 e o 400 específico de formato
    // JSON (`json_format_rejected`). Qualquer outro 4xx (400/422 genérico, 401/403, 402, 404, …) é falha FECHADA,
    // sem nova tentativa às cegas. Mesmo prazo, mesmas travas.
    const fallbackId = guestFallbackModel(v.spec.id);
    const vFallback = fallbackId ? validateLlmRequest({ ...request, model: fallbackId }) : null;
    let cur: ValidatedRequest = v;
    try {
      while (attempts < MAX_ATTEMPTS) {
        if (deadline.firedReason) {
          // Cancelado/estourado antes de (re)tentar: nada vai à rede.
          lastError = failure(deadline.firedReason === "timeout" ? "timeout" : "aborted");
          break;
        }
        attempts += 1;
        let outcome: ProviderOutcome;
        try {
          outcome = await deadline.race(provider.complete(cur.provider, deadline.controller.signal));
        } catch {
          const reason = deadline.firedReason;
          lastError = failure(reason === "timeout" ? "timeout" : reason === "aborted" ? "aborted" : "network");
          if (reason) break;
          outcome = { kind: "error", error: lastError, usage: null, requestId: null };
        }
        requestId = outcome.requestId ?? requestId;

        if (outcome.kind === "ok") {
          const text = outcome.text;
          usage = addUsage(usage, normalizeUsage(outcome.usage, cur.inputChars, text.length, cur.imageCount));
          const t = () => telemetryBase(provider.id, cur.spec.id, attempts, usage, cur.spec, requestId);
          const extra = { ...extraBase, outputChars: text.length };
          if (outcome.finishReason === "tool_calls") {
            // só vale se a requisição ofereceu ferramentas e permitiu chamá-las; nomes fora da lista são descartados
            const declared = new Set((cur.provider.tools ?? []).map((x) => x.name));
            const calls = (cur.provider.toolChoice ?? "auto") === "auto" ? (outcome.toolCalls ?? []).filter((c) => validToolCall(c) && declared.has(c.name)) : [];
            if (calls.length === 0) return emit(fail(failure("invalid_response"), t()), extra);
            return emit({ ok: true, text: text.trim(), finishReason: "tool_calls", toolCalls: calls, telemetry: t() }, extra);
          }
          if (outcome.finishReason === "length") return emit(fail(failure("truncated_response"), t()), extra);
          if (outcome.finishReason === "content_filter") return emit(fail(failure("content_filtered"), t()), extra);
          if (outcome.finishReason !== "stop") return emit(fail(failure("invalid_response"), t()), extra);
          if (!text.trim()) return emit(fail(failure("empty_response"), t()), extra);
          if (cur.provider.responseFormat === "json") {
            const parsed = parseJsonText(text);
            if (!parsed.ok) return emit(fail(failure("invalid_response"), t()), extra);
            return emit({ ok: true, text: text.trim(), json: parsed.value, finishReason: "stop", telemetry: t() }, extra);
          }
          return emit({ ok: true, text: text.trim(), finishReason: "stop", telemetry: t() }, extra);
        }

        if (outcome.usage) usage = addUsage(usage, normalizeUsage(outcome.usage, cur.inputChars, 0, cur.imageCount));
        lastError = outcome.error;
        const remaining = v.timeoutMs - (now() - started);
        const canSwitch = cur === v && vFallback !== null && (isTransient(outcome.error.code) || FALLBACK_ON.has(outcome.error.code));
        if ((!isTransient(outcome.error.code) && !canSwitch) || attempts >= MAX_ATTEMPTS || remaining < MIN_RETRY_BUDGET_MS) break;
        if (canSwitch) cur = vFallback;
        try {
          await deadline.sleep(RETRY_BACKOFF_MS, schedule);
        } catch {
          const reason = deadline.firedReason;
          lastError = failure(reason === "aborted" ? "aborted" : "timeout");
          break;
        }
      }
    } finally {
      deadline.dispose();
    }
    return emit(fail(lastError, telemetryBase(provider.id, cur.spec.id, attempts, usage, cur.spec, requestId)), { ...extraBase, outputChars: 0 });
  } catch {
    // Defesa final: nenhuma exceção escapa do gateway.
    return emit(fail(failure("internal_error"), telemetryBase("none", "unregistered", 0, ZERO_USAGE, null, null)), {
      timeoutMs: 0, effort: "none", format: "text", messageCount: 0, inputChars: 0, outputChars: 0,
    });
  }
}
