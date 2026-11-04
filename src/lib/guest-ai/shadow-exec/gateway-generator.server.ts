/**
 * F2-B · B3.3 — GERADOR SHADOW ligado ao Gateway real (capacidade EMITIDA e verificável).
 *
 * Só `createShadowGatewayGenerator` cria um gerador válido (registro WeakSet, como o `LlmMock`), e só
 * com uma PRÉ-AUTORIZAÇÃO emitida pelo worker (`issueShadowPreflight`) depois de manifesto, integridade,
 * pausa e posse humana conferidos. O executor recusa qualquer outro gerador.
 *
 * Antes de QUALQUER chamada de rede, nesta ordem (falha ⇒ nenhuma requisição, código fechado):
 *   chave mestra `GUEST_AI_SHADOW=on` → prazo → estado global relido (`running`, mesma versão) →
 *   configuração completa + retenção autorizada → modelo permitido (OpenAI `/responses`) →
 *   orçamento por turno (pior caso) → reserva atômica diária.
 * Depois da resposta: estado relido de novo; mudou ⇒ resultado descartado (`shutdown_requested`).
 *
 * Descarte: o texto bruto do provedor NUNCA sai daqui. À cadeia vai só a decisão re-serializada a
 * partir do JSON já validado pelo Gateway; o gerador guarda apenas números e códigos (`telemetry()`).
 * Não há fallback para outro modelo ou provedor.
 */
import { generateGuestLlm } from "@/lib/guest-ai/llm/gateway.server";
import type { LlmErrorCode } from "@/lib/guest-ai/llm/contracts";
import type { LlmLogger } from "@/lib/guest-ai/llm/telemetry";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import { modelSpec } from "@/lib/guest-ai/llm/models";
import { estimateTokens } from "@/lib/guest-ai/budget";
import type { ComposedPrompt } from "@/lib/guest-ai/orchestrator/contracts";
import type { ShadowStore } from "@/lib/guest-ai/data/shadow-store.server";
import { evaluateTurnBudget, validateShadowControl } from "./breakers";
import { SHADOW_ALLOWED_MODELS, UUID_RE, type BudgetLimitId, type ShadowBlockCode, type ShadowLimits, type ShadowModelId } from "./contracts";
import type { ShadowDeadline } from "./deadline";

// ─────────────────────────── Pré-autorização do worker ───────────────────────────

const PREFLIGHTS = new WeakSet<object>();

/** Prova de que o worker conferiu manifesto, integridade, pausa e posse humana desta execução. */
export interface ShadowPreflight {
  readonly executionId: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly conversationId: string;
  readonly stateVersion: number;
}

export function issueShadowPreflight(p: { executionId: string; tenantId: string; propertyId: string; conversationId: string; stateVersion: number; manifestOk: true; integrityOk: true; pauseInactive: true; ownershipOk: true }): Readonly<ShadowPreflight> | null {
  if (p.manifestOk !== true || p.integrityOk !== true || p.pauseInactive !== true || p.ownershipOk !== true) return null;
  if (![p.executionId, p.tenantId, p.propertyId, p.conversationId].every((v) => typeof v === "string" && UUID_RE.test(v)) || !Number.isInteger(p.stateVersion)) return null;
  const pf = Object.freeze({ executionId: p.executionId, tenantId: p.tenantId, propertyId: p.propertyId, conversationId: p.conversationId, stateVersion: p.stateVersion });
  PREFLIGHTS.add(pf);
  return pf;
}

// ─────────────────────────── Gerador ───────────────────────────

export interface GeneratorTelemetry {
  readonly status: "idle" | "blocked" | "called" | "failed" | "discarded";
  readonly blockCode: ShadowBlockCode | null;
  readonly budgetLimit: BudgetLimitId | null;
  readonly estimatedInputTokens: number | null;
  readonly reservationId: string | null;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly usageSource: "provider" | "estimated" | "none";
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly error: LlmErrorCode | null;
}

export interface ShadowGatewayGenerator {
  readonly kind: "shadow_gateway";
  readonly modelId: ShadowModelId;
  generate(prompt: ComposedPrompt, signal: AbortSignal): Promise<string>;
  telemetry(): GeneratorTelemetry;
}

const ISSUED = new WeakSet<object>();
export function isShadowGatewayGenerator(x: unknown): x is ShadowGatewayGenerator {
  return typeof x === "object" && x !== null && ISSUED.has(x);
}

/** Erro sem conteúdo: só um código fechado (nunca mensagem do provedor ou texto). */
export class ShadowGeneratorStop extends Error {
  constructor(readonly code: ShadowBlockCode | "gateway_failed" | "response_discarded") {
    super(code);
    this.name = "ShadowGeneratorStop";
  }
}

export interface ShadowGeneratorDeps {
  preflight: Readonly<ShadowPreflight>;
  limits: ShadowLimits;
  deadline: ShadowDeadline;
  store: Pick<ShadowStore, "readControl" | "reserve">;
  /** Chave mestra lida a cada chamada (padrão: `process.env.GUEST_AI_SHADOW === "on"`). */
  masterSwitchOn?: () => boolean;
  /** Transporte injetável (testes usam transporte falso; nenhuma chamada externa). */
  provider?: LlmProvider;
  log?: LlmLogger;
  now?: () => number;
}

export const defaultMasterSwitch = (): boolean => process.env["GUEST_AI_SHADOW"] === "on";

export function createShadowGatewayGenerator(deps: ShadowGeneratorDeps): ShadowGatewayGenerator | null {
  if (!deps || !PREFLIGHTS.has(deps.preflight as object)) return null;
  if (!(SHADOW_ALLOWED_MODELS as readonly string[]).includes(deps.limits?.modelId)) return null;
  const spec = modelSpec(deps.limits.modelId);
  if (!spec || spec.wire !== "responses") return null;
  const switchOn = deps.masterSwitchOn ?? defaultMasterSwitch;
  const now = deps.now ?? (() => performance.now());
  let used = false;
  let t: GeneratorTelemetry = Object.freeze({
    status: "idle", blockCode: null, budgetLimit: null, estimatedInputTokens: null, reservationId: null, calls: 0, inputTokens: 0, outputTokens: 0,
    reasoningTokens: 0, totalTokens: 0, usageSource: "none", costUsd: 0, latencyMs: 0, error: null,
  });
  const block = (code: ShadowBlockCode, limit: BudgetLimitId | null = null): never => {
    t = Object.freeze({ ...t, status: "blocked", blockCode: code, budgetLimit: limit });
    throw new ShadowGeneratorStop(code);
  };
  const stillRunning = async (): Promise<ShadowBlockCode | null> => {
    const c = await deps.store.readControl();
    if (!c) return "state_unreadable";
    if (c.state !== "running" || c.stateVersion !== deps.preflight.stateVersion) return "shutdown_requested";
    const v = validateShadowControl(c);
    return v.ok ? null : v.code;
  };

  const generator: ShadowGatewayGenerator = {
    kind: "shadow_gateway",
    modelId: deps.limits.modelId,
    async generate(prompt, signal) {
      // uma chamada por execução: o worker nunca repete (a nova tentativa interna é do Gateway e já está no orçamento)
      if (used) block("generator_not_issued");
      used = true;
      if (switchOn() !== true) block("master_switch_off");
      if (signal.aborted || deps.deadline.processingRemainingMs() <= 0) block("deadline_expired");
      const state = await stillRunning();
      if (state) block(state);
      const chars = (prompt?.system?.length ?? 0) + (Array.isArray(prompt?.messages) ? prompt.messages.reduce((n, m) => n + (typeof m?.content === "string" ? m.content.length : 0), 0) : 0);
      const estimated = estimateTokens(chars);
      t = Object.freeze({ ...t, estimatedInputTokens: estimated });
      const turn = evaluateTurnBudget(deps.limits, spec, estimated);
      if (!turn.ok) return block("budget_turn_exceeded", turn.limit);
      const res = await deps.store.reserve(deps.preflight.executionId, turn.reservation);
      if (res.kind === "exceeded") block("budget_daily_exceeded", res.limit);
      if (res.kind === "blocked" && res.code === "state_not_running") block("shutdown_requested");
      if (res.kind !== "reserved") block("budget_reservation_failed");
      const reservationId = (res as { reservationId: string }).reservationId;
      t = Object.freeze({ ...t, reservationId });
      // estado e prazo conferidos de novo IMEDIATAMENTE antes da rede
      if (switchOn() !== true) block("master_switch_off");
      if (signal.aborted || deps.deadline.processingRemainingMs() <= 0) block("deadline_expired");

      const t0 = now();
      const result = await generateGuestLlm(
        {
          purpose: "guest_reply",
          model: deps.limits.modelId,
          messages: [{ role: "system", content: prompt.system }, ...prompt.messages],
          maxOutputTokens: deps.limits.maxOutputTokens,
          reasoningEffort: deps.limits.reasoningEffort,
          responseFormat: "json",
          timeoutMs: deps.deadline.processingRemainingMs(),
          signal,
          traceId: deps.preflight.executionId,
        },
        { provider: deps.provider, log: deps.log },
      );
      const u = result.telemetry.usage;
      t = Object.freeze({
        ...t,
        status: "called",
        calls: result.telemetry.attempts,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        reasoningTokens: u.reasoningTokens,
        totalTokens: u.totalTokens,
        usageSource: u.source,
        costUsd: result.telemetry.costUsd,
        latencyMs: Math.max(0, Math.round(now() - t0)),
        error: result.ok ? null : result.error.code,
      });
      if (!result.ok) {
        t = Object.freeze({ ...t, status: "failed" });
        throw new ShadowGeneratorStop("gateway_failed");
      }
      // desligamento/troca de estado durante a chamada ⇒ o resultado é descartado sem chegar à cadeia
      const after = await stillRunning();
      if (after || signal.aborted) {
        t = Object.freeze({ ...t, status: "discarded", blockCode: after ?? "deadline_expired" });
        throw new ShadowGeneratorStop("response_discarded");
      }
      // Só a decisão estruturada (JSON validado pelo Gateway), re-serializada; o texto bruto fica aqui.
      return JSON.stringify(result.json);
    },
    telemetry() {
      return t;
    },
  };
  ISSUED.add(generator);
  return Object.freeze(generator);
}
