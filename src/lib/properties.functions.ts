import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const slugRe = /^[a-z0-9](?:[a-z0-9-]{1,60}[a-z0-9])?$/;

const PropertyInput = z.object({
  name: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(200).optional().nullable(),
  slug: z.string().regex(slugRe, "Slug inválido (use letras minúsculas, números e hífens)"),
  hero_image_url: z.string().url().max(1024).optional().nullable(),
  gallery_images: z.array(z.string().url().max(1024)).max(4).default([]),
  theme_images: z.object({
    checkin: z.string().url().max(1024).optional().nullable(),
    residencia: z.string().url().max(1024).optional().nullable(),
    faq: z.string().url().max(1024).optional().nullable(),
    explore: z.string().url().max(1024).optional().nullable(),
  }).partial().default({}),
  address: z.string().max(500).optional().nullable(),
  maps_url: z.string().url().max(2048).optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  country: z.string().max(120).optional().nullable(),
  checkin_time: z.string().max(8).optional().nullable(),
  checkin_time_max: z.string().max(8).optional().nullable(),
  checkout_time: z.string().max(8).optional().nullable(),
  checkout_time_min: z.string().max(8).optional().nullable(),
  lock_code: z.string().max(40).optional().nullable(),
  gate_code: z.string().max(40).optional().nullable(),
  address_note: z.string().max(1000).optional().nullable(),
  wifi_ssid: z.string().max(64).optional().nullable(),
  wifi_password: z.string().max(64).optional().nullable(),
  host_name: z.string().max(120).optional().nullable(),
  host_phone: z.string().max(40).optional().nullable(),
  access_mode: z.enum(["public", "pin"]).default("public"),
  pin_code: z.string().max(20).optional().nullable(),
  pin_expires_at: z.string().datetime().optional().nullable(),
  default_language: z.enum(["pt", "en"]).default("pt"),
  guide_theme: z.enum(["dark", "light"]).default("dark"),
  published: z.boolean().default(true),
});

const RecInput = z.object({
  scope: z.enum(["nearby", "city"]),
  type: z.enum(["restaurant","bar","cafe","beach","attraction","market","pharmacy","park","nightlife","shopping","other"]),
  name: z.string().min(1).max(200),
  category: z.string().max(80).optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
  user_ratings_total: z.number().int().min(0).max(10_000_000).optional().nullable(),
  distance_text: z.string().max(80).optional().nullable(),
  distance_meters: z.number().int().optional().nullable(),
  drive_minutes: z.number().int().optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  image_url: z.string().max(2048).optional().nullable(),
  maps_url: z.string().max(2048).optional().nullable(),
  place_id: z.string().max(200).optional().nullable(),
});


export const listMyProperties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("properties")
      .select("id, slug, name, tagline, hero_image_url, gallery_images, access_mode, pin_expires_at, published, city, country, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    return data ?? [];
  });

export const getMyProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const [p, manual, recs, emerg, faqs, checkout] = await Promise.all([
      context.supabase.from("properties").select("*").eq("id", data.id).single(),
      context.supabase.from("property_manual_items").select("*").eq("property_id", data.id).order("position"),
      context.supabase.from("property_recommendations").select("*").eq("property_id", data.id).order("scope").order("type").order("position"),
      context.supabase.from("property_emergency_contacts").select("*").eq("property_id", data.id).order("position"),
      context.supabase.from("property_faqs").select("*").eq("property_id", data.id).order("position"),
      context.supabase.from("property_checkout_items").select("*").eq("property_id", data.id).order("position"),
    ]);
    if (p.error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", p.error);
    return {
      property: p.data,
      manual: manual.data ?? [],
      recommendations: recs.data ?? [],
      emergency: emerg.data ?? [],
      faqs: faqs.data ?? [],
      checkout: checkout.data ?? [],
    };
  });

const SavePropertyInput = z.object({
  id: z.string().uuid().optional().nullable(),
  property: PropertyInput,
  recommendations: z.array(RecInput).max(200).default([]),
  manual: z.array(z.object({
    title: z.string().min(1).max(120),
    description: z.string().max(300).optional().nullable(),
    body: z.string().max(4000).optional().nullable(),
  })).max(40).default([]),
  emergency: z.array(z.object({
    label: z.string().min(1).max(120),
    number: z.string().min(1).max(40),
  })).max(20).default([]),
  faqs: z.array(z.object({
    question: z.string().min(1).max(200),
    answer: z.string().min(1).max(2000),
  })).max(40).default([]),
  checkout: z.array(z.object({
    label: z.string().min(1).max(200),
  })).max(40).default([]),
});

export const upsertProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SavePropertyInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let propertyId = data.id ?? null;

    if (propertyId) {
      const { error } = await supabase
        .from("properties")
        .update({ ...data.property })
        .eq("id", propertyId);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    } else {
      const { data: inserted, error } = await supabase
        .from("properties")
        .insert({ ...data.property, owner_id: userId })
        .select("id")
        .single();
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
      propertyId = inserted.id;
    }

    // Replace child tables wholesale (simpler than diff). All scoped via RLS.
    const id = propertyId!;
    await Promise.all([
      supabase.from("property_recommendations").delete().eq("property_id", id),
      supabase.from("property_manual_items").delete().eq("property_id", id),
      supabase.from("property_emergency_contacts").delete().eq("property_id", id),
      supabase.from("property_faqs").delete().eq("property_id", id),
      supabase.from("property_checkout_items").delete().eq("property_id", id),
    ]);

    if (data.recommendations.length) {
      const rows = data.recommendations.map((r, i) => ({ ...r, property_id: id, position: i }));
      const { error } = await supabase.from("property_recommendations").insert(rows);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    }
    if (data.manual.length) {
      const rows = data.manual.map((m, i) => ({ ...m, property_id: id, position: i }));
      const { error } = await supabase.from("property_manual_items").insert(rows);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    }
    if (data.emergency.length) {
      const rows = data.emergency.map((m, i) => ({ ...m, property_id: id, position: i }));
      const { error } = await supabase.from("property_emergency_contacts").insert(rows);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    }
    if (data.faqs.length) {
      const rows = data.faqs.map((m, i) => ({ ...m, property_id: id, position: i }));
      const { error } = await supabase.from("property_faqs").insert(rows);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    }
    if (data.checkout.length) {
      const rows = data.checkout.map((m, i) => ({ ...m, property_id: id, position: i }));
      const { error } = await supabase.from("property_checkout_items").insert(rows);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    }
    return { id };
  });

export const deleteProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("properties").delete().eq("id", data.id);
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    return { ok: true };
  });
