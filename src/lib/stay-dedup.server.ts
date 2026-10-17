/* eslint-disable @typescript-eslint/no-explicit-any */
// Troca a reserva do iCal pela reserva da API (Channex) do mesmo imóvel e datas, passando antes
// todos os vínculos (cartões da esteira, registros, tarefas, conversas) e só então aposentando
// a do iCal (status cancelada + marca). Nunca apaga a reserva: `guest_arrival_status` tem
// ON DELETE CASCADE, então apagar destruiria os cartões.
import { pairIcalWithApi, planCards, SUPERSEDED_TAG, type CardRow, type StayRow } from "@/lib/stay-dedup";

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const LINK_TABLES = ["reservation_records", "tasks", "task_completions", "ai_conversations", "ai_proactive_actions"] as const;

export type DedupResult = { pairs: number; retired: number; movedCards: number; droppedCards: number; moved: Record<string, number> };

/** `dryRun` só conta o que faria (conferência). */
export async function reconcileIcalWithApi(propertyIds: string[], opts: { dryRun?: boolean } = {}): Promise<DedupResult> {
  const out: DedupResult = { pairs: 0, retired: 0, movedCards: 0, droppedCards: 0, moved: {} };
  if (!propertyIds.length) return out;
  const sb = await admin();
  const { data: rows } = await sb
    .from("property_reservations")
    .select("id, property_id, checkin_date, checkout_date, status, source, raw_summary")
    .in("property_id", propertyIds)
    .in("source", ["airbnb", "channex"]);
  const all = (rows ?? []) as Array<StayRow & { raw_summary: string | null }>;
  const pairs = pairIcalWithApi(all);
  out.pairs = pairs.length;
  for (const { ical, api } of pairs) {
    const { data: ic } = await sb.from("guest_arrival_status").select("id, reservation_id, kind, status, concluded_at, cleaning_type").eq("reservation_id", ical.id);
    const { data: ac } = await sb.from("guest_arrival_status").select("id, reservation_id, kind, status, concluded_at, cleaning_type").eq("reservation_id", api.id);
    const plan = planCards((ic ?? []) as CardRow[], (ac ?? []) as CardRow[]);
    out.movedCards += plan.moveIds.length;
    out.droppedCards += plan.dropIds.length;
    if (opts.dryRun) {
      for (const t of LINK_TABLES) {
        const { count } = await sb.from(t).select("reservation_id", { count: "exact", head: true }).eq("reservation_id", ical.id);
        if (count) out.moved[t] = (out.moved[t] ?? 0) + count;
      }
      out.retired++;
      continue;
    }
    // 1) vínculos primeiro; se qualquer passo falhar, a reserva do iCal NÃO é aposentada.
    let ok = true;
    if (plan.dropIds.length) {
      const { error } = await sb.from("guest_arrival_status").delete().in("id", plan.dropIds);
      if (error) ok = false;
    }
    if (ok && plan.moveIds.length) {
      const { error } = await sb.from("guest_arrival_status").update({ reservation_id: api.id }).in("id", plan.moveIds);
      if (error) ok = false;
    }
    if (ok) {
      await sb.from("guest_arrival_status").update({ manual_reservation_id: api.id }).eq("manual_reservation_id", ical.id);
      for (const t of LINK_TABLES) {
        const { data, error } = await sb.from(t).update({ reservation_id: api.id }).eq("reservation_id", ical.id).select("reservation_id");
        if (error) ok = false;
        else if (data?.length) out.moved[t] = (out.moved[t] ?? 0) + data.length;
      }
    }
    if (!ok) {
      console.error("[stay-dedup] vínculos não migraram; iCal mantido", ical.id);
      continue;
    }
    // 2) só então aposenta a reserva do iCal.
    const summary = `${ical.raw_summary ?? "Reserved"} ${SUPERSEDED_TAG}`.slice(0, 200);
    const { error } = await sb.from("property_reservations").update({ status: "cancelled", raw_summary: summary }).eq("id", ical.id);
    if (!error) out.retired++;
  }
  return out;
}

/** Atalho para a chegada de reserva da API / backfill: só imóveis ligados à Channex. */
export async function reconcileIcalForProperty(propertyId: string): Promise<DedupResult | null> {
  try {
    return await reconcileIcalWithApi([propertyId]);
  } catch (e) {
    console.error("[stay-dedup]", propertyId, e);
    return null;
  }
}
