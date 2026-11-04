/**
 * F2-B · B3.1 — LEITURA da janela do coletor de UMA conversa (somente leitura).
 *
 * Mensagens pendentes = o bloco final de mensagens do HÓSPEDE da conversa do turno, depois da última
 * mensagem não-hóspede (equipe, IA, sistema); notas internas são ignoradas. O mesmo critério da cadeia
 * (`batchMatchesHistory`: o lote é a cauda do histórico). No Airbnb, cada pendente é ligada ao seu
 * webhook bruto pelo id externo (instante do canal e do recebimento) e os brutos de hóspede da thread
 * ainda sem mensagem gravada são devolvidos para o coletor esperar a reconciliação.
 * Nada é marcado como processado, nada é escrito. Falha de leitura propaga como erro tipado; o
 * coletor nunca trata falha como "sem pendências".
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import type { BatchChannel } from "@/lib/guest-ai/batch/message-batch";
import type { CollectorMessage, CollectorWindowInput } from "@/lib/guest-ai/batch/collector";
import { GuestAiAbortedError, abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { COLLECTOR_MESSAGE_COLUMNS, cols } from "./projections";
import { GuestAiReadError, fetchThreadRawMeta, threadIdOf } from "./airbnb-thread.server";

/** Lê até 40 mensagens recentes (> 20 do limite do lote): bloco maior ⇒ `pendingOverflow`. */
export const COLLECTOR_SCAN_ROWS = 40;
const RAW_LOOKBACK_MS = 30 * 60_000;

type Row = { id: string; conversation_id: string; role: string | null; sender_type: string | null; channel: string | null; is_internal_note: boolean | null; created_at: string | null; external_id: string | null; content: string | null };

export type CollectorWindowSource = Omit<CollectorWindowInput, "pause" | "now" | "config" | "alreadyAnswered">;

export async function fetchCollectorWindow(turn: ValidatedTurn, deps: { db?: GuestAiDb; signal?: AbortSignal; nowMs: number }): Promise<CollectorWindowSource> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  const channel: BatchChannel = turn.surface === "airbnb" ? "airbnb" : turn.surface === "whatsapp" ? "whatsapp" : "web";
  const scope = { conversationId: turn.conversationId, propertyId: turn.propertyId, tenantId: turn.tenantId, channel, senderId: turn.guestSessionId };
  try {
    const res = await db
      .from("property_chat_messages")
      .select(cols(COLLECTOR_MESSAGE_COLUMNS))
      .eq("conversation_id", turn.conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(COLLECTOR_SCAN_ROWS + 1);
    if (res.error) throw new GuestAiReadError("collector_lookup_failed");
    const rows = (res.data ?? []) as Row[];
    const pending: Row[] = [];
    let stopped = false;
    for (const r of rows.slice(0, COLLECTOR_SCAN_ROWS)) {
      if (r.conversation_id !== turn.conversationId) throw new GuestAiReadError("collector_scope_mismatch");
      if (r.is_internal_note === true) continue;
      if (r.sender_type === "guest" && r.role === "user") {
        pending.push(r);
        continue;
      }
      stopped = true;
      break;
    }
    const pendingOverflow = !stopped && rows.length > COLLECTOR_SCAN_ROWS;
    pending.reverse();

    const byExt = new Map<string, { tChannel: string | null; tReceived: string | null }>();
    let unpersistedRawGuest: CollectorWindowSource["unpersistedRawGuest"] = [];
    if (channel === "airbnb") {
      const thread = threadIdOf(turn);
      if (!thread) throw new GuestAiReadError("thread_unidentified");
      const earliest = pending.length && pending[0]!.created_at ? Date.parse(pending[0]!.created_at) : Number.NaN;
      const sinceMs = Math.min(Number.isFinite(earliest) ? earliest : Number.POSITIVE_INFINITY, deps.nowMs) - RAW_LOOKBACK_MS;
      const ext = pending.map((p) => p.external_id).filter((x): x is string => !!x);
      const raw = await fetchThreadRawMeta(db, thread, { sinceIso: new Date(sinceMs).toISOString(), limit: 200, messageIds: ext });
      if (!raw.complete) throw new GuestAiReadError("raw_over_limit");
      // Ids externos de TODAS as mensagens gravadas da conversa na janela (para achar brutos não gravados).
      const known = await db.from("property_chat_messages").select(cols(["id", "external_id"])).eq("conversation_id", turn.conversationId).gte("created_at", new Date(sinceMs - RAW_LOOKBACK_MS).toISOString()).limit(501);
      if (known.error) throw new GuestAiReadError("collector_lookup_failed");
      const knownRows = (known.data ?? []) as Array<{ external_id: string | null }>;
      if (knownRows.length > 500) throw new GuestAiReadError("collector_over_limit");
      const knownExt = new Set(knownRows.map((k) => k.external_id).filter((x): x is string => !!x));
      for (const r of raw.rows) {
        for (const k of [r.message_id, r.ota_message_id]) if (k && !byExt.has(k)) byExt.set(k, { tChannel: r.inserted_at, tReceived: r.first_seen_at });
      }
      unpersistedRawGuest = raw.rows
        .filter((r) => r.sender === "guest" && !(r.message_id && knownExt.has(r.message_id)) && !(r.ota_message_id && knownExt.has(r.ota_message_id)))
        .map((r) => ({ tReceived: r.first_seen_at, tChannel: r.inserted_at }));
    }
    throwIfAborted(deps.signal);
    const messages: CollectorMessage[] = pending.map((p) => {
      const raw = p.external_id ? byExt.get(p.external_id) : undefined;
      const viaWebhook = channel === "airbnb";
      return {
        id: p.id,
        conversationId: p.conversation_id,
        propertyId: turn.propertyId,
        tenantId: turn.tenantId,
        channel: (p.channel === "airbnb" || p.channel === "whatsapp" || p.channel === "web" ? p.channel : "web") as BatchChannel,
        senderRole: "guest",
        senderId: turn.guestSessionId,
        text: p.content ?? "",
        tPersisted: p.created_at,
        // Fora do Airbnb a mensagem nasce no próprio ConciergeIA: canal = recebimento = gravação.
        tChannel: viaWebhook ? raw?.tChannel ?? null : p.created_at,
        tReceived: viaWebhook ? raw?.tReceived ?? null : p.created_at,
        rawMatched: viaWebhook ? !!raw : true,
      };
    });
    return { scope, messages, unpersistedRawGuest, pendingOverflow };
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    throw e instanceof GuestAiReadError ? e : new GuestAiReadError("collector_lookup_failed");
  }
}
