import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const slugRe = /^[a-z0-9](?:[a-z0-9-]{1,60}[a-z0-9])?$/;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const HttpsUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().url().max(2048).refine(isHttpsUrl, "Use um link HTTPS válido").optional().nullable(),
);

// Aceita URL HTTPS absoluta OU caminho relativo interno (ex.: /api/public/place-photo?...)
// usado para fotos do Google Places servidas via proxy do próprio app.
const ImageUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string()
    .trim()
    .max(2048)
    .refine(
      (v) => v.startsWith("/") || isHttpsUrl(v),
      "Use um link HTTPS válido ou um caminho interno (/api/...)",
    )
    .optional()
    .nullable(),
);

const PropertyInput = z.object({
  name: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(200).optional().nullable(),
  slug: z.string().regex(slugRe, "Slug inválido (use letras minúsculas, números e hífens)"),
  hero_image_url: HttpsUrl,
  gallery_images: z.array(z.string().trim().url().max(2048).refine(isHttpsUrl, "Use um link HTTPS válido")).max(4).default([]),
  theme_images: z.object({
    checkin: HttpsUrl,
    residencia: HttpsUrl,
    faq: HttpsUrl,
    explore: HttpsUrl,
  }).partial().default({}),
  marketplace_links: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    url: z.string().trim().url().max(2048).refine(isHttpsUrl, "Use um link HTTPS válido"),
    description: z.string().trim().max(280).optional().nullable(),
  })).max(20).default([]),
  address: z.string().max(500).optional().nullable(),
  maps_url: HttpsUrl,
  garage_maps_url: HttpsUrl,
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(60).optional().nullable(),
  country: z.string().max(120).optional().nullable(),
  checkin_time: z.string().max(8).optional().nullable(),
  checkin_time_max: z.string().max(8).optional().nullable(),
  checkin_note: z.string().max(1000).optional().nullable(),
  checkout_time: z.string().max(8).optional().nullable(),
  checkout_time_min: z.string().max(8).optional().nullable(),
  checkout_note: z.string().max(1000).optional().nullable(),
  lock_code: z.string().max(40).optional().nullable(),
  lock_label: z.string().max(40).optional().nullable(),
  gate_code: z.string().max(40).optional().nullable(),
  gate_label: z.string().max(40).optional().nullable(),
  access_codes_pin: z.string().max(20).optional().nullable(),
  address_note: z.string().max(1000).optional().nullable(),
  checkin_instructions: z.string().max(3000).optional().nullable(),
  checkout_instructions: z.string().max(3000).optional().nullable(),
  house_rules: z.string().max(3000).optional().nullable(),
  checkin_media: z.array(z.object({
    url: z.string().trim().url().max(2048).refine(isHttpsUrl, "Use um link HTTPS válido"),
    type: z.enum(["image", "video"]),
  })).max(8).default([]),
  gate_instructions: z.string().max(3000).optional().nullable(),
  gate_media: z.array(z.object({
    url: z.string().trim().url().max(2048).refine(isHttpsUrl, "Use um link HTTPS válido"),
    type: z.enum(["image", "video"]),
  })).max(8).default([]),
  gate_video_url: HttpsUrl,
  lock_instructions: z.string().max(3000).optional().nullable(),
  lock_media: z.array(z.object({
    url: z.string().trim().url().max(2048).refine(isHttpsUrl, "Use um link HTTPS válido"),
    type: z.enum(["image", "video"]),
  })).max(8).default([]),
  lock_video_url: HttpsUrl,
  wifi_ssid: z.string().max(64).optional().nullable(),
  wifi_password: z.string().max(64).optional().nullable(),
  host_name: z.string().max(120).optional().nullable(),
  host_phone: z.string().max(40).optional().nullable(),
  brand_name: z.string().max(120).optional().nullable(),
  brand_logo_url: HttpsUrl,
  access_mode: z.enum(["public", "pin"]).default("public"),
  pin_code: z.string().max(20).optional().nullable(),
  pin_expires_at: z.string().datetime().optional().nullable(),
  default_language: z.enum(["pt", "en"]).default("pt"),
  guide_theme: z.enum(["dark", "light"]).default("dark"),
  published: z.boolean().default(true),
  require_access_gate: z.boolean().default(false),
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
  walk_minutes: z.number().int().optional().nullable(),
  opening_hours: z.array(z.string().max(200)).max(14).optional().nullable(),

  note: z.string().max(1000).optional().nullable(),
  image_url: ImageUrl,
  maps_url: HttpsUrl,
  place_id: z.string().max(200).optional().nullable(),
});


export const listMyProperties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("properties")
      .select("id, slug, name, tagline, hero_image_url, gallery_images, access_mode, pin_expires_at, published, city, country, address, lat, lng, updated_at, wifi_ssid, checkin_time, checkout_time")
      .order("updated_at", { ascending: false });
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    const { signPropertyImages } = await import("@/lib/storage.server");
    return await signPropertyImages(context.supabase, data ?? []);
  });

// Versão leve: apenas os campos necessários para seleção de imóveis em UIs
// como o CopyRecsDialog. Não carrega imagens assinadas, reduz payload.
export const listMyPropertiesBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("properties")
      .select("id, name, city, published")
      .order("name", { ascending: true });
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    return (data ?? []) as Array<{ id: string; name: string; city: string | null; published: boolean }>;
  });

const BulkPatch = z.object({
  checkin_time: z.string().max(8).optional(),
  checkin_time_max: z.string().max(8).optional(),
  checkin_note: z.string().max(1000).optional(),
  checkout_time: z.string().max(8).optional(),
  checkout_time_min: z.string().max(8).optional(),
  checkout_note: z.string().max(1000).optional(),
  address_note: z.string().max(1000).optional(),
  checkin_instructions: z.string().max(3000).optional(),
  checkout_instructions: z.string().max(3000).optional(),
  gate_code: z.string().max(40).optional(),
  gate_label: z.string().max(40).optional(),
  gate_instructions: z.string().max(3000).optional(),
  lock_code: z.string().max(40).optional(),
  lock_label: z.string().max(40).optional(),
  lock_instructions: z.string().max(3000).optional(),
  access_codes_pin: z.string().max(20).optional(),
  wifi_ssid: z.string().max(64).optional(),
  wifi_password: z.string().max(64).optional(),
  host_name: z.string().max(120).optional(),
  host_phone: z.string().max(40).optional(),
  brand_name: z.string().max(120).optional(),
  brand_logo_url: HttpsUrl.optional(),
  guide_theme: z.enum(["dark", "light"]).optional(),
}).strict();

export const bulkUpdateProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      ids: z.array(z.string().uuid()).min(1).max(200),
      patch: BulkPatch,
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, string | null> = Object.fromEntries(
      Object.entries(data.patch).map(([k, v]) => [k, v === "" ? null : (v as string)]),
    );
    if (Object.keys(patch).length === 0) {
      return { updated: 0 };
    }
    // RLS automatically scopes to owner_id = auth.uid()
    const { data: rows, error } = await context.supabase
      .from("properties")
      .update(patch as never)
      .in("id", data.ids)
      .select("id");
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    return { updated: rows?.length ?? 0 };
  });

export const getMyProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const [p, manual, recs, emerg, faqs, checkout] = await Promise.all([
      context.supabase.from("properties").select("*").eq("id", data.id).maybeSingle(),
      context.supabase.from("property_manual_items").select("*").eq("property_id", data.id).order("position"),
      context.supabase.from("property_recommendations").select("*").eq("property_id", data.id).order("scope").order("type").order("position"),
      context.supabase.from("property_emergency_contacts").select("*").eq("property_id", data.id).order("position"),
      context.supabase.from("property_faqs").select("*").eq("property_id", data.id).order("position"),
      context.supabase.from("property_checkout_items").select("*").eq("property_id", data.id).order("position"),
    ]);
    if (p.error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", p.error);
    if (!p.data) throw new Error("Guia não encontrado.");
    const { signPropertyImages } = await import("@/lib/storage.server");
    const property = await signPropertyImages(context.supabase, p.data);
    return {
      property,
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
  recommendations: z.array(RecInput).max(2000).default([]),
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
    tags: z.array(z.enum(["chegada", "saida", "residencia", "explore"])).max(4).default([]),
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
    const { resolveUserPlan, assertCanCreateGuide } = await import("@/lib/plan-guard.server");
    const plan = await resolveUserPlan(supabase, userId);
    let propertyId = data.id ?? null;

    // Strip Business-only fields when the user is not on Business.
    const propertyData = { ...data.property };
    if (!plan.features.customBrand) {
      propertyData.brand_name = null;
      propertyData.brand_logo_url = null;
    }


    if (propertyId) {
      const { error } = await supabase
        .from("properties")
        .update(propertyData)
        .eq("id", propertyId);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    } else {
      // Enforce per-plan quota on creation.
      await assertCanCreateGuide(supabase, userId);
      const { data: inserted, error } = await supabase
        .from("properties")
        .insert({ ...propertyData, owner_id: userId })
        .select("id")
        .single();
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
      propertyId = inserted.id;

      // Auto-generate default FAQs on first creation when the user didn't
      // provide any. Only fields that are actually filled produce a question.
      if (!data.faqs.length) {
        const { buildDefaultFaqs } = await import("@/lib/default-faqs");
        const defaults = buildDefaultFaqs(propertyData);
        if (defaults.length) {
          data.faqs = defaults.map((f) => ({
            question: f.question,
            answer: f.answer,
            tags: f.tags,
          }));
        }
      }
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

// ---- COPY CITY RECS TO OTHER PROPERTIES --------------------------------
// Copia recomendações "Pela cidade" (scope=city) de um imóvel para outros
// imóveis do mesmo usuário. Substitui apenas as recs de scope "city" nos
// destinos, mantendo as "nearby" intactas.
export const copyCityRecsToProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      sourcePropertyId: z.string().uuid(),
      targetPropertyIds: z.array(z.string().uuid()).min(1).max(50),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // Usa supabaseAdmin para garantir permissão de leitura/escrita
    // em property_recommendations de outros imóveis do mesmo dono.
    // O cliente RLS do usuário (context.supabase) pode não ter acesso
    // a rows de outros imóveis dependendo das policies configuradas.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verifica que o usuário autenticado é dono do imóvel fonte
    const { data: src, error: srcErr } = await supabaseAdmin
      .from("properties")
      .select("id, owner_id")
      .eq("id", data.sourcePropertyId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (srcErr || !src) throw new Error("Imóvel de origem não encontrado ou sem permissão.");

    // Busca as recs "Pela cidade" do imóvel fonte
    const { data: cityRecs, error: recsErr } = await supabaseAdmin
      .from("property_recommendations")
      .select("*")
      .eq("property_id", data.sourcePropertyId)
      .eq("scope", "city");
    if (recsErr) throw new Error("Erro ao buscar recomendações.");
    const recs = cityRecs ?? [];

    // Garante que os destinos pertencem ao mesmo usuário autenticado
    const { data: targets, error: tgtErr } = await supabaseAdmin
      .from("properties")
      .select("id")
      .in("id", data.targetPropertyIds)
      .eq("owner_id", (src as { owner_id: string }).owner_id);
    if (tgtErr || !targets || targets.length === 0)
      throw new Error("Nenhum imóvel destino válido encontrado.");

    let copied = 0;
    for (const target of targets as Array<{ id: string }>) {
      // Remove recs "city" existentes no destino
      await supabaseAdmin
        .from("property_recommendations")
        .delete()
        .eq("property_id", target.id)
        .eq("scope", "city");

      if (recs.length > 0) {
        const rows = recs.map((r, i) => {
          const rec = r as Record<string, unknown>;
          return {
            property_id: target.id,
            scope: rec.scope,
            type: rec.type,
            name: rec.name,
            category: rec.category ?? null,
            rating: rec.rating ?? null,
            user_ratings_total: rec.user_ratings_total ?? null,
            distance_text: rec.distance_text ?? null,
            distance_meters: rec.distance_meters ?? null,
            drive_minutes: rec.drive_minutes ?? null,
            walk_minutes: rec.walk_minutes ?? null,
            opening_hours: rec.opening_hours ?? null,
            note: rec.note ?? null,
            image_url: rec.image_url ?? null,
            maps_url: rec.maps_url ?? null,
            place_id: rec.place_id ?? null,
            position: i,
          };
        });
        const { error: insErr } = await supabaseAdmin
          .from("property_recommendations")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .insert(rows as any);
        if (!insErr) copied += 1;
      } else {
        copied += 1;
      }
    }

    return { copied, total: targets.length };
  });
