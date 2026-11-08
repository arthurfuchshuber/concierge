/**
 * DOCUMENTO VIVO para a IA (Etapa 4, aprendizado contínuo) — LEITURA das entradas APROVADAS do imóvel do
 * turno validado, com projeção própria (`LIVING_DOCUMENT_COLUMNS`).
 *
 * - Imóvel SEMPRE do turno validado, nunca de parâmetro; só `status = approved` (pendente, recusado e
 *   revogado nunca chegam ao modelo).
 * - As mais recentes primeiro, até `LIVING_DOCUMENT_MAX`; normalização e travas em `normalizeLivingRows`.
 * - Enriquecimento: falha de leitura ⇒ `unavailable` (o bloco não entra), nunca derruba o turno. Só o
 *   cancelamento interrompe (`GuestAiAbortedError`).
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import { LIVING_DOCUMENT_MAX, normalizeLivingRows, type LivingDocumentLoad } from "@/lib/guest-ai/learning/learning";
import { GuestAiAbortedError, abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { LIVING_DOCUMENT_COLUMNS, cols } from "./projections";

export async function fetchLivingDocument(
  turn: ValidatedTurn,
  deps: { db?: GuestAiDb; signal?: AbortSignal } = {},
): Promise<LivingDocumentLoad> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  try {
    const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
    const res = await db
      .from("guest_ai_learning_entries")
      .select(cols(LIVING_DOCUMENT_COLUMNS))
      .eq("property_id", turn.propertyId)
      .eq("status", "approved")
      .order("decided_at", { ascending: false })
      .limit(LIVING_DOCUMENT_MAX);
    throwIfAborted(deps.signal);
    if (res.error) return { status: "unavailable", reason: "lookup_failed" };
    const rows = Array.isArray(res.data) ? (res.data as unknown[]) : [];
    return { status: "available", propertyId: turn.propertyId, items: normalizeLivingRows(turn.propertyId, rows) };
  } catch (e) {
    if (e instanceof GuestAiAbortedError) throw e;
    throwIfAborted(deps.signal);
    return { status: "unavailable", reason: "lookup_failed" };
  }
}
