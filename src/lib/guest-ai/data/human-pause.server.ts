/**
 * F2-B · B3.2 — LEITURA das fontes da pausa humana derivada (somente leitura).
 *
 * Devolve o `HumanPauseInput` para `deriveHumanPause` (política pura). Lê, para a conversa DO TURNO:
 *  1. a coluna de pausa (`ai_paused`, `paused_until`) e confere que a conversa é do imóvel do turno;
 *  2. mensagens gravadas SEM texto (`PAUSE_MESSAGE_COLUMNS`) desde a janela de leitura + a
 *     intervenção (não hóspede, não nota interna) mais recente da conversa, qualquer que seja a idade;
 *  3. no Airbnb, os webhooks brutos da thread (metadados) desde a janela + o bruto `property` mais
 *     recente, e as propriedades Channex do imóvel para conferir a origem.
 * Teto por leitura: acima dele, `complete = false` ⇒ a política devolve `unknown` (nunca lista cortada
 * tratada como completa). Falha ⇒ `lookup: "failed"` ⇒ `unknown` ⇒ bloqueio. Cancelamento propaga.
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import type { HumanPauseSource, PausePersistedRow } from "@/lib/guest-ai/policy/human-pause";
import { GuestAiAbortedError, abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { CONVERSATION_PAUSE_COLUMNS, PAUSE_MESSAGE_COLUMNS, cols } from "./projections";
import { fetchPropertyChannexIds, fetchThreadRawMeta, threadIdOf } from "./airbnb-thread.server";

/** Janela de leitura (≥ janela de 10 min + folga). A intervenção mais recente é lida à parte. */
export const PAUSE_LOOKBACK_MS = 30 * 60_000;
export const PAUSE_MAX_ROWS = 200;

export type { HumanPauseSource };

const failed = (): HumanPauseSource => ({ lookup: "failed", column: null, persisted: [], persistedComplete: false, raw: [], rawComplete: false, allowedSourcePropertyIds: null });

export async function loadHumanPauseSource(
  turn: ValidatedTurn,
  deps: { db?: GuestAiDb; signal?: AbortSignal; nowMs: number; sinceIso?: string },
): Promise<HumanPauseSource> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  const windowStart = new Date(deps.nowMs - PAUSE_LOOKBACK_MS).toISOString();
  const since = deps.sinceIso && deps.sinceIso < windowStart ? deps.sinceIso : windowStart;
  try {
    const conv = await db.from("property_chat_conversations").select(cols(CONVERSATION_PAUSE_COLUMNS)).eq("id", turn.conversationId).maybeSingle();
    if (conv.error || !conv.data) return failed();
    const c = conv.data as { id: string; property_id: string | null; ai_paused: unknown; paused_until: unknown };
    if (c.id !== turn.conversationId || c.property_id !== turn.propertyId) return failed();

    const msgs = () => db.from("property_chat_messages").select(cols(PAUSE_MESSAGE_COLUMNS)).eq("conversation_id", turn.conversationId);
    const [win, latest] = await Promise.all([
      msgs().gte("created_at", since).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(PAUSE_MAX_ROWS + 1),
      msgs().neq("sender_type", "guest").eq("is_internal_note", false).order("created_at", { ascending: false }).limit(1),
    ]);
    if (win.error || latest.error) return failed();
    const w = (win.data ?? []) as PausePersistedRow[];
    const byId = new Map<string, PausePersistedRow>();
    for (const r of [...w.slice(0, PAUSE_MAX_ROWS), ...((latest.data ?? []) as PausePersistedRow[])]) byId.set(r.id, r);

    let raw: HumanPauseSource["raw"] = [];
    let rawComplete = true;
    let allowed: string[] | null = null;
    const thread = threadIdOf(turn);
    if (turn.surface === "airbnb") {
      if (!thread) return failed();
      const [r, ids] = await Promise.all([fetchThreadRawMeta(db, thread, { sinceIso: since, limit: PAUSE_MAX_ROWS }), fetchPropertyChannexIds(db, turn)]);
      raw = r.rows;
      rawComplete = r.complete;
      allowed = ids;
    }
    throwIfAborted(deps.signal);
    return {
      lookup: "ok",
      column: { ai_paused: c.ai_paused, paused_until: c.paused_until },
      persisted: [...byId.values()],
      persistedComplete: w.length <= PAUSE_MAX_ROWS,
      raw,
      rawComplete,
      allowedSourcePropertyIds: allowed,
    };
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    return failed();
  }
}
