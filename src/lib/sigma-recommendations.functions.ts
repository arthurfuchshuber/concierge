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

export type AdminSigmaConciergeRow = {
  id: string;
  name: string;
  slug: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  owner_id: string;
  owner_email: string | null;
  updated_at: string | null;
  hero_image_url: string | null;
  sigma_pack_city_key: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolvePropertySigmaScope(supabaseAdmin: any, propertyId: string) {
  const { data: membership } = await supabaseAdmin
    .from("city_reference_group_members")
    .select("group_id")
    .eq("property_id", propertyId)
    .maybeSingle();
  return { groupId: (membership?.group_id as string | null) ?? null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readScopedCityReferences(supabaseAdmin: any, propertyId: string) {
  const scope = await resolvePropertySigmaScope(supabaseAdmin, propertyId);
  let q = supabaseAdmin.from("city_references").select("*");
  if (scope.groupId) q = q.eq("group_id", scope.groupId);
  else q = q.eq("property_id", propertyId).is("group_id", null);
  const { data, error } = await q.order("display_order");
  if (error) throw new Error(error.message);
  return { scope, rows: data ?? [] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function replaceScopedCityReferences(supabaseAdmin: any, propertyId: string, rows: Array<Record<string, unknown>>) {
  const scope = await resolvePropertySigmaScope(supabaseAdmin, propertyId);
  let del = supabaseAdmin.from("city_references").delete();
  if (scope.groupId) del = del.eq("group_id", scope.groupId);
  else del = del.eq("property_id", propertyId).is("group_id", null);
  const { error: delErr } = await del;
  if (delErr) throw new Error(delErr.message);

  if (!rows.length) return;
  const cleaned = rows.map((r, idx) => {
    const {
      id: _id,
      created_at: _created,
      updated_at: _updated,
      property_id: _propertyId,
      group_id: _groupId,
      ...rest
    } = r;
    void _id; void _created; void _updated; void _propertyId; void _groupId;
    return {
      ...rest,
      property_id: scope.groupId ? null : propertyId,
      group_id: scope.groupId,
      display_order: typeof rest.display_order === "number" ? rest.display_order : idx,
    };
  });
  const { error: insErr } = await supabaseAdmin.from("city_references").insert(cleaned as never);
  if (insErr) throw new Error(insErr.message);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applySigmaPackToPropertyInternal(supabaseAdmin: any, propertyId: string, cityKey: string) {
  const { data: prop } = await supabaseAdmin
    .from("properties")
    .select("id, owner_id, city, state, country, marketplace_links")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) throw new Error("Imóvel não encontrado.");
  const propRow = prop as { id: string; owner_id: string; city: string | null; state: string | null; country: string | null; marketplace_links: unknown };
  if (makeCityKey(propRow.city ?? "") !== cityKey) {
    throw new Error("Este guia não pertence à mesma cidade desta recomendação SigmaConcierge.");
  }

  const { data: pack } = await supabaseAdmin
    .from("sigma_city_packs")
    .select("city_key, city_label, country")
    .eq("city_key", cityKey)
    .eq("is_published", true)
    .maybeSingle();
  if (!pack) throw new Error("Recomendação SigmaConcierge indisponível para esta cidade.");
  const packRow = pack as { city_key: string; city_label: string; country: string | null };

  const scopedRefs = await readScopedCityReferences(supabaseAdmin, propertyId);
  const [{ data: sigmaRecs }, { data: sigmaMkt }, { data: sigmaFaqs }, { data: ownFaqs }] = await Promise.all([
    supabaseAdmin.from("sigma_city_recommendations").select("*").eq("city_key", cityKey).order("position"),
    supabaseAdmin.from("sigma_city_marketplace").select("label, url, description").eq("city_key", cityKey).order("position"),
    supabaseAdmin.from("sigma_city_faqs").select("question, answer").eq("city_key", cityKey).order("position"),
    supabaseAdmin.from("property_faqs").select("*").eq("property_id", propertyId),
  ]);

  const snapshot = {
    marketplace_links: propRow.marketplace_links ?? [],
    property_faqs: ownFaqs ?? [],
    city_references: scopedRefs.rows ?? [],
  };

  const newMkt = (sigmaMkt ?? []).map((m: Record<string, unknown>) => ({
    label: m.label,
    url: m.url,
    description: m.description ?? null,
  }));
  const { error: upErr } = await supabaseAdmin
    .from("properties")
    .update({
      sigma_pack_city_key: cityKey,
      sigma_pack_activated_at: new Date().toISOString(),
      sigma_pack_snapshot: snapshot,
      marketplace_links: newMkt,
    })
    .eq("id", propertyId);
  if (upErr) throw new Error(upErr.message);

  const cityRefRows = (sigmaRecs ?? []).map((r: Record<string, unknown>, idx: number) => ({
    city_key: cityKey,
    city_label: packRow.city_label,
    state: propRow.state ?? null,
    country: propRow.country ?? packRow.country ?? "BR",
    type: (r.type as string) ?? "other",
    category: (r.category as string | null) ?? "Outros",
    name: r.name as string,
    rating: (r.rating as number | null) ?? null,
    user_ratings_total: (r.user_ratings_total as number | null) ?? null,
    note: (r.note as string | null) ?? null,
    image_url: (r.image_url as string | null) ?? null,
    maps_url: (r.maps_url as string | null) ?? null,
    place_id: (r.place_id as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    lat: (r.lat as number | null) ?? null,
    lng: (r.lng as number | null) ?? null,
    opening_hours: (r.opening_hours as string[] | null) ?? null,
    source: "manual",
    display_order: idx,
  }));
  await replaceScopedCityReferences(supabaseAdmin, propertyId, cityRefRows);

  await supabaseAdmin.from("property_faqs").delete().eq("property_id", propertyId).contains("tags", ["sigma"]);
  if ((sigmaFaqs ?? []).length) {
    const rows = (sigmaFaqs ?? []).map((f: Record<string, unknown>, idx: number) => ({
      property_id: propertyId,
      question: f.question,
      answer: f.answer,
      tags: ["sigma"],
      position: idx,
    }));
    await supabaseAdmin.from("property_faqs").insert(rows as never);
  }

  return { ok: true };
}

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
      context.supabase
        .from("sigma_city_recommendations")
        .select("city_key, image_url, rating, user_ratings_total"),
      context.supabase.from("sigma_city_marketplace").select("city_key"),
      context.supabase.from("sigma_city_faqs").select("city_key"),
    ]);
    if (packs.error) throw new Error(packs.error.message);
    const count = (rows: { city_key: string }[] | null) => {
      const m = new Map<string, number>();
      (rows ?? []).forEach((r) => m.set(r.city_key, (m.get(r.city_key) ?? 0) + 1));
      return m;
    };
    // Capa automática por cidade = imagem do ponto com melhor avaliação.
    const autoCover = new Map<string, string>();
    const byCity = new Map<string, { image_url: string | null; rating: number | null; user_ratings_total: number | null }[]>();
    for (const r of (recs.data ?? []) as { city_key: string; image_url: string | null; rating: number | null; user_ratings_total: number | null }[]) {
      const arr = byCity.get(r.city_key) ?? [];
      arr.push(r);
      byCity.set(r.city_key, arr);
    }
    // Capa em camadas (mesmo racional do guia público): 1) nota ≥ 4.8 ordenado
    // por nº de avaliações; 2) nota ≥ 4.5 por score bayesiano; 3) qualquer
    // item com imagem pelo mesmo score. m=150, C=4.3.
    const bayes = (r: number | null, v: number | null) => {
      const R = r ?? 0;
      const V = v ?? 0;
      const m = 150, C = 4.3;
      return (V / (V + m)) * R + (m / (V + m)) * C;
    };
    byCity.forEach((arr, key) => {
      const pool = arr.filter((x) => !!x.image_url);
      if (pool.length === 0) return;
      const t1 = pool.filter((x) => (x.rating ?? 0) >= 4.8);
      if (t1.length > 0) {
        const best = t1.sort((a, b) => (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0))[0];
        if (best?.image_url) autoCover.set(key, best.image_url);
        return;
      }
      const t2 = pool.filter((x) => (x.rating ?? 0) >= 4.5);
      const sorted = (t2.length > 0 ? t2 : pool).sort(
        (a, b) => bayes(b.rating, b.user_ratings_total) - bayes(a.rating, a.user_ratings_total),
      );
      if (sorted[0]?.image_url) autoCover.set(key, sorted[0].image_url);
    });
    const rc = count((recs.data ?? []).map((r) => ({ city_key: (r as { city_key: string }).city_key })));
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
      cover_url: p.cover_url ?? autoCover.get(p.city_key) ?? null,
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
    // Enforce one pack per city — friendly message before hitting the unique index
    const { data: existing } = await context.supabase
      .from("sigma_city_packs")
      .select("city_label")
      .eq("city_key", key)
      .maybeSingle();
    if (existing) {
      throw new Error(`Já existe uma recomendação para ${(existing as { city_label: string }).city_label}. Edite a cidade existente em vez de criar outra.`);
    }
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
    if (error) {
      if (error.code === "23505") {
        throw new Error("Já existe uma recomendação para esta cidade. Edite a cidade existente em vez de criar outra.");
      }
      throw new Error(error.message);
    }
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

export const adminListPublishedGuidesForSigma = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ city_key: z.string() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: props, error }, usersData] = await Promise.all([
      supabaseAdmin
        .from("properties")
        .select("id, name, slug, city, state, country, owner_id, updated_at, hero_image_url, sigma_pack_city_key")
        .eq("published", true)
        .order("updated_at", { ascending: false }),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (error) throw new Error("Erro ao carregar guias publicados.");
    const emailByUser = new Map((usersData.data?.users ?? []).map((u) => [u.id, u.email ?? null]));
    return ((props ?? []) as Array<Omit<AdminSigmaConciergeRow, "owner_email">>)
      .map((p) => ({ ...p, owner_email: emailByUser.get(p.owner_id) ?? null }))
      .sort((a, b) => Number(makeCityKey(b.city ?? "") === data.city_key) - Number(makeCityKey(a.city ?? "") === data.city_key)) as AdminSigmaConciergeRow[];
  });

export const adminApplySigmaPackToProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ city_key: z.string(), property_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return applySigmaPackToPropertyInternal(supabaseAdmin, data.property_id, data.city_key);
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
  image_url: z.string().nullable().optional(),
  maps_url: z.string().nullable().optional(),
  place_id: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  opening_hours: z.array(z.string()).nullable().optional(),
});

// Re-aplica o pack Sigma em todos os guias inscritos (sigma_pack_city_key = cityKey),
// para que qualquer alteração feita no painel do Sigma propague instantaneamente.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function propagateSigmaPackToSubscribers(supabaseAdmin: any, cityKey: string) {
  try {
    const { data: subs } = await supabaseAdmin
      .from("properties")
      .select("id")
      .eq("sigma_pack_city_key", cityKey);
    const ids = ((subs ?? []) as { id: string }[]).map((p) => p.id);
    for (const id of ids) {
      try {
        await applySigmaPackToPropertyInternal(supabaseAdmin, id, cityKey);
      } catch {
        // ignora falha individual para não bloquear o restante
      }
    }
  } catch {
    // Propagação é best-effort; não derruba a edição.
  }
}
// Helper: descobre o city_key de uma linha filha do pack para propagar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCityKeyByChildId(supabaseAdmin: any, table: string, id: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from(table).select("city_key").eq("id", id).maybeSingle();
  return (data as { city_key: string } | null)?.city_key ?? null;
}

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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await propagateSigmaPackToSubscribers(supabaseAdmin, data.city_key);
    return { id: row.id, duplicate: false };
  });

export const updateSigmaRec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), patch: z.record(z.string(), z.unknown()) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cityKey = await getCityKeyByChildId(supabaseAdmin, "sigma_city_recommendations", data.id);
    const { error } = await context.supabase
      .from("sigma_city_recommendations")
      .update(data.patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    if (cityKey) await propagateSigmaPackToSubscribers(supabaseAdmin, cityKey);
    return { ok: true };
  });

export const deleteSigmaRecs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("sigma_city_recommendations")
      .select("city_key")
      .in("id", data.ids);
    const keys = Array.from(new Set(((rows ?? []) as { city_key: string }[]).map((r) => r.city_key)));
    const { error } = await context.supabase.from("sigma_city_recommendations").delete().in("id", data.ids);
    if (error) throw new Error(error.message);
    for (const k of keys) await propagateSigmaPackToSubscribers(supabaseAdmin, k);
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await propagateSigmaPackToSubscribers(supabaseAdmin, data.city_key);
    return { id: row.id };
  });
export const updateSigmaMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), patch: z.record(z.string(), z.unknown()) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cityKey = await getCityKeyByChildId(supabaseAdmin, "sigma_city_marketplace", data.id);
    const { error } = await context.supabase.from("sigma_city_marketplace").update(data.patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    if (cityKey) await propagateSigmaPackToSubscribers(supabaseAdmin, cityKey);
    return { ok: true };
  });
export const deleteSigmaMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cityKey = await getCityKeyByChildId(supabaseAdmin, "sigma_city_marketplace", data.id);
    const { error } = await context.supabase.from("sigma_city_marketplace").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (cityKey) await propagateSigmaPackToSubscribers(supabaseAdmin, cityKey);
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await propagateSigmaPackToSubscribers(supabaseAdmin, data.city_key);
    return { id: row.id };
  });
export const updateSigmaFaq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), patch: z.record(z.string(), z.unknown()) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cityKey = await getCityKeyByChildId(supabaseAdmin, "sigma_city_faqs", data.id);
    const { error } = await context.supabase.from("sigma_city_faqs").update(data.patch as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    if (cityKey) await propagateSigmaPackToSubscribers(supabaseAdmin, cityKey);
    return { ok: true };
  });
export const deleteSigmaFaq = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cityKey = await getCityKeyByChildId(supabaseAdmin, "sigma_city_faqs", data.id);
    const { error } = await context.supabase.from("sigma_city_faqs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (cityKey) await propagateSigmaPackToSubscribers(supabaseAdmin, cityKey);
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
    // Look up available pack for the property city (only published). Use the
    // backend client so the editor button appears reliably for matching cities.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pack } = await supabaseAdmin
      .from("sigma_city_packs")
      .select("city_key, city_label, country, cover_url")
      .eq("city_key", expectedKey)
      .eq("is_published", true)
      .maybeSingle();
    let counts: { recs: number; marketplace: number; faqs: number } | null = null;
    if (pack) {
      const [r, m, f] = await Promise.all([
        supabaseAdmin.from("sigma_city_recommendations").select("id", { count: "exact", head: true }).eq("city_key", pack.city_key),
        supabaseAdmin.from("sigma_city_marketplace").select("id", { count: "exact", head: true }).eq("city_key", pack.city_key),
        supabaseAdmin.from("sigma_city_faqs").select("id", { count: "exact", head: true }).eq("city_key", pack.city_key),
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
    // Verify ownership via RLS
    const { data: prop, error: propErr } = await context.supabase
      .from("properties")
      .select("id")
      .eq("id", data.property_id)
      .maybeSingle();
    if (propErr || !prop) throw new Error("Imóvel não encontrado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return applySigmaPackToPropertyInternal(supabaseAdmin, data.property_id, data.city_key);
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
    const snap = (prop as { sigma_pack_snapshot: { marketplace_links?: unknown[]; property_faqs?: Record<string, unknown>[]; city_references?: Record<string, unknown>[] } | null } | null)?.sigma_pack_snapshot;
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (snap && Array.isArray(snap.city_references)) {
      await replaceScopedCityReferences(supabaseAdmin, data.property_id, snap.city_references);
    } else {
      await replaceScopedCityReferences(supabaseAdmin, data.property_id, []);
    }

    // FAQs manuais continuam editáveis enquanto o SigmaConcierge está ativo;
    // ao desativar, removemos apenas as FAQs adicionadas pelo SigmaConcierge.
    await context.supabase.from("property_faqs").delete().eq("property_id", data.property_id).contains("tags", ["sigma"]);
    return { ok: true };
  });

// ============== ADMIN — SAVE CURRENT GUIDE AS A SIGMA PACK ==============
// Snapshots the property's city_references (city scope) + marketplace_links + property_faqs
// into a Sigma pack for the property's city. Overwrites existing pack content for that city.
export const saveGuideAsSigmaPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ property_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Read source guide (bypass RLS — admin already verified)
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("id, city, country, marketplace_links")
      .eq("id", data.property_id)
      .maybeSingle();
    if (!prop) throw new Error("Imóvel não encontrado.");
    const propRow = prop as { id: string; city: string | null; country: string | null; marketplace_links: unknown };
    if (!propRow.city) throw new Error("Este guia não tem cidade definida.");

    const key = makeCityKey(propRow.city);
    if (!key) throw new Error("Cidade inválida.");

    const [cityRefsRes, faqsRes] = await Promise.all([
      supabaseAdmin
        .from("city_references")
        .select("type, name, category, rating, user_ratings_total, note, image_url, maps_url, place_id, address, lat, lng, opening_hours")
        .eq("property_id", data.property_id),
      supabaseAdmin
        .from("property_faqs")
        .select("question, answer, tags, position")
        .eq("property_id", data.property_id)
        .order("position"),
    ]);

    const cityRefs = cityRefsRes.data ?? [];

    const faqs = (faqsRes.data ?? []) as Array<{ question: string; answer: string; tags: string[] | null; position: number }>;
    // Skip FAQs imported from sigma — avoid feedback loops
    const userFaqs = faqs.filter((f) => !(Array.isArray(f.tags) && f.tags.includes("sigma")));

    const mkt = Array.isArray(propRow.marketplace_links)
      ? (propRow.marketplace_links as Array<{ label?: string; url?: string; description?: string | null }>)
      : [];

    // Upsert the pack
    const { data: existing } = await supabaseAdmin
      .from("sigma_city_packs")
      .select("city_key")
      .eq("city_key", key)
      .maybeSingle();

    if (!existing) {
      const { error: insErr } = await supabaseAdmin.from("sigma_city_packs").insert({
        city_key: key,
        city_label: propRow.city,
        country: propRow.country ?? null,
        is_published: true,
      });
      if (insErr) throw new Error(insErr.message);
    } else {
      // Salvar via guia republica automaticamente para liberar "Importar do SigmaConcierge" nos demais guias.
      await supabaseAdmin
        .from("sigma_city_packs")
        .update({ is_published: true })
        .eq("city_key", key);
    }

    // Wipe + repopulate child tables for this city
    await Promise.all([
      supabaseAdmin.from("sigma_city_recommendations").delete().eq("city_key", key),
      supabaseAdmin.from("sigma_city_marketplace").delete().eq("city_key", key),
      supabaseAdmin.from("sigma_city_faqs").delete().eq("city_key", key),
    ]);

    const recRows = cityRefs.map((r, idx) => {
      const rec = r as Record<string, unknown>;
      return {
        city_key: key,
        type: (rec.type as string) ?? "other",
        name: rec.name as string,
        category: (rec.category as string | null) ?? null,
        rating: (rec.rating as number | null) ?? null,
        user_ratings_total: (rec.user_ratings_total as number | null) ?? null,
        note: (rec.note as string | null) ?? null,
        image_url: (rec.image_url as string | null) ?? null,
        maps_url: (rec.maps_url as string | null) ?? null,
        place_id: (rec.place_id as string | null) ?? null,
        address: (rec.address as string | null) ?? null,
        lat: (rec.lat as number | null) ?? null,
        lng: (rec.lng as number | null) ?? null,
        opening_hours: (rec.opening_hours as string[] | null) ?? null,
        position: idx,
      };
    });
    if (recRows.length) {
      const { error } = await supabaseAdmin.from("sigma_city_recommendations").insert(recRows);
      if (error) throw new Error(error.message);
    }

    const mktRows = mkt
      .filter((m) => m && m.label && m.url)
      .map((m, idx) => ({
        city_key: key,
        label: String(m.label),
        url: String(m.url),
        description: m.description ?? null,
        position: idx,
      }));
    if (mktRows.length) {
      const { error } = await supabaseAdmin.from("sigma_city_marketplace").insert(mktRows);
      if (error) throw new Error(error.message);
    }

    const faqRows = userFaqs.map((f, idx) => ({
      city_key: key,
      question: f.question,
      answer: f.answer,
      tags: Array.isArray(f.tags) ? f.tags.filter((t) => t !== "sigma") : [],
      position: idx,
    }));
    if (faqRows.length) {
      const { error } = await supabaseAdmin.from("sigma_city_faqs").insert(faqRows);
      if (error) throw new Error(error.message);
    }

    await propagateSigmaPackToSubscribers(supabaseAdmin, key);

    return {
      ok: true,
      city_key: key,
      city_label: propRow.city,
      counts: { recs: recRows.length, marketplace: mktRows.length, faqs: faqRows.length },
    };
  });

// Reaplica TODOS os packs Sigma em TODOS os guias inscritos.
// Útil para um "refresh geral" após mudanças de regra ou correções de catálogo.
export const adminRefreshAllSigmaSubscribers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: packs } = await supabaseAdmin
      .from("sigma_city_packs")
      .select("city_key");
    const keys = Array.from(new Set(((packs ?? []) as { city_key: string }[]).map((p) => p.city_key)));
    let refreshed = 0;
    for (const k of keys) {
      await propagateSigmaPackToSubscribers(supabaseAdmin, k);
      refreshed++;
    }
    return { ok: true, packs: refreshed };
  });

