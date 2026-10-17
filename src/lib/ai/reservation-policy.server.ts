/**
 * Lê, do banco, o que a regra de cancelamento precisa: a MODALIDADE DA PRÓPRIA
 * RESERVA (política de cancelamento que o Airbnb gravou nela: moderada, não
 * reembolsável...), data/horário de check-in, noites e quando foi reservada.
 *
 * Sem a modalidade da reserva (reservas antigas sem o dado) o resultado é
 * "unknown": a IA NÃO presume pela política do anúncio (decisão do anfitrião,
 * 17/10/2026) e orienta o menu da reserva na plataforma.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { propertyTimeZone } from "@/lib/property-timezone";
import { cancellationWindow, type CancellationWindow } from "./reservation-change";

type Admin = SupabaseClient;

export async function loadCancellationWindow(
  admin: Admin,
  p: { propertyId: string; code: string | null; checkin?: string | null; checkout?: string | null },
): Promise<CancellationWindow> {
  try {
    const unknown = (reason: string): CancellationWindow => ({ status: "unknown", policy: null, deadline: null, reason });
    if (!p.code || !/^[A-Z0-9-]{3,40}$/i.test(p.code)) return unknown("reserva não identificada");
    const [{ data: prop }, { data: rows }] = await Promise.all([
      admin.from("properties").select("checkin_time, city, country").eq("id", p.propertyId).maybeSingle(),
      admin
        .from("property_reservations")
        .select("checkin_date, checkout_date, cancellation_policy_category, raw_payload")
        .eq("property_id", p.propertyId)
        .contains("guest_contacts", { code: p.code })
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    const r = (rows?.[0] ?? null) as {
      checkin_date?: string; checkout_date?: string; cancellation_policy_category?: string | null;
      raw_payload?: { inserted_at?: string } | null;
    } | null;
    if (!r?.cancellation_policy_category) return unknown("modalidade da reserva não registrada");
    const pr = (prop ?? {}) as Record<string, unknown>;
    const tz = propertyTimeZone(pr.city as string | null, pr.country as string | null);
    const checkin = r.checkin_date ? String(r.checkin_date).slice(0, 10) : (p.checkin ?? null);
    const checkout = r.checkout_date ? String(r.checkout_date).slice(0, 10) : (p.checkout ?? null);
    const nights = checkin && checkout ? Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86_400_000) : null;
    return cancellationWindow({
      category: r.cancellation_policy_category,
      checkin,
      checkinTime: pr.checkin_time,
      nights,
      bookedAt: r.raw_payload?.inserted_at ?? null,
      tz,
      nowMs: Date.now(),
    });
  } catch (e) {
    console.error("[reservation-policy] leitura falhou", e);
    return { status: "unknown", policy: null, deadline: null, reason: "leitura indisponível" };
  }
}
