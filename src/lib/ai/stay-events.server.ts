/**
 * Check-in / checkout confirmados pelo hóspede no chat → avanço do card no
 * painel operacional, reaproveitando a mesma rotina do clique manual
 * (`runAdvanceArrival`). Só avança se aquele lado ainda estiver pendente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Stay = { reservationId: string; checkinDate: string; checkoutDate: string | null };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function findStayForEvent(
  supabase: SupabaseClient,
  p: { propertyId: string; checkinDate: string | null; checkoutDate: string | null },
): Promise<Stay | null> {
  let q = supabase
    .from("property_reservations")
    .select("id, checkin_date, checkout_date, status")
    .eq("property_id", p.propertyId);
  if (p.checkinDate) q = q.eq("checkin_date", p.checkinDate);
  else {
    const t = todayISO();
    q = q.lte("checkin_date", t).gte("checkout_date", t);
  }
  const { data } = await q.order("checkin_date", { ascending: false }).limit(5);
  const rows = ((data ?? []) as Array<{ id: string; checkin_date: string; checkout_date: string | null; status: string | null }>)
    .filter((r) => !(r.status ?? "").toLowerCase().includes("cancel"));
  if (rows.length !== 1 && !p.checkinDate) return null; // ambíguo: não arrisca
  const r = rows[0];
  return r ? { reservationId: r.id, checkinDate: r.checkin_date, checkoutDate: r.checkout_date } : null;
}

export async function applyStayEvent(
  supabase: SupabaseClient,
  stay: Stay,
  kind: "checkin" | "checkout",
): Promise<{ ok: boolean; motivo?: string }> {
  const { data: rows } = await supabase
    .from("guest_arrival_status")
    .select("kind, status, done_at")
    .eq("reservation_id", stay.reservationId);
  const list = (rows ?? []) as Array<{ kind: string; status: string; done_at: string | null }>;
  const done = (k: string) => list.some((r) => r.kind === k && (r.status === "done" || !!r.done_at));
  const noShow = list.some((r) => r.kind === "checkin" && r.status === "no_show");
  if (noShow) return { ok: false, motivo: "marcada_nao_compareceu" };
  if (kind === "checkin" && stay.checkinDate > todayISO()) return { ok: false, motivo: "checkin_futuro" };

  const { runAdvanceArrival } = await import("@/lib/dashboard.functions");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  if (kind === "checkin") {
    if (done("checkin")) return { ok: true, motivo: "ja_registrado" };
    await runAdvanceArrival(sb, { reservationId: stay.reservationId, from: "checkin" });
    return { ok: true };
  }
  if (done("checkout")) return { ok: true, motivo: "ja_registrado" };
  if (!done("checkin")) {
    await runAdvanceArrival(sb, { reservationId: stay.reservationId, from: "checkin" });
  }
  await runAdvanceArrival(sb, { reservationId: stay.reservationId, from: "checkout" });
  return { ok: true };
}
