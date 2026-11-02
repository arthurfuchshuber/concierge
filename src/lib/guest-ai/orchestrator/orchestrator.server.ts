/**
 * F2-B · B1 — CONVERSATIONAL ORCHESTRATOR.
 *
 * `runGuestTurn(request)` coordena um turno: contexto autorizado → composição do prompt →
 * Gateway F2-A → decisão estruturada → validação → resultado. Ele NÃO decide a conversa (isso é
 * do modelo, dentro dos limites) e NÃO contém regra de diálogo: só ordena etapas, aplica o prazo
 * e converte qualquer falha num fallback tipado.
 *
 * Garantias:
 *  - nunca lança (fail-closed absoluto): toda falha vira `{ kind: "fallback" }`;
 *  - prazo total ≤ 15 s (contexto + modelo + validação), com corrida contra etapas lentas;
 *  - o contexto nunca contém credenciais (recusado se contiver);
 *  - modo literal "shadow": o resultado não é enviado a canal algum; nada é gravado aqui;
 *  - única via ao modelo: `generateGuestLlm` (F2-A); nenhum provedor é chamado diretamente.
 */
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmErrorCode, LlmResult, ReasoningEffort } from "@/lib/guest-ai/llm/contracts";
import { modelSpec } from "@/lib/guest-ai/llm/models";
import { GuestAiScopeError } from "@/lib/guest-ai/data/scope.server";
import { GUEST_SURFACES } from "@/lib/guest-ai/types";
import { loadConversationContext } from "@/lib/guest-ai/context/conversation-context.server";
import { validateDecision } from "@/lib/guest-ai/validation/output-validator";
import { resolveCaseOwnership } from "./case-ownership";
import { parseModelDecision } from "./decision";
import {
  GUEST_AI_DEFAULT_MODEL,
  GUEST_AI_DEFAULT_REASONING,
  TURN_MAX_DEADLINE_MS,
  TURN_MAX_OUTPUT_TOKENS,
  type ComposedPrompt,
  type ConversationContext,
  type FallbackKind,
  type OrchestratorResult,
  type TurnRequest,
  type TurnStage,
  type ValidationReport,
} from "./contracts";
import { buildTurnLogEvent, defaultTurnLogger, type TurnLogger } from "./telemetry";

/** Mínimo de prazo para valer a pena chamar o modelo (o Gateway também recusa < 1 s). */
export const MIN_LLM_BUDGET_MS = 1_000;
/** Reserva para parse + validação após o modelo. */
export const POST_LLM_RESERVE_MS = 250;

/**
 * Mapeamento EXAUSTIVO dos 17 códigos do Gateway F2-A para fallbacks tipados.
 * `Record<LlmErrorCode, …>` faz o compilador exigir todos os códigos.
 */
export const LLM_FALLBACK: Readonly<Record<LlmErrorCode, FallbackKind>> = Object.freeze({
  invalid_request: "llm_request_invalid",
  sensitive_content_blocked: "sensitive_content_blocked",
  config_missing: "llm_unavailable",
  timeout: "deadline_exceeded",
  aborted: "aborted",
  rate_limited: "llm_unavailable",
  billing: "llm_unavailable",
  auth: "llm_unavailable",
  model_unavailable: "llm_unavailable",
  bad_request: "llm_request_invalid",
  provider_unavailable: "llm_unavailable",
  network: "llm_unavailable",
  invalid_response: "llm_output_invalid",
  empty_response: "llm_output_invalid",
  truncated_response: "llm_output_invalid",
  content_filtered: "llm_output_invalid",
  internal_error: "internal_error",
});

/** B2 instala o compositor real (persona + Dossiê). Sem ele, o turno cai em `prompt_unavailable`. */
export type PromptComposer = (ctx: ConversationContext, req: TurnRequest) => ComposedPrompt | null;
export const NO_COMPOSER: PromptComposer = () => null;

export interface OrchestratorDeps {
  loadContext?: (req: TurnRequest, signal: AbortSignal) => Promise<ConversationContext>;
  composePrompt?: PromptComposer;
  generate?: typeof generateGuestLlm;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  /** Prazo total (limitado a 15 s). */
  deadlineMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  log?: TurnLogger;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACE = /^[\w.:-]{1,80}$/;

export function isValidTurnRequest(req: TurnRequest): boolean {
  return (
    !!req &&
    typeof req === "object" &&
    req.mode === "shadow" &&
    (GUEST_SURFACES as readonly string[]).includes(req.surface) &&
    typeof req.conversationId === "string" &&
    UUID.test(req.conversationId) &&
    typeof req.messageId === "string" &&
    UUID.test(req.messageId) &&
    (req.expectedOwnerId == null || (typeof req.expectedOwnerId === "string" && UUID.test(req.expectedOwnerId))) &&
    typeof req.traceId === "string" &&
    TRACE.test(req.traceId)
  );
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/** Prazo total do turno: aborta o sinal entregue às etapas e permite correr contra elas. */
class TurnDeadline {
  readonly controller = new AbortController();
  private reason: "deadline" | "aborted" | null = null;
  private readonly cancelTimer: () => void;
  private readonly onExternal = () => this.fire("aborted");
  constructor(
    ms: number,
    schedule: NonNullable<OrchestratorDeps["schedule"]>,
    private readonly external?: AbortSignal,
  ) {
    this.cancelTimer = schedule(() => this.fire("deadline"), ms);
    if (external?.aborted) this.fire("aborted");
    else external?.addEventListener("abort", this.onExternal, { once: true });
  }
  private fire(r: "deadline" | "aborted") {
    if (this.reason) return;
    this.reason = r;
    this.controller.abort(r);
  }
  get fired() {
    return this.reason;
  }
  race<T>(p: Promise<T>): Promise<T> {
    if (this.reason) return Promise.reject(new Error(this.reason));
    return Promise.race([
      p,
      new Promise<never>((_, reject) => this.controller.signal.addEventListener("abort", () => reject(new Error(this.reason ?? "aborted")), { once: true })),
    ]);
  }
  dispose() {
    this.cancelTimer();
    this.external?.removeEventListener("abort", this.onExternal);
  }
}

export async function runGuestTurn(req: TurnRequest, deps: OrchestratorDeps = {}): Promise<OrchestratorResult> {
  const rawNow = deps.now ?? (() => performance.now());
  let clockBroken = false;
  // Relógio protegido: um relógio que falha nunca derruba o turno (vira internal_error).
  const now = (): number => {
    try {
      const v = rawNow();
      if (typeof v === "number" && Number.isFinite(v)) return v;
    } catch {
      /* cai abaixo */
    }
    clockBroken = true;
    return Number.NaN;
  };
  const schedule = deps.schedule ?? defaultSchedule;
  const log = deps.log ?? defaultTurnLogger;
  const started = now();
  const requestedModel = deps.model ?? GUEST_AI_DEFAULT_MODEL;
  const model = modelSpec(requestedModel) ? requestedModel : "unregistered";
  const reasoningEffort = deps.reasoningEffort ?? GUEST_AI_DEFAULT_REASONING;
  const deadlineMs = Math.min(TURN_MAX_DEADLINE_MS, Math.max(MIN_LLM_BUDGET_MS, Math.floor(deps.deadlineMs ?? TURN_MAX_DEADLINE_MS)));
  const traceId = typeof req?.traceId === "string" && TRACE.test(req.traceId) ? req.traceId : null;

  let stage: TurnStage = "start";
  let llm: LlmResult | null = null;
  let promptVersion: string | null = null;

  const telemetry = () => ({
    traceId,
    mode: "shadow" as const,
    model,
    reasoningEffort,
    latencyMs: (() => {
      const v = Math.round(now() - started);
      return Number.isFinite(v) && v > 0 ? v : 0;
    })(),
    deadlineMs,
    stage,
    llm: llm ? llm.telemetry : null,
    promptVersion,
  });
  const finish = (r: OrchestratorResult): OrchestratorResult => {
    try {
      log(buildTurnLogEvent(r));
    } catch {
      /* log nunca derruba o turno */
    }
    return r;
  };
  const fallback = (kind: FallbackKind, llmCode: LlmErrorCode | null = null, validation: ValidationReport | null = null): OrchestratorResult =>
    finish({ kind: "fallback", fallback: kind, llmCode, validation, telemetry: telemetry() });

  let deadline: TurnDeadline | null = null;
  try {
    if (clockBroken) return fallback("internal_error");
    if (!isValidTurnRequest(req)) return fallback("scope_invalid");
    if (model === "unregistered") return fallback("llm_request_invalid");

    deadline = new TurnDeadline(deadlineMs, schedule, deps.signal);
    const dl = deadline;
    const interrupted = (): FallbackKind | null => (dl.fired === "deadline" ? "deadline_exceeded" : dl.fired === "aborted" ? "aborted" : null);
    if (interrupted()) return fallback(interrupted()!);

    // 1) Contexto autorizado (sem credenciais)
    stage = "context";
    const loadContext = deps.loadContext ?? ((r: TurnRequest, s: AbortSignal) => loadConversationContext(r, {}, s));
    let ctx: ConversationContext;
    try {
      ctx = await dl.race(loadContext(req, dl.controller.signal));
    } catch (err) {
      const cut = interrupted();
      if (cut) return fallback(cut);
      return fallback(err instanceof GuestAiScopeError ? "scope_invalid" : "context_unavailable");
    }
    if (!ctx || !ctx.guest) return fallback("context_unavailable");
    // Defesa em profundidade: o modelo jamais pode receber credenciais.
    if (ctx.guest.credentials !== null) return fallback("credentials_present");

    // 2) Composição do prompt (B2)
    stage = "compose";
    let prompt: ComposedPrompt | null;
    try {
      prompt = (deps.composePrompt ?? NO_COMPOSER)(ctx, req);
    } catch {
      return fallback("internal_error");
    }
    if (!prompt || typeof prompt.system !== "string" || !prompt.system || !Array.isArray(prompt.messages) || prompt.messages.length === 0) {
      return fallback("prompt_unavailable");
    }
    promptVersion = typeof prompt.promptVersion === "string" ? prompt.promptVersion : null;

    // 3) Modelo (via Gateway F2-A), com o prazo restante
    const cut = interrupted();
    if (cut) return fallback(cut);
    const remaining = deadlineMs - (now() - started);
    const llmTimeout = Math.floor(remaining - POST_LLM_RESERVE_MS);
    if (clockBroken || !Number.isFinite(llmTimeout)) return fallback("internal_error");
    if (llmTimeout < MIN_LLM_BUDGET_MS) return fallback("deadline_exceeded");
    stage = "llm";
    const generate = deps.generate ?? generateGuestLlm;
    try {
      llm = await dl.race(
        generate({
          purpose: "guest_reply",
          model,
          messages: [{ role: "system", content: prompt.system }, ...prompt.messages],
          maxOutputTokens: TURN_MAX_OUTPUT_TOKENS,
          reasoningEffort,
          responseFormat: "json",
          timeoutMs: llmTimeout,
          signal: dl.controller.signal,
          traceId: traceId ?? undefined,
        }),
      );
    } catch {
      return fallback(interrupted() ?? "internal_error");
    }
    if (!llm.ok) return fallback(LLM_FALLBACK[llm.error.code] ?? "internal_error", llm.error.code);

    // 4) Decisão estruturada (parse estrito)
    stage = "decision";
    const decision = parseModelDecision(llm.json);
    if (!decision) return fallback("invalid_decision");

    // 5) Validação (segurança e integridade; não é censura de estilo)
    stage = "validation";
    const ownership = resolveCaseOwnership(ctx.guest.openCases, decision.caseRelation);
    const validation = validateDecision({
      decision,
      credentialPolicy: ctx.credentialPolicy.decision,
      ownership,
      sourceIds: prompt.sourceIds,
    });
    if (validation.verdict === "block") return fallback("validator_block", null, validation);
    // Prazo conferido também pelo relógio: o temporizador não dispara durante código síncrono.
    const late = interrupted() ?? (now() - started > deadlineMs ? "deadline_exceeded" : null);
    if (late) return fallback(late, null, validation);

    stage = "done";
    return finish({ kind: "draft", decision, validation, telemetry: telemetry() });
  } catch {
    return fallback("internal_error");
  } finally {
    deadline?.dispose();
  }
}
