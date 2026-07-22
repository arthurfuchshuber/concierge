import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCookie, setCookie } from "@tanstack/react-start/server";

const SlugInput = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/) });

async function loadFullGuide(supabaseAdmin: typeof import("@/integrations/supabase/client.server").supabaseAdmin, propertyId: string) {
  const [manual, recs, emerg, faqs, checkout] = await Promise.all([
    supabaseAdmin.from("property_manual_items").select("*").eq("property_id", propertyId).order("position"),
    supabaseAdmin.from("property_recommendations").select("*").eq("property_id", propertyId).eq("scope", "nearby").order("type").order("position"),
    supabaseAdmin.from("property_emergency_contacts").select("*").eq("property_id", propertyId).order("position"),
    supabaseAdmin.from("property_faqs").select("*").eq("property_id", propertyId).order("position"),
    supabaseAdmin.from("property_checkout_items").select("*").eq("property_id", propertyId).order("position"),
  ]);
  return {
    manual: manual.data ?? [],
    recommendations: recs.data ?? [],
    emergency: emerg.data ?? [],
    faqs: faqs.data ?? [],
    checkout: checkout.data ?? [],
  };
}

// Credentials (wifi_*, lock_code, gate_code, host_phone) are the purpose of the
// guide and are gated by access_mode + PIN cookie below. pin_code and owner_id
// are never returned to guests.

export const getPublicGuide = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => SlugInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // First fetch only access-control + display fields (no credentials, no pin_code).
    const { data: prop, error } = await supabaseAdmin
      .from("properties")
      .select("id,owner_id,slug,name,tagline,hero_image_url,gallery_images,theme_images,marketplace_links,address,maps_url,garage_maps_url,lat,lng,city,state,country,checkin_time,checkin_time_max,checkin_note,checkout_time,checkout_time_min,checkout_note,address_note,checkin_instructions,checkout_instructions,checkin_media,house_rules,gate_instructions,gate_media,gate_video_url,lock_instructions,lock_media,lock_video_url,host_name,brand_name,brand_logo_url,access_mode,pin_expires_at,default_language,guide_theme,require_access_gate,collect_arrival_time,collect_vehicles,vehicles_max,collect_document,document_scope,published,created_at,updated_at")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    if (!prop) return { status: "not_found" as const };

    if (prop.access_mode === "pin" && prop.pin_expires_at && new Date(prop.pin_expires_at) < new Date()) {
      return { status: "expired" as const, propertyName: prop.name };
    }

    if (prop.access_mode === "pin") {
      const cookie = getCookie(`sg-pin-${prop.id}`);
      if (cookie !== "ok") {
        return { status: "locked" as const, propertyName: prop.name, expiresAt: prop.pin_expires_at };
      }
    }

    // Access granted — now fetch credential fields in a separate query.
    // access_codes_pin NEVER leaves the server; we only expose whether one is set
    // and whether the current visitor has already unlocked it via cookie.
    const { data: creds } = await supabaseAdmin
      .from("properties")
      .select("wifi_ssid,wifi_password,lock_code,gate_code,host_phone,access_codes_pin")
      .eq("id", prop.id)
      .maybeSingle();

    const rawPin = (creds?.access_codes_pin ?? "").toString().trim();
    const hasAccessPin = rawPin.length > 0;
    const accessUnlocked = hasAccessPin
      ? getCookie(`sg-accesscodes-${prop.id}`) === "ok"
      : true;

    // Strip the PIN out of the payload no matter what.
    const { access_codes_pin: _omit, wifi_password, lock_code, gate_code, ...credsPublic } = (creds ?? {}) as Record<string, unknown> & {
      access_codes_pin?: string | null;
      wifi_password?: string | null;
      lock_code?: string | null;
      gate_code?: string | null;
    };
    // Only reveal protected codes when the visitor has unlocked them.
    const protectedCodes = accessUnlocked
      ? { wifi_password: wifi_password ?? null, lock_code: lock_code ?? null, gate_code: gate_code ?? null }
      : { wifi_password: null, lock_code: null, gate_code: null };
    // Booleans so the UI can render gated/masked slots even before unlock.
    const setFlags = {
      wifi_password_set: !!(wifi_password && String(wifi_password).trim()),
      lock_code_set: !!(lock_code && String(lock_code).trim()),
      gate_code_set: !!(gate_code && String(gate_code).trim()),
    };

    const safeProp = { ...prop, ...credsPublic, ...protectedCodes, ...setFlags, hasAccessPin, accessUnlocked };
    const children = await loadFullGuide(supabaseAdmin, prop.id);
    const { signPropertyImages } = await import("@/lib/storage.server");
    const signedProp = await signPropertyImages(supabaseAdmin, safeProp);
    // Resolve owner plan to gate AI chat in the public guide UI.
    const { resolveOwnerPlanAdmin } = await import("@/lib/plan-guard.server");
    const ownerPlan = await resolveOwnerPlanAdmin(supabaseAdmin as any, (prop as any).owner_id as string);
    const aiEnabled = !!ownerPlan.features.guestChat;

    // Referências macro da cidade — escopo POR IMÓVEL OU POR GRUPO de guias
    // vinculados. Nunca compartilhamos por city_key (causava vazamento entre
    // guias da mesma cidade).
    let cityReferences: any[] = [];
    const { data: membership } = await supabaseAdmin
      .from("city_reference_group_members")
      .select("group_id")
      .eq("property_id", prop.id)
      .maybeSingle();
    const groupId = (membership as { group_id: string } | null)?.group_id ?? null;
    {
      let q = supabaseAdmin
        .from("city_references")
        .select("id, category, type, name, note, address, rating, user_ratings_total, image_url, maps_url, opening_hours, lat, lng, place_id, display_order")
        .eq("is_hidden", false)
        .order("type")
        .order("display_order")
        .order("user_ratings_total", { ascending: false });
      if (groupId) q = q.eq("group_id", groupId);
      else q = q.eq("property_id", prop.id).is("group_id", null);
      const { data } = await q;
      cityReferences = data ?? [];
    }


    return { status: "ok" as const, property: signedProp, ...children, aiEnabled, cityReferences };
  });

const AccessPinSubmit = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  pin: z.string().min(1).max(32),
});

export const submitAccessPin = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => AccessPinSubmit.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop, error } = await supabaseAdmin
      .from("properties")
      .select("id, access_codes_pin, wifi_password, lock_code, gate_code")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    if (!prop) return { ok: false as const, reason: "not_found" };
    const stored = ((prop as any).access_codes_pin ?? "").toString().trim();
    if (!stored) return { ok: false as const, reason: "not_required" };
    if (stored !== data.pin.trim()) return { ok: false as const, reason: "wrong" };
    setCookie(`sg-accesscodes-${prop.id}`, "ok", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    return {
      ok: true as const,
      wifi_password: (prop as any).wifi_password ?? null,
      lock_code: (prop as any).lock_code ?? null,
      gate_code: (prop as any).gate_code ?? null,
    };
  });


const PinSubmit = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  pin: z.string().min(1).max(20),
});

export const submitPin = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => PinSubmit.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop, error } = await supabaseAdmin
      .from("properties")
      .select("id, pin_code, pin_expires_at, access_mode")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    if (!prop || prop.access_mode !== "pin") return { ok: false as const, reason: "not_found" };
    if (prop.pin_expires_at && new Date(prop.pin_expires_at) < new Date()) {
      return { ok: false as const, reason: "expired" };
    }
    if (!prop.pin_code || prop.pin_code !== data.pin) {
      return { ok: false as const, reason: "wrong" };
    }
    // maxAge alinhado com pin_expires_at: o cookie expira junto com o guia.
    // Fallback de 24h quando não há data de expiração configurada.
    const expiresAt = prop.pin_expires_at ? new Date(prop.pin_expires_at).getTime() : null;
    const maxAge = expiresAt
      ? Math.max(60, Math.floor((expiresAt - Date.now()) / 1000))
      : 60 * 60 * 24;
    setCookie(`sg-pin-${prop.id}`, "ok", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge,
    });
    return { ok: true as const };
  });
