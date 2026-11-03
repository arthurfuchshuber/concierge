/** Fixtures compartilhadas dos testes da B2.1 (composição, histórico, render). */
import type { ConversationContext } from "@/lib/guest-ai/orchestrator/contracts";
import type { GuestContext } from "@/lib/guest-ai/types";
import type { HistoryRow } from "@/lib/guest-ai/history";
import type { FreeTextGuard } from "@/lib/guest-ai/composer";
import { validDecision } from "./decision-fixtures";

export const CONV = "11111111-1111-4111-8111-111111111111";
export const MSG = "22222222-2222-4222-8222-222222222222";
export const OTHER_CONV = "99999999-9999-4999-8999-999999999999";

export function guestContext(over: Partial<GuestContext> = {}): GuestContext {
  return {
    version: 1,
    interlocutor: { guestId: "wa:5511988887777", conversationId: CONV, messageId: MSG, surface: "guide_chat" },
    property: {
      id: "p1",
      tenantId: "t1",
      name: "Flat ao lado da Santa Casa",
      timezone: "America/Sao_Paulo",
      listingFacts: null,
      dossierKnowledge: null,
    },
    phase: "pre_stay",
    stay: {
      reservationId: "r1",
      phase: "pre_stay",
      status: "confirmed",
      checkInAt: "2026-11-04T18:00:00.000Z",
      checkOutAt: "2026-11-07T14:00:00.000Z",
      timezone: "America/Sao_Paulo",
    },
    audiences: ["P", "G"],
    access: { credentialsAllowed: false, policyResult: { decision: "deny", allowed: false, reason: "outside_release_window", evaluatedAt: "2026-11-03T12:00:00Z" } },
    credentials: null,
    openCases: [],
    uncertainties: [],
    conflicts: [],
    ...over,
  };
}

export function conversationContext(over: Partial<GuestContext> = {}, cases: ConversationContext["humanOwnership"]["cases"] = []): ConversationContext {
  return {
    guest: guestContext(over),
    credentialPolicy: { decision: "deny", reason: "outside_release_window" },
    history: { status: "unavailable", reason: "not_loaded" },
    humanOwnership: { openCaseCount: cases.length, cases },
    hostGuidance: { status: "unavailable", reason: "no_governed_store" },
    precedents: { status: "unavailable", reason: "no_governed_store" },
  };
}

let seq = 0;
export function row(over: Partial<HistoryRow> = {}): HistoryRow {
  seq += 1;
  return {
    id: over.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    conversation_id: CONV,
    role: "user",
    sender_type: "guest",
    channel: "web",
    content: `mensagem ${seq}`,
    created_at: `2026-11-03T10:00:${String(seq % 60).padStart(2, "0")}.000000+00:00`,
    is_internal_note: false,
    delivery_status: null,
    attachment_type: null,
    attachment_duration_ms: null,
    attachment_transcript: null,
    ...over,
  };
}

/** Guard de TESTE: troca uma sequência marcada por um marcador. Não é o secret-scrub (B2.2). */
export const TEST_GUARD: FreeTextGuard = {
  id: "test-guard",
  version: "0",
  apply: (t: string) => t.replace(/SEGREDO-\d+/g, "[removido]"),
};

/** Decisão v2 válida (B2.1): v1 + os cinco campos novos. Sem texto padrão de resposta. */
export const v2 = (over: Record<string, unknown> = {}) =>
  validDecision({
    shouldReply: true,
    intents: ["informational_query"],
    formalChangeRequests: [],
    hospitalityMilestone: null,
    speakerName: null,
    ...over,
  });
