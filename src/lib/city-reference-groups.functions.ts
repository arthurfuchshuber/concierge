import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { cityKey } from "@/lib/city-key";

/**
 * Vínculos entre guias — "Referências na Cidade" compartilhada.
 *
 * Modelo:
 *   - Um grupo (`city_reference_groups`) reúne N properties (`city_reference_group_members`).
 *   - Properties no mesmo grupo compartilham UMA lista única de `city_references` (group_id preenchido).
 *   - Properties sem grupo seguem o fluxo legado: lista por `city_key`.
 */

export type GroupSummary = {
  id: string;
  name: string;
  city_key: string;
  member_count: number;
  members: { property_id: string; property_name: string; property_slug: string | null; city: string | null }[];
};

async function getMembershipForProperty(
  ctx: { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string },
  propertyId: string,
) {
  const { data: prop } = await ctx.supabase
    .from("properties")
    .select("id, owner_id, city, name, slug")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) throw new Error("Imóvel não encontrado");
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (prop.owner_id !== ctx.userId && !isAdmin) throw new Error("Sem permissão");
  return { prop, isAdmin: !!isAdmin };
}

// ============ READ ============
export const getPropertyGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ propertyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<GroupSummary | null> => {
    await getMembershipForProperty(context, data.propertyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: m } = await supabaseAdmin
      .from("city_reference_group_members")
      .select("group_id")
      .eq("property_id", data.propertyId)
      .maybeSingle();
    if (!m?.group_id) return null;
    const { data: g } = await supabaseAdmin
      .from("city_reference_groups")
      .select("id, name, city_key")
      .eq("id", m.group_id)
      .maybeSingle();
    if (!g) return null;
    const { data: members } = await supabaseAdmin
      .from("city_reference_group_members")
      .select("property_id, properties(name, slug, city)")
      .eq("group_id", g.id);
    type MemberRow = { property_id: string; properties: { name: string | null; slug: string | null; city: string | null } | null };
    const list = ((members ?? []) as unknown as MemberRow[]).map((row) => ({
      property_id: row.property_id,
      property_name: row.properties?.name ?? "—",
      property_slug: row.properties?.slug ?? null,
      city: row.properties?.city ?? null,
    }));
    return { id: g.id, name: g.name, city_key: g.city_key, member_count: list.length, members: list };
  });

// Lista properties do usuário disponíveis para vincular (mesma cidade, sem grupo).
export const listLinkableProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ propertyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { prop, isAdmin } = await getMembershipForProperty(context, data.propertyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = cityKey(prop.city ?? "");
    let q = supabaseAdmin
      .from("properties")
      .select("id, name, slug, city, owner_id")
      .neq("id", data.propertyId)
      .order("name", { ascending: true });
    if (!isAdmin) q = q.eq("owner_id", context.userId);
    const { data: all } = await q;

    // Filtra por mesma cidade e remove os que já estão em qualquer grupo
    const sameCity = (all ?? []).filter((p) => cityKey(p.city ?? "") === key);
    if (sameCity.length === 0) return [] as Array<{ id: string; name: string; slug: string | null; city: string | null }>;
    const ids = sameCity.map((p) => p.id);
    const { data: existing } = await supabaseAdmin
      .from("city_reference_group_members")
      .select("property_id")
      .in("property_id", ids);
    const taken = new Set((existing ?? []).map((r) => r.property_id));
    return sameCity
      .filter((p) => !taken.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, slug: p.slug, city: p.city }));
  });

// ============ MUTATIONS ============
// Move TODAS as refs com escopo individual desta property (property_id=X, sem group)
// para o group_id informado. Idempotente.
async function promotePropertyRefsToGroup(
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient,
  propertyId: string,
  groupId: string,
) {
  await supabaseAdmin
    .from("city_references")
    .update({ group_id: groupId, property_id: null } as never)
    .eq("property_id", propertyId)
    .is("group_id", null);
}

// Reseta (apaga) refs individuais de uma property antes de ela receber as do grupo.
async function wipePropertyOwnRefs(
  supabaseAdmin: import("@supabase/supabase-js").SupabaseClient,
  propertyId: string,
) {
  await supabaseAdmin
    .from("city_references")
    .delete()
    .eq("property_id", propertyId)
    .is("group_id", null);
}

// Cria/garante um grupo e adiciona properties.
// Fluxo: a property âncora é o "PAI" — suas refs viram as do grupo. Demais
// properties são RESETADAS (refs individuais apagadas) e então passam a
// enxergar as do grupo. A partir daí, qualquer alteração em qualquer guia
// vinculado é bidirecional (todos leem/escrevem no mesmo group_id).
const LinkSchema = z.object({
  propertyId: z.string().uuid(), // âncora (PAI)
  addPropertyIds: z.array(z.string().uuid()).default([]),
  groupName: z.string().max(120).optional(),
});

export const linkPropertiesToGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => LinkSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { prop } = await getMembershipForProperty(context, data.propertyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const key = cityKey(prop.city ?? "");
    if (!key) throw new Error("Defina a cidade do imóvel âncora antes.");

    // Já tem grupo?
    const { data: existing } = await supabaseAdmin
      .from("city_reference_group_members")
      .select("group_id")
      .eq("property_id", data.propertyId)
      .maybeSingle();

    let groupId = (existing?.group_id as string | null) ?? null;
    if (!groupId) {
      const { data: gRow, error: gErr } = await supabaseAdmin
        .from("city_reference_groups")
        .insert({
          name: data.groupName?.trim() || `${prop.city ?? "Grupo"} — compartilhado`,
          city_key: key,
          created_by: context.userId,
        } as never)
        .select("id")
        .single();
      if (gErr) throw new Error(gErr.message);
      groupId = (gRow as { id: string }).id;
      await supabaseAdmin
        .from("city_reference_group_members")
        .insert({ group_id: groupId, property_id: data.propertyId } as never);
      // Promove as refs do PAI para o grupo.
      await promotePropertyRefsToGroup(supabaseAdmin, data.propertyId, groupId);
    }

    // Adiciona os demais (filhos): RESET das refs individuais antes de
    // entrarem no grupo. Eles passam a ler exclusivamente do grupo (PAI).
    if (data.addPropertyIds.length > 0) {
      const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
      const { data: rows } = await supabaseAdmin
        .from("properties")
        .select("id, owner_id, city")
        .in("id", data.addPropertyIds);
      const allowed = (rows ?? []).filter((r) => (isAdmin || r.owner_id === context.userId) && cityKey(r.city ?? "") === key);
      if (allowed.length === 0) return { ok: true, group_id: groupId, added: 0 };

      for (const r of allowed) {
        await wipePropertyOwnRefs(supabaseAdmin, r.id);
      }
      const inserts = allowed.map((r) => ({ group_id: groupId, property_id: r.id }));
      await supabaseAdmin
        .from("city_reference_group_members")
        .upsert(inserts as never, { onConflict: "property_id", ignoreDuplicates: true });

      return { ok: true, group_id: groupId, added: allowed.length };
    }
    return { ok: true, group_id: groupId, added: 0 };
  });


const UnlinkSchema = z.object({ propertyId: z.string().uuid(), removeIds: z.array(z.string().uuid()).optional() });
export const unlinkPropertyFromGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UnlinkSchema.parse(i))
  .handler(async ({ data, context }) => {
    await getMembershipForProperty(context, data.propertyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const targets = data.removeIds && data.removeIds.length > 0 ? data.removeIds : [data.propertyId];
    await supabaseAdmin.from("city_reference_group_members").delete().in("property_id", targets);
    return { ok: true, removed: targets.length };
  });

const RenameSchema = z.object({ groupId: z.string().uuid(), name: z.string().min(1).max(120) });
export const renameCityGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RenameSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Permite se o usuário é membro do grupo (ou admin)
    const { data: ok } = await context.supabase.rpc("user_is_group_member", {
      _user_id: context.userId,
      _group_id: data.groupId,
    });
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!ok && !isAdmin) throw new Error("Sem permissão");
    await supabaseAdmin.from("city_reference_groups").update({ name: data.name.trim() }).eq("id", data.groupId);
    return { ok: true };
  });
