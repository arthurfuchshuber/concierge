// Campos estruturados do anúncio (Airbnb via Channex) usados pelo sistema e
// pela IA. Função pura: o mesmo cálculo alimenta `property_listing_raw_data.
// normalized` e as colunas do imóvel, para os dois nunca divergirem.
import { POLICY_LABEL } from "@/lib/reservation-rich";

type Any = Record<string, any>;

const hhmm = (v: unknown): string | null => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  if (/^\d{1,2}$/.test(t)) return `${t.padStart(2, "0")}:00`;
  if (/^\d{1,2}:\d{2}$/.test(t)) return t.padStart(5, "0");
  return null;
};

export type StructuredListing = {
  instant_booking_enabled: boolean | null;
  instant_booking_category: string | null;
  checkin_window: { start: string | null; end: string | null };
  checkout_time: string | null;
  cancellation_policy_default: string | null;
  cancellation_policy_label: string | null;
  house_rules: Array<{ key: string; label: string; allowed: boolean | null; detail?: string | null }>;
  /** O Channex não informa co-anfitriões no anúncio; vem das reservas (repasse). */
  cohosts: Array<{ name: string | null; role: string }>;
};

export function structuredListing(settings: Any | null | undefined, cohostSeen = false): StructuredListing {
  const b: Any = settings?.booking_setting ?? {};
  const g: Any = b.guest_controls ?? {};
  const a: Any = settings?.availability_rule ?? {};
  const cat = (b.instant_booking_allowed_category ?? a.instant_booking_allowed_category ?? null) as string | null;
  const policy = (b.cancellation_policy_settings?.cancellation_policy_category ?? null) as string | null;
  const rule = (key: string, label: string, v: unknown, detail?: string | null) => ({
    key,
    label,
    allowed: typeof v === "boolean" ? v : null,
    ...(detail ? { detail } : {}),
  });
  const rules = [
    rule("children", "Crianças", g.allows_children_as_host, g.children_not_allowed_details),
    rule("infants", "Bebês", g.allows_infants_as_host),
    rule("pets", "Animais de estimação", g.allows_pets_as_host, g.pet_capacity ? `até ${g.pet_capacity}` : null),
    rule("events", "Festas e eventos", g.allows_events_as_host),
    rule("smoking", "Fumar", g.allows_smoking_as_host),
  ].filter((r) => r.allowed !== null);
  return {
    instant_booking_enabled: cat == null ? null : cat !== "none" && cat !== "off" && cat !== "",
    instant_booking_category: cat,
    checkin_window: { start: hhmm(b.check_in_time_start), end: hhmm(b.check_in_time_end) },
    checkout_time: hhmm(b.check_out_time),
    cancellation_policy_default: policy,
    cancellation_policy_label: policy ? (POLICY_LABEL[policy] ?? policy) : null,
    house_rules: rules,
    cohosts: cohostSeen ? [{ name: null, role: "co-anfitrião (repasse automático nas reservas)" }] : [],
  };
}

/** Texto das regras para o campo `airbnb_house_rules` quando ele está vazio. */
export function houseRulesText(rules: StructuredListing["house_rules"]): string | null {
  if (!rules.length) return null;
  return rules
    .map((r) => `${r.label}: ${r.allowed ? "permitido" : "não permitido"}${r.detail ? ` (${r.detail})` : ""}`)
    .join("\n");
}
