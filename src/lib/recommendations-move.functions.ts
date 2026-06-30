import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { cityKey } from "@/lib/city-key";

/**
 * Server functions para gerenciar movimentação de pontos entre
 * `property_recommendations` (scope=nearby — "Aqui Pertinho") e
 * `city_references` (compartilhado por cidade ou por grupo).
 *
 * Regras de auto-decisão (addPlaceAuto):
 *   - nearby  : distância ≤ 1500 m  OU  ≤ 20 min a pé.
 *   - city    : demais casos. Independe de avaliação para que o anfitrião
 *               consiga adicionar pontos novos manualmente; a regra de
 *               qualidade (rating ≥ 4.5 & ≥ 500 reviews) só limita a geração
 *               automática por IA, não a inserção manual.
 */

// ---------- helpers de autorização ----------
async function ensureOwnerOrAdmin(
  ctx: { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string },
  propertyId: string,
) {
  const { data: prop, error } = await ctx.supabase
    .from("properties")
    .select("id, owner_id, lat, lng, city")
    .eq("id", propertyId)
    .maybeSingle();
  if (error || !prop) throw new Error("Imóvel não encontrado.");
  const { data: isAdmin } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (prop.owner_id !== ctx.userId && !isAdmin) throw new Error("Sem permissão.");
  return prop as { id: string; owner_id: string; lat: number | null; lng: number | null; city: string | null };
}

// Decide o destino com base em distância/tempo a pé.
export function decideScope(input: { distance_meters?: number | null; walk_minutes?: number | null }): "nearby" | "city" {
  const d = input.distance_meters ?? null;
  const w = input.walk_minutes ?? null;
  if ((d != null && d <= 1500) || (w != null && w <= 20)) return "nearby";
  return "city";
}

// ---------- addPlaceAuto ----------
const AddPlaceAutoSchema = z.object({
  propertyId: z.string().uuid(),
  placeId: z.string().min(1),
  forceScope: z.enum(["nearby", "city"]).optional(),
});

export const addPlaceAuto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AddPlaceAutoSchema.parse(i))
  .handler(async ({ data, context }) => {
    const prop = await ensureOwnerOrAdmin(context, data.propertyId);
    const { fetchPlaceDetails, pickBestPlacePhoto, haversineMeters, formatDistance } = await import(
      "@/lib/maps.functions"
    );
    const { loadTaxonomyCached } = await import("@/lib/poi-taxonomy.functions");

    const p = await fetchPlaceDetails(data.placeId);
    if (!p || !p.location) throw new Error("Local não encontrado no Google.");

    // Resolve tag (type) a partir do primaryType, com fallback para "other".
    const taxonomy = await loadTaxonomyCached();
    const primary = (p.primaryType ?? "").toLowerCase();
    const matchedTag =
      taxonomy.tags.find((t) => t.accepted_primary_types.includes(primary)) ??
      taxonomy.tags.find((t) => t.slug === "other") ??
      taxonomy.tags[0];

    const noteText = p.editorialSummary?.text ?? p.generativeSummary?.overview?.text ?? null;
    const note = noteText && noteText.length > 240 ? noteText.slice(0, 237).trimEnd() + "…" : noteText;
    const image_url = pickBestPlacePhoto(p.photos) ?? null;
    const maps_url = p.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query_place_id=${p.id}`;

    let distance_meters: number | null = null;
    let distance_text: string | null = null;
    let walk_minutes: number | null = null;
    let drive_minutes: number | null = null;
    if (prop.lat != null && prop.lng != null) {
      const d = haversineMeters({ lat: prop.lat, lng: prop.lng }, { lat: p.location.latitude, lng: p.location.longitude });
      distance_meters = d;
      const fmt = formatDistance(d);
      distance_text = fmt.text;
      walk_minutes = fmt.walkMin;
      drive_minutes = fmt.driveMin;
    }

    const scope = data.forceScope ?? decideScope({ distance_meters, walk_minutes });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (scope === "nearby") {
      // duplicado?
      const { data: dup } = await supabaseAdmin
        .from("property_recommendations")
        .select("id")
        .eq("property_id", data.propertyId)
        .eq("place_id", p.id)
        .maybeSingle();
      if (dup) return { ok: true, scope: "nearby", id: dup.id, duplicate: true };

      const { data: row, error } = await supabaseAdmin
        .from("property_recommendations")
        .insert({
          property_id: data.propertyId,
          scope: "nearby",
          type: matchedTag.slug as never,
          name: p.displayName?.text ?? "Sem nome",
          category: matchedTag.category_label,
          place_id: p.id,
          rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
          user_ratings_total: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
          opening_hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
          image_url,
          maps_url,
          note,
          distance_meters,
          distance_text,
          walk_minutes,
          drive_minutes,
          position: 0,
          last_synced_at: new Date().toISOString(),
        } as never)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { ok: true, scope: "nearby" as const, id: row.id, duplicate: false };
    }

    // scope === 'city' — usa group_id se a property pertence a um grupo, senão city_key
    const { data: membership } = await supabaseAdmin
      .from("city_reference_group_members")
      .select("group_id")
      .eq("property_id", data.propertyId)
      .maybeSingle();
    const groupId = membership?.group_id ?? null;
    const key = cityKey(prop.city ?? "");
    if (!groupId && !key) throw new Error("Defina a cidade do imóvel antes.");

    // duplicado por (group_id|city_key) + place_id
    let dupQ = supabaseAdmin
      .from("city_references")
      .select("id")
      .eq("place_id", p.id);
    dupQ = groupId ? dupQ.eq("group_id", groupId) : dupQ.eq("city_key", key).is("group_id", null);
    const { data: dup } = await dupQ.maybeSingle();
    if (dup) return { ok: true, scope: "city" as const, id: dup.id, duplicate: true };

    const { data: row, error } = await supabaseAdmin
      .from("city_references")
      .insert({
        city_key: key,
        city_label: prop.city ?? "",
        group_id: groupId,
        type: matchedTag.slug,
        category: matchedTag.category_label,
        place_id: p.id,
        name: p.displayName?.text ?? "Sem nome",
        rating: typeof p.rating === "number" ? Number(p.rating.toFixed(1)) : null,
        user_ratings_total: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        opening_hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
        primary_type: p.primaryType ?? null,
        lat: p.location.latitude,
        lng: p.location.longitude,
        image_url,
        maps_url,
        note,
        source: "manual",
        is_hidden: false,
        display_order: 500,
        last_synced_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, scope: "city" as const, id: row.id, duplicate: false };
  });

// ---------- moveRecommendations ----------
const MoveSchema = z.object({
  propertyId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1),
  from: z.enum(["nearby", "city"]),
  to: z.enum(["nearby", "city"]),
});

export const moveRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => MoveSchema.parse(i))
  .handler(async ({ data, context }) => {
    if (data.from === data.to) return { ok: true, moved: 0 };
    const prop = await ensureOwnerOrAdmin(context, data.propertyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.from === "nearby" && data.to === "city") {
      const { data: rows, error } = await supabaseAdmin
        .from("property_recommendations")
        .select("*")
        .in("id", data.ids)
        .eq("property_id", data.propertyId);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) return { ok: true, moved: 0 };

      const { data: membership } = await supabaseAdmin
        .from("city_reference_group_members")
        .select("group_id")
        .eq("property_id", data.propertyId)
        .maybeSingle();
      const groupId = membership?.group_id ?? null;
      const key = cityKey(prop.city ?? "");
      if (!groupId && !key) throw new Error("Defina a cidade do imóvel antes.");

      const inserts = rows
        .filter((r) => r.place_id)
        .map((r) => ({
          city_key: key,
          city_label: prop.city ?? "",
          group_id: groupId,
          type: r.type,
          category: r.category,
          place_id: r.place_id,
          name: r.name,
          rating: r.rating,
          user_ratings_total: r.user_ratings_total,
          opening_hours: r.opening_hours,
          lat: null,
          lng: null,
          image_url: r.image_url,
          maps_url: r.maps_url,
          note: r.note,
          source: "manual",
          is_hidden: false,
          display_order: 500,
          last_synced_at: new Date().toISOString(),
        }));

      if (inserts.length > 0) {
        await supabaseAdmin.from("city_references").upsert(inserts as never, {
          onConflict: groupId ? "group_id,place_id" : "city_key,place_id",
          ignoreDuplicates: true,
        });
      }

      await supabaseAdmin
        .from("property_recommendations")
        .delete()
        .in("id", rows.map((r) => r.id))
        .eq("property_id", data.propertyId);
      return { ok: true, moved: rows.length };
    }

    // city → nearby
    const { data: rows, error } = await supabaseAdmin
      .from("city_references")
      .select("*")
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return { ok: true, moved: 0 };

    const { fetchPlaceDetails, haversineMeters, formatDistance } = await import("@/lib/maps.functions");
    const hasCoords = prop.lat != null && prop.lng != null;

    const inserts = await Promise.all(
      rows.map(async (r) => {
        let distance_meters: number | null = null;
        let distance_text: string | null = null;
        let walk_minutes: number | null = null;
        let drive_minutes: number | null = null;
        if (hasCoords && r.place_id) {
          const p = await fetchPlaceDetails(r.place_id);
          if (p?.location) {
            const d = haversineMeters(
              { lat: prop.lat as number, lng: prop.lng as number },
              { lat: p.location.latitude, lng: p.location.longitude },
            );
            distance_meters = d;
            const fmt = formatDistance(d);
            distance_text = fmt.text;
            walk_minutes = fmt.walkMin;
            drive_minutes = fmt.driveMin;
          }
        }
        return {
          property_id: data.propertyId,
          scope: "nearby" as const,
          type: r.type,
          name: r.name,
          category: r.category,
          place_id: r.place_id,
          rating: r.rating,
          user_ratings_total: r.user_ratings_total,
          opening_hours: r.opening_hours,
          image_url: r.image_url,
          maps_url: r.maps_url,
          note: r.note,
          distance_meters,
          distance_text,
          walk_minutes,
          drive_minutes,
          position: 0,
          last_synced_at: new Date().toISOString(),
        };
      }),
    );

    await supabaseAdmin.from("property_recommendations").insert(inserts as never);
    // Não deletamos do city_references — outros guias da cidade ainda usam a lista compartilhada.
    return { ok: true, moved: rows.length };
  });
