/**
 * F2-B · B2.3 — VALIDADOR SEMÂNTICO da decisão (puro).
 *
 * Camada INDEPENDENTE do validador estrutural (`output-validator.ts`): uma decisão estruturalmente
 * válida não é, por isso, semanticamente autorizada. Aqui se confere a decisão contra o que o
 * SISTEMA sabe e autorizou no turno:
 *  - compromissos (v3, `commitmentKinds`): cada tipo precisa de uma fonte de autorização real do
 *    sistema (`COMMITMENT_AUTHORIZATION`). Na F2-B não existe fonte para alteração de reserva,
 *    entrada antecipada, saída tardia, benefício, ação executada ou resolução (B2.4+): esses tipos
 *    nunca passam. Compromisso sem tipo declarado (v1/v2) não é verificável ⇒ recusado;
 *  - alteração contratual: nunca decidida na conversa — precisa de rota (encaminhamento, orientação
 *    do caminho formal ou esclarecimento);
 *  - imóveis alternativos: só com dossiês candidatos autorizados no turno e citados em `groundedOn`;
 *    disponibilidade só conta quando CONFIRMADA para aquele imóvel (hoje: sempre `not_consulted`);
 *  - marcos da estadia: compatíveis com a fase calculada pelo servidor e sem repetir ritual já
 *    reconhecido (quando o sistema sabe; sem estado durável nesta fase, a repetição só é barrada
 *    se o chamador informar o que já foi reconhecido);
 *  - emergência: nunca sem encaminhamento urgente;
 *  - saída sensível: TODO texto da decisão passa pelo FreeTextGuard; qualquer achado (ou guard
 *    ausente/falho) ⇒ recusa. Isto não é censura de estilo: o guard procura segredos, não palavras.
 *  - B2.4: entrada antecipada/saída tardia usam a verificação FORMAL (`policy/stay-authorizations.ts`);
 *    com o estado do atendimento humano, nenhum encaminhamento paralelo no assunto da equipe (salvo
 *    emergência/urgência maior) e nenhum compromisso em assunto ambíguo — por assunto, nunca global.
 *
 * NÃO é censura lexical: nenhuma regra aqui lê o `reply` procurando palavras proibidas. A
 * classificação (intenções, tipos de compromisso) é SEMÂNTICA e feita pelo modelo; o sistema só
 * decide se aquilo que o modelo declarou está autorizado. Limitação registrada: uma promessa escrita
 * só em linguagem natural, sem declaração em `commitments`/`commitmentKinds`, não é detectada por
 * esta camada (ver relatório B2.3, riscos residuais).
 */
import {
  CREDENTIAL_MARKER,
  commitmentKindsOf,
  decisionSignals,
  type CommitmentKind,
  type ConversationContext,
  type HospitalityMilestoneKind,
  type ModelDecision,
} from "@/lib/guest-ai/orchestrator/contracts";
import type { CaseOwnership } from "@/lib/guest-ai/orchestrator/case-ownership";
import type { StayPhase } from "@/lib/guest-ai/types";
import type { HumanOwnershipSnapshot } from "@/lib/guest-ai/orchestrator/case-ownership";
import { unavailableStayAuthorizations, type StayAuthorization, type StayAuthorizations } from "@/lib/guest-ai/policy/stay-authorizations";

/**
 * Contrato mínimo do guard usado na SAÍDA (estruturalmente igual ao `FreeTextGuard` do composer;
 * declarado aqui para a camada de validação não importar o compositor — isolamento B2.1/B2.2).
 */
export interface OutputScanner {
  scan(text: string): { status: string; text: string; findings: ReadonlyArray<unknown> };
}

/** Estados de disponibilidade (espelho de `AvailabilityState["status"]`; conferido no `turn-chain.ts`). */
export type AvailabilityStatus = "not_consulted" | "confirmed_available" | "confirmed_unavailable";

export const SEMANTIC_VALIDATOR_VERSION = "semantic.2026-11-03.2";

export const SEMANTIC_BLOCKS = [
  "commitment_kinds_undeclared",
  "unauthorized_commitment",
  "formal_change_without_route",
  "alternatives_without_candidates",
  "alternatives_not_grounded",
  "milestone_without_stay",
  "milestone_phase_incompatible",
  "milestone_repeated",
  "emergency_without_escalation",
  "output_sensitive_content",
  "output_guard_failed",
  // B2.4 — não interferência em assunto sob responsabilidade humana
  "protected_topic_second_action",
  "ambiguous_topic_commitment",
] as const;
export type SemanticBlock = (typeof SEMANTIC_BLOCKS)[number];

export interface SemanticReport {
  verdict: "pass" | "block";
  blocks: SemanticBlock[];
  /** Tipos de compromisso recusados (enum, sem texto). */
  unauthorizedKinds: CommitmentKind[];
  /** O sistema não sabe se o marco já foi reconhecido (sem estado durável nesta fase). */
  milestoneIdempotency: "not_applicable" | "verified_new" | "unverified";
}

/** Dossiê como o validador o enxerga: ref do prompt, papel e estado de disponibilidade. */
export interface SemanticDossierView {
  ref: string;
  role: "primary" | "candidate";
  availability: AvailabilityStatus;
}

export type PriorMilestones = { status: "unknown" } | { status: "known"; acknowledged: readonly HospitalityMilestoneKind[] };

export interface SemanticInput {
  decision: ModelDecision;
  context: ConversationContext;
  ownership: CaseOwnership;
  /** Dossiês efetivamente compostos no turno (vazio/null = nenhum). */
  dossiers: readonly SemanticDossierView[] | null;
  priorMilestones: PriorMilestones;
  /** Mesmo guard da composição. Ausente ⇒ `output_guard_failed`. */
  guard: OutputScanner | null;
  /** B2.4: autorizações de horário verificadas deterministicamente. Ausente ⇒ nada autorizado. */
  stayAuthorizations?: StayAuthorizations | null;
  /** B2.4: estado do atendimento humano por assunto. Ausente ⇒ só a regra B1 de `caseRelation`. */
  humanOwnership?: HumanOwnershipSnapshot | null;
}

/** Autorizações que o SISTEMA concede no turno (nunca vindas do modelo). */
export interface TurnAuthorizations {
  credentialRelease: "allow" | "deny";
  /** Refs de dossiê com disponibilidade CONFIRMADA (hoje sempre vazio: não há fonte de calendário). */
  availabilityConfirmedRefs: string[];
  /** B2.4: resultado da verificação formal (`policy/stay-authorizations.ts`), nunca do modelo. */
  earlyCheckin: StayAuthorization;
  lateCheckout: StayAuthorization;
  /** Fontes inexistentes nesta fase: o tipo literal impede tratá-las como concedidas. */
  reservationChange: "no_authorization_source";
  serviceOrBenefit: "no_authorization_source";
  actionsExecuted: "none";
  resolution: "no_authorization_source";
}

export function deriveTurnAuthorizations(
  ctx: ConversationContext,
  dossiers: readonly SemanticDossierView[] | null,
  stay: StayAuthorizations | null = null,
): TurnAuthorizations {
  const verified = stay ?? unavailableStayAuthorizations();
  return {
    credentialRelease: ctx.credentialPolicy.decision === "allow" ? "allow" : "deny",
    availabilityConfirmedRefs: (dossiers ?? []).filter((d) => d.availability === "confirmed_available").map((d) => d.ref),
    earlyCheckin: verified.earlyCheckin,
    lateCheckout: verified.lateCheckout,
    reservationChange: "no_authorization_source",
    serviceOrBenefit: "no_authorization_source",
    actionsExecuted: "none",
    resolution: "no_authorization_source",
  };
}

/**
 * Regra de autorização por tipo de compromisso (exaustiva: o compilador exige todos os tipos).
 * `true` = o tipo está coberto por uma autorização real do sistema neste turno.
 */
export const COMMITMENT_AUTHORIZATION: Readonly<Record<CommitmentKind, (d: ModelDecision, a: TurnAuthorizations) => boolean>> = Object.freeze({
  // Repassar à equipe / retornar depois só existe pelo encaminhamento estruturado.
  team_relay: (d) => d.handoff.needed,
  information_followup: (d) => d.handoff.needed,
  // Credenciais: D9 permitiu E o modelo usou o caminho do marcador (o texto nunca contém valores).
  credential_release: (d, a) => a.credentialRelease === "allow" && d.credentialIntent === "would_deliver",
  // Disponibilidade: só confirmada para o imóvel citado.
  availability: (d, a) => a.availabilityConfirmedRefs.some((ref) => d.groundedOn.some((id) => id.startsWith(`dos:${ref}:`))),
  // Exceções de horário: só com autorização FORMAL verificada (entrada antecipada não tem fonte).
  early_checkin: (_d, a) => a.earlyCheckin.status === "authorized",
  late_checkout: (_d, a) => a.lateCheckout.status === "authorized",
  // Sem fonte de autorização nesta fase.
  reservation_change: () => false,
  service_or_benefit: () => false,
  action_completed: () => false,
  resolution: () => false,
});

const MILESTONE_PHASES: Readonly<Record<HospitalityMilestoneKind, readonly StayPhase[]>> = Object.freeze({
  checkin_confirmed: ["pre_stay", "in_stay"],
  checkout_confirmed: ["in_stay", "post_checkout"],
});

const FORMAL_ROUTE_STRATEGIES = ["clarify", "guide"] as const;

/** Textos da decisão que podem carregar segredo (todos os campos de texto livre). */
function decisionTexts(d: ModelDecision): string[] {
  const sig = decisionSignals(d);
  return [
    d.reply.replaceAll(CREDENTIAL_MARKER, " "),
    d.handoff.question ?? "",
    ...d.commitments,
    ...d.missingInformation,
    ...d.capabilityNeeds.map((n) => n.reason),
    sig.speakerName ?? "",
  ].filter((t) => t.trim().length > 0);
}

/** `true` = algum texto não é `safe`; `null` = guard ausente/falho (fail-closed). */
function scanOutput(guard: OutputScanner | null, texts: string[]): boolean | null {
  if (!guard || typeof guard.scan !== "function") return null;
  try {
    for (const t of texts) {
      const r = guard.scan(t);
      if (!r || typeof r !== "object" || typeof r.text !== "string" || !Array.isArray(r.findings)) return null;
      if (r.status !== "safe" || r.text !== t || r.findings.length > 0) return true;
    }
    return false;
  } catch {
    return null;
  }
}

export function validateSemantics(input: SemanticInput): SemanticReport {
  const { decision: d, context: ctx, dossiers, priorMilestones } = input;
  const blocks: SemanticBlock[] = [];
  const add = (b: SemanticBlock) => {
    if (!blocks.includes(b)) blocks.push(b);
  };
  const sig = decisionSignals(d);
  const auth = deriveTurnAuthorizations(ctx, dossiers, input.stayAuthorizations ?? null);
  const unauthorizedKinds: CommitmentKind[] = [];

  // 1) Compromissos: tipo declarado e autorizado pelo sistema.
  const kinds = commitmentKindsOf(d);
  if (d.commitments.length > 0 && kinds === null) add("commitment_kinds_undeclared");
  for (const k of kinds ?? []) {
    if (!COMMITMENT_AUTHORIZATION[k](d, auth)) unauthorizedKinds.push(k);
  }
  if (unauthorizedKinds.length) add("unauthorized_commitment");

  // 2) Alteração contratual: nunca decidida na conversa; precisa de rota.
  if (sig.formalChangeRequests.length > 0 && !d.handoff.needed && !(FORMAL_ROUTE_STRATEGIES as readonly string[]).includes(d.strategy)) {
    add("formal_change_without_route");
  }

  // 3) Alternativas: só com candidatos autorizados e citados.
  if (d.strategy === "suggest_alternatives") {
    const candidates = (dossiers ?? []).filter((x) => x.role === "candidate");
    if (candidates.length === 0) add("alternatives_without_candidates");
    else if (!candidates.some((c) => d.groundedOn.some((id) => id.startsWith(`dos:${c.ref}:`)))) add("alternatives_not_grounded");
  }

  // 4) Marcos: estadia existente, fase compatível, sem repetir ritual conhecido.
  let milestoneIdempotency: SemanticReport["milestoneIdempotency"] = "not_applicable";
  const m = sig.hospitalityMilestone;
  if (m) {
    if (!ctx.guest.stay) add("milestone_without_stay");
    else if (!MILESTONE_PHASES[m.kind].includes(ctx.guest.phase)) add("milestone_phase_incompatible");
    if (priorMilestones.status === "known") {
      if (priorMilestones.acknowledged.includes(m.kind)) add("milestone_repeated");
      else milestoneIdempotency = "verified_new";
    } else {
      milestoneIdempotency = "unverified";
    }
  }

  // 5) Emergência: nunca sem encaminhamento urgente.
  if (sig.intents.includes("emergency") && (!d.handoff.needed || d.handoff.urgency !== "high")) add("emergency_without_escalation");

  // 6) B2.4 — não interferência por ASSUNTO (nunca bloqueio da conversa inteira).
  const own = input.humanOwnership;
  if (own && own.active) {
    // Mesmo assunto sob responsabilidade humana: nada de segunda ação paralela (novo encaminhamento),
    // salvo emergência ou mudança relevante de prioridade (urgência alta acima da registrada).
    const escalation = sig.intents.includes("emergency") || (d.handoff.urgency === "high" && own.urgency !== "high");
    if (d.caseRelation === "related" && d.handoff.needed && !escalation) add("protected_topic_second_action");
    // Assunto ambíguo: não assumir que é independente — nenhum compromisso até esclarecer.
    if (d.caseRelation === "ambiguous" && d.commitments.length > 0) add("ambiguous_topic_commitment");
  }

  // 7) Saída sensível: todo texto da decisão pelo guard (fail-closed).
  const sensitive = scanOutput(input.guard, decisionTexts(d));
  if (sensitive === null) add("output_guard_failed");
  else if (sensitive) add("output_sensitive_content");

  return { verdict: blocks.length ? "block" : "pass", blocks, unauthorizedKinds, milestoneIdempotency };
}
