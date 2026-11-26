/**
 * F2-B · B3.2 — LEITURA das fontes da identidade de envio Airbnb (somente leitura).
 *
 * Produz o `SenderIdentitySource` da política pura `resolveSenderIdentity` (B2.5), sem decidir nada:
 *  1. anúncio da conversa: as propriedades Channex vistas nos webhooks brutos DESTA thread (thread do
 *     turno validado) → anúncio principal (`property_listing_raw_data.channex_property_id`) ou gêmeo
 *     (`channex_twin_links.twin_channex_property_id`). Mais de um anúncio ⇒ candidatos múltiplos ⇒
 *     a política devolve `ambiguous` (nunca escolhe um);
 *  2. grupo do anúncio: linhas do anúncio e dos gêmeos SEM filtrar por tenant (para que a política
 *     detecte anúncio/gêmeo de OUTRO tenant e invalide, em vez de simplesmente não enxergar);
 *  3. preferência do anfitrião (`airbnb_sender_pref`), só os campos do contrato por caminho JSON;
 *  4. contas Airbnb candidatas (owner, canal, status) — nenhuma coluna de token/credencial.
 * Ausência de `sender_user_id` nunca é usada como prova de nada aqui: identidade de ENVIO (conta do
 * anfitrião) ≠ remetente de uma mensagem ≠ titular da reserva. Falha de leitura ⇒ `lookup: "failed"`
 * ⇒ `unavailable`. Fora do Airbnb, a política responde `not_applicable` sem consulta.
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import { type SenderIdentitySource } from "@/lib/guest-ai/policy/sender-identity";
import { GuestAiAbortedError, abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { threadIdOf } from "./airbnb-thread.server";
import { readSenderIdentitySourceForThread } from "@/lib/sender-identity-source.server";

const FAILED: SenderIdentitySource = { lookup: "failed", conversationListingId: null, reservationListingId: null, listings: [], twins: [], prefs: [], accounts: [] };


export async function loadSenderIdentitySource(turn: ValidatedTurn, deps: { db?: GuestAiDb; signal?: AbortSignal } = {}): Promise<SenderIdentitySource> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  if (turn.surface !== "airbnb") return { ...FAILED, lookup: "ok" };
  const thread = threadIdOf(turn);
  if (!thread) return FAILED;
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  try {
    return await readSenderIdentitySourceForThread(db, thread, deps.signal);
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    return FAILED;
  }
}
