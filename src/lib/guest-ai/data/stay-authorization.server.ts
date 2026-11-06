/**
 * F2-B · B3.2 — LEITURA das fontes de autorização de HORÁRIO da estadia (somente leitura).
 *
 * Produz exatamente a porta `loadStayAuthorizationSource` da cadeia (B2.4): reserva do turno,
 * reservas irmãs da mesma estadia, imóvel (fuso IANA com origem declarada + checkout oficial),
 * cartões de estadia SEM credenciais e o histórico do R6. A identidade (imóvel, reserva, tenant) vem
 * sempre do `ValidatedTurn`.
 *
 * Ordem obrigatória (B3.0 Rev. 2 §6.3): primeiro as COLUNAS dos cartões, depois o HISTÓRICO
 * (`audit_logs`, ações `guest_arrival_status.late_checkout.*`). O histórico só nega: revogação
 * registrada no instante da aprovação lida ou depois ⇒ não autorizado; falha ao ler o histórico ⇒
 * `history.lookup = "failed"` ⇒ não autorizado. Nunca reativa autorização a partir do histórico.
 *
 * Fuso: `resolvePropertyTimezone` (país + estado verificados); a função antiga do SaaS
 * (`propertyTimeZoneOrNull`) não é usada aqui. Sem fuso inequívoco ⇒ `timezone: null` ⇒ R6 negado.
 * Nenhuma coluna de credencial é lida (projeções `STAY_AUTH_CARD_COLUMNS`/`PROPERTY_TIMEZONE_COLUMNS`).
 */
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { assertIssued } from "@/lib/guest-ai/trust";
import type { StayAuthorizationInput, StayCardRow } from "@/lib/guest-ai/policy/stay-authorizations";
import { resolvePropertyTimezone, type PropertyTimezone } from "@/lib/guest-ai/policy/timezone-source";
import { GuestAiAbortedError, abortableDb, getGuestAiDb, throwIfAborted, type GuestAiDb } from "./client.server";
import { PROPERTY_TIMEZONE_COLUMNS, RESERVATION_COLUMNS, STAY_AUTH_AUDIT_COLUMNS, STAY_AUTH_CARD_COLUMNS, cols } from "./projections";
import { GuestAiReadError } from "./airbnb-thread.server";

export const R6_AUDIT_ACTION_PREFIX = "guest_arrival_status.late_checkout.";

export type StayAuthorizationSource = Omit<StayAuthorizationInput, "turn" | "now" | "lookup"> & { timezoneResolution: PropertyTimezone };

export async function loadStayAuthorizationSource(turn: ValidatedTurn, deps: { db?: GuestAiDb; signal?: AbortSignal } = {}): Promise<StayAuthorizationSource> {
  assertIssued("turn", turn, "data_requires_validated_turn");
  throwIfAborted(deps.signal);
  const db = abortableDb(deps.db ?? (await getGuestAiDb()), deps.signal);
  try {
    const prop = await db.from("properties").select(cols(PROPERTY_TIMEZONE_COLUMNS)).eq("id", turn.propertyId).maybeSingle();
    if (prop.error || !prop.data) throw new GuestAiReadError("property_lookup_failed");
    const p = prop.data as { id: string; owner_id: string | null; country: unknown; state: unknown; checkout_time: string | null };
    if (p.id !== turn.propertyId || p.owner_id !== turn.tenantId) throw new GuestAiReadError("property_scope_mismatch");
    const tz = resolvePropertyTimezone({ country: p.country, state: p.state });
    const property = { timezone: tz.status === "resolved" ? tz.timezone : null, checkOutTime: p.checkout_time ?? null };

    if (!turn.reservationId) return { reservation: null, stayReservationIds: [], property, cards: [], history: { lookup: "ok", events: [] }, timezoneResolution: tz };
    const res = await db.from("property_reservations").select(cols(RESERVATION_COLUMNS)).eq("id", turn.reservationId).maybeSingle();
    if (res.error) throw new GuestAiReadError("reservation_lookup_failed");
    const r = (res.data ?? null) as { id: string; property_id: string; status: string | null; checkin_date: string | null; checkout_date: string | null } | null;
    if (!r) return { reservation: null, stayReservationIds: [], property, cards: [], history: { lookup: "ok", events: [] }, timezoneResolution: tz };
    if (r.property_id !== turn.propertyId) return { reservation: r, stayReservationIds: [], property, cards: [], history: { lookup: "ok", events: [] }, timezoneResolution: tz };

    let stayIds = [r.id];
    if (r.checkin_date && r.checkout_date) {
      const sib = await db.from("property_reservations").select("id").eq("property_id", turn.propertyId).eq("checkin_date", r.checkin_date).eq("checkout_date", r.checkout_date).limit(20);
      if (sib.error) throw new GuestAiReadError("reservation_lookup_failed");
      stayIds = Array.from(new Set([r.id, ...((sib.data ?? []) as Array<{ id: string }>).map((x) => x.id)]));
    }

    // 1º) colunas dos cartões
    const cardsRes = await db.from("guest_arrival_status").select(cols(STAY_AUTH_CARD_COLUMNS)).eq("property_id", turn.propertyId).in("reservation_id", stayIds).limit(50);
    if (cardsRes.error) throw new GuestAiReadError("arrival_status_lookup_failed");
    const cards = (cardsRes.data ?? []) as StayCardRow[];

    // 2º) histórico (só depois das colunas). Falha ⇒ histórico indisponível ⇒ nada autorizado.
    const ids = cards.map((c) => c.id).filter((x): x is string => typeof x === "string" && x.length > 0);
    let history: NonNullable<StayAuthorizationInput["history"]> = { lookup: "ok", events: [] };
    if (ids.length) {
      try {
        const a = await db
          .from("audit_logs")
          .select(cols(STAY_AUTH_AUDIT_COLUMNS))
          .eq("entity_type", "guest_arrival_status")
          .in("entity_id", ids)
          .like("action", `${R6_AUDIT_ACTION_PREFIX}%`)
          .order("created_at", { ascending: true })
          .limit(501);
        const rows = (a.data ?? []) as Array<{ action: string | null; entity_id: string | null; created_at: string | null }>;
        history = a.error || rows.length > 500 ? { lookup: "failed", events: [] } : { lookup: "ok", events: rows.map((e) => ({ card_id: e.entity_id, action: e.action, created_at: e.created_at })) };
      } catch (e) {
        if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
        history = { lookup: "failed", events: [] };
      }
    }
    throwIfAborted(deps.signal);
    return { reservation: r, stayReservationIds: stayIds, property, cards, history, timezoneResolution: tz };
  } catch (e) {
    if (e instanceof GuestAiAbortedError || deps.signal?.aborted) throw new GuestAiAbortedError();
    throw e instanceof GuestAiReadError ? e : new GuestAiReadError("stay_lookup_failed");
  }
}
