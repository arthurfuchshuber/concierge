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
import { shouldSilenceBareAck } from "@/lib/guest-ai/ack-silence";
import { fetchGuestImages, type GuestImage } from "@/lib/guest-ai/data/guest-images.server";
import { fetchGuestProfile } from "@/lib/guest-ai/data/guest-profile.server";
import { fetchCityEvents } from "@/lib/guest-ai/data/city-events.server";
import { fetchLivingDocument } from "@/lib/guest-ai/data/living-document.server";
import { fetchPropertyOrigin, type PropertyOrigin } from "@/lib/guest-ai/data/property-origin.server";
import type { GuestToolContext, MapsHttp } from "@/lib/guest-ai/tools/contracts";
import { hasNewerGuestMessage } from "@/lib/guest-ai/data/newer-guest-message.server";
import { formatForChannel } from "./channel-format";
import { diagnosisNeedsTeam, diagnosisUrgency, reconcileVisualDiagnosis, stripRoboticAck } from "@/lib/guest-ai/vision/analyzer";
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
import { extractOpsSignals, type OpsExtractorInput, type OpsSignals } from "./ops-extractor.server";
import {
  COPILOT_DEADLINE_MS,
  COPILOT_STAGE_MAX_MS,
  COPILOT_MAX_OUTPUT_TOKENS,
  COPILOT_MAX_TURN_COST_USD,
  COPILOT_MIN_OUTPUT_TOKENS,
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
  Pick<ChainDeps, "loadGuestProfile" | "loadCityEvents" | "loadLivingDocument">;

export interface CopilotGenerateDeps {
  /**
   * CONDUÇÃO AUTÔNOMA (10/11/2026): chamada pelo `slot.server.ts`, que tem a própria chave e lista de imóveis.
   * Aqui só muda: não confere a chave/lista do Copiloto e o silêncio é legítimo (o roteiro não exige texto).
   */
  autonomous?: boolean;
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
    /** `low` só na nova tentativa após o raciocínio estourar o teto de saída (10/11/2026). */
    reasoningEffort?: "low";
    remainingMs: () => number;
    beforeNetwork: () => Promise<boolean>;
    traceId: string;
    loadVision: () => Promise<CopilotVisionInput>;
    loadToolContext: () => Promise<GuestToolContext | null>;
  }) => CopilotGenerator;
  /** Rajada: há mensagem do hóspede mais nova na conversa? (produção: `hasNewerGuestMessage`). */
  checkNewerGuestMessage?: (
    turn: ValidatedTurn,
    db: GuestAiDb,
  ) => Promise<"newer" | "none" | "unknown">;
  /** Fotos do hóspede (produção: `fetchGuestImages`; testes: falso em memória). */
  loadImages?: (turn: ValidatedTurn, db: GuestAiDb, signal: AbortSignal) => Promise<GuestImage[]>;
  /** Origem do imóvel para as ferramentas (produção: `fetchPropertyOrigin`; testes: falso em memória). */
  loadPropertyOrigin?: (turn: ValidatedTurn, db: GuestAiDb, signal: AbortSignal) => Promise<PropertyOrigin | null>;
  /** Transporte do Google Maps das ferramentas (testes: falso, sem rede). */
  toolHttp?: MapsHttp;
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
  /**
   * Bastidores (08/11/2026): extrator próprio dos sinais operacionais (padrão: `extractOpsSignals`, Reserva).
   * Roda em paralelo com a resposta assim que contexto e histórico estão lidos e NÃO depende dela dar certo.
   */
  extractOps?: (input: OpsExtractorInput) => Promise<OpsSignals | null>;
}

export type CopilotGenerateResult =
  | {
      status: "stored";
      suggestionId: string;
      state: "available" | "no_suggestion" | "generation_failed";
      code: string | null;
      /** O que foi gravado (para a condução autônoma devolver ao canal sem reler o banco). */
      result?: {
        text: string | null;
        handoffNeeded: boolean;
        handoffUrgency: string | null;
        internalQuestion: string | null;
        outcomeKind: string | null;
        /** Pedidos formais declarados pelo modelo (decisão humana com 1 clique, 10/11/2026). */
        formalChangeRequests?: string[];
        /** Turno do hóspede é só confirmação/cortesia e não há pergunta nossa pendente (10/11/2026). */
        bareAckWithoutQuestion?: boolean;
      };
    }
  | { status: "exists"; suggestionId: string; state: string }
  | { status: "daily_budget_exceeded"; suggestionId: string }
  | { status: "stale"; suggestionId: string }
  | {
      status: "skipped";
      code:
        | "generation_off"
        | "property_not_allowlisted"
        | "superseded_by_newer_message"
        | "scope_refused"
        | "claim_invalid"
        | "claim_failed"
        | "store_failed"
        | "internal_error";
      detail: string | null;
    };

/**
 * DISJUNTOR DE RETENTATIVAS (10/11/2026): uma geração reivindicada que morreu sem gravar resultado (Worker
 * cortado no meio de um stage_timeout) é re-reivindicada pelo banco a cada 90 s — e cada nova reivindicação lia o
 * Dossiê inteiro de novo (até 7 tentativas em 2 min na mesma conversa). Permitimos UMA recuperação; da 3ª em diante
 * a mensagem é encerrada como `generation_failed` (`retry_circuit_open`) SEM chamar modelo. Só uma NOVA mensagem
 * do hóspede (outro `trigger_message_id`) gera de novo.
 */
export const COPILOT_MAX_GENERATION_ATTEMPTS = 2;

function failedRecord(suggestionId: string, attempt: number, outcomeCode: string) {
  return {
    suggestionId,
    attempt,
    state: "generation_failed" as const,
    text: null,
    internalQuestion: null,
    intents: [],
    strategy: null,
    handoffNeeded: false,
    handoffUrgency: null,
    outcomeKind: "technical_error" as const,
    outcomeCode,
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
    gateway: { modelId: null, inputTokens: null, outputTokens: null, costUsd: 0, latencyMs: null, error: null },
  };
}

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
        // O contexto usa o MESMO turno já validado pela cadeia (07/11/2026): revalidar aqui lia a conversa de novo
        // e, se a reserva fosse vinculada nesse meio-tempo, contexto e turno divergiam
        // (`reservation_conversation_mismatch`). Com o mesmo retrato, conversa ainda sem reserva segue como consulta
        // (só dados públicos, sem credenciais) em vez de travar.
        { db, validateTurnScope: async () => t },
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
    loadCityEvents: (t, s) => fetchCityEvents(t, { db, signal: s }),
    loadLivingDocument: (t, s) => fetchLivingDocument(t, { db, signal: s }),
  };
}

const uniq = (w: CopilotWarning[]): CopilotWarning[] => [...new Set(w)];

/**
 * Sintaxe de expansão do guia (`[[info:…]]`, `[[tag:…]]`). A rotina humana de envio EXPANDE essas marcas com
 * campos do imóvel — inclusive senhas de fechadura, portão e Wi-Fi. Um texto vindo do MODELO nunca pode
 * carregá-las (seria um caminho para revelar credencial depois da aprovação). Recusada na geração.
 */
export const GUIDE_TEMPLATE_SYNTAX = /\[\[\s*(info|tag)\s*:/i;

/**
 * Bloqueio estrutural/semântico grava QUAL regra barrou (09/11/2026: 3 mensagens simples foram barradas e o motivo
 * não ficava registrado). O código continua casando com o CHECK do banco (`^[a-z][a-z0-9_]{0,63}$`), sem migration.
 */
export function refusalCodeWithReason(code: string, structural: readonly string[] = [], semantic: readonly string[] = []): string {
  const reason = code === "structural_block" ? structural[0] : code === "semantic_block" ? semantic[0] : undefined;
  if (!reason) return code;
  const out = `${code}_${reason}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return /^[a-z][a-z0-9_]{0,63}$/.test(out) ? out : code;
}

/** Desfechos sem texto que valem uma nova tentativa (corrigíveis pelo modelo). Códigos fechados; nada de texto livre. */
/** Tempo mínimo restante para a nova tentativa com raciocínio `low` após saída truncada. */
export const TRUNCATED_RETRY_MIN_MS = 6_000;

export function retryReason(o: ChainOutcome): string | null {
  if (o.kind === "silence") return "silence_not_allowed_in_suggestion_mode";
  if (o.kind === "refused") {
    const c = o.code as string;
    if (c === "structural_block") return `structural_block ${o.audit.structuralBlocks.join(" ")}`.slice(0, 190).toLowerCase();
    if (c === "semantic_block") return `semantic_block ${o.audit.semanticBlocks.join(" ")}`.slice(0, 190).toLowerCase();
    if (c.startsWith("parse_")) return c;
  }
  return null;
}

/** Projeção do desfecho da cadeia para a linha do banco (só o texto final da sugestão é texto livre). */
export function projectOutcome(
  outcome: ChainOutcome,
  extra: {
    surface: string;
    humanInCommand: boolean | null;
    reservationLinked: boolean | null;
    /** Fotos do hóspede que foram ao modelo neste turno (diagnóstico visual só vale com foto). */
    imagesSent?: number;
  },
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
  // visão (v6): incidente na foto que exige a equipe ⇒ sempre encaminhado, com urgência pela gravidade
  const visual = reconcileVisualDiagnosis(
    "decision" in outcome ? outcome.decision.visualDiagnosis : null,
    extra.imagesSent ?? 0,
  );
  const visualHandoff = diagnosisNeedsTeam(visual);
  if (situation?.humanAction.needed || a.decision?.handoff.needed || visualHandoff)
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
  const declared = situation?.humanAction ?? a.decision?.handoff ?? { needed: false, urgency: null };
  const rank = { low: 0, normal: 1, high: 2 } as const;
  const visualUrgency = visual && visualHandoff ? diagnosisUrgency(visual) : null;
  const handoff =
    visualHandoff && visualUrgency
      ? {
          needed: true,
          urgency:
            declared.urgency && rank[declared.urgency as keyof typeof rank] >= rank[visualUrgency]
              ? declared.urgency
              : visualUrgency,
        }
      : declared;
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
        // Pilar 3: forma do canal (letras estilizadas, Markdown, links no Airbnb); conteúdo intacto.
        // Visão: sem frase de recibo de anexo no início ("recebi sua foto"), rede de segurança do prompt.
        text: formatForChannel(stripRoboticAck(outcome.text), extra.surface),
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
        outcomeCode: refusalCodeWithReason(outcome.code, a.structuralBlocks, a.semanticBlocks),
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
  if (!deps.autonomous && !copilotFlagOn("generation", env))
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
  // bastidores em andamento (o segundo plano do Worker só termina quando a geração resolve: nunca abandoná-los)
  let pendingBackstage: Promise<boolean> | null = null;

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
    if (!deps.autonomous && !copilotPropertyAllowed(turn.propertyId, env)) {
      return { status: "skipped", code: "property_not_allowlisted", detail: null };
    }

    // 1c) rajada: o hóspede já mandou outra mensagem depois desta ⇒ quem responde é a geração da mais nova, que vê
    // o conjunto inteiro como um único turno (uma resposta só). Leitura incerta ⇒ segue gerando.
    const newer = deps.checkNewerGuestMessage
      ? await deps.checkNewerGuestMessage(turn, db)
      : await hasNewerGuestMessage(turn, {
          db: abortableDb(db, controller.signal),
          signal: controller.signal,
        });
    if (newer === "newer")
      return { status: "skipped", code: "superseded_by_newer_message", detail: null };

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
    if (claim.attempt > COPILOT_MAX_GENERATION_ATTEMPTS) {
      const r = await store.store(failedRecord(claim.suggestionId, claim.attempt, "retry_circuit_open"));
      if (r.kind === "stale") return { status: "stale", suggestionId: claim.suggestionId };
      return { status: "stored", suggestionId: claim.suggestionId, state: "generation_failed", code: "retry_circuit_open" };
    }

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
    let opsCheckInAt: string | null = null;
    let opsCheckOutAt: string | null = null;
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
    // BASTIDORES (08/11/2026): trabalho próprio, ligado à mesma geração mas independente da resposta. Começa assim
    // que contexto e histórico estão lidos (em paralelo com a chamada da resposta) e grava as ações nos cards pela
    // política determinística de sempre. Se o extrator falhar, os sinais da resposta (se houver) são o reserva.
    let backstage: Promise<boolean> | null = null;
    const opsRun = deps.ops ?? ((i: OpsRunInput) => runOps(i, { env }));
    const startBackstage = () => {
      // só há ação de card antes/durante a estadia; nas demais fases não gasta chamada (a resposta segue igual)
      if (backstage || !opsPhase || !history || history.status !== "available") return;
      if (opsPhase !== "pre_stay" && opsPhase !== "in_stay" && opsPhase !== "post_checkout") return;
      const phase = opsPhase;
      const h = history;
      backstage = pendingBackstage = (async () => {
        try {
          const signals = await (deps.extractOps ?? ((i: OpsExtractorInput) => extractOpsSignals(i, { provider: deps.provider, log: deps.log })))({
            history: h,
            phase,
            timezone: opsTimezone,
            checkInAt: opsCheckInAt,
            checkOutAt: opsCheckOutAt,
            now: new Date(now()),
            traceId: claimed?.suggestionId ?? turn.messageId,
            remainingMs,
            signal: controller.signal,
          });
          if (!signals) return false;
          await opsRun({
            turn,
            decision: signals,
            history: h,
            phase,
            timezone: opsTimezone,
            suggestionId: claimed?.suggestionId ?? null,
          });
          return true;
        } catch {
          console.error("[copilot] bastidores falharam");
          return false;
        }
      })();
    };
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
    // ferramentas de consulta (Google Places / rotas): origem = coordenadas do imóvel do turno validado
    const loadToolContext = async (): Promise<GuestToolContext | null> => {
      const o = deps.loadPropertyOrigin
        ? await deps.loadPropertyOrigin(turn, db, controller.signal)
        : await fetchPropertyOrigin(turn, { db: abortableDb(db, controller.signal), signal: controller.signal });
      if (!o) return null;
      return { origin: o.origin, city: o.city, region: o.region, country: o.country, surface: turn.surface };
    };
    const makeGenerator = (effort?: "low") =>
      deps.generator
        ? deps.generator({ ...(effort ? { reasoningEffort: effort } : {}), remainingMs, beforeNetwork, traceId: claimed!.suggestionId, loadVision, loadToolContext })
        : createCopilotGenerator({
            modelId: copilotModelId(env),
            maxOutputTokens: COPILOT_MAX_OUTPUT_TOKENS,
            minOutputTokens: COPILOT_MIN_OUTPUT_TOKENS,
            // elasticidade nativa: sem tabela por assunto; o modelo dosa o raciocínio, o custo é contido por fora
            reasoningEffort: effort ?? COPILOT_REASONING_EFFORT,
            remainingMs,
            beforeNetwork,
            traceId: claimed!.suggestionId,
            provider: deps.provider,
            log: deps.log,
            loadVision,
            loadToolContext,
            toolHttp: deps.toolHttp,
          });
    let generator = makeGenerator();
    const chainDeps: ChainDeps = {
      loadContext: async (t, sg) => {
        const ctx = await ports.loadContext(t, sg);
        reservationLinked = !!ctx.guest.stay;
        stayPhase = ctx.guest.phase;
        opsPhase = ctx.guest.phase;
        opsTimezone = ctx.guest.stay?.timezone ?? ctx.guest.property.timezone ?? null;
        opsCheckInAt = ctx.guest.stay?.checkInAt ?? null;
        opsCheckOutAt = ctx.guest.stay?.checkOutAt ?? null;
        startBackstage();
        return ctx;
      },
      loadHistory: async (t, sg) => {
        const h = await ports.loadHistory(t, sg);
        history = h;
        startBackstage();
        return h;
      },
      loadDossiers: ports.loadDossiers,
      loadStayAuthorizationSource: ports.loadStayAuthorizationSource,
      loadSenderIdentitySource: ports.loadSenderIdentitySource,
      loadGuestProfile: ports.loadGuestProfile,
      loadCityEvents: ports.loadCityEvents,
      loadLivingDocument: ports.loadLivingDocument,
      generate: (prompt, sg) => generator.generate(prompt, sg), // `generator` é trocado na nova tentativa (cada um serve a 1 chamada)
      guard: SECRET_SCRUBBER,
      stageTimeoutMs: Math.max(1_000, Math.min(COPILOT_STAGE_MAX_MS, Math.floor(remainingMs()))),
      turnDeadlineMs: Math.max(1_000, Math.min(COPILOT_STAGE_MAX_MS, Math.floor(remainingMs()))),
      signal: controller.signal,
      now,
      schedule,
    };
    // SUGESTÃO EM 100% DAS MENSAGENS (pedido de 09/11/2026): o roteiro exige texto sempre; se mesmo assim a 1ª
    // tentativa vier sem texto por motivo corrigível (silêncio, incoerência de campos, bloqueio de validação),
    // faz UMA nova tentativa dizendo ao modelo o que corrigir (só códigos fechados). Credenciais (D9), guard,
    // escopo e falhas técnicas NÃO são recontadas aqui.
    // Na condução autônoma o silêncio é LEGÍTIMO (ex.: "ok, obrigado"): sem exigir texto e sem refazer por silêncio.
    const alwaysSuggest = !deps.autonomous;
    let outcome = await runTurnChain(
      { turn, traceId: claimed.suggestionId, batch: null, suggest: { alwaysSuggest } },
      chainDeps,
    );
    // telemetria de prazo (10/11/2026): em corte por tempo, registra EM QUE ETAPA estourou (código fixo, sem dados)
    if (outcome.kind === "technical_error")
      console.warn("[copilot] turno interrompido", outcome.code, `etapa=${outcome.stage}`, `restante_ms=${Math.round(remainingMs())}`);
    // RACIOCÍNIO QUE ESTOUROU O TETO DE SAÍDA (10/11/2026, caso Karen: 4.089 de 4.096 tokens gastos pensando,
    // 23 s, nenhuma resposta): o padrão segue elástico (`auto`), mas esta falha específica ganha UMA nova
    // tentativa com raciocínio `low` (curto e rápido), se houver tempo. Nunca em bloqueio de custo/prazo.
    if (
      outcome.kind === "technical_error" &&
      outcome.code === "model_call_failed" &&
      generator.telemetry().error === "truncated_response" &&
      remainingMs() > TRUNCATED_RETRY_MIN_MS
    ) {
      generator = makeGenerator("low");
      outcome = await runTurnChain(
        { turn, traceId: claimed.suggestionId, batch: null, suggest: { alwaysSuggest } },
        chainDeps,
      );
    }
    const rawReason = retryReason(outcome);
    const reason = deps.autonomous && outcome.kind === "silence" ? null : rawReason;
    if (reason && generator.telemetry().status !== "blocked" && remainingMs() > 6_000) {
      generator = makeGenerator();
      const second = await runTurnChain(
        { turn, traceId: claimed.suggestionId, batch: null, suggest: { alwaysSuggest, retryNote: reason } },
        chainDeps,
      );
      if (second.kind === "reply" || retryReason(second) === null) outcome = second;
    }
    const g = generator.telemetry();
    const projected = projectOutcome(outcome, {
      surface: turn.surface,
      humanInCommand,
      reservationLinked,
      imagesSent: g.imagesSent,
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
        modelId: g.model ?? generator.modelId,
        inputTokens: g.calls > 0 ? g.inputTokens : null,
        outputTokens: g.calls > 0 ? g.outputTokens : null,
        costUsd: g.costUsd,
        latencyMs: g.calls > 0 ? g.latencyMs : null,
        error: g.error,
      },
    });
    // G2: os bastidores já rodaram em paralelo (extrator próprio). Reserva: se o extrator não respondeu, usa os
    // sinais da MESMA decisão validada da resposta, como antes (a reivindicação é idempotente por mensagem + ação).
    const backstageDone = backstage ? await backstage : false;
    if (
      !backstageDone &&
      (outcome.kind === "reply" || outcome.kind === "silence" || outcome.kind === "human_action") &&
      opsPhase
    ) {
      try {
        await opsRun({
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
        result: {
          text: projected.text,
          handoffNeeded: projected.handoffNeeded,
          handoffUrgency: projected.handoffUrgency,
          internalQuestion: projected.internalQuestion,
          outcomeKind: projected.outcomeKind,
          formalChangeRequests:
            "decision" in outcome ? [...(outcome.decision.formalChangeRequests ?? [])] : [],
          bareAckWithoutQuestion: ((h: HistoryResult | null) =>
            !!h && h.status === "available" && shouldSilenceBareAck(h.entries))(history as HistoryResult | null),
        },
      };
    if (stored.kind === "stale") return { status: "stale", suggestionId: claimed.suggestionId };
    return {
      status: "skipped",
      code: "store_failed",
      detail: stored.kind === "invalid" ? stored.reason : stored.kind,
    };
  } catch (e) {
    const pb = pendingBackstage as Promise<boolean> | null;
    if (pb) await pb.catch(() => false);
    // falha inesperada: a sugestão reivindicada não pode ficar "gerando" para sempre
    if (claimed && store) {
      try {
        await store.store(
          failedRecord(
            claimed.suggestionId,
            claimed.attempt,
            e instanceof CopilotGeneratorStop ? e.code : "internal_error",
          ),
        );
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
