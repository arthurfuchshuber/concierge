import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isAllowedIcalUrl } from "@/lib/airbnb-ical-url";

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
  collect_arrival_time: z.enum(["off", "optional", "required"]).default("off"),
  collect_vehicles: z.enum(["off", "optional", "required"]).default("off"),
  vehicles_max: z.number().int().min(0).max(10).default(2),
  collect_document: z.enum(["off", "optional", "required"]).default("off"),
  document_scope: z.enum(["main", "all"]).default("main"),
  airbnb_ical_url: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine(isHttpsUrl, "Use um link HTTPS válido")
      .refine(isAllowedIcalUrl, "Use um link iCal oficial do Airbnb")
      .optional()
      .nullable(),
  ),
  airbnb_listing_url: z.preprocess(
    (v) => {
      if (typeof v !== "string") return v;
      const s = v.trim();
      if (!s) return null;
      if (/^https?:\/\//i.test(s)) return s;
      return `https://${s.replace(/^\/+/, "")}`;
    },
    z.string().trim().url().max(2048).optional().nullable(),
  ),
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
    const { userId } = context;
    // CRÍTICO: filtrar explicitamente por owner_id do próprio usuário.
    // Sem este filtro, a RLS `user_can_access_property` também autoriza
    // propriedades de contas onde ele é membro — vazando guias de outras
    // contas quando nenhum "cliente" está selecionado no switcher.
    const { data, error } = await context.supabase
      .from("properties")
      .select("id, slug, name, tagline, hero_image_url, gallery_images, access_mode, pin_expires_at, published, city, country, address, lat, lng, updated_at, wifi_ssid, checkin_time, checkout_time")
      .eq("owner_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    const { signPropertyImages } = await import("@/lib/storage.server");
    return await signPropertyImages(context.supabase, data ?? []);
  });

// Lista as propriedades de uma conta específica que o usuário atual pode
// acessar via `account_members` (RLS `user_can_access_property` autoriza).
// Diferente de `adminListUserPropertiesFull`, não exige papel de admin SaaS —
// serve para atendentes/owners convidados navegando entre contas.
export const listPropertiesForAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ ownerId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("properties")
      .select("id, slug, name, tagline, hero_image_url, gallery_images, access_mode, pin_expires_at, published, city, country, address, lat, lng, updated_at, wifi_ssid, checkin_time, checkout_time")
      .eq("owner_id", data.ownerId)
      .order("updated_at", { ascending: false });
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    const { signPropertyImages } = await import("@/lib/storage.server");
    return await signPropertyImages(context.supabase, rows ?? []);
  });

// Versão leve: apenas os campos necessários para seleção de imóveis em UIs
// como o CopyRecsDialog. Não carrega imagens assinadas, reduz payload.
export const listMyPropertiesBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data, error } = await context.supabase
      .from("properties")
      .select("id, name, city, published")
      .eq("owner_id", userId)
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
  // Regras do espaço
  house_rules: z.string().max(3000).optional(),
  // Endereço e localização
  address: z.string().max(500).optional(),
  maps_url: HttpsUrl.optional(),
  garage_maps_url: HttpsUrl.optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(60).optional(),
  country: z.string().max(120).optional(),
  // Tipo do guia
  default_language: z.enum(["pt", "en"]).optional(),
  published: z.boolean().optional(),
  // Modo de acesso
  access_mode: z.enum(["public", "pin"]).optional(),
  pin_code: z.string().max(20).optional(),
  require_access_gate: z.boolean().optional(),
  collect_arrival_time: z.enum(["off", "optional", "required"]).optional(),
  collect_vehicles: z.enum(["off", "optional", "required"]).optional(),
  vehicles_max: z.number().int().min(0).max(10).optional(),
  collect_document: z.enum(["off", "optional", "required"]).optional(),
  document_scope: z.enum(["main", "all"]).optional(),
}).strict();

const BulkListsInput = z.object({
  manual: z.array(z.object({
    title: z.string().min(1).max(120),
    description: z.string().max(300).optional().nullable(),
    body: z.string().max(4000).optional().nullable(),
  })).max(40).optional(),
  emergency: z.array(z.object({
    label: z.string().min(1).max(120),
    number: z.string().min(1).max(40),
  })).max(20).optional(),
  faqs: z.array(z.object({
    question: z.string().min(1).max(200),
    answer: z.string().min(1).max(2000),
    tags: z.array(z.string().max(40)).max(8).default([]),
  })).max(40).optional(),
  checkout: z.array(z.object({
    label: z.string().min(1).max(200),
  })).max(40).optional(),
}).strict();

// Retorna o conteúdo atual dos guias selecionados para exibir preview
// no popup de edição em massa (valores por guia + contagem de listas).
export const bulkFetchProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const cols = [
      "id","name",
      ...Object.keys(BulkPatch.shape),
    ].join(",");
    const q = await sb
      .from("properties")
      .select(cols)
      .in("id", data.ids);
    if (q.error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", q.error);
    const rows = (q.data ?? []) as unknown as Array<{ id: string; name: string } & Record<string, string | number | boolean | null>>;
    const propIds = rows.map((r) => r.id);
    const [manual, emerg, faqs, checkout] = await Promise.all([
      sb.from("property_manual_items").select("property_id").in("property_id", propIds),
      sb.from("property_emergency_contacts").select("property_id").in("property_id", propIds),
      sb.from("property_faqs").select("property_id").in("property_id", propIds),
      sb.from("property_checkout_items").select("property_id").in("property_id", propIds),
    ]);
    function tally(arr: unknown): Record<string, number> {
      const m: Record<string, number> = {};
      for (const r of (arr as { property_id: string }[] | null) ?? [])
        m[r.property_id] = (m[r.property_id] ?? 0) + 1;
      return m;
    }
    return {
      properties: rows,
      listCounts: {
        manual: tally(manual.data),
        emergency: tally(emerg.data),
        faqs: tally(faqs.data),
        checkout: tally(checkout.data),
      },
    };
  });


export const bulkUpdateProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      ids: z.array(z.string().uuid()).min(1).max(200),
      patch: BulkPatch,
      lists: BulkListsInput.optional(),
      mode: z.enum(["overwrite", "fill-empty"]).default("overwrite"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const patch: Record<string, unknown> = Object.fromEntries(
      Object.entries(data.patch).map(([k, v]) => [k, v === "" ? null : v]),
    );
    const patchKeys = Object.keys(patch);
    const updatedSet = new Set<string>();

    function isEmpty(v: unknown): boolean {
      return v === null || v === undefined || v === "";
    }

    if (patchKeys.length > 0) {
      if (data.mode === "overwrite") {
        const { data: rows, error } = await sb
          .from("properties")
          .update(patch as never)
          .in("id", data.ids)
          .select("id");
        if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
        for (const r of rows ?? []) updatedSet.add((r as { id: string }).id);
      } else {
        // fill-empty: por campo, aplica apenas onde o valor atual está vazio.
        const cq = await sb
          .from("properties")
          .select(["id", ...patchKeys].join(","))
          .in("id", data.ids);
        if (cq.error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", cq.error);
        const current = (cq.data ?? []) as unknown as Array<{ id: string } & Record<string, unknown>>;
        for (const key of patchKeys) {
          const targetIds = current.filter((r) => isEmpty(r[key])).map((r) => r.id);
          if (!targetIds.length) continue;
          const { data: uRows, error: uErr } = await sb
            .from("properties")
            .update({ [key]: patch[key] } as never)
            .in("id", targetIds)
            .select("id");
          if (uErr) throw (await import("@/lib/db-errors.server")).safeDbError("properties", uErr);
          for (const r of (uRows ?? []) as unknown as Array<{ id: string }>) updatedSet.add(r.id);
        }
      }
    }

    // Listas
    const lists = data.lists;
    if (lists) {
      // Conta itens existentes por guia para respeitar "fill-empty"
      const listCounts: Record<string, Record<string, number>> = {};
      if (data.mode === "fill-empty") {
        const tables = [
          ["manual", "property_manual_items"],
          ["emergency", "property_emergency_contacts"],
          ["faqs", "property_faqs"],
          ["checkout", "property_checkout_items"],
        ] as const;
        for (const [key, table] of tables) {
          const { data: rows } = await sb.from(table).select("property_id").in("property_id", data.ids);
          const m: Record<string, number> = {};
          for (const r of rows ?? []) m[(r as { property_id: string }).property_id] = (m[(r as { property_id: string }).property_id] ?? 0) + 1;
          listCounts[key] = m;
        }
      }
      const listMap = [
        ["manual", "property_manual_items"],
        ["emergency", "property_emergency_contacts"],
        ["faqs", "property_faqs"],
        ["checkout", "property_checkout_items"],
      ] as const;

      for (const id of data.ids) {
        for (const [key, table] of listMap) {
          const items = (lists as Record<string, unknown[]>)[key];
          if (items === undefined) continue;
          if (data.mode === "fill-empty" && (listCounts[key]?.[id] ?? 0) > 0) continue;
          await sb.from(table).delete().eq("property_id", id);
          if (items.length) {
            const rows = items.map((m, i) => ({ ...(m as object), property_id: id, position: i }));
            await sb.from(table).insert(rows as never);
          }
          updatedSet.add(id);
        }
      }
    }
    return { updated: updatedSet.size };
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
  ownerId: z.string().uuid().optional().nullable(),
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
    tags: z.array(z.string().max(40)).max(8).default([]),
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
    const { resolveEffectivePlan, assertCanCreateGuide } = await import("@/lib/plan-guard.server");
    let propertyId = data.id ?? null;

    // Descobre o dono efetivo (para membros de equipe editando propriedades
    // do dono da conta, o plano relevante é o do DONO — não do caller).
    let effectiveOwnerId: string = userId;
    if (propertyId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: existing } = await supabaseAdmin
        .from("properties")
        .select("owner_id")
        .eq("id", propertyId)
        .maybeSingle();
      if (existing?.owner_id) effectiveOwnerId = existing.owner_id as string;
    } else if (data.ownerId && data.ownerId !== userId) {
      effectiveOwnerId = data.ownerId;
    } else if (!data.ownerId) {
      // Fallback para membros puros de equipe: se o usuário não possui guias
      // próprios e tem permissão explícita de criar/editar em exatamente uma
      // conta, a criação deve cair nessa conta. Isso evita que um admin SaaS
      // que também é membro fique preso na regra global de somente leitura.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: ownedProps }, { data: memberships }] = await Promise.all([
        supabaseAdmin.from("properties").select("id").eq("owner_id", userId).limit(1),
        supabaseAdmin
          .from("account_members")
          .select("owner_id")
          .eq("member_user_id", userId)
          .eq("status", "active"),
      ]);
      const ownerIds = Array.from(new Set((memberships ?? []).map((m) => m.owner_id as string)));
      if ((ownedProps ?? []).length === 0 && ownerIds.length > 0) {
        const { data: editRows } = await supabaseAdmin
          .from("account_member_permissions")
          .select("owner_id")
          .eq("member_user_id", userId)
          .eq("permission", "library_edit")
          .eq("granted", true)
          .in("owner_id", ownerIds);
        const editableOwnerIds = Array.from(new Set((editRows ?? []).map((r) => r.owner_id as string)));
        if (editableOwnerIds.length === 1) effectiveOwnerId = editableOwnerIds[0];
      }
    }

    const plan = await resolveEffectivePlan(supabase, userId, { ownerId: effectiveOwnerId });

    // Strip Business-only fields when the effective plan doesn't include white-label.
    const propertyData = { ...data.property };
    if (!plan.features.customBrand) {
      propertyData.brand_name = null;
      propertyData.brand_logo_url = null;
    }

    // Quando o operador é membro atuando dentro de outra conta, valida a
    // permissão `library_edit` e escreve com o cliente admin (as policies
    // RLS de properties/child tables permitem apenas o titular ou admin).
    const actingAsMember = effectiveOwnerId !== userId;
    let writeClient: typeof supabase = supabase;
    if (actingAsMember) {
      const { requireMemberPermission } = await import("@/lib/member-permissions.server");
      await requireMemberPermission(supabase, userId, effectiveOwnerId, "library_edit");
      writeClient = (await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as typeof supabase;
    }

    if (propertyId) {
      const { error } = await writeClient
        .from("properties")
        .update(propertyData)
        .eq("id", propertyId);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    } else {
      await assertCanCreateGuide(supabase, userId, { ownerId: effectiveOwnerId });
      const { data: inserted, error } = await writeClient
        .from("properties")
        .insert({ ...propertyData, owner_id: effectiveOwnerId })
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

    // Replace child tables wholesale (simpler than diff).
    if (!propertyId) throw new Error("Não foi possível salvar o guia.");
    const id = propertyId;
    await Promise.all([
      writeClient.from("property_recommendations").delete().eq("property_id", id),
      writeClient.from("property_manual_items").delete().eq("property_id", id),
      writeClient.from("property_emergency_contacts").delete().eq("property_id", id),
      writeClient.from("property_faqs").delete().eq("property_id", id),
      writeClient.from("property_checkout_items").delete().eq("property_id", id),
    ]);

    if (data.recommendations.length) {
      const rows = data.recommendations.map((r, i) => ({ ...r, property_id: id, position: i }));
      const { error } = await writeClient.from("property_recommendations").insert(rows);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    }
    if (data.manual.length) {
      const rows = data.manual.map((m, i) => ({ ...m, property_id: id, position: i }));
      const { error } = await writeClient.from("property_manual_items").insert(rows);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    }
    if (data.emergency.length) {
      const rows = data.emergency.map((m, i) => ({ ...m, property_id: id, position: i }));
      const { error } = await writeClient.from("property_emergency_contacts").insert(rows);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    }
    if (data.faqs.length) {
      const rows = data.faqs.map((m, i) => ({ ...m, property_id: id, position: i }));
      const { error } = await writeClient.from("property_faqs").insert(rows);
      if (error) throw (await import("@/lib/db-errors.server")).safeDbError("properties", error);
    }
    if (data.checkout.length) {
      const rows = data.checkout.map((m, i) => ({ ...m, property_id: id, position: i }));
      const { error } = await writeClient.from("property_checkout_items").insert(rows);
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

// ---- DUPLICATE PROPERTY -------------------------------------------------
// Duplicates a property (and all its child tables) N times for the same owner.
// Enforces the plan's max-guides quota — refuses to create more copies than
// the remaining allowance and reports how many were created vs. skipped.
export const duplicateProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      id: z.string().uuid(),
      copies: z.number().int().min(1).max(20),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveEffectivePlan } = await import("@/lib/plan-guard.server");

    // Load source first — the effective owner may be the account owner (not the caller).
    const { data: src, error: srcErr } = await supabase
      .from("properties")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (srcErr) throw (await import("@/lib/db-errors.server")).safeDbError("properties", srcErr);
    if (!src) throw new Error("Guia de origem não encontrado.");
    const sourceOwnerId = (src as { owner_id: string }).owner_id;

    // Plan gate — usa o plano do DONO da propriedade fonte (para membros de equipe).
    const plan = await resolveEffectivePlan(supabase, userId, { ownerId: sourceOwnerId });
    if (!plan.plan) {
      throw new Error("Você precisa de um plano ativo para duplicar guias.");
    }
    const { count: currentCount, error: countErr } = await supabaseAdmin
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", sourceOwnerId);
    if (countErr) throw new Error("Não foi possível verificar seu limite de guias.");
    const used = currentCount ?? 0;
    const remaining = Math.max(0, plan.maxGuides - used);
    if (remaining <= 0) {
      throw new Error(
        `Limite do plano ${plan.plan} atingido (${plan.maxGuides}). Faça upgrade em /precos.`,
      );
    }
    const toCreate = Math.min(data.copies, remaining);
    const skipped = data.copies - toCreate;


    const [manual, recs, emerg, faqs, checkout] = await Promise.all([
      supabaseAdmin.from("property_manual_items").select("*").eq("property_id", data.id).order("position"),
      supabaseAdmin.from("property_recommendations").select("*").eq("property_id", data.id).order("position"),
      supabaseAdmin.from("property_emergency_contacts").select("*").eq("property_id", data.id).order("position"),
      supabaseAdmin.from("property_faqs").select("*").eq("property_id", data.id).order("position"),
      supabaseAdmin.from("property_checkout_items").select("*").eq("property_id", data.id).order("position"),
    ]);

    // Strip fields that must NOT be copied verbatim.
    const stripped = { ...(src as Record<string, unknown>) };
    delete stripped.id;
    delete stripped.created_at;
    delete stripped.updated_at;
    delete stripped.slug;
    delete stripped.name;
    delete stripped.owner_id;

    const baseSlug = (src as { slug: string }).slug;
    const baseName = (src as { name: string }).name;
    const createdIds: string[] = [];

    // Fetch existing slugs starting with baseSlug once, to find free suffixes.
    // Use admin client to bypass RLS — the `slug` uniqueness constraint is
    // global across all owners, so we must see slugs owned by other users too.
    const { data: existing } = await supabaseAdmin
      .from("properties")
      .select("slug")
      .like("slug", `${baseSlug}-copia%`);
    const taken = new Set<string>(((existing ?? []) as Array<{ slug: string }>).map((r) => r.slug));


    function nextSlug(): string {
      let n = 1;
      while (true) {
        const candidate = n === 1 ? `${baseSlug}-copia` : `${baseSlug}-copia-${n}`;
        if (!taken.has(candidate)) {
          taken.add(candidate);
          return candidate;
        }
        n += 1;
      }
    }

    for (let i = 0; i < toCreate; i++) {
      const newSlug = nextSlug();
      const suffix = createdIds.length === 0 ? " (cópia)" : ` (cópia ${createdIds.length + 1})`;
      const newName = `${baseName}${suffix}`;

      const { data: inserted, error: insErr } = await supabase
        .from("properties")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({ ...(stripped as any), owner_id: sourceOwnerId, slug: newSlug, name: newName, published: false })
        .select("id")
        .single();
      if (insErr) throw (await import("@/lib/db-errors.server")).safeDbError("properties", insErr);
      const newId = (inserted as { id: string }).id;
      createdIds.push(newId);

      // Copy child tables via admin (owner_id is inherited via property_id + RLS).
      const cloneRows = (
        rows: unknown[] | null | undefined,
      ): Array<Record<string, unknown>> =>
        (rows ?? []).map((r) => {
          const row = { ...(r as Record<string, unknown>) };
          delete row.id;
          delete row.created_at;
          delete row.updated_at;
          row.property_id = newId;
          return row;
        });

      const manualRows = cloneRows(manual.data);
      const recsRows = cloneRows(recs.data);
      const emergRows = cloneRows(emerg.data);
      const faqsRows = cloneRows(faqs.data);
      const checkoutRows = cloneRows(checkout.data);

      await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        manualRows.length ? supabaseAdmin.from("property_manual_items").insert(manualRows as any) : Promise.resolve(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recsRows.length ? supabaseAdmin.from("property_recommendations").insert(recsRows as any) : Promise.resolve(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        emergRows.length ? supabaseAdmin.from("property_emergency_contacts").insert(emergRows as any) : Promise.resolve(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        faqsRows.length ? supabaseAdmin.from("property_faqs").insert(faqsRows as any) : Promise.resolve(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        checkoutRows.length ? supabaseAdmin.from("property_checkout_items").insert(checkoutRows as any) : Promise.resolve(),
      ]);
    }

    return { created: createdIds.length, skipped, requested: data.copies, remainingBefore: remaining };
  });
