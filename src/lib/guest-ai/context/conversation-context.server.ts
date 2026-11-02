/**
 * F2-B · B1 — Contexto conversacional do turno (versão B1, mínima).
 *
 * Reaproveita o Context Engine F1 (`buildGuestContext`) em modo `credentials: "skip"`: a D9 é
 * avaliada (decisão e motivo), mas NENHUMA credencial é buscada. Histórico e detalhes da posse
 * humana (motivo/horário do encaminhamento) chegam na B2; aqui o contrato já existe e responde
 * `unavailable` explicitamente — nada é inventado.
 *
 * Conhecimento do anfitrião/orientações e precedentes: não existe repositório governado (as
 * únicas tabelas com isso são as 29 legadas, proibidas). Sempre `unavailable/no_governed_store`.
 */
import { buildGuestContext, type BuilderDeps } from "@/lib/guest-ai/context/builder.server";
import type { ConversationContext, TurnRequest } from "@/lib/guest-ai/orchestrator/contracts";
import type { OpenCase } from "@/lib/guest-ai/types";

/** Todos os chamados abertos, sem descartar nenhum (motivo/horário: B2). */
export function humanOwnershipOf(openCases: readonly OpenCase[]): ConversationContext["humanOwnership"] {
  return {
    openCaseCount: openCases.length,
    cases: openCases.map((c) => ({ caseId: c.id, status: c.status, handoffReason: null, handoffAt: null })),
  };
}

export async function loadConversationContext(
  req: TurnRequest,
  deps: Omit<BuilderDeps, "credentials" | "signal"> = {},
  signal?: AbortSignal,
): Promise<ConversationContext> {
  // O sinal do turno chega a TODAS as consultas (ver `abortableDb`) e é conferido entre etapas.
  const guest = await buildGuestContext(
    { surface: req.surface, conversationId: req.conversationId, messageId: req.messageId, expectedOwnerId: req.expectedOwnerId ?? null },
    { ...deps, credentials: "skip", signal },
  );
  return {
    guest,
    credentialPolicy: { decision: guest.access.policyResult.decision, reason: guest.access.policyResult.reason },
    history: { status: "unavailable", reason: "not_loaded" },
    humanOwnership: humanOwnershipOf(guest.openCases),
    hostGuidance: { status: "unavailable", reason: "no_governed_store" },
    precedents: { status: "unavailable", reason: "no_governed_store" },
  };
}
