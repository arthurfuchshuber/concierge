import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { cityKey, normalizeState } from "@/lib/city-key";
import { generateCityReferencesFromMaps, type CityReferenceRow } from "@/lib/maps.functions";

const CityIdent = z.object({
  city_label: z.string().min(1).max(120),
  state: z.string().nullable().optional(),
  country: z.string().min(1).max(60).default("BR"),
});

const ListInput = CityIdent.extend({ includeHidden: z.boolean().optional() });
const HideInput = z.object({ id: z.string().uuid(), hidden: z.boolean() });
const DeleteInput = z.object({ id: z.string().uuid() });
const ReorderInput = z.object({ id: z.string().uuid(), display_order: z.number().int() });

const ManualAddInput = CityIdent.extend({
  type: z.string().min(1).max(40),
  category: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
  place_id: z.string().max(200).nullable().optional(),
  note: z.string().max(800).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  rating: z.number().nullable().optional(),
  user_ratings_total: z.number().int().nullable().optional(),
  primary_type: z.string().max(80).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  image_url: z.string().max(2048).nullable().optional(),
  maps_url: z.string().max(2048).nullable().optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isAdmin(ctx: any): Promise<boolean> {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return Boolean(data);
}

// Admin OU dono de ao menos uma residência na cidade indicada.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCanManageCity(
  ctx: any,
  args: { city_label: string; state: string | null; country: string },
) {
  if (await isAdmin(ctx)) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = cityKey(args.city_label);
  const { data: rows } = await supabaseAdmin
    .from("properties")
    .select("city, state, country")
    .eq("owner_id", ctx.userId);
  const owns = (rows ?? []).some((p) => {
    const pState = normalizeState((p as { state: string | null }).state ?? null);
    const pCountry = ((p as { country: string | null }).country ?? "BR");
    const pKey = cityKey((p as { city: string | null }).city ?? "");
    return pKey === key && pState === args.state && pCountry === args.country;
  });
  if (!owns) throw new Error("Você não tem residências cadastradas nesta cidade.");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCanManageRefById(ctx: any, id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin
    .from("city_references")
    .select("city_label, state, country")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Referência não encontrada.");
  await assertCanManageCity(ctx, {
    city_label: (row as { city_label: string }).city_label,
    state: ((row as { state: string | null }).state) ?? null,
    country: ((row as { country: string | null }).country) ?? "BR",
  });
}

// ---- LIST -------------------------------------------------------------
export const listCityReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = cityKey(data.city_label);
    const st = normalizeState(data.state ?? null);
    let q = supabaseAdmin
      .from("city_references")
      .select("*")
      .eq("city_key", key)
      .eq("country", data.country)
      .order("type")
      .order("display_order")
      .order("user_ratings_total", { ascending: false });
    q = st ? q.eq("state", st) : q.is("state", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const { data: job } = await supabaseAdmin
      .from("city_reference_jobs")
      .select("*")
      .eq("city_key", key)
      .eq("country", data.country)
      .maybeSingle();

    return { items: rows ?? [], job };
  });

// ---- GENERATE ---------------------------------------------------------
export const generateCityReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CityIdent.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    return runCityGeneration(data);
  });

// Função interna reaproveitável pelo cron (sem auth middleware).
export async function runCityGeneration(input: {
  city_label: string;
  state?: string | null;
  country: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = cityKey(input.city_label);
  const st = normalizeState(input.state ?? null);
  const country = input.country || "BR";

  let rows: CityReferenceRow[] = [];
  let status = "ok";
  let message: string | null = null;
  try {
    rows = await generateCityReferencesFromMaps({
      city_label: input.city_label,
      state: st,
      country,
    });
  } catch (e) {
    status = "error";
    message = e instanceof Error ? e.message : "Erro desconhecido";
  }

  // IDs ocultos pré-existentes: preservar is_hidden=true após upsert.
  const { data: existing } = await supabaseAdmin
    .from("city_references")
    .select("id, place_id, is_hidden, source")
    .eq("city_key", key)
    .eq("country", country)
    .then((r) => ({ data: (r.data ?? []) as Array<{ id: string; place_id: string | null; is_hidden: boolean; source: string }> }));
  const hiddenByPlace = new Map<string, boolean>();
  for (const e of existing) if (e.place_id) hiddenByPlace.set(e.place_id, e.is_hidden);

  const nowIso = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    const payload = {
      city_key: key,
      city_label: input.city_label,
      state: st,
      country,
      category: r.category,
      type: r.type,
      place_id: r.place_id,
      name: r.name,
      note: r.note,
      address: r.address,
      rating: r.rating,
      user_ratings_total: r.user_ratings_total,
      primary_type: r.primary_type,
      lat: r.lat,
      lng: r.lng,
      image_url: r.image_url,
      maps_url: r.maps_url,
      opening_hours: r.opening_hours,
      source: "auto",
      is_hidden: hiddenByPlace.get(r.place_id) ?? false,
      last_synced_at: nowIso,
    };
    const { data: ups, error } = await supabaseAdmin
      .from("city_references")
      .upsert(payload, { onConflict: "city_key,state,country,place_id", ignoreDuplicates: false })
      .select("id, created_at, updated_at");
    if (error) continue;
    const row = (ups ?? [])[0] as { created_at?: string; updated_at?: string } | undefined;
    if (row?.created_at === row?.updated_at) inserted += 1;
    else updated += 1;
  }

  await supabaseAdmin
    .from("city_reference_jobs")
    .upsert(
      {
        city_key: key,
        city_label: input.city_label,
        state: st,
        country,
        last_refreshed_at: nowIso,
        last_status: status,
        last_message: message,
      },
      { onConflict: "city_key,state,country" },
    );

  return { inserted, updated, total: rows.length, status, message };
}

// ---- TOGGLE HIDE ------------------------------------------------------
export const toggleHideCityReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => HideInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("city_references")
      .update({ is_hidden: data.hidden })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- DELETE -----------------------------------------------------------
export const deleteCityReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DeleteInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("city_references").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- REORDER ----------------------------------------------------------
export const reorderCityReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ReorderInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("city_references")
      .update({ display_order: data.display_order })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- MANUAL ADD -------------------------------------------------------
export const addManualCityReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ManualAddInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = cityKey(data.city_label);
    const st = normalizeState(data.state ?? null);
    const payload = {
      city_key: key,
      city_label: data.city_label,
      state: st,
      country: data.country,
      category: data.category,
      type: data.type,
      place_id: data.place_id ?? null,
      name: data.name,
      note: data.note ?? null,
      address: data.address ?? null,
      rating: data.rating ?? null,
      user_ratings_total: data.user_ratings_total ?? null,
      primary_type: data.primary_type ?? null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      image_url: data.image_url ?? null,
      maps_url: data.maps_url ?? null,
      source: "manual",
      is_hidden: false,
      last_synced_at: new Date().toISOString(),
    };
    const { error, data: row } = await supabaseAdmin
      .from("city_references")
      .upsert(payload, { onConflict: "city_key,state,country,place_id", ignoreDuplicates: false })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { id: (row as { id: string } | null)?.id ?? null };
  });

// ---- LIST CITIES (admin index) ---------------------------------------
export const listAdminCities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Cidades distintas das propriedades publicadas + cidades já cadastradas.
    const { data: props } = await supabaseAdmin
      .from("properties")
      .select("city, state, country")
      .not("city", "is", null);
    const { data: jobs } = await supabaseAdmin
      .from("city_reference_jobs")
      .select("city_key, city_label, state, country, last_refreshed_at, last_status");

    type Bucket = {
      city_key: string;
      city_label: string;
      state: string | null;
      country: string;
      properties: number;
      last_refreshed_at: string | null;
      last_status: string | null;
      ref_count: number;
    };
    const map = new Map<string, Bucket>();
    const k = (city_key: string, state: string | null, country: string) =>
      `${city_key}|${state ?? ""}|${country}`;

    for (const p of (props ?? []) as Array<{ city: string | null; state: string | null; country: string | null }>) {
      if (!p.city) continue;
      const country = p.country ?? "BR";
      const state = normalizeState(p.state);
      const key = cityKey(p.city);
      const id = k(key, state, country);
      const b = map.get(id) ?? {
        city_key: key,
        city_label: p.city,
        state,
        country,
        properties: 0,
        last_refreshed_at: null,
        last_status: null,
        ref_count: 0,
      };
      b.properties += 1;
      map.set(id, b);
    }
    for (const j of (jobs ?? []) as Array<{ city_key: string; city_label: string; state: string | null; country: string; last_refreshed_at: string | null; last_status: string | null }>) {
      const id = k(j.city_key, j.state, j.country);
      const b = map.get(id) ?? {
        city_key: j.city_key,
        city_label: j.city_label,
        state: j.state,
        country: j.country,
        properties: 0,
        last_refreshed_at: null,
        last_status: null,
        ref_count: 0,
      };
      b.last_refreshed_at = j.last_refreshed_at;
      b.last_status = j.last_status;
      map.set(id, b);
    }
    // ref_count: conta por cidade.
    const { data: refs } = await supabaseAdmin
      .from("city_references")
      .select("city_key, state, country");
    for (const r of (refs ?? []) as Array<{ city_key: string; state: string | null; country: string }>) {
      const id = k(r.city_key, r.state, r.country);
      const b = map.get(id);
      if (b) b.ref_count += 1;
    }

    return { cities: Array.from(map.values()).sort((a, b) => a.city_label.localeCompare(b.city_label, "pt-BR")) };
  });
