import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCookie, setCookie } from "@tanstack/react-start/server";

const SlugInput = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/) });

async function loadFullGuide(supabaseAdmin: typeof import("@/integrations/supabase/client.server").supabaseAdmin, propertyId: string) {
  const [manual, recs, emerg, faqs, checkout] = await Promise.all([
    supabaseAdmin.from("property_manual_items").select("*").eq("property_id", propertyId).order("position"),
    supabaseAdmin.from("property_recommendations").select("*").eq("property_id", propertyId).order("scope").order("type").order("position"),
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
      .select("id,slug,name,tagline,hero_image_url,gallery_images,theme_images,marketplace_links,address,maps_url,garage_maps_url,lat,lng,city,country,checkin_time,checkin_time_max,checkin_note,checkout_time,checkout_time_min,checkout_note,address_note,checkin_instructions,checkout_instructions,checkin_media,gate_instructions,gate_media,gate_video_url,lock_instructions,lock_media,lock_video_url,host_name,brand_name,brand_logo_url,access_mode,pin_expires_at,default_language,guide_theme,require_access_gate,published,created_at,updated_at")
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
    const { data: creds } = await supabaseAdmin
      .from("properties")
      .select("wifi_ssid,wifi_password,lock_code,gate_code,host_phone,access_codes_pin")
      .eq("id", prop.id)
      .maybeSingle();

    const safeProp = { ...prop, ...(creds ?? {}) };
    const children = await loadFullGuide(supabaseAdmin, prop.id);
    const { signPropertyImages } = await import("@/lib/storage.server");
    const signedProp = await signPropertyImages(supabaseAdmin, safeProp);
    return { status: "ok" as const, property: signedProp, ...children };
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
    setCookie(`sg-pin-${prop.id}`, "ok", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 24h
    });
    return { ok: true as const };
  });
