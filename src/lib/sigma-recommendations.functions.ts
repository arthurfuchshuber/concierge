import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { cityKey as makeCityKey } from "@/lib/city-key";

// ---------- helpers ----------
function publicClient() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

async function assertAdmin(ctx: { supabase: ReturnType<typeof createClient<Database>>; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Acesso restrito a administradores.");
}

// ---------- types ----------
export type SigmaPack = {
  id: string;
  city_key: string;
  city_label: string;
  country: string | null;
  cover_url: string | null;
  is_published: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SigmaRec = {
  id: string;
  city_key: string;
  type: string;
  name: string;
  category: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  note: string | null;
  image_url: string | null;
  maps_url: string | null;
  place_id: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  opening_hours: string[] | null;
  position: number;
};

export type SigmaMarketplace = {
  id: string;
  city_key: string;
  label: string;
  url: string;
  description: string | null;
  position: number;
};

export type SigmaFaq = {
  id: string;
  city_key: string;
  question: string;
  answer: string;
  tags: string[];
  position: number;
};

// ============== PUBLIC READERS ==============
export const listPublishedSigmaPacks = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data, error } = await sb
    .from("sigma_city_packs")
    .select("*")
    .eq("is_published", true)
    .order("city_label");
  if (error) throw new Error(error.message);
  return (data ?? []) as SigmaPack[];
});

export const getPublicSigmaPack = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ city_key: z.string() }).parse(i))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const [pack, recs, mkt, faqs] = await Promise.all([
      sb.from("sigma_city_packs").select("*").eq("city_key", data.city_key).eq("is_published", true).maybeSingle(),
      sb.from("sigma_city_recommendations").select("*").eq("city_key", data.city_key).order("position"),
      sb.from("sigma_city_marketplace").select("*").eq("city_key", data.city_key).order("position"),
      sb.from("sigma_city_faqs").select("*").eq("city_key", data.city_key).order("position"),
    ]);
    if (!pack.data) return null;
    return {
      pack: pack.data as SigmaPack,
      recs: (recs.data ?? []) as SigmaRec[],
      marketplace: (mkt.data ?? []) as SigmaMarketplace[],
      faqs: (faqs.data ?? []) as SigmaFaq[],
    };
  });

// ============== ADMIN — PACK CRUD ==============
export const listAllSigmaPacks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    // counts per city via aggregates
    const [packs, recs, mkt, faqs] = await Promise.all([
      context.supabase.from("sigma_city_packs").select("*").order("city_label"),
      context.supabase.from("sigma_city_recommendations").select("city_key"),
      context.supabase.from("sigma_city_marketplace").select("city_key"),
      context.supabase.from("sigma_city_faqs").select("city_key"),
    ]);
    if (packs.error) throw new Error(packs.error.message);
    const count = (rows: { city_key: string }[] | null) => {
      const m = new Map<string, number>();
      (rows ?? []).forEach((r) => m.set(r.city_key, (m.get(r.city_key) ?? 0) + 1));
      return m;
    };
    const rc = count(recs.data as { city_key: string }[]);
    const mc = count(mkt.data as { city_key: string }[]);
    const fc = count(faqs.data as { city_key: string }[]);
    // adoption: properties using each city_key
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: adoption } = await supabaseAdmin
      .from("properties")
      .select("sigma_pack_city_key")
      .not("sigma_pack_city_key", "is", null);
    const ac = new Map<string, number>();
    (adoption ?? []).forEach((p) => {
      const k = (p as { sigma_pack_city_key: string }).sigma_pack_city_key;
      ac.set(k, (ac.get(k) ?? 0) + 1);
    });
    return ((packs.data ?? []) as SigmaPack[]).map((p) => ({
      ...p,
      recs_count: rc.get(p.city_key) ?? 0,
      marketplace_count: mc.get(p.city_key) ?? 0,
      faqs_count: fc.get(p.city_key) ?? 0,
      adoption_count: ac.get(p.city_key) ?? 0,
    }));
  });

export const createSigmaPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      city_label: z.string().min(1).max(120),
      country: z.string().max(120).optional().nullable(),
      cover_url: z.string().url().optional().nullable(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const key = makeCityKey(data.city_label);
    if (!key) throw new Error("Nome da cidade inválido.");
    const { data: row, error } = await context.supabase
      .from("sigma_city_packs")
      .insert({
        city_key: key,
        city_label: data.city_label.trim(),
        country: data.country ?? null,
        cover_url: data.cover_url ?? null,
        is_published: false,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as SigmaPack;
  });

export const updateSigmaPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      city_key: z.string(),
      patch: z.object({
        city_label: z.string().min(1).max(120).optional(),
        country: z.string().max(120).nullable().optional(),
        cover_url: z.string().url().nullable().optional(),
        is_published: z.boolean().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("sigma_city_packs")
      .update(data.patch)
      .eq("city_key", data.city_key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSigmaPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ city_key: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Detach any property using this pack
    await supabaseAdmin
      .from("properties")
      .update({ sigma_pack_city_key: null, sigma_pack_activated_at: null })
      .eq("sigma_pack_city_key", data.city_key);
    const { error } = await context.supabase.from("sigma_city_packs").delete().eq("city_key", data.city_key);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== ADMIN — get full pack for editor ==============
export const adminGetSigmaPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ city_key: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const [pack, recs, mkt, faqs] = await Promise.all([
      context.supabase.from("sigma_city_packs").select("*").eq("city_key", data.city_key).maybeSingle(),
      context.supabase.from("sigma_city_recommendations").select("*").eq("city_key", data.city_key).order("position"),
      context.supabase.from("sigma_city_marketplace").select("*").eq("city_key", data.city_key).order("position"),
      context.supabase.from("sigma_city_faqs").select("*").eq("city_key", data.city_key).order("position"),
    ]);
    if (!pack.data) throw new Error("Cidade não encontrada.");
    return {
      pack: pack.data as SigmaPack,
      recs: (recs.data ?? []) as SigmaRec[],
      marketplace: (mkt.data ?? []) as SigmaMarketplace[],
      faqs: (faqs.data ?? []) as SigmaFaq[],
    };
  });

// ============== ADMIN — child CRUD ==============
const RecPayload = z.object({
  city_key: z.string(),
  type: z.string().max(80),
  name: z.string().min(1).max(200),
  category: z.string().max(120).nullable().optional(),
  rating: z.number().nullable().optional(),
  user_ratings_total: z.number().int().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  maps_url: z.string().url().nullable().optional(),
  place_id: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  opening_hours: z.array(z.string()).nullable().optional(),
});
export const addSigmaRec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RecPayload.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.place_id) {
      const { data: dup } = await context.supabase
        .from("sigma_city_recommendations")
        .select("id")
        .eq("city_key", data.city_key)
        .eq("place_id", data.place_id)
        .maybeSingle();
      if (dup) return { id: dup.id, duplicate: true };
    }
    const { data: row, error } = await context.supabase
      .from("sigma_city_recommendations")
      .insert(data)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, duplicate: false };
  });

export const updateSigmaRec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), patch: z.record(z.string(), z.unknown()) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("sigma_city_recommendations")
      .update(data.patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSigmaRecs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("sigma_city_recommendations").delete().in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const MktPayload = z.object({
  city_key: z.string(),
  label: z.string().min(1).max(120),
  url: z.string().url(),
  description: z.string().max(500).nullable().optional(),
});
export const addSigmaMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => MktPayload.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase
      .from("sigma_city_marketplace").insert(data).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });
export const updateSigmaMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), patch: z.record(z.string(), z.unknown()) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("sigma_city_marketplace").update(data.patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const deleteSigmaMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("sigma_city_marketplace").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const FaqPayload = z.object({
  city_key: z.string(),
  question: z.string().min(1).max(300),
  answer: z.string().min(1).max(3000),
  tags: z.array(z.string()).default([]),
});
export const addSigmaFaq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => FaqPayload.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase.from("sigma_city_faqs").insert(data).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });
export const updateSigmaFaq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), patch: z.record(z.string(), z.unknown()) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("sigma_city_faqs").update(data.patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const deleteSigmaFaq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("sigma_city_faqs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== USER — ACTIVATE/DEACTIVATE on own property ==============
export const getMyPropertySigmaState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ property_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: prop } = await context.supabase
      .from("properties")
      .select("id, city, sigma_pack_city_key, sigma_pack_activated_at")
      .eq("id", data.property_id)
      .maybeSingle();
    if (!prop) throw new Error("Imóvel não encontrado.");
    const propRow = prop as { id: string; city: string | null; sigma_pack_city_key: string | null; sigma_pack_activated_at: string | null };
    const expectedKey = makeCityKey(propRow.city ?? "");
    // Look up available pack for the property city (only published)
    const sb = publicClient();
    const { data: pack } = await sb
      .from("sigma_city_packs")
      .select("city_key, city_label, country, cover_url")
      .eq("city_key", expectedKey)
      .eq("is_published", true)
      .maybeSingle();
    let counts: { recs: number; marketplace: number; faqs: number } | null = null;
    if (pack) {
      const [r, m, f] = await Promise.all([
        sb.from("sigma_city_recommendations").select("id", { count: "exact", head: true }).eq("city_key", pack.city_key),
        sb.from("sigma_city_marketplace").select("id", { count: "exact", head: true }).eq("city_key", pack.city_key),
        sb.from("sigma_city_faqs").select("id", { count: "exact", head: true }).eq("city_key", pack.city_key),
      ]);
      counts = { recs: r.count ?? 0, marketplace: m.count ?? 0, faqs: f.count ?? 0 };
    }
    return {
      property_id: propRow.id,
      city: propRow.city,
      active_city_key: propRow.sigma_pack_city_key,
      activated_at: propRow.sigma_pack_activated_at,
      available_pack: pack ?? null,
      counts,
    };
  });

export const activateSigmaPackOnProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ property_id: z.string().uuid(), city_key: z.string() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // Verify ownership via RLS by selecting the property
    const { data: prop, error: propErr } = await context.supabase
      .from("properties")
      .select("id, marketplace_links")
      .eq("id", data.property_id)
      .maybeSingle();
    if (propErr || !prop) throw new Error("Imóvel não encontrado.");

    const sb = publicClient();
    const { data: pack } = await sb
      .from("sigma_city_packs")
      .select("city_key")
      .eq("city_key", data.city_key)
      .eq("is_published", true)
      .maybeSingle();
    if (!pack) throw new Error("Recomendação SigmaGuide indisponível para esta cidade.");

    // Snapshot current marketplace links so we can restore on deactivate.
    const snapshot = {
      marketplace_links: (prop as { marketplace_links: unknown }).marketplace_links ?? [],
    };
    const { error } = await context.supabase
      .from("properties")
      .update({
        sigma_pack_city_key: data.city_key,
        sigma_pack_activated_at: new Date().toISOString(),
        sigma_pack_snapshot: snapshot as never,
      })
      .eq("id", data.property_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deactivateSigmaPackOnProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ property_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: prop } = await context.supabase
      .from("properties")
      .select("sigma_pack_snapshot")
      .eq("id", data.property_id)
      .maybeSingle();
    const snap = (prop as { sigma_pack_snapshot: { marketplace_links?: unknown[] } | null } | null)?.sigma_pack_snapshot;
    const patch: Record<string, unknown> = {
      sigma_pack_city_key: null,
      sigma_pack_activated_at: null,
      sigma_pack_snapshot: null,
    };
    if (snap && Array.isArray(snap.marketplace_links)) {
      patch.marketplace_links = snap.marketplace_links;
    }
    const { error } = await context.supabase
      .from("properties")
      .update(patch as never)
      .eq("id", data.property_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
