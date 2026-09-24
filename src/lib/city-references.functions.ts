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
const httpsUrl = z
  .string()
  .max(2048)
  .refine(
    (v) => {
      if (!v) return true;
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "URL deve usar HTTPS." },
  );

const UpdateInput = z.object({
  id: z.string().uuid(),
  patch: z.object({
    name: z.string().min(1).max(200).optional(),
    type: z.string().min(1).max(40).optional(),
    category: z.string().min(1).max(60).optional(),
    note: z.string().max(1000).nullable().optional(),
    maps_url: httpsUrl.nullable().optional(),
    image_url: httpsUrl.nullable().optional(),
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
  image_url: httpsUrl.nullable().optional(),
  maps_url: httpsUrl.nullable().optional(),
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

/**
 * ISOLAMENTO POR CONTA (regra explícita, 24/09/2026: "cada tenant deve ter
 * suas visibilidades... NUNCA, JAMAIS, algum imóvel, guia ou tenant deve
 * puxar de outros" — a única exceção é o que se VINCULA de propósito, como
 * "usar recomendações Sigma"). Os escopos de referência que pertencem a esta
 * conta: os imóveis dela e os grupos de guias em que esses imóveis estão.
 */
async function ownScopes(userId: string): Promise<{ propertyIds: string[]; groupIds: string[] }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: props } = await supabaseAdmin.from("properties").select("id").eq("owner_id", userId);
  const propertyIds = ((props ?? []) as Array<{ id: string }>).map((p) => p.id);
  if (!propertyIds.length) return { propertyIds, groupIds: [] };
  const { data: mem } = await supabaseAdmin
    .from("city_reference_group_members")
    .select("group_id")
    .in("property_id", propertyIds);
  const groupIds = Array.from(new Set(((mem ?? []) as Array<{ group_id: string }>).map((m) => m.group_id)));
  return { propertyIds, groupIds };
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
    .select("city_label, state, country, group_id, property_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Referência não encontrada.");
  const r = row as {
    city_label: string;
    state: string | null;
    country: string | null;
    group_id: string | null;
    property_id: string | null;
  };

  // Admin bypasses all checks.
  if (await isAdmin(ctx)) return;

  // Group-scoped ref: caller must be a member of that specific group
  // (i.e., own a property inside it). City-level ownership is NOT enough —
  // that would let any host in the same city tamper with another host's
  // private shared group content.
  if (r.group_id) {
    const { data: ok } = await ctx.supabase.rpc("user_is_group_member", {
      _user_id: ctx.userId,
      _group_id: r.group_id,
    });
    if (!ok) throw new Error("Sem permissão para editar este item do grupo.");
    return;
  }

  // Property-scoped ref: caller must own that property.
  if (r.property_id) {
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("owner_id")
      .eq("id", r.property_id)
      .maybeSingle();
    if (!prop || (prop as { owner_id: string }).owner_id !== ctx.userId) {
      throw new Error("Sem permissão para editar este item.");
    }
    return;
  }

  // Ref legada por cidade (sem imóvel e sem grupo): não pertence a nenhuma
  // conta — só admin mexe. Antes, qualquer anfitrião com imóvel na cidade
  // podia alterar essas linhas (isolamento por conta, 24/09/2026).
  throw new Error("Sem permissão para editar este item.");
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
      const { retryDbResult, safeDbError } = await import("@/lib/db-errors.server");
      const { data: prop, error: propError } = await retryDbResult(() => supabaseAdmin
        .from("properties")
        .select("owner_id")
        .eq("id", data.propertyId as string)
        .maybeSingle());
      if (propError) throw safeDbError("city_references_property", propError);
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
      const { data: rows, error } = await retryDbResult(() => q);
      if (error) throw safeDbError("city_references", error);
      return { items: rows ?? [], job: null, scope };
    }

    // Modo legado (city_key). Mantido só para a página admin.cidades.
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    const key = cityKey(data.city_label);
    let legacyQ = supabaseAdmin
      .from("city_references")
      .select("*")
      .eq("city_key", key)
      .order("type")
      .order("display_order")
      .order("user_ratings_total", { ascending: false });
    // Anfitrião vê só as referências dos PRÓPRIOS guias nesta cidade — nunca
    // as de outros clientes da mesma cidade (isolamento, 24/09/2026). Admin
    // continua vendo tudo, é a visão administrativa.
    if (!(await isAdmin(context))) {
      const { propertyIds, groupIds } = await ownScopes(context.userId);
      const parts: string[] = [];
      if (propertyIds.length) parts.push(`property_id.in.(${propertyIds.join(",")})`);
      if (groupIds.length) parts.push(`group_id.in.(${groupIds.join(",")})`);
      if (!parts.length) return { items: [], job: null, scope: null };
      legacyQ = legacyQ.or(parts.join(","));
    }
    const { data: rows, error } = await legacyQ;
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
  /** Coordenada do imóvel vinda da tela (ex.: link do Maps recém-colado,
   * ainda não salvo). Só vale junto com `propertyId`. */
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

// ---- GENERATE ---------------------------------------------------------
export const generateCityReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GenerateInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertCanManageCity(context, { city_label: data.city_label, state: normalizeState(data.state ?? null), country: data.country });
    // Sem imóvel, a geração grava linhas "da cidade", sem dono — só admin
    // (isolamento por conta, 24/09/2026).
    if (!data.propertyId && !(await isAdmin(context))) {
      throw new Error("Escolha o imóvel para gerar as recomendações.");
    }
    // Ter imóvel na cidade não basta: as refs nascem no escopo do `propertyId`
    // enviado. Sem esta checagem, um anfitrião gravava referências no guia de
    // outro anfitrião da mesma cidade (22/09/2026).
    if (data.propertyId) {
      const { data: canAccess } = await context.supabase.rpc("user_can_access_property", {
        _user_id: context.userId,
        _property_id: data.propertyId,
      });
      if (!canAccess) throw new Error("Você não tem acesso a esta residência.");
    }
    const { assertFeature } = await import("@/lib/plan-guard.server");
    await assertFeature(context.supabase, context.userId, "autoImport", { propertyId: data.propertyId ?? null });
    const origin =
      data.propertyId && typeof data.lat === "number" && typeof data.lng === "number"
        ? { lat: data.lat, lng: data.lng }
        : null;
    return runCityGeneration({ ...data, type: data.type ?? null, propertyId: data.propertyId ?? null, origin });
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
  origin?: { lat: number; lng: number } | null;
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

  // O raio de 30 km é contado a partir da RESIDÊNCIA (regra explícita,
  // 24/09/2026). Sem coordenada no imóvel, cai para o centro da cidade.
  let origin: { lat: number; lng: number } | null = input.origin ?? null;
  if (!origin && input.propertyId) {
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("lat, lng")
      .eq("id", input.propertyId)
      .maybeSingle();
    const p = prop as { lat: number | null; lng: number | null } | null;
    if (p && typeof p.lat === "number" && typeof p.lng === "number") origin = { lat: p.lat, lng: p.lng };
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
      origin,
    });
  } catch (e) {
    status = "error";
    message = e instanceof Error ? e.message : "Erro desconhecido";
  }

  // Carrega existentes do MESMO escopo para decidir entre INSERT e UPDATE.
  let existingQ = supabaseAdmin
    .from("city_references")
    .select("id, place_id, name, is_hidden, source, note");
  if (scopeGroup) existingQ = existingQ.eq("group_id", scopeGroup);
  else if (scopeProperty) existingQ = existingQ.eq("property_id", scopeProperty).is("group_id", null);
  else existingQ = existingQ.eq("city_key", key).is("property_id", null).is("group_id", null);
  const { data: existing } = await existingQ;
  type Existing = { id: string; is_hidden: boolean; note: string | null };
  const byPlace = new Map<string, Existing>();
  const byName = new Map<string, Existing>();
  for (const e of (existing ?? []) as Array<{ id: string; place_id: string | null; name: string; is_hidden: boolean; note: string | null }>) {
    const v = { id: e.id, is_hidden: e.is_hidden, note: e.note };
    if (e.place_id) byPlace.set(e.place_id, v);
    else byName.set(e.name.toLowerCase(), v);
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
      // REGERAR NÃO DESFAZ O QUE O ANFITRIÃO EDITOU (auditoria, 24/09/2026).
      // Antes o update regravava a linha inteira: nome, categoria, tipo e
      // nota voltavam ao que o Google/IA sugeriu — quem tinha movido um
      // ponto para outra categoria ou escrito a própria nota perdia tudo a
      // cada "Gerar"/troca do link do Maps. Agora só os DADOS DO GOOGLE são
      // atualizados (nota, avaliações, foto, horários, link, posição); a nota
      // só é preenchida quando ainda está vazia, e a origem (manual/Sigma)
      // também é mantida.
      const {
        name: _name,
        category: _category,
        type: _type,
        note: _note,
        city_key: _ck,
        city_label: _cl,
        state: _st,
        country: _co,
        source: _src,
        ...facts
      } = base;
      void [_name, _category, _type, _note, _ck, _cl, _st, _co, _src];
      const patch: Record<string, unknown> = { ...facts };
      if (!match.note && base.note) patch.note = base.note;
      const { error } = await supabaseAdmin
        .from("city_references")
        .update(patch as never)
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
    // Mesma regra do bulk abaixo: excluído fica guardado oculto e nunca volta.
    const { error } = await supabaseAdmin
      .from("city_references")
      .update({ is_hidden: true, excluded_at: new Date().toISOString() } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- BULK DELETE ------------------------------------------------------
/*
 * EXCLUÍDO NUNCA VOLTA (regra explícita, 24/09/2026: "eu quero que EXCLUÍDOS
 * NUNCA voltem").
 *
 * Apagar a linha de verdade deixava o lugar livre para a próxima geração
 * (botão "Gerar", troca do link do Maps) inseri-lo de novo — o anfitrião
 * excluía e o ponto reaparecia. Agora "excluir" guarda a linha OCULTA
 * (`is_hidden = true`): ela some do editor, do guia e da IA, e a geração, que
 * reconhece o lugar pelo place_id, só atualiza os dados do Google sem nunca
 * mexer no `is_hidden`. O ponto só volta se o anfitrião adicioná-lo de novo
 * na mão (a adição manual reativa a linha). `hard: true` apaga de verdade —
 * usado só por quem precisa (ex.: limpeza administrativa).
 */
const BulkDeleteInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  hard: z.boolean().optional(),
});
export const bulkDeleteCityReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BulkDeleteInput.parse(i))
  .handler(async ({ data, context }) => {
    // Verifica permissão para cada referência antes de excluir.
    for (const id of data.ids) {
      await assertCanManageRefById(context, id);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = data.hard
      ? await supabaseAdmin.from("city_references").delete().in("id", data.ids)
      : await supabaseAdmin
          .from("city_references")
          .update({ is_hidden: true, excluded_at: new Date().toISOString() } as never)
          .in("id", data.ids);
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


// ---- RENOMEAR / MOVER CATEGORIA — SÓ NESTE GUIA ------------------------
// A categoria de um ponto é o texto `category` da própria linha, e cada guia
// (ou grupo de guias vinculados) tem as suas linhas. Renomear "Compras" para
// "Shoppings" aqui muda só as linhas deste escopo.
//
// Antes, o lápis "Renomear categoria" do editor do guia chamava
// `updatePoiCategory`, que altera a TAXONOMIA GLOBAL da plataforma (a mesma
// para todos os clientes): para um anfitrião comum dava erro ("Forbidden"),
// e para um admin renomeava a categoria de TODO MUNDO — foi assim que a
// categoria-base "Compras" virou "No Paraguai" e passou a aparecer nos guias
// de Ourinhos (auditoria das recomendações, 24/09/2026).
const RenameCategoryInput = z.object({
  propertyId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1).max(2000),
  to: z.string().trim().min(1).max(60),
});
export const renameCityReferenceCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RenameCategoryInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: canAccess } = await context.supabase.rpc("user_can_access_property", {
      _user_id: context.userId,
      _property_id: data.propertyId,
    });
    if (!canAccess && !(await isAdmin(context))) throw new Error("Você não tem acesso a esta residência.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const scope = await resolvePropertyScope(supabaseAdmin, data.propertyId);
    // O filtro de escopo garante que ids de outro guia nunca são tocados,
    // mesmo que alguém mande ids que não são deste imóvel.
    let q = supabaseAdmin.from("city_references").update({ category: data.to }).in("id", data.ids);
    q = scope.groupId ? q.eq("group_id", scope.groupId) : q.eq("property_id", data.propertyId).is("group_id", null);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- MANUAL ADD -------------------------------------------------------
// Quando `propertyId` é informado, grava com escopo da property/grupo.
// Sem propertyId mantém comportamento legado (city_key) só para a página admin.cidades.
export const addManualCityReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ManualAddInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let scopeGroup: string | null = null;
    let scopeProperty: string | null = null;
    if (data.propertyId) {
      const { data: prop } = await supabaseAdmin
        .from("properties")
        .select("owner_id")
        .eq("id", data.propertyId)
        .maybeSingle();
      if (!prop) throw new Error("Imóvel não encontrado.");
      const { data: isAdminRes } = await context.supabase.rpc("has_role", {
        _user_id: context.userId, _role: "admin",
      });
      if ((prop as { owner_id: string }).owner_id !== context.userId && !isAdminRes) {
        throw new Error("Sem permissão.");
      }
      const s = await resolvePropertyScope(supabaseAdmin, data.propertyId);
      scopeGroup = s.groupId;
      scopeProperty = s.groupId ? null : s.propertyId;
    } else {
      // Sem imóvel = linha "da cidade", sem dono: só admin (isolamento, 24/09/2026).
      if (!(await isAdmin(context))) throw new Error("Escolha o imóvel para adicionar o ponto.");
    }

    const key = cityKey(data.city_label);
    const st = normalizeState(data.state ?? null);
    const payload: Record<string, unknown> = {
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
      // Adicionar na mão um lugar que tinha sido excluído o traz de volta —
      // é a única forma de um excluído voltar.
      is_hidden: false,
      excluded_at: null,
      last_synced_at: new Date().toISOString(),
    };
    if (scopeGroup) payload.group_id = scopeGroup;
    if (scopeProperty) payload.property_id = scopeProperty;

    // Find-or-insert dedup no MESMO escopo (não cruza guias).
    let existingQ = supabaseAdmin
      .from("city_references")
      .select("id, place_id, name");
    if (scopeGroup) existingQ = existingQ.eq("group_id", scopeGroup);
    else if (scopeProperty) existingQ = existingQ.eq("property_id", scopeProperty).is("group_id", null);
    else existingQ = existingQ.eq("city_key", key).is("property_id", null).is("group_id", null);
    const { data: existingList } = await existingQ;
    const normalized = data.name.trim().toLowerCase();
    const existing = (existingList ?? []).find((row) => {
      const r = row as { id: string; place_id: string | null; name: string };
      if (data.place_id && r.place_id && r.place_id === data.place_id) return true;
      return (r.name ?? "").trim().toLowerCase() === normalized;
    }) as { id: string } | undefined;
    if (existing) {
      const { error } = await supabaseAdmin
        .from("city_references")
        .update(payload as never)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { id: existing.id, duplicate: true };
    }
    const { error, data: row } = await supabaseAdmin
      .from("city_references")
      .insert(payload as never)
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
    // ref_count: conta por cidade — para anfitrião, só os pontos dos
    // próprios guias (isolamento por conta, 24/09/2026).
    let refsQ = supabaseAdmin.from("city_references").select("city_key, state, country");
    if (!admin) {
      const { propertyIds, groupIds } = await ownScopes(context.userId);
      const parts: string[] = [];
      if (propertyIds.length) parts.push(`property_id.in.(${propertyIds.join(",")})`);
      if (groupIds.length) parts.push(`group_id.in.(${groupIds.join(",")})`);
      refsQ = parts.length ? refsQ.or(parts.join(",")) : refsQ.eq("id", "00000000-0000-0000-0000-000000000000");
    }
    const { data: refs } = await refsQ;
    for (const r of (refs ?? []) as Array<{ city_key: string; state: string | null; country: string }>) {
      const id = k(r.city_key);
      const b = map.get(id);
      if (b) b.ref_count += 1;
    }

    return { cities: Array.from(map.values()).sort((a, b) => a.city_label.localeCompare(b.city_label, "pt-BR")) };
  });
