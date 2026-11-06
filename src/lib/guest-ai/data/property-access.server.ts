/**
 * F2-B · B2.2 — AUTORIZAÇÃO POR IMÓVEL para carregar dossiês (isolamento multipropriedade por tenant).
 *
 * Regra absoluta (aditivo de 03/11/2026): imóveis alternativos só do MESMO tenant da conversa/reserva
 * atual. Cada candidato é validado INDIVIDUALMENTE no banco — nunca se presume que, por o imóvel
 * principal ser do tenant, os demais também sejam; nem por estarem na mesma cidade, plataforma ou rede.
 *
 * Validações do candidato (qualquer divergência ou ausência ⇒ bloqueio):
 *  1. turno validado emitido (`ValidatedTurn`), que fixa o tenant atual (`turn.tenantId`);
 *  2. finalidade explícita e conhecida (`guest_alternative_consultation`);
 *  3. id do candidato: UUID válido e diferente do imóvel principal;
 *  4. identidade inequívoca no banco: a linha existe e é exatamente aquele `id`;
 *  5. tenant do candidato (`properties.owner_id`) presente e IGUAL ao tenant atual;
 *  6. imóvel ativo (não arquivado);
 *  7. escopo: o hóspede não tem reserva no candidato ⇒ audiência SÓ pública (P). Endereço, manuais,
 *     acesso e qualquer dado de reserva (G) nunca; credenciais e equipe interna (I) nunca.
 *
 * Isto NÃO é busca de portfólio: recebe UM id de candidato (de uma ferramenta futura, autorizada) e
 * decide se ele pode ser lido. Somente leitura.
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import type { DossierAudience } from "@/lib/guest-ai/dossier/contracts";
import { issueDossierTarget, type DossierTarget } from "@/lib/guest-ai/dossier/registry";
import { GuestAiAbortedError, abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { PROPERTY_ACCESS_COLUMNS, cols } from "./projections";

export const ALTERNATIVE_PURPOSE = "guest_alternative_consultation" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Alvo do imóvel PRINCIPAL: o imóvel do turno validado, com a audiência já decidida pelo Policy Engine. */
export function primaryDossierTarget(turn: ValidatedTurn, audiences: readonly string[]): Readonly<DossierTarget> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  const allowed = audiences.filter((a): a is DossierAudience => a === "P" || a === "G");
  if (!allowed.includes("P") || allowed.length !== audiences.length) throw new Error("dossier_audiences_invalid");
  return issueDossierTarget({
    propertyId: turn.propertyId,
    tenantId: turn.tenantId,
    role: "primary",
    audiences: [...new Set(allowed)].sort(),
    purpose: "reservation_context",
  });
}

export type CandidateDenial =
  | "purpose_invalid"
  | "invalid_id"
  | "same_as_primary"
  | "lookup_failed"
  | "not_found"
  | "identity_mismatch"
  | "tenant_unknown"
  | "tenant_mismatch"
  | "archived";

export type CandidateDecision = { ok: true; target: Readonly<DossierTarget> } | { ok: false; reason: CandidateDenial };

export async function authorizeCandidateProperty(
  turn: ValidatedTurn,
  candidatePropertyId: string,
  purpose: string,
  deps: { db?: GuestAiDb; signal?: AbortSignal } = {},
): Promise<CandidateDecision> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  if (purpose !== ALTERNATIVE_PURPOSE) return { ok: false, reason: "purpose_invalid" };
  if (typeof candidatePropertyId !== "string" || !UUID.test(candidatePropertyId)) return { ok: false, reason: "invalid_id" };
  if (candidatePropertyId.toLowerCase() === turn.propertyId.toLowerCase()) return { ok: false, reason: "same_as_primary" };
  if (typeof turn.tenantId !== "string" || !turn.tenantId) return { ok: false, reason: "tenant_unknown" };

  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  let row: Record<string, unknown> | null;
  try {
    const { data, error } = await db.from("properties").select(cols(PROPERTY_ACCESS_COLUMNS)).eq("id", candidatePropertyId).maybeSingle();
    if (error) {
      throwIfAborted(deps.signal);
      return { ok: false, reason: "lookup_failed" };
    }
    row = (data as Record<string, unknown> | null) ?? null;
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    return { ok: false, reason: "lookup_failed" };
  }
  throwIfAborted(deps.signal);

  if (!row) return { ok: false, reason: "not_found" };
  if (row["id"] !== candidatePropertyId) return { ok: false, reason: "identity_mismatch" };
  const owner = row["owner_id"];
  if (typeof owner !== "string" || !owner) return { ok: false, reason: "tenant_unknown" };
  if (owner !== turn.tenantId) return { ok: false, reason: "tenant_mismatch" };
  if (row["archived_at"] !== null && row["archived_at"] !== undefined) return { ok: false, reason: "archived" };

  return {
    ok: true,
    target: issueDossierTarget({ propertyId: candidatePropertyId, tenantId: owner, role: "candidate", audiences: ["P"], purpose: ALTERNATIVE_PURPOSE }),
  };
}
