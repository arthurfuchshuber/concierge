/**
 * MENTE ÚNICA DE ACESSO (pedido explícito, 15/10/2026): durante a estadia em
 * andamento — reserva confirmada, hoje entre a data de entrada e a de saída,
 * check-out ainda não concluído e card NÃO marcado como "Não Compareceu" —
 * todos os dados do anúncio ficam liberados para a IA (Wi-Fi, senhas, códigos,
 * endereço, instruções), em TODOS os canais. Fora disso, segue bloqueado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { propertyTimeZone, todayInTZ } from "@/lib/property-timezone";
import { isStayMarkedNoShow } from "@/lib/guest-access.server";

export type StayAccess = {
  open: boolean;
  checkin: string | null;
  checkout: string | null;
  reason: "in_stay" | "no_reservation" | "outside_window" | "no_show" | "checked_out" | "unverified";
};

/** Regra pura: hoje dentro da janela [entrada, saída]. */
export function isWithinStay(today: string, checkin: string | null, checkout: string | null): boolean {
  if (!checkin) return false;
  const ci = checkin.slice(0, 10);
  const co = (checkout ?? checkin).slice(0, 10);
  return today >= ci && today <= co;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export async function resolveStayAccess(params: {
  supabase: SupabaseClient;
  property: Record<string, unknown>;
  channel: string;
  guestName?: string | null;
  checkinDate?: string | null;
  checkoutDate?: string | null;
  reservationVerified?: boolean;
  /** Guia: visitante não provou a reserva → nunca libera. */
  credentialsLocked?: boolean;
}): Promise<StayAccess> {
  const p = params.property;
  const propertyId = String(p.id);
  const tz = propertyTimeZone(
    typeof p.city === "string" ? p.city : null,
    typeof p.country === "string" ? p.country : null,
  );
  const today = todayInTZ(tz);
  const base = { checkin: null, checkout: null } as const;
  if (params.credentialsLocked === true || params.reservationVerified === false) {
    return { open: false, ...base, reason: "unverified" };
  }

  let checkin = params.checkinDate ? params.checkinDate.slice(0, 10) : null;
  let checkout = params.checkoutDate ? params.checkoutDate.slice(0, 10) : null;
  let logId: string | null = null;

  // Airbnb exige a validação do próprio canal (reserva oficial do thread).
  if (params.channel === "airbnb" && params.reservationVerified !== true) {
    return { open: false, ...base, reason: "unverified" };
  }
  if (!checkin) {
    const target = norm(params.guestName ?? "");
    if (!target) return { open: false, ...base, reason: "no_reservation" };
    const { data } = await params.supabase
      .from("guide_access_logs")
      .select("id, guest_name, checkin_date, checkout_date")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (data ?? []) as Array<{ id: string; guest_name: string; checkin_date: string; checkout_date: string | null }>;
    const first = target.split(" ")[0];
    const log =
      rows.find((r) => norm(r.guest_name ?? "") === target) ??
      rows.find((r) => norm(r.guest_name ?? "").split(" ")[0] === first);
    if (!log?.checkin_date) return { open: false, ...base, reason: "no_reservation" };
    checkin = String(log.checkin_date).slice(0, 10);
    checkout = log.checkout_date ? String(log.checkout_date).slice(0, 10) : null;
    logId = log.id;
  }

  if (!isWithinStay(today, checkin, checkout)) return { open: false, checkin, checkout, reason: "outside_window" };
  if (await isStayMarkedNoShow(propertyId, checkin)) return { open: false, checkin, checkout, reason: "no_show" };
  if (logId) {
    const { data: done } = await params.supabase
      .from("guest_arrival_status")
      .select("status, done_at")
      .eq("log_id", logId)
      .eq("kind", "checkout")
      .limit(1);
    const d = (done ?? [])[0] as { status: string | null; done_at: string | null } | undefined;
    if (d && (d.status === "done" || d.done_at)) return { open: false, checkin, checkout, reason: "checked_out" };
  }
  return { open: true, checkin, checkout, reason: "in_stay" };
}

/** Fatos completos do anúncio liberados durante a estadia (evidência oficial). */
export function stayFactsText(p: Record<string, unknown>): string {
  const rows: Array<[string, unknown]> = [
    ["Endereço", p.address],
    ["Como chegar", p.address_note],
    ["Rede Wi-Fi", p.wifi_ssid],
    ["Senha do Wi-Fi", p.wifi_password],
    [`Portão${p.gate_label ? ` (${p.gate_label})` : ""} — código`, p.gate_code],
    ["Portão — instruções", p.gate_instructions],
    [`Fechadura${p.lock_label ? ` (${p.lock_label})` : ""} — código`, p.lock_code],
    ["Fechadura — instruções", p.lock_instructions],
    ["Instruções de check-in", p.checkin_instructions],
    ["Instruções de check-out", p.checkout_instructions],
  ];
  return rows
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .join("\n");
}
