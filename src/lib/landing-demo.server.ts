/**
 * CÓPIA FIEL DO GUIA PARA A LANDING (28/09/2026).
 *
 * A landing não mostra mais o guia oficial: mostra uma CÓPIA (outro imóvel no
 * banco) da Casa Charmosa, com todos os dados sensíveis trocados por fictícios
 * — senhas, códigos, endereço, telefones — e sem nenhum bloqueio (PIN, código
 * de reserva, portaria). O lead navega por tudo.
 *
 * A cópia pertence a um usuário técnico próprio ("vitrine"), então não aparece
 * nos painéis de nenhuma empresa. Ela é re-sincronizada automaticamente a partir
 * do guia oficial sempre que alguém abre a vitrine (no máximo a cada 2 min).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const LANDING_SOURCE_SLUG = "charmosa";
export const LANDING_COPY_SLUG = "vitrine-casa-charmosa";
const DEMO_OWNER_EMAIL = "vitrine-landing@conciergeia.app";

export const DEMO_SECRETS = {
  wifi_ssid: "ConciergeIA_Hospede",
  wifi_password: "demo-2026",
  lock_code: "2468",
  gate_code: "1357",
  phone: "+55 (45) 90000-0000",
};

const CHILD_TABLES = [
  "property_manual_items",
  "property_recommendations",
  "property_emergency_contacts",
  "property_faqs",
  "property_checkout_items",
  "property_details",
  "property_daily_tips",
  "property_rec_exclusions",
] as const;

const STRIP = new Set(["id", "property_id", "created_at", "updated_at"]);
const SYNC_EVERY_MS = 2 * 60 * 1000;
let lastSyncAt = 0;
let inflight: Promise<void> | null = null;
let demoOwnerId: string | null = null;

export function isLandingCopy(slug: string | null | undefined) {
  return slug === LANDING_COPY_SLUG;
}

async function ensureDemoOwner(admin: SupabaseClient): Promise<string> {
  if (demoOwnerId) return demoOwnerId;
  const { findAuthUserByEmail } = await import("@/lib/admin-users.server");
  const found = await findAuthUserByEmail(DEMO_OWNER_EMAIL);
  if (found?.id) return (demoOwnerId = found.id);
  const pwd = crypto.randomUUID() + crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email: DEMO_OWNER_EMAIL,
    password: pwd,
    email_confirm: true,
    user_metadata: { full_name: "Vitrine ConciergeIA" },
  });
  if (error || !data.user) throw new Error(`vitrine: ${error?.message ?? "sem usuário"}`);
  return (demoOwnerId = data.user.id);
}

/** Owner cujo plano libera os recursos da cópia (o dono do guia oficial). */
export async function landingSourceOwnerId(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin.from("properties").select("owner_id").eq("slug", LANDING_SOURCE_SLUG).maybeSingle();
  return (data?.owner_id as string) ?? null;
}

function scrubber(secrets: string[]) {
  const list = secrets.filter((s) => s && s.trim().length >= 3);
  return (value: unknown): unknown => {
    if (typeof value === "string") {
      let out = list.reduce((t, s) => t.split(s).join(DEMO_SECRETS.lock_code), value);
      // Telefones escritos no texto
      return out.replace(/(\+?\d[\d\s().-]{8,}\d)/g, DEMO_SECRETS.phone);
    }
    if (Array.isArray(value)) return value.map((v) => scrubber(list)(v));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubber(list)(v)]));
    }
    return value;
  };
}

async function sync(admin: SupabaseClient) {
  const { data: src } = await admin.from("properties").select("*").eq("slug", LANDING_SOURCE_SLUG).maybeSingle();
  if (!src) return;
  const s = src as Record<string, unknown>;
  const ownerId = await ensureDemoOwner(admin);
  const secrets = [s.wifi_password, s.lock_code, s.gate_code, s.host_phone, s.access_codes_pin, s.pin_code]
    .filter((v): v is string => typeof v === "string");
  const scrub = scrubber(secrets);
  const textFields = ["checkin_instructions", "checkout_instructions", "lock_instructions", "gate_instructions", "checkin_note", "checkout_note", "house_rules"];

  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!STRIP.has(k)) row[k] = v;
  for (const f of textFields) row[f] = scrub(row[f]);
  const lat = typeof s.lat === "number" ? Math.round(s.lat * 100) / 100 : null;
  const lng = typeof s.lng === "number" ? Math.round(s.lng * 100) / 100 : null;
  const city = [s.city, s.state].filter(Boolean).join(" - ");
  Object.assign(row, {
    owner_id: ownerId,
    slug: LANDING_COPY_SLUG,
    published: true,
    access_mode: "public",
    pin_code: null,
    pin_expires_at: null,
    access_codes_pin: null,
    require_access_gate: false,
    airbnb_ical_url: null,
    airbnb_ical_url_2: null,
    airbnb_listing_url: null,
    portaria_email: null,
    owner_contact_id: null,
    ai_evaluation_target: false,
    wifi_ssid: DEMO_SECRETS.wifi_ssid,
    wifi_password: DEMO_SECRETS.wifi_password,
    lock_code: DEMO_SECRETS.lock_code,
    gate_code: DEMO_SECRETS.gate_code,
    host_phone: DEMO_SECRETS.phone,
    address: `Rua das Hortênsias, 120 — Centro${city ? `, ${city}` : ""}`,
    address_note: "Endereço fictício — demonstração do ConciergeIA.",
    lat,
    lng,
    maps_url: lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null,
    garage_maps_url: null,
  });

  const { data: existing } = await admin.from("properties").select("id").eq("slug", LANDING_COPY_SLUG).maybeSingle();
  let copyId = existing?.id as string | undefined;
  if (copyId) {
    const { error } = await admin.from("properties").update(row as never).eq("id", copyId);
    if (error) throw error;
  } else {
    const { data: ins, error } = await admin.from("properties").insert(row as never).select("id").single();
    if (error) throw error;
    copyId = ins.id as string;
  }

  for (const table of CHILD_TABLES) {
    const { data: rows, error } = await admin.from(table as never).select("*").eq("property_id", s.id as string);
    if (error) continue; // tabela sem property_id ou indisponível: não trava a vitrine
    await admin.from(table as never).delete().eq("property_id", copyId);
    const copies = (rows ?? []).map((r) => {
      const out: Record<string, unknown> = { property_id: copyId };
      for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
        if (STRIP.has(k)) continue;
        out[k] = table === "property_recommendations" ? v : scrub(v);
      }
      if (table === "property_emergency_contacts" && out.phone) out.phone = DEMO_SECRETS.phone;
      return out;
    });
    if (copies.length) {
      const { error: insErr } = await admin.from(table as never).insert(copies as never);
      if (insErr) console.error(`[vitrine] falha ao copiar ${table}`, insErr.message);
    }
  }
}

/** Garante a cópia atualizada. Nunca lança: a vitrine segue com a última cópia. */
export async function ensureLandingCopy(admin: SupabaseClient) {
  if (Date.now() - lastSyncAt < SYNC_EVERY_MS) return;
  if (!inflight) {
    inflight = sync(admin)
      .then(() => {
        lastSyncAt = Date.now();
      })
      .catch((e) => console.error("[vitrine] sync falhou", e instanceof Error ? e.message : e))
      .finally(() => {
        inflight = null;
      });
  }
  await inflight;
}
