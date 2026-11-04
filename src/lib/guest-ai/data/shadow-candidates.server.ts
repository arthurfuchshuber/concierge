/**
 * F2-B · B3.3 — Descoberta de conversas candidatas ao Shadow (SÓ leitura, SÓ imóveis do manifesto).
 *
 * Para cada imóvel autorizado, lê as conversas com atividade recente (janela derivada de valores
 * aprovados: espera máxima do coletor + carência de reconciliação + cadência do tick) e a mensagem de
 * hóspede mais recente de cada uma — que será o `messageId` do `validateTurnScope`. A superfície vem do
 * prefixo de `guest_session_id` (mesma regra do escopo, que confere de novo no banco). Nenhum texto é lido.
 * Qualquer erro de leitura ⇒ `{ ok: false }` (o tick não executa nada); linha de imóvel fora do
 * manifesto ⇒ `{ ok: false, integrity: true }`.
 */
import type { GuestSurface } from "@/lib/guest-ai/types";
import type { ManifestEntry } from "@/lib/guest-ai/shadow-exec/contracts";
import { UUID_RE } from "@/lib/guest-ai/shadow-exec/contracts";
import { COLLECTOR_DEFAULTS } from "@/lib/guest-ai/batch/collector";
import { abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { cols } from "./projections";

export const CANDIDATE_CONVERSATION_COLUMNS = ["id", "property_id", "guest_session_id", "last_message_at"] as const;
export const CANDIDATE_MESSAGE_COLUMNS = ["id", "conversation_id", "created_at"] as const;

export interface ShadowCandidate {
  conversationId: string;
  propertyId: string;
  tenantId: string;
  surface: GuestSurface;
  messageId: string;
}

export type CandidatesResult = { ok: true; candidates: readonly ShadowCandidate[] } | { ok: false; integrity: boolean };

/** Janela de atividade (ms): só valores aprovados (coletor B3.1 + cadência configurada). */
export function candidateLookbackMs(tickIntervalSeconds: number): number {
  return COLLECTOR_DEFAULTS.maxWaitMs + COLLECTOR_DEFAULTS.reconciliationGraceMs + tickIntervalSeconds * 1000;
}

const surfaceOf = (session: string): GuestSurface => (session.startsWith("wa:") ? "whatsapp" : session.startsWith("airbnb:") ? "airbnb" : "guide_chat");

export async function listShadowCandidates(
  entries: readonly ManifestEntry[],
  opts: { limit: number; tickIntervalSeconds: number; nowMs: number; db?: GuestAiDb; signal?: AbortSignal },
): Promise<CandidatesResult> {
  try {
    if (entries.length === 0 || !Number.isInteger(opts.limit) || opts.limit < 1 || !Number.isFinite(opts.nowMs)) return { ok: false, integrity: false };
    throwIfAborted(opts.signal);
    const tenantOf = new Map(entries.map((e) => [e.propertyId, e.tenantId]));
    const db = abortableDb(opts.db ?? (await getGuestAiDb()), opts.signal);
    const since = new Date(opts.nowMs - candidateLookbackMs(opts.tickIntervalSeconds)).toISOString();
    const conv = await db
      .from("property_chat_conversations")
      .select(cols(CANDIDATE_CONVERSATION_COLUMNS))
      .in("property_id", [...tenantOf.keys()])
      .gte("last_message_at", since)
      .order("last_message_at", { ascending: false })
      .limit(opts.limit);
    if (conv.error || !Array.isArray(conv.data)) return { ok: false, integrity: false };
    const out: ShadowCandidate[] = [];
    for (const raw of conv.data as Array<Record<string, unknown>>) {
      const propertyId = raw.property_id;
      const tenantId = typeof propertyId === "string" ? tenantOf.get(propertyId) : undefined;
      if (!tenantId) return { ok: false, integrity: true };
      if (typeof raw.id !== "string" || !UUID_RE.test(raw.id) || typeof raw.guest_session_id !== "string") return { ok: false, integrity: false };
      throwIfAborted(opts.signal);
      const msg = await db
        .from("property_chat_messages")
        .select(cols(CANDIDATE_MESSAGE_COLUMNS))
        .eq("conversation_id", raw.id)
        .eq("sender_type", "guest")
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1);
      if (msg.error || !Array.isArray(msg.data)) return { ok: false, integrity: false };
      const m = msg.data[0] as Record<string, unknown> | undefined;
      if (!m) continue; // conversa sem mensagem de hóspede: nada a avaliar
      if (m.conversation_id !== raw.id || typeof m.id !== "string" || !UUID_RE.test(m.id)) return { ok: false, integrity: true };
      out.push(Object.freeze({ conversationId: raw.id, propertyId: propertyId as string, tenantId, surface: surfaceOf(raw.guest_session_id), messageId: m.id }));
    }
    return { ok: true, candidates: Object.freeze(out) };
  } catch {
    return { ok: false, integrity: false };
  }
}
