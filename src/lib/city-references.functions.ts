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

// `propertyId` é OPCIONAL nas APIs antigas para compat (admin.cidades),
// mas é OBRIGATÓRIO no novo fluxo por imóvel/grupo. Sempre que vier,
// determinamos o escopo (group_id se a property estiver em grupo, senão property_id).
const ListInput = CityIdent.extend({
  includeHidden: z.boolean().optional(),
  propertyId: z.string().uuid().nullable().optional(),
});
const HideInput = z.object({ id: z.string().uuid(), hidden: z.boolean() });
const DeleteInput = z.object({ id: z.string().uuid() });
const ReorderInput = z.object({ id: z.string().uuid(), display_order: z.number().int() });
const UpdateInput = z.object({
  id: z.string().uuid(),
  patch: z.object({
    name: z.string().min(1).max(200).optional(),
    type: z.string().min(1).max(40).optional(),
    category: z.string().min(1).max(60).optional(),
    note: z.string().max(1000).nullable().optional(),
    maps_url: z.string().max(2048).nullable().optional(),
    image_url: z.string().max(2048).nullable().optional(),
  }),
});

const ManualAddInput = CityIdent.extend({
  type: z.string().min(1).max(40),
  category: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
  // place_id é OBRIGATÓRIO — só aceitamos pontos cadastrados no Google.
  place_id: z.string().min(1).max(200),
  propertyId: z.string().uuid().nullable().optional(),
  note: z.string().max(800).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  rating: z.number().nullable().optional(),
  user_ratings_total: z.number().int().nullable().optional(),
  primary_type: z.string().max(80).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  image_url: z.string().max(2048).nullable().optional(),
  maps_url: z.string().max(2048).nullable().optional(),
  opening_hours: z.array(z.string().max(200)).max(14).nullable().optional(),
});

// Resolve o escopo (group_id OU property_id) a partir do propertyId.
// Quando a property está em um grupo, todas as refs vivem com group_id setado
// (e property_id = null). Sem grupo, vivem com property_id setado.
async function resolvePropertyScope(
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient,
  propertyId: string,
): Promise<{ groupId: string | null; propertyId: string }> {
  const { data: m } = await supabaseAdmin
    .from("city_reference_group_members")
    .select("group_id")
    .eq("property_id", propertyId)
    .maybeSingle();
  return { groupId: (m?.group_id as string | null) ?? null, propertyId };
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isAdmin(ctx: any): Promise<boolean> {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return Boolean(data);
}

// Admin OU dono de ao menos uma residência na cidade indicada.
// Compara por city_key apenas: as referências são compartilhadas por cidade,
// independentemente de variações em state/country salvas historicamente.
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
    .select("city")
    .eq("owner_id", ctx.userId);
  const owns = (rows ?? []).some((p) => {
    const pKey = cityKey((p as { city: string | null }).city ?? "");
    return pKey === key;
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
// Quando `propertyId` é informado: lista apenas as refs do escopo dessa property
// (group_id se membro de um grupo; senão property_id). Esse é o modo NOVO.
// Sem `propertyId`: mantém o comportamento legado por city_key (usado pela
// página admin.cidades como visão administrativa).
export const listCityReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.propertyId) {
      // Modo por escopo (property/group). Permissão: dono OU admin.
      const { data: prop } = await supabaseAdmin
        .from("properties")
        .select("owner_id")
        .eq("id", data.propertyId)
        .maybeSingle();
      if (!prop) throw new Error("Imóvel não encontrado.");
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId, _role: "admin",
      });
      if ((prop as { owner_id: string }).owner_id !== context.userId && !isAdmin) {
        throw new Error("Sem permissão.");
      }
      const scope = await resolvePropertyScope(supabaseAdmin, data.propertyId);
      let q = supabaseAdmin
        .from("city_references")
        .select("*")
        .order("type")
        .order("display_order")
        .order("user_ratings_total", { ascending: false });
      if (scope.groupId) {
        q = q.eq("group_id", scope.groupId);
      } else {
        q = q.eq("property_id", scope.propertyId).is("group_id", null);
      }
      if (!data.includeHidden) q = q.eq("is_hidden", false);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      return { items: rows ?? [], job: null, scope };
    }

    // Modo legado (city_key). Mantido só para a página admin.cidades.
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    const key = cityKey(data.city_label);
    const { data: rows, error } = await supabaseAdmin
      .from("city_references")
      .select("*")
      .eq("city_key", key)
      .order("type")
      .order("display_order")
      .order("user_ratings_total", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: job } = await supabaseAdmin
      .from("city_reference_jobs")
      .select("*")
      .eq("city_key", key)
      .maybeSingle();

    return { items: rows ?? [], job, scope: null };
  });

const GenerateInput = CityIdent.extend({
  type: z.string().min(1).max(40).nullable().optional(),
  propertyId: z.string().uuid().nullable().optional(),
});

// ---- GENERATE ---------------------------------------------------------
export const generateCityReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GenerateInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    const { assertFeature } = await import("@/lib/plan-guard.server");
    await assertFeature(context.supabase, context.userId, "autoImport");
    return runCityGeneration({ ...data, type: data.type ?? null, propertyId: data.propertyId ?? null });
  });


// Função interna reaproveitável pelo cron (sem auth middleware).
// Quando `propertyId` é informado, grava as refs com escopo da property/grupo;
// senão grava como "órfãs" (city_key) — modo legado mantido para compat.
export async function runCityGeneration(input: {
  city_label: string;
  state?: string | null;
  country: string;
  type?: string | null;
  propertyId?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = cityKey(input.city_label);
  const st = normalizeState(input.state ?? null);
  const country = input.country || "BR";

  let scopeGroup: string | null = null;
  let scopeProperty: string | null = null;
  if (input.propertyId) {
    const s = await resolvePropertyScope(supabaseAdmin, input.propertyId);
    scopeGroup = s.groupId;
    scopeProperty = s.groupId ? null : s.propertyId;
  }

  let rows: CityReferenceRow[] = [];
  let status = "ok";
  let message: string | null = null;
  try {
    rows = await generateCityReferencesFromMaps({
      city_label: input.city_label,
      state: st,
      country,
      type: input.type ?? null,
    });
  } catch (e) {
    status = "error";
    message = e instanceof Error ? e.message : "Erro desconhecido";
  }

  // Carrega existentes do MESMO escopo para decidir entre INSERT e UPDATE.
  let existingQ = supabaseAdmin
    .from("city_references")
    .select("id, place_id, name, is_hidden, source");
  if (scopeGroup) existingQ = existingQ.eq("group_id", scopeGroup);
  else if (scopeProperty) existingQ = existingQ.eq("property_id", scopeProperty).is("group_id", null);
  else existingQ = existingQ.eq("city_key", key).is("property_id", null).is("group_id", null);
  const { data: existing } = await existingQ;
  const byPlace = new Map<string, { id: string; is_hidden: boolean }>();
  const byName = new Map<string, { id: string; is_hidden: boolean }>();
  for (const e of (existing ?? []) as Array<{ id: string; place_id: string | null; name: string; is_hidden: boolean }>) {
    if (e.place_id) byPlace.set(e.place_id, { id: e.id, is_hidden: e.is_hidden });
    else byName.set(e.name.toLowerCase(), { id: e.id, is_hidden: e.is_hidden });
  }


  const nowIso = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  for (const r of rows) {
    const match = (r.place_id && byPlace.get(r.place_id)) || byName.get(r.name.toLowerCase()) || null;
    const base = {
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
      last_synced_at: nowIso,
    };
    if (match) {
      const { error } = await supabaseAdmin
        .from("city_references")
        .update(base)
        .eq("id", match.id);
      if (error) {
        failed += 1;
        if (!message) message = error.message;
      } else updated += 1;
    } else {
      const insertPayload: Record<string, unknown> = { ...base, is_hidden: false };
      if (scopeGroup) insertPayload.group_id = scopeGroup;
      else if (scopeProperty) insertPayload.property_id = scopeProperty;
      const { error } = await supabaseAdmin
        .from("city_references")
        .insert(insertPayload as never);
      if (error) {
        failed += 1;
        if (!message) message = error.message;
      } else inserted += 1;
    }
  }

  if (failed > 0 && status === "ok") status = "partial";

  {
    // Upsert do job por city_key + country apenas (ignora state para
    // evitar jobs duplicados quando o mesmo city_key tem state inconsistente).
    const { data: jobRow } = await supabaseAdmin
      .from("city_reference_jobs")
      .select("id")
      .eq("city_key", key)
      .maybeSingle();
    const jobPayload = {
      city_key: key,
      city_label: input.city_label,
      state: st,
      country,
      last_refreshed_at: nowIso,
      last_status: status,
      last_message: message,
    };
    if (jobRow) {
      await supabaseAdmin
        .from("city_reference_jobs")
        .update(jobPayload)
        .eq("id", (jobRow as { id: string }).id);
    } else {
      await supabaseAdmin.from("city_reference_jobs").insert(jobPayload);
    }
  }


  return { inserted, updated, failed, total: rows.length, status, message };
}


// ---- TOGGLE HIDE ------------------------------------------------------
export const toggleHideCityReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => HideInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageRefById(context, data.id);
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
    await assertCanManageRefById(context, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("city_references").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- BULK DELETE ------------------------------------------------------
const BulkDeleteInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
export const bulkDeleteCityReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BulkDeleteInput.parse(i))
  .handler(async ({ data, context }) => {
    // Verifica permissão para cada referência antes de excluir.
    for (const id of data.ids) {
      await assertCanManageRefById(context, id);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("city_references").delete().in("id", data.ids);
    if (error) throw new Error(error.message);
    return { ok: true, deleted: data.ids.length };
  });

// ---- REORDER ----------------------------------------------------------
export const reorderCityReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ReorderInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageRefById(context, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("city_references")
      .update({ display_order: data.display_order })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- UPDATE -----------------------------------------------------------
export const updateCityReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageRefById(context, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Partial<{
      name: string;
      type: string;
      category: string;
      note: string | null;
      maps_url: string | null;
      image_url: string | null;
    }> = {};
    for (const [k, v] of Object.entries(data.patch)) {
      if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin
      .from("city_references")
      .update(patch)
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
      opening_hours: data.opening_hours ?? null,
      source: "manual",
      is_hidden: false,
      last_synced_at: new Date().toISOString(),
    };
    // Find-or-insert manualmente: nunca duplica o mesmo ponto. Procura por
    // (a) place_id quando informado, OU (b) mesmo nome (case-insensitive)
    // dentro da mesma cidade. Se já existir, faz UPDATE em vez
    // de INSERT.
    let existingQ = supabaseAdmin
      .from("city_references")
      .select("id, place_id, name")
      .eq("city_key", key);
    const { data: existingList } = await existingQ;
    const normalized = payload.name.trim().toLowerCase();
    const existing = (existingList ?? []).find((row) => {
      const r = row as { id: string; place_id: string | null; name: string };
      if (payload.place_id && r.place_id && r.place_id === payload.place_id) return true;
      return (r.name ?? "").trim().toLowerCase() === normalized;
    }) as { id: string } | undefined;
    if (existing) {
      const { error } = await supabaseAdmin
        .from("city_references")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { id: existing.id, duplicate: true };
    }
    const { error, data: row } = await supabaseAdmin
      .from("city_references")
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { id: (row as { id: string } | null)?.id ?? null };

  });

// ---- LIST CITIES (admin index) ---------------------------------------
export const listAdminCities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await isAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Hosts veem apenas cidades das próprias residências. Admins veem todas.
    let propsQ = supabaseAdmin.from("properties").select("city, state, country").not("city", "is", null);
    if (!admin) propsQ = propsQ.eq("owner_id", context.userId);
    const { data: props } = await propsQ;
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
    const k = (city_key: string) => city_key;

    for (const p of (props ?? []) as Array<{ city: string | null; state: string | null; country: string | null }>) {
      if (!p.city) continue;
      const country = p.country ?? "BR";
      const state = normalizeState(p.state);
      const key = cityKey(p.city);
      const id = k(key);
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
      // Prefer state-set value for display
      if (!b.state && state) b.state = state;
      map.set(id, b);
    }
    for (const j of (jobs ?? []) as Array<{ city_key: string; city_label: string; state: string | null; country: string; last_refreshed_at: string | null; last_status: string | null }>) {
      const id = k(j.city_key);
      const existing = map.get(id);
      if (!existing && !admin) continue; // hosts: só cidades das próprias residências
      const b = existing ?? {
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
      const id = k(r.city_key);
      const b = map.get(id);
      if (b) b.ref_count += 1;
    }

    return { cities: Array.from(map.values()).sort((a, b) => a.city_label.localeCompare(b.city_label, "pt-BR")) };
  });
