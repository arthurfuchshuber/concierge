/**
 * Concessão de acesso a credenciais (CredentialGrant).
 *
 * É o ÚNICO jeito de obter a chave que `fetchSensitiveCredentials` aceita. Só é
 * emitida quando a política D9 devolveu `allow` PARA A MESMA reserva/imóvel/
 * conversa de um turno já validado, e vence em `GRANT_TTL_MS`: uma liberação
 * antiga não sobrevive a um no-show, checkout ou revogação (o builder reavalia
 * imediatamente antes de pedir as credenciais; o TTL é a segunda trava).
 */
import type { AccessPolicyResult, ValidatedTurn } from "@/lib/guest-ai/types";
import { GuestAiSecurityError, assertIssued, issue } from "@/lib/guest-ai/trust";

export const GRANT_TTL_MS = 30_000;

export interface CredentialGrant {
  readonly propertyId: string;
  readonly reservationId: string;
  readonly conversationId: string;
  readonly messageId: string;
  /** ISO. */
  readonly issuedAt: string;
  /** ISO. */
  readonly expiresAt: string;
  readonly policy: AccessPolicyResult;
}

/**
 * Emite a concessão. Recusa (lança) se o resultado não for `allow`, se o turno
 * não for um `ValidatedTurn` emitido pelo módulo de dados, ou se a reserva não
 * for a vinculada ao turno.
 */
export function issueCredentialGrant(
  turn: ValidatedTurn,
  reservationId: string,
  policy: AccessPolicyResult,
  nowMs: number,
): CredentialGrant {
  assertIssued("turn", turn, "grant_requires_validated_turn");
  if (!policy.allowed || policy.decision !== "allow") {
    throw new GuestAiSecurityError("grant_requires_allow");
  }
  if (!turn.reservationId || turn.reservationId !== reservationId) {
    throw new GuestAiSecurityError("grant_reservation_mismatch");
  }
  return issue("grant", {
    propertyId: turn.propertyId,
    reservationId,
    conversationId: turn.conversationId,
    messageId: turn.messageId,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + GRANT_TTL_MS).toISOString(),
    policy,
  });
}

/** Valida emissão + validade. Chamada por `fetchSensitiveCredentials` antes de qualquer consulta. */
export function assertGrantUsable(grant: unknown, nowMs: number): asserts grant is CredentialGrant {
  assertIssued("grant", grant, "credentials_require_grant");
  const g = grant as CredentialGrant;
  if (!(nowMs <= Date.parse(g.expiresAt))) throw new GuestAiSecurityError("grant_expired");
}
