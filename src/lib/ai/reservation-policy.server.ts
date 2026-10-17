/**
 * Lê, do banco, o que a regra de cancelamento precisa: modalidade (categoria da
 * política do anúncio, vinda da Channex), data/horário de check-in, noites e
 * quando a reserva foi feita. Falha de leitura = "desconhecido" (a equipe decide).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { propertyTimeZone } from "@/lib/property-timezone";
import { cancellationWindow, type CancellationWindow } from "./reservation-change";

type Admin = SupabaseClient;

function findCategory(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  if (typeof o.cancellation_policy_category === "string" && o.cancellation_policy_category) return o.cancellation_policy_category;
  for (const v of Object.values(o)) {
    const r = findCategory(v);
    if (r) return r;
  }
  return null;
}

export async function loadCancellationWindow(
  admin: Admin,
  p: { propertyId: string; code: string | null; checkin?: string | null; checkout?: string | null },
): Promise<CancellationWindow> {
  try {
    const [{ data: prop }, { data: raw }] = await Promise.all([
      admin.from("properties").select("checkin_time, city, country").eq("id", p.propertyId).maybeSingle(),
      admin.from("property_listing_raw_data").select("raw_settings").eq("property_id", p.propertyId).limit(1).maybeSingle(),
    ]);
    const pr = (prop ?? {}) as Record<string, unknown>;
    const tz = propertyTimeZone(pr.city as string | null, pr.country as string | null);
    let checkin = p.checkin ?? null;
    let checkout = p.checkout ?? null;
    let bookedAt: string | null = null;
    if (p.code && /^[A-Z0-9-]{3,40}$/i.test(p.code)) {
      const { data } = await admin
        .from("reservas")
        .select("data_checkin, data_checkout, created_at, payload")
        .ilike("codigo_reserva_channex", `%${p.code}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const r = data as { data_checkin?: string; data_checkout?: string; created_at?: string; payload?: { inserted_at?: string } } | null;
      if (r) {
        checkin = checkin ?? (r.data_checkin ? String(r.data_checkin).slice(0, 10) : null);
        checkout = checkout ?? (r.data_checkout ? String(r.data_checkout).slice(0, 10) : null);
        bookedAt = r.payload?.inserted_at ?? r.created_at ?? null;
      }
    }
    const nights = checkin && checkout ? Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86_400_000) : null;
    return cancellationWindow({
      category: findCategory((raw as { raw_settings?: unknown } | null)?.raw_settings),
      checkin,
      checkinTime: pr.checkin_time,
      nights,
      bookedAt,
      tz,
      nowMs: Date.now(),
    });
  } catch (e) {
    console.error("[reservation-policy] leitura falhou", e);
    return { status: "unknown", policy: null, deadline: null, reason: "leitura indisponível" };
  }
}
