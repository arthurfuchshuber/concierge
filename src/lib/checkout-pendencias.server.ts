// Server-only: encerramento automático das pendências de retorno no horário de checkout da reserva (15/11/2026,
// decisão do titular: "toda pendência de retorno precisa ser automaticamente finalizada no horário de checkout").
// Pendência de retorno = encaminhamento à equipe (conversa needs_human) e decisão humana pendente. Chamados de
// ocorrência (incidentes, danos, reclamações) NÃO são encerrados aqui: seguem abertos nos bastidores até a equipe
// tratá-los, e a conversa que tem chamado aberto também não sai da fila. O corte é o mesmo da baixa automática de checkout: horário oficial do imóvel no dia da saída
// (ou o late checkout formal, se houver), no fuso do imóvel; reservas com a saída já passada fecham de imediato.
// Conversa já ASSUMIDA por uma pessoa (status assigned) não é tocada. Melhor esforço: nunca lança.
// Roda junto da varredura de checkout (cron auto-checkout, a cada 5 minutos).

import type { SupabaseClient } from "@supabase/supabase-js";
import { propertyTimeZone, zonedTimeToUtc } from "@/lib/property-timezone";
import { autoCheckoutTriggerTime, loadFormalLateCheckouts, type FormalLateCheckout } from "@/lib/auto-checkout.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any>;

/** Instante (ms) em que as pendências da reserva se encerram; sem horário oficial, o fim do dia da saída. Puro. */
export function pendencyCutoffMs(r: {
  checkoutDate: string;
  standardTime: string | null;
  lateCheckout: FormalLateCheckout | null;
  timeZone: string;
}): number | null {
  const [y, mo, d] = (r.checkoutDate ?? "").slice(0, 10).split("-").map(Number);
  if (!y || !mo || !d) return null;
  const hm = autoCheckoutTriggerTime({ standardTime: r.standardTime, lateCheckout: r.lateCheckout }) ?? [23, 59];
  return zonedTimeToUtc(y, mo, d, hm[0]!, hm[1]!, r.timeZone).getTime();
}

const chunk = <T,>(a: T[], n = 100): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

interface ConvRow { id: string; status: string | null; property_id: string; reservation_id: string | null }

export async function closePendenciesAtCheckout(
  admin: Admin,
  now: Date = new Date(),
): Promise<{ conversations: number; decisions: number }> {
  const out = { conversations: 0, decisions: 0 };
  try {
    const [convQ, decQ, incQ] = await Promise.all([
      admin.from("property_chat_conversations").select("id, status, property_id, reservation_id").eq("status", "needs_human").not("reservation_id", "is", null).limit(500),
      admin.from("guest_ai_human_decisions").select("id, conversation_id").eq("status", "pending").limit(500),
      admin.from("guest_ai_incidents").select("conversation_id, reservation_id").eq("status", "open").limit(500),
    ]);
    const openIncidents = ((incQ.data ?? []) as Array<{ conversation_id: string; reservation_id: string | null }>);
    const incidentConvs = new Set(openIncidents.map((i) => i.conversation_id));
    const incidentReservations = new Set(openIncidents.map((i) => i.reservation_id).filter((x): x is string => !!x));
    const handoffs = ((convQ.data ?? []) as ConvRow[]).filter(
      (c) => !incidentConvs.has(c.id) && !(c.reservation_id && incidentReservations.has(c.reservation_id)),
    );
    const decisions = ((decQ.data ?? []) as Array<{ id: string; conversation_id: string }>);
    if (!handoffs.length && !decisions.length) return out;

    // conversas das decisões (para achar a reserva)
    const convById = new Map<string, ConvRow>(handoffs.map((c) => [c.id, c]));
    const missing = [...new Set(decisions.map((d) => d.conversation_id))].filter((id) => !convById.has(id));
    for (const ids of chunk(missing)) {
      const { data } = await admin.from("property_chat_conversations").select("id, status, property_id, reservation_id").in("id", ids);
      for (const c of (data ?? []) as ConvRow[]) convById.set(c.id, c);
    }

    const reservationIds = [
      ...new Set([
        ...[...convById.values()].map((c) => c.reservation_id),
      ].filter((x): x is string => !!x)),
    ];
    if (!reservationIds.length) return out;
    const resById = new Map<string, { id: string; checkout_date: string; property_id: string }>();
    for (const ids of chunk(reservationIds)) {
      const { data } = await admin.from("property_reservations").select("id, checkout_date, property_id").in("id", ids);
      for (const r of (data ?? []) as Array<{ id: string; checkout_date: string; property_id: string }>) resById.set(r.id, r);
    }
    const propIds = [...new Set([...resById.values()].map((r) => r.property_id))];
    const props = new Map<string, { checkout_time: string | null; city: string | null; country: string | null }>();
    for (const ids of chunk(propIds)) {
      const { data } = await admin.from("properties").select("id, checkout_time, city, country").in("id", ids);
      for (const p of (data ?? []) as Array<{ id: string; checkout_time: string | null; city: string | null; country: string | null }>) props.set(p.id, p);
    }
    const lateOf = await loadFormalLateCheckouts(admin as never, propIds);
    if (!lateOf) return out; // sem saber o corte certo, não age às cegas

    const due = (reservationId: string | null): boolean => {
      const r = reservationId ? resById.get(reservationId) : undefined;
      if (!r) return false;
      const p = props.get(r.property_id);
      const cutoff = pendencyCutoffMs({
        checkoutDate: r.checkout_date,
        standardTime: p?.checkout_time ?? null,
        lateCheckout: lateOf({ logId: "", reservationId: r.id }),
        timeZone: propertyTimeZone(p?.city ?? null, p?.country ?? null),
      });
      return cutoff !== null && cutoff <= now.getTime();
    };

    // decisões pendentes
    for (const d of decisions) {
      if (!due(convById.get(d.conversation_id)?.reservation_id ?? null)) continue;
      const { error } = await admin.rpc("guest_ai_decision_expire", { p_decision_id: d.id });
      if (!error) out.decisions++;
    }
    // encaminhamentos à equipe
    for (const c of handoffs) {
      if (!due(c.reservation_id)) continue;
      const { error } = await admin
        .from("property_chat_conversations")
        .update({ status: "ai", handoff_reason: null, handoff_urgency: null })
        .eq("id", c.id)
        .eq("status", "needs_human");
      if (!error) out.conversations++;
    }
  } catch (err) {
    console.error("[checkout-pendencias]", err);
  }
  return out;
}
