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
import { LIVING_DOCUMENT_COLUMNS, PROPERTY_CITY_COLUMNS, REGIONAL_SITUATION_COLUMNS, cols } from "./projections";
import { cityKey } from "@/lib/city-key";
import { regionalLivingStatement } from "@/lib/regional-situation";

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
    const items = normalizeLivingRows(turn.propertyId, rows);
    // SITUAÇÃO REGIONAL CONFIRMADA PELA EQUIPE (26/11/2026): a ativa da mesma conta e cidade entra no topo, com as
    // travas no próprio texto (nunca citar outros hóspedes/imóveis; "só aqui" ⇒ problema do imóvel). Falha ⇒ fora.
    try {
      const prop = await db.from("properties").select(cols(PROPERTY_CITY_COLUMNS)).eq("id", turn.propertyId).maybeSingle();
      throwIfAborted(deps.signal);
      const p = (prop.data ?? null) as { owner_id?: string | null; city?: string | null } | null;
      if (p?.owner_id && p.city) {
        const nowIso = new Date().toISOString();
        const reg = await db
          .from("guest_ai_regional_situations")
          .select(cols(REGIONAL_SITUATION_COLUMNS))
          .eq("owner_id", p.owner_id)
          .eq("status", "active")
          .lte("starts_at", nowIso)
          .order("starts_at", { ascending: false })
          .limit(5);
        throwIfAborted(deps.signal);
        const key = cityKey(p.city);
        const active = ((reg.data ?? []) as Array<Record<string, unknown>>).filter(
          (r) => cityKey(String(r["city"] ?? "")) === key && (!r["expires_at"] || String(r["expires_at"]) > nowIso),
        );
        for (const r of active.reverse()) {
          items.unshift({
            id: `regional:${String(r["id"])}`,
            category: "vizinhanca",
            statement: regionalLivingStatement({
              kind: String(r["kind"] ?? ""),
              city: String(r["city"] ?? ""),
              neighborhoods: String(r["neighborhoods"] ?? ""),
              aiText: String(r["ai_text"] ?? ""),
            }),
            source: "team_instruction",
            approvedAt: (r["starts_at"] as string | null) ?? null,
          });
        }
      }
    } catch (e) {
      if (e instanceof GuestAiAbortedError) throw e;
    }
    return { status: "available", propertyId: turn.propertyId, items };
  } catch (e) {
    if (e instanceof GuestAiAbortedError) throw e;
    throwIfAborted(deps.signal);
    return { status: "unavailable", reason: "lookup_failed" };
  }
}
