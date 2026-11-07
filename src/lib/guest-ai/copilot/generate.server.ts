/**
 * COPILOTO — serviço de GERAÇÃO de uma sugestão (servidor; nunca bloqueia o atendimento humano).
 *
 * Fluxo: identificadores do canal → `validateTurnScope` (F0: conversa, mensagem, imóvel e conta re-derivados
 * e validados no backend) → reivindicação idempotente no banco (`copilot_claim_generation`: uma sugestão por
 * mensagem do hóspede, teto diário, sugestões anteriores da conversa marcadas `superseded`) → a MESMA cadeia
 * `runTurnChain` da Guest AI (contexto D9 com `credentials: "skip"`, Dossiê, histórico, autorizações
 * formais, identidade de envio, guard de segredos, validadores estrutural e semântico) com o gerador do
 * Copiloto ligado ao Lovable AI Gateway → resultado gravado (`copilot_store_result`) para o cartão da UI.
 *
 * O que NÃO entra aqui, de propósito:
 *  - as portas `loadConversationOwnership`/`loadHumanPause` da cadeia. Elas implementam o VETO da pausa
 *    humana à resposta AUTÔNOMA (B2.5/B3.2): com a equipe no comando, a cadeia só pode devolver `paused`.
 *    No Copiloto a equipe está SEMPRE no comando (é ela quem aprova e envia), então o veto tornaria a
 *    sugestão impossível exatamente quando ela é útil. A posse humana continua lida (só leitura) para o
 *    cartão informar "equipe no comando"; os controles D9 (credenciais, horários, remetente, isolamento)
 *    seguem íntegros na própria cadeia. Nenhum controle foi alterado — só não se injeta o veto de envio
 *    num fluxo que não envia.
 *  - o coletor/lease do worker Shadow (lote autônomo): a sugestão é por mensagem; mensagem mais nova
 *    substitui a sugestão anterior (`superseded`) e o gerador confere isso antes da rede.
 * Nunca lança: todo desfecho vira um resultado fechado; nenhum texto de exceção ou do provedor sai em log.
 */
import { runTurnChain, type ChainDeps, type ChainOutcome } from "@/lib/guest-ai/turn-chain";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import {
  GuestAiScopeError,
  validateTurnScope as realValidateTurnScope,
} from "@/lib/guest-ai/data/scope.server";
import {
  abortableDb,
  getGuestAiCopilotRpc,
  getGuestAiDb,
  type GuestAiDb,
} from "@/lib/guest-ai/data/client.server";
import { loadConversationContext } from "@/lib/guest-ai/context/conversation-context.server";
import { fetchConversationHistory } from "@/lib/guest-ai/data/history.server";
import { fetchGuestImages, type GuestImage } from "@/lib/guest-ai/data/guest-images.server";
import { fetchGuestProfile } from "@/lib/guest-ai/data/guest-profile.server";
import type { HistoryResult } from "@/lib/guest-ai/history";
import { fetchPropertyDossier } from "@/lib/guest-ai/data/property-dossier.server";
import { primaryDossierTarget } from "@/lib/guest-ai/data/property-access.server";
import { loadStayAuthorizationSource } from "@/lib/guest-ai/data/stay-authorization.server";
import { loadSenderIdentitySource } from "@/lib/guest-ai/data/sender-identity.server";
import {
  loadConversationOwnership,
  type OwnershipLoad,
} from "@/lib/guest-ai/data/conversation-ownership.server";
import { deriveHumanOwnership } from "@/lib/guest-ai/orchestrator/case-ownership";
import type { LlmProvider } from "@/lib/guest-ai/llm/providers/types";
import type { LlmLogger } from "@/lib/guest-ai/llm/telemetry";
import type { StayPhase, ValidatedTurn } from "@/lib/guest-ai/types";
import { runOps, type OpsRunInput } from "@/lib/guest-ai/ops/executor.server";
import {
  COPILOT_DEADLINE_MS,
  COPILOT_MAX_OUTPUT_TOKENS,
  COPILOT_MAX_TURN_COST_USD,
  COPILOT_REASONING_EFFORT,
  copilotDailyLimitUsd,
  copilotFlagOn,
  copilotPropertyAllowed,
  copilotModelId,
  type CopilotGenerationRequest,
  type CopilotWarning,
} from "./contracts";
import {
  createCopilotGenerator,
  CopilotGeneratorStop,
  NO_VISION,
  type CopilotGenerator,
  type CopilotVisionInput,
} from "./generator.server";
import { createCopilotStore, type CopilotResultInput, type CopilotStore } from "./store.server";

export type CopilotPorts = Required<
  Pick<
    ChainDeps,
    | "loadContext"
    | "loadHistory"
    | "loadDossiers"
    | "loadStayAuthorizationSource"
    | "loadSenderIdentitySource"
  >
> &
  Pick<ChainDeps, "loadGuestProfile">;

export interface CopilotGenerateDeps {
  db?: GuestAiDb;
  store?: CopilotStore;
  validateTurnScope?: (input: CopilotGenerationRequest, db: GuestAiDb) => Promise<ValidatedTurn>;
  loadOwnership?: (
    turn: ValidatedTurn,
    db: GuestAiDb,
    signal: AbortSignal,
    nowIso: string,
  ) => Promise<OwnershipLoad>;
  /** Portas de leitura da cadeia (produção: loaders reais; testes: falsos em memória). */
  ports?: (
    turn: ValidatedTurn,
    db: GuestAiDb,
    meta: { onDossierEntries: (n: number) => void; onHistoryMessages: (n: number) => void },
  ) => CopilotPorts;
  generator?: (opts: {
    remainingMs: () => number;
    beforeNetwork: () => Promise<boolean>;
    traceId: string;
    loadVision: () => Promise<CopilotVisionInput>;
  }) => CopilotGenerator;
  /** Fotos do hóspede (produção: `fetchGuestImages`; testes: falso em memória). */
  loadImages?: (turn: ValidatedTurn, db: GuestAiDb, signal: AbortSignal) => Promise<GuestImage[]>;
  provider?: LlmProvider;
  log?: LlmLogger;
  /** Relógio de parede em ms desde a época (padrão `Date.now`). */
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  env?: Record<string, string | undefined>;
  deadlineMs?: number;
  /**
   * G2 · ações operacionais (padrão: `runOps`, modo por `GUEST_AI_OPS_MODE`). Roda depois da gravação da
   * sugestão, só com decisão validada; nunca altera a sugestão, e falha nunca derruba a geração.
   */
  ops?: (input: OpsRunInput) => Promise<unknown>;
}

export type CopilotGenerateResult =
  | {
      status: "stored";
      suggestionId: string;
      state: "available" | "no_suggestion" | "generation_failed";
      code: string | null;
    }
  | { status: "exists"; suggestionId: string; state: string }
  | { status: "daily_budget_exceeded"; suggestionId: string }
  | { status: "stale"; suggestionId: string }
  | {
      status: "skipped";
      code:
        | "generation_off"
        | "property_not_allowlisted"
        | "scope_refused"
        | "claim_invalid"
        | "claim_failed"
        | "store_failed"
        | "internal_error";
      detail: string | null;
    };

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

function productionPorts(
  turn: ValidatedTurn,
  db: GuestAiDb,
  meta: { onDossierEntries: (n: number) => void; onHistoryMessages: (n: number) => void },
): CopilotPorts {
  let audiences: readonly string[] | null = null;
  return {
    loadContext: async (t, s) => {
      const ctx = await loadConversationContext(
        // `mode: "shadow"` é o único valor do contrato do loader e significa só "sem envio autônomo" — o que vale aqui.
        {
          surface: t.surface,
          conversationId: t.conversationId,
          messageId: t.messageId,
          expectedOwnerId: t.tenantId,
          mode: "shadow",
          traceId: t.conversationId,
        },
        { db },
        s,
      );
      audiences = ctx.guest.audiences;
      return ctx;
    },
    loadHistory: async (t, s) => {
      const h = await fetchConversationHistory(t, { db, signal: s });
      meta.onHistoryMessages(h.status === "available" ? h.entries.length : 0);
      return h;
    },
    loadDossiers: async (t, s) => {
      if (!audiences) throw new Error("context_not_loaded");
      const primary = await fetchPropertyDossier(primaryDossierTarget(t, audiences), {
        db,
        signal: s,
      });
      meta.onDossierEntries(primary.entries.length + primary.manuals.length);
      return { primary };
    },
    loadStayAuthorizationSource: (t, s) => loadStayAuthorizationSource(t, { db, signal: s }),
    loadSenderIdentitySource: (t, s) => loadSenderIdentitySource(t, { db, signal: s }),
    loadGuestProfile: (t, s) => fetchGuestProfile(t, { db, signal: s }),
  };
}

const uniq = (w: CopilotWarning[]): CopilotWarning[] => [...new Set(w)];

/**
 * Sintaxe de expansão do guia (`[[info:…]]`, `[[tag:…]]`). A rotina humana de envio EXPANDE essas marcas com
 * campos do imóvel — inclusive senhas de fechadura, portão e Wi-Fi. Um texto vindo do MODELO nunca pode
 * carregá-las (seria um caminho para revelar credencial depois da aprovação). Recusada na geração.
 */
export const GUIDE_TEMPLATE_SYNTAX = /\[\[\s*(info|tag)\s*:/i;

/** Projeção do desfecho da cadeia para a linha do banco (só o texto final da sugestão é texto livre). */
export function projectOutcome(
  outcome: ChainOutcome,
  extra: { surface: string; humanInCommand: boolean | null; reservationLinked: boolean | null },
): Pick<
  CopilotResultInput,
  | "state"
  | "text"
  | "internalQuestion"
  | "intents"
  | "strategy"
  | "handoffNeeded"
  | "handoffUrgency"
  | "outcomeKind"
  | "outcomeCode"
  | "warnings"
> & {
  stayPhase: string | null;
  credentialPolicy: "allow" | "deny" | null;
  senderIdentity: string | null;
} {
  const a = outcome.audit;
  const warnings: CopilotWarning[] = [];
  const situation = "situation" in outcome ? outcome.situation : null;
  const intents = situation?.intents ?? a.decision?.intents ?? [];
  if (a.checks.unknownFacts > 0) warnings.push("unknown_facts");
  if (a.checks.sourceConflicts > 0) warnings.push("source_conflicts");
  if (a.decision?.credentialIntent === "would_deliver") warnings.push("credential_request_denied");
  if ((a.decision?.unauthorizedKinds.length ?? 0) > 0) warnings.push("unauthorized_commitment");
  if (situation?.humanAction.needed || a.decision?.handoff.needed)
    warnings.push("handoff_recommended");
  if (situation?.emergency || intents.includes("emergency")) warnings.push("emergency");
  if (
    extra.surface === "airbnb" &&
    a.checks.senderIdentity &&
    a.checks.senderIdentity.status !== "resolved"
  )
    warnings.push("sender_identity_unresolved");
  if (extra.humanInCommand) warnings.push("human_in_command");
  if (extra.reservationLinked === false) warnings.push("reservation_not_linked");
  if (a.checks.dossierScope === "not_provided" || a.checks.dossierScope === "not_run")
    warnings.push("dossier_unavailable");
  if (intents.includes("formal_change_request")) warnings.push("formal_change_request");
  const handoff = situation?.humanAction ?? a.decision?.handoff ?? { needed: false, urgency: null };
  const base = {
    intents: [...intents],
    strategy: a.decision?.strategy ?? null,
    handoffNeeded: handoff.needed,
    handoffUrgency: handoff.urgency,
    stayPhase: null as string | null,
    credentialPolicy: a.checks.credentialPolicy,
    senderIdentity: a.checks.senderIdentity?.status ?? "not_evaluated",
    internalQuestion: null as string | null,
  };
  switch (outcome.kind) {
    case "reply":
      if (GUIDE_TEMPLATE_SYNTAX.test(outcome.text)) {
        return {
          ...base,
          state: "generation_failed",
          text: null,
          strategy: outcome.strategy,
          outcomeKind: "refused",
          outcomeCode: "template_tag_in_output",
          warnings: uniq(warnings),
        };
      }
      return {
        ...base,
        state: "available",
        text: outcome.text,
        strategy: outcome.strategy,
        outcomeKind: "reply",
        outcomeCode: null,
        warnings: uniq(warnings),
      };
    case "human_action":
      return {
        ...base,
        state: "no_suggestion",
        text: null,
        internalQuestion: outcome.question.slice(0, 1000) || null,
        outcomeKind: "human_action",
        outcomeCode: "human_action",
        warnings: uniq([...warnings, "handoff_recommended"]),
      };
    case "silence":
      return {
        ...base,
        state: "no_suggestion",
        text: null,
        outcomeKind: "silence",
        outcomeCode: "silence",
        warnings: uniq(warnings),
      };
    case "paused":
      return {
        ...base,
        state: "no_suggestion",
        text: null,
        outcomeKind: "paused",
        outcomeCode: "human_pause_active",
        warnings: uniq([...warnings, "human_in_command"]),
      };
    case "urgent_internal_alert":
      return {
        ...base,
        state: "no_suggestion",
        text: null,
        outcomeKind: "urgent_internal_alert",
        outcomeCode: "urgent_internal_alert",
        warnings: uniq([...warnings, "emergency", "handoff_recommended"]),
        handoffNeeded: true,
        handoffUrgency: "high",
      };
    case "refused":
      return {
        ...base,
        state: "generation_failed",
        text: null,
        outcomeKind: "refused",
        outcomeCode: outcome.code,
        warnings: uniq(warnings),
      };
    case "technical_error":
      return {
        ...base,
        state: "generation_failed",
        text: null,
        outcomeKind: "technical_error",
        outcomeCode: outcome.code,
        warnings: uniq(warnings),
      };
  }
}

/** Gera (ou reaproveita) a sugestão do Copiloto para a mensagem do hóspede. Nunca lança. */
export async function generateCopilotSuggestion(
  req: CopilotGenerationRequest,
  deps: CopilotGenerateDeps = {},
): Promise<CopilotGenerateResult> {
  const env = deps.env ?? process.env;
  // porta da GERAÇÃO: conferida aqui, no servidor, para QUALQUER chamador (canal ou tela). Sem desvio.
  if (!copilotFlagOn("generation", env))
    return { status: "skipped", code: "generation_off", detail: null };
  // relógio de PAREDE (ms desde a época): a cadeia o usa para datas (fase da estadia, janela D9, pausa) e o
  // prazo global é medido pelo mesmo relógio. Nunca `performance.now` aqui (origem ≠ época).
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? defaultSchedule;
  const started = now();
  const deadlineMs = deps.deadlineMs ?? COPILOT_DEADLINE_MS;
  const remainingMs = () => Math.max(0, deadlineMs - (now() - started));
  const controller = new AbortController();
  const cancelTimer = schedule(() => controller.abort(), deadlineMs);
  let claimed: { suggestionId: string; attempt: number } | null = null;
  let store: CopilotStore | null = null;

  try {
    const db = deps.db ?? (await getGuestAiDb());
    store = deps.store ?? createCopilotStore(await getGuestAiCopilotRpc());

    // 1) escopo validado no backend (fail-closed)
    let turn: ValidatedTurn;
    try {
      turn = deps.validateTurnScope
        ? await deps.validateTurnScope(req, db)
        : await realValidateTurnScope(
            {
              surface: req.surface,
              conversationId: req.conversationId,
              messageId: req.messageId,
              expectedOwnerId: req.expectedOwnerId ?? null,
            },
            { db: abortableDb(db, controller.signal) },
          );
    } catch (e) {
      return {
        status: "skipped",
        code: "scope_refused",
        detail: e instanceof GuestAiScopeError ? e.code : "lookup_failed",
      };
    }

    // 1b) escopo de imóveis (backend): sem lista ⇒ todos; com lista ⇒ só os listados (imóvel do turno VALIDADO)
    if (!copilotPropertyAllowed(turn.propertyId, env)) {
      return { status: "skipped", code: "property_not_allowlisted", detail: null };
    }

    // 2) reivindicação idempotente (uma sugestão por mensagem; teto diário; anteriores ⇒ superseded)
    const claim = await store.claim({
      tenantId: turn.tenantId,
      propertyId: turn.propertyId,
      conversationId: turn.conversationId,
      triggerMessageId: turn.messageId,
      surface: turn.surface,
      dailyCostLimitUsd: copilotDailyLimitUsd(env),
      turnCostCeilingUsd: COPILOT_MAX_TURN_COST_USD,
    });
    if (claim.kind === "exists")
      return { status: "exists", suggestionId: claim.suggestionId, state: claim.state };
    if (claim.kind === "daily_budget_exceeded")
      return { status: "daily_budget_exceeded", suggestionId: claim.suggestionId };
    if (claim.kind === "invalid")
      return { status: "skipped", code: "claim_invalid", detail: claim.reason };
    if (claim.kind !== "claimed") return { status: "skipped", code: "claim_failed", detail: null };
    claimed = { suggestionId: claim.suggestionId, attempt: claim.attempt };

    // 3) posse humana (só leitura, para o cartão) — nunca veto
    let humanInCommand: boolean | null = null;
    try {
      const nowIso = new Date(now()).toISOString();
      const own = deps.loadOwnership
        ? await deps.loadOwnership(turn, db, controller.signal, nowIso)
        : await loadConversationOwnership(turn, { db, signal: controller.signal, nowIso });
      humanInCommand =
        own.status === "identified" || own.status === "none"
          ? deriveHumanOwnership(own.row, nowIso).aiPausedByTeam
          : null;
    } catch {
      humanInCommand = null;
    }

    // 4) cadeia real com o gerador do Copiloto
    let dossierEntries: number | null = null;
    let historyMessages: number | null = null;
    let reservationLinked: boolean | null = null;
    let stayPhase: string | null = null;
    let opsPhase: StayPhase | null = null;
    let opsTimezone: string | null = null;
    const meta = {
      onDossierEntries: (n: number) => (dossierEntries = n),
      onHistoryMessages: (n: number) => (historyMessages = n),
    };
    const ports = (deps.ports ?? productionPorts)(turn, abortableDb(db, controller.signal), meta);
    const s = store;
    const c = claimed;
    const beforeNetwork = async () => {
      const st = await s.state(c.suggestionId);
      return !!st && st.state === "generating" && st.attempt === c.attempt;
    };
    // visão: só consulta fotos se o histórico do turno tiver imagem do hóspede; ids citáveis vêm do histórico
    let history: HistoryResult | null = null;
    const loadVision = async (): Promise<CopilotVisionInput> => {
      if (!history || history.status !== "available") return NO_VISION;
      const refs = new Map(history.entries.map((e) => [e.messageId, e.ref]));
      if (!history.entries.some((e) => e.speaker === "guest" && e.media?.kind === "image"))
        return NO_VISION;
      const images = deps.loadImages
        ? await deps.loadImages(turn, db, controller.signal)
        : await fetchGuestImages(turn, {
            db: abortableDb(db, controller.signal),
            signal: controller.signal,
          });
      const ref = (id: string | null) => (id ? (refs.get(id) ?? null) : null);
      return {
        images: images
          .filter((i): i is Extract<GuestImage, { status: "loaded" }> => i.status === "loaded")
          .map((i) => ({
            ref: ref(i.messageId),
            at: i.at,
            dataUrl: i.dataUrl,
            tokenBound: i.tokenBound,
          })),
        failed: images
          .filter((i): i is Extract<GuestImage, { status: "failed" }> => i.status === "failed")
          .map((i) => ({ ref: ref(i.messageId), at: i.at })),
      };
    };
    const generator = deps.generator
      ? deps.generator({ remainingMs, beforeNetwork, traceId: claimed.suggestionId, loadVision })
      : createCopilotGenerator({
          modelId: copilotModelId(env),
          maxOutputTokens: COPILOT_MAX_OUTPUT_TOKENS,
          reasoningEffort: COPILOT_REASONING_EFFORT,
          remainingMs,
          beforeNetwork,
          traceId: claimed.suggestionId,
          provider: deps.provider,
          log: deps.log,
          loadVision,
        });
    const chainDeps: ChainDeps = {
      loadContext: async (t, sg) => {
        const ctx = await ports.loadContext(t, sg);
        reservationLinked = !!ctx.guest.stay;
        stayPhase = ctx.guest.phase;
        opsPhase = ctx.guest.phase;
        opsTimezone = ctx.guest.stay?.timezone ?? ctx.guest.property.timezone ?? null;
        return ctx;
      },
      loadHistory: async (t, sg) => {
        const h = await ports.loadHistory(t, sg);
        history = h;
        return h;
      },
      loadDossiers: ports.loadDossiers,
      loadStayAuthorizationSource: ports.loadStayAuthorizationSource,
      loadSenderIdentitySource: ports.loadSenderIdentitySource,
      loadGuestProfile: ports.loadGuestProfile,
      generate: (prompt, sg) => generator.generate(prompt, sg),
      guard: SECRET_SCRUBBER,
      stageTimeoutMs: Math.max(1_000, Math.min(15_000, Math.floor(remainingMs()))),
      signal: controller.signal,
      now,
      schedule,
    };
    const outcome = await runTurnChain(
      { turn, traceId: claimed.suggestionId, batch: null },
      chainDeps,
    );
    const g = generator.telemetry();
    const projected = projectOutcome(outcome, {
      surface: turn.surface,
      humanInCommand,
      reservationLinked,
    });
    // bloqueio do gerador (orçamento do turno, substituída, prazo) ⇒ código fechado em vez do técnico genérico
    const outcomeCode =
      outcome.kind === "technical_error" && g.status === "blocked" && g.blockCode
        ? g.blockCode
        : projected.outcomeCode;

    const stored = await store.store({
      suggestionId: claimed.suggestionId,
      attempt: claimed.attempt,
      state: projected.state,
      text: projected.text,
      internalQuestion: projected.internalQuestion,
      intents: projected.intents,
      strategy: projected.strategy,
      handoffNeeded: projected.handoffNeeded,
      handoffUrgency: projected.handoffUrgency,
      outcomeKind: projected.outcomeKind,
      outcomeCode,
      warnings: projected.warnings,
      context: {
        stayPhase,
        reservationLinked,
        historyMessages,
        dossierEntries,
        credentialPolicy: projected.credentialPolicy,
        senderIdentity: projected.senderIdentity,
        humanInCommand,
      },
      gateway: {
        modelId: generator.modelId,
        inputTokens: g.calls > 0 ? g.inputTokens : null,
        outputTokens: g.calls > 0 ? g.outputTokens : null,
        costUsd: g.costUsd,
        latencyMs: g.calls > 0 ? g.latencyMs : null,
        error: g.error,
      },
    });
    // G2: sinais operacionais da MESMA decisão validada (ação real em `live`, registro em `shadow`)
    if (
      (outcome.kind === "reply" || outcome.kind === "silence" || outcome.kind === "human_action") &&
      opsPhase
    ) {
      try {
        await (deps.ops ?? ((i: OpsRunInput) => runOps(i, { env })))({
          turn,
          decision: outcome.decision,
          history,
          phase: opsPhase,
          timezone: opsTimezone,
          suggestionId: claimed.suggestionId,
        });
      } catch {
        console.error("[copilot] ações operacionais (observação) falharam");
      }
    }
    if (stored.kind === "stored")
      return {
        status: "stored",
        suggestionId: claimed.suggestionId,
        state: projected.state,
        code: outcomeCode,
      };
    if (stored.kind === "stale") return { status: "stale", suggestionId: claimed.suggestionId };
    return {
      status: "skipped",
      code: "store_failed",
      detail: stored.kind === "invalid" ? stored.reason : stored.kind,
    };
  } catch (e) {
    // falha inesperada: a sugestão reivindicada não pode ficar "gerando" para sempre
    if (claimed && store) {
      try {
        await store.store({
          suggestionId: claimed.suggestionId,
          attempt: claimed.attempt,
          state: "generation_failed",
          text: null,
          internalQuestion: null,
          intents: [],
          strategy: null,
          handoffNeeded: false,
          handoffUrgency: null,
          outcomeKind: "technical_error",
          outcomeCode: e instanceof CopilotGeneratorStop ? e.code : "internal_error",
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
        });
      } catch {
        /* melhor esforço */
      }
    }
    return {
      status: "skipped",
      code: "internal_error",
      detail: e instanceof CopilotGeneratorStop ? e.code : null,
    };
  } finally {
    cancelTimer();
  }
}
