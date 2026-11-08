/**
 * F2-B · B1 — CONTRATOS do Conversational Orchestrator do ConciergeIA Guest.
 *
 * Princípio: o sistema controla os limites; o modelo decide como atuar dentro deles.
 * Estes tipos são o vocabulário entre Orchestrator, contexto, Gateway (F2-A), validação e
 * (na B3) o shadow. Nenhum deles carrega credenciais nem texto de resposta para persistência.
 */
import type { VisualDiagnosis } from "../vision/analyzer";
import type { LlmErrorCode, LlmTelemetry, ReasoningEffort } from "@/lib/guest-ai/llm/contracts";
import type { AccessPolicyReason, GuestContext, GuestSurface } from "@/lib/guest-ai/types";
import type { CapabilityId } from "./capabilities";

// ─────────────────────────── Configuração vinculante ───────────────────────────

/**
 * Catálogo único (Diretiva Global, 07/11/2026): Titular `openai/gpt-6-astra` (atendimento e copiloto) e
 * Reserva `google/gemini-3.8-flash` (reserva automática do Titular e rotinas de fundo de baixo custo, como a
 * extração de memória do hóspede). Nenhum outro modelo de texto é registrado (`llm/models.ts`).
 */
export const GUEST_AI_DEFAULT_MODEL = "openai/gpt-6-astra";
export const GUEST_AI_RESERVE_MODEL = "google/gemini-3.8-flash";
export const GUEST_AI_DEFAULT_REASONING: ReasoningEffort = "low";
/** Prazo total de um turno (contexto + modelo + validação). Máximo absoluto do produto: 15 s. */
export const TURN_MAX_DEADLINE_MS = 15_000;
/** Teto de tokens de saída de um turno. */
export const TURN_MAX_OUTPUT_TOKENS = 1_024;
/** Marcador fixo onde o SISTEMA (nunca o modelo) poderia inserir credenciais numa fase futura. Na F2-B nunca é substituído. */
export const CREDENTIAL_MARKER = "[[CREDENCIAIS]]";

// ─────────────────────────── Entrada do turno ───────────────────────────

/**
 * Mesmo conteúdo de entrada do slot (`GuestAiRequest`) + modo e correlação.
 * `mode` é literal: a F2-B só existe em shadow. Nada aqui é enviado a canal algum.
 */
export interface TurnRequest {
  surface: GuestSurface;
  conversationId: string;
  messageId: string;
  expectedOwnerId?: string | null;
  mode: "shadow";
  /** Id opaco da execução (na B3: id da linha shadow). Formato `[\w.:-]{1,80}`. */
  traceId: string;
}

// ─────────────────────────── Decisão do modelo ───────────────────────────

/** `silence` (B2.1): resultado legítimo de não responder — só com `shouldReply: false` (decisão v2). */
export const STRATEGIES = ["answer", "clarify", "guide", "suggest_alternatives", "handoff", "answer_and_handoff", "silence"] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const CASE_RELATIONS = ["related", "independent", "ambiguous", "new", "no_open_case"] as const;
export type ModelCaseRelation = (typeof CASE_RELATIONS)[number];

export const HANDOFF_URGENCIES = ["low", "normal", "high"] as const;
export type HandoffUrgency = (typeof HANDOFF_URGENCIES)[number];

/** O que o MODELO devolve (JSON). Validado por `decision.ts` com parse estrito. */
export interface ModelDecision {
  strategy: Strategy;
  /** Texto ao hóspede, no idioma do hóspede. Vazio só quando `strategy = "handoff"`. */
  reply: string;
  handoff: { needed: boolean; question: string | null; urgency: HandoffUrgency | null };
  caseRelation: ModelCaseRelation;
  /** Ids das fontes do contexto que sustentam as afirmações factuais do `reply`. */
  groundedOn: string[];
  /** O que faltou para responder melhor (texto curto, sem dado pessoal). */
  missingInformation: string[];
  /** Capacidades futuras (F2-C) que teriam ajudado. Só registro; nada é executado. */
  capabilityNeeds: Array<{ capability: CapabilityId; reason: string }>;
  /** O modelo nunca vê credenciais: só declara se as entregaria (usando `CREDENTIAL_MARKER`). */
  credentialIntent: "none" | "would_deliver";
  /** Compromissos/promessas que o `reply` assume perante o hóspede. */
  commitments: string[];
  // ── B2.1 (decisão v2). Opcionais NO TIPO só para manter a decisão v1 da B1 válida; o parser
  //    exige TODOS juntos (v2) ou NENHUM (v1). Ausentes ⇒ padrões conservadores (`decisionSignals`):
  //    responder (nunca silêncio por omissão), sem ritual, sem alteração formal, sem nome.
  /** `false` = não responder (afirmação/cortesia sem necessidade). Silêncio é resultado legítimo, não erro. */
  shouldReply?: boolean;
  /** O que o hóspede está fazendo na mensagem atual (pode ser mais de uma coisa). Nunca concede autorização. */
  intents?: IntentCategory[];
  /** Alterações que dependem da reserva/plataforma ou de autorização formal. Só registro: nada é aprovado. */
  formalChangeRequests?: FormalChangeKind[];
  /** Marco da estadia confirmado pelo hóspede NA MENSAGEM ATUAL (ritual de hospitalidade). Não altera estado operacional. */
  hospitalityMilestone?: { kind: HospitalityMilestoneKind; evidence: string[] } | null;
  /** Nome que o interlocutor declarou (tratamento cordial). NÃO é identidade comprovada nem autorização. */
  speakerName?: string | null;
  // ── B2.3 (decisão v3 = v2 + `commitmentKinds`). Aditivo: v1 e v2 continuam válidas no parser.
  /**
   * TIPOS de compromisso que o `reply` assume (conjunto, sem repetição). Classificação semântica
   * feita pelo MODELO; a AUTORIZAÇÃO de cada tipo é decidida pelo sistema (`semantic-validator.ts`).
   * Vazio ⇔ `commitments` vazio. Ausente (v1/v2) ⇒ compromissos não verificáveis.
   */
  commitmentKinds?: CommitmentKind[];
  // ── B2.5 (decisão v4 = v3 + `promisedTimes`). Aditivo: v1–v3 seguem válidas.
  //    `caseAssessments` (avaliação por chamado) NÃO foi implementado: exige aprovação específica
  //    (complemento da diretriz B2.5, §8). Mensagem com vários assuntos segue a regra conservadora.
  /**
   * Horários que o `reply` promete, um por compromisso temporal (hoje: saída tardia; entrada
   * antecipada nunca é autorizada). Data ISO, hora HH:MM e fuso IANA do imóvel — sem formato livre.
   * O sistema compara com a autorização formal (R6) e recusa qualquer divergência.
   */
  promisedTimes?: PromisedTime[];
  // ── G2 (decisão v5 = v4 + `guestEtas` + `milestoneQuote`). Aditivo: v1–v4 seguem válidas.
  //    Sinais OPERACIONAIS: o modelo só os DECLARA; quem decide se algo acontece é a política
  //    determinística `guest-ai/ops/policy.ts`; a escrita, quando o modo é `live`, é do executor.
  /** Previsões de chegada/saída que o HÓSPEDE informou nesta conversa (no máximo uma por card). */
  guestEtas?: GuestEta[];
  /** Trecho LITERAL da mensagem do hóspede que confirma o marco (`hospitalityMilestone`); `null` sem marco. */
  milestoneQuote?: string | null;
  // ── Visão de incidentes (decisão v6 = v5 + `visualDiagnosis`, 07/11/2026). Aditivo: v1–v5 seguem válidas.
  /** Diagnóstico da foto do hóspede anexada ao turno (`guest-ai/vision/analyzer.ts`); `null` sem foto. */
  visualDiagnosis?: VisualDiagnosis | null;
}

// ─────────────────────────── G2 — previsão informada pelo hóspede (decisão v5) ───────────────────────────

export const GUEST_ETA_CARDS = ["checkin", "checkout"] as const;
export type GuestEtaCard = (typeof GUEST_ETA_CARDS)[number];

export interface GuestEta {
  /** Card a que a previsão se refere: chegada (`checkin`) ou saída (`checkout`). */
  card: GuestEtaCard;
  /** YYYY-MM-DD no fuso do imóvel (o dia a que o horário se refere). */
  date: string;
  /** HH:MM (24 h), horário previsto informado pelo hóspede. */
  time: string;
  /** Ids das mensagens do hóspede que trazem a previsão. */
  evidence: string[];
  /** Trecho LITERAL da mensagem do hóspede com a previsão. */
  quote: string;
}

// ─────────────────────────── B2.5 — horário prometido (decisão v4) ───────────────────────────

/** Domínios de compromisso TEMPORAL (cada um com a sua própria política de autorização). */
export const TEMPORAL_COMMITMENT_KINDS = ["late_checkout", "early_checkin"] as const;
export type TemporalCommitmentKind = (typeof TEMPORAL_COMMITMENT_KINDS)[number];

export interface PromisedTime {
  kind: TemporalCommitmentKind;
  /** YYYY-MM-DD (dia a que o horário se refere, no fuso do imóvel). */
  date: string;
  /** HH:MM (24 h). */
  time: string;
  /** Fuso IANA do imóvel (precisa ser igual ao do contexto validado). */
  timezone: string;
}

// ─────────────────────────── B2.3 — tipos de compromisso (decisão v3) ───────────────────────────

/**
 * Tipos de compromisso operacional. São categorias para o SISTEMA autorizar ou recusar, não frases:
 * nada aqui restringe vocabulário. Na F2-B nenhuma fonte de autorização existe para alterações,
 * exceções, benefícios ou ações executadas (B2.4+), então esses tipos nunca são autorizados.
 */
export const COMMITMENT_KINDS = [
  "reservation_change",
  "early_checkin",
  "late_checkout",
  "availability",
  "service_or_benefit",
  "credential_release",
  "action_completed",
  "resolution",
  "team_relay",
  "information_followup",
] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

// ─────────────────────────── B2.1 — sinais da conversa (decisão v2) ───────────────────────────

export const INTENT_CATEGORIES = [
  "acknowledgment",
  "informational_query",
  "operational_request",
  "problem_report",
  "emergency",
  "formal_change_request",
  "arrival_confirmation",
  "departure_confirmation",
  "other",
] as const;
export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

/** Intenções que, sozinhas, admitem silêncio (afirmação, cortesia, confirmação de chegada/saída já reconhecida). */
export const SILENCE_COMPATIBLE_INTENTS: readonly IntentCategory[] = ["acknowledgment", "arrival_confirmation", "departure_confirmation"];

export const FORMAL_CHANGE_KINDS = ["dates", "guest_count", "price", "cancellation", "early_checkin", "late_checkout", "other_conditions"] as const;
export type FormalChangeKind = (typeof FORMAL_CHANGE_KINDS)[number];

export const HOSPITALITY_MILESTONES = ["checkin_confirmed", "checkout_confirmed"] as const;
export type HospitalityMilestoneKind = (typeof HOSPITALITY_MILESTONES)[number];

/** Sinais B2.1 normalizados (v1 ⇒ padrões conservadores). Fonte única para validador e render. */
export interface DecisionSignals {
  version: DecisionContractVersion;
  shouldReply: boolean;
  intents: IntentCategory[];
  formalChangeRequests: FormalChangeKind[];
  hospitalityMilestone: { kind: HospitalityMilestoneKind; evidence: string[] } | null;
  speakerName: string | null;
}

/** Versões do contrato da decisão aceitas pelo parser (compatibilidade preservada). */
export const DECISION_CONTRACT_VERSIONS = [1, 2, 3, 4, 5, 6] as const;
export type DecisionContractVersion = (typeof DECISION_CONTRACT_VERSIONS)[number];
/** Versão que o prompt atual (G2) pede ao modelo e que a cadeia fail-closed exige. */
export const CURRENT_DECISION_VERSION: DecisionContractVersion = 6;

export function decisionSignals(d: ModelDecision): DecisionSignals {
  if (d.shouldReply === undefined) {
    return { version: 1, shouldReply: true, intents: ["other"], formalChangeRequests: [], hospitalityMilestone: null, speakerName: null };
  }
  return {
    version: d.guestEtas !== undefined ? 5 : d.promisedTimes !== undefined ? 4 : d.commitmentKinds === undefined ? 2 : 3,
    shouldReply: d.shouldReply,
    intents: [...(d.intents ?? [])],
    formalChangeRequests: [...(d.formalChangeRequests ?? [])],
    hospitalityMilestone: d.hospitalityMilestone ? { kind: d.hospitalityMilestone.kind, evidence: [...d.hospitalityMilestone.evidence] } : null,
    speakerName: d.speakerName ?? null,
  };
}

/** B2.3: tipos de compromisso declarados (v3). `null` = não declarados (v1/v2) ⇒ não verificáveis. */
export function commitmentKindsOf(d: ModelDecision): CommitmentKind[] | null {
  return d.commitmentKinds === undefined ? null : [...d.commitmentKinds];
}

// ─────────────────────────── Contexto do turno ───────────────────────────

export type Unavailable<R extends string> = { status: "unavailable"; reason: R };

export interface HistoryMessage {
  id: string;
  speaker: "guest" | "previous_ai" | "team" | "system";
  text: string;
  createdAt: string | null;
}

/**
 * Contexto autorizado de um turno. `guest.credentials` é SEMPRE `null` (o Orchestrator recusa
 * qualquer outro valor). Histórico e posse humana detalhada chegam na B2; aqui o contrato já existe.
 */
export interface ConversationContext {
  guest: GuestContext;
  credentialPolicy: { decision: "allow" | "deny"; reason: AccessPolicyReason };
  history: Unavailable<"not_loaded"> | { status: "available"; messages: HistoryMessage[]; omittedOlder: number };
  /**
   * TODOS os chamados abertos da conversa (não só o primeiro). Hoje a fonte é o status da conversa,
   * então há no máximo 1; o contrato já suporta N. Motivo/horário do encaminhamento chegam na B2.
   */
  humanOwnership: {
    openCaseCount: number;
    cases: Array<{ caseId: string; status: string; handoffReason: string | null; handoffAt: string | null }>;
  };
  hostGuidance: Unavailable<"no_governed_store">;
  precedents: Unavailable<"no_governed_store">;
}

/** Prompt pronto para o Gateway + ids citáveis (para validar `groundedOn`). Montado na B2. */
export interface ComposedPrompt {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Ids que o modelo pode citar. `null` = composição sem ids (validação de fundamento pulada). */
  sourceIds: ReadonlySet<string> | null;
  promptVersion: string;
}

// ─────────────────────────── Validação ───────────────────────────

export type ValidationBlock =
  | "reply_missing"
  | "reply_too_long"
  | "handoff_inconsistent"
  | "credential_marker_without_intent"
  | "credential_intent_without_marker"
  | "credential_marker_repeated"
  | "credential_intent_against_policy"
  | "possible_fabricated_credential"
  | "grounding_unknown_source"
  | "case_relation_missing"
  | "human_owned_topic_commitment"
  | "ambiguous_case_requires_clarify"
  // B2.1 (estruturais; nenhum de estilo)
  | "silence_with_reply"
  | "silence_strategy_mismatch"
  | "silence_not_allowed"
  | "formal_change_inconsistent"
  | "formal_change_commitment"
  | "milestone_inconsistent"
  | "milestone_without_current_guest_evidence"
  // B2.3 (estruturais)
  | "handoff_fields_without_need"
  | "commitment_kinds_inconsistent"
  // B2.5 (estruturais, v4)
  | "promised_time_kind_undeclared";

export interface ValidationReport {
  verdict: "pass" | "block";
  blocks: ValidationBlock[];
}

// ─────────────────────────── Resultado ───────────────────────────

export const FALLBACK_KINDS = [
  "scope_invalid",
  "context_unavailable",
  "context_over_budget",
  "credentials_present",
  "prompt_unavailable",
  "sensitive_content_blocked",
  "llm_request_invalid",
  "llm_unavailable",
  "llm_output_invalid",
  "invalid_decision",
  "validator_block",
  "deadline_exceeded",
  "aborted",
  "internal_error",
] as const;
export type FallbackKind = (typeof FALLBACK_KINDS)[number];

export type TurnStage = "start" | "context" | "compose" | "llm" | "decision" | "validation" | "done";

export interface TurnTelemetry {
  traceId: string | null;
  mode: "shadow";
  model: string;
  reasoningEffort: ReasoningEffort;
  latencyMs: number;
  deadlineMs: number;
  /** Última etapa alcançada. */
  stage: TurnStage;
  /** Telemetria do Gateway (tokens, custo, latência do modelo), quando houve chamada. */
  llm: LlmTelemetry | null;
  promptVersion: string | null;
}

export type OrchestratorResult =
  | {
      kind: "draft";
      decision: ModelDecision;
      validation: ValidationReport;
      telemetry: TurnTelemetry;
    }
  | {
      kind: "fallback";
      fallback: FallbackKind;
      /** Código do Gateway quando a falha veio dele. */
      llmCode: LlmErrorCode | null;
      validation: ValidationReport | null;
      telemetry: TurnTelemetry;
    };
