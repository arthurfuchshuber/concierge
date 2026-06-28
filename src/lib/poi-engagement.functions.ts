import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PoiType = z.enum([
  "city_reference",
  "recommendation",
  "sigma_city_reference",
  "marketplace_link",
]);
const EventType = z.enum(["view", "share", "like", "dislike"]);

const RecordInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  poi_key: z.string().trim().min(1).max(200),
  poi_type: PoiType,
  event_type: EventType,
  anon_id: z.string().trim().min(8).max(80),
});

const CountsInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
});

const ReactionsInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  anon_id: z.string().trim().min(8).max(80),
});

async function resolvePropertyId(slug: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("properties")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return (data?.id as string | null) ?? null;
}

export const recordPoiEngagement = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => RecordInput.parse(i))
  .handler(async ({ data }) => {
    const propertyId = await resolvePropertyId(data.slug);
    if (!propertyId) return { ok: false as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Reactions: like/dislike are mutually exclusive — clicking again toggles off.
    if (data.event_type === "like" || data.event_type === "dislike") {
      const opposite = data.event_type === "like" ? "dislike" : "like";
      // Remove opposite reaction first
      await supabaseAdmin
        .from("poi_engagement_events")
        .delete()
        .eq("property_id", propertyId)
        .eq("poi_key", data.poi_key)
        .eq("anon_id", data.anon_id)
        .eq("event_type", opposite);
      // Toggle: if same reaction exists, remove it; otherwise insert.
      const { data: existing } = await supabaseAdmin
        .from("poi_engagement_events")
        .select("id")
        .eq("property_id", propertyId)
        .eq("poi_key", data.poi_key)
        .eq("anon_id", data.anon_id)
        .eq("event_type", data.event_type)
        .maybeSingle();
      if (existing?.id) {
        await supabaseAdmin.from("poi_engagement_events").delete().eq("id", existing.id);
        return { ok: true as const, state: "off" as const };
      }
      await supabaseAdmin.from("poi_engagement_events").insert({
        property_id: propertyId,
        poi_key: data.poi_key,
        poi_type: data.poi_type,
        event_type: data.event_type,
        anon_id: data.anon_id,
      });
      return { ok: true as const, state: "on" as const };
    }

    // Views: de-duplicate per anon per POI per day.
    if (data.event_type === "view") {
      const sinceMidnight = new Date();
      sinceMidnight.setHours(0, 0, 0, 0);
      const { data: dup } = await supabaseAdmin
        .from("poi_engagement_events")
        .select("id")
        .eq("property_id", propertyId)
        .eq("poi_key", data.poi_key)
        .eq("anon_id", data.anon_id)
        .eq("event_type", "view")
        .gte("created_at", sinceMidnight.toISOString())
        .maybeSingle();
      if (dup?.id) return { ok: true as const, state: "dup" as const };
    }

    await supabaseAdmin.from("poi_engagement_events").insert({
      property_id: propertyId,
      poi_key: data.poi_key,
      poi_type: data.poi_type,
      event_type: data.event_type,
      anon_id: data.anon_id,
    });
    return { ok: true as const, state: "on" as const };
  });

export type PoiCounts = Record<
  string,
  { views: number; likes: number; dislikes: number; shares: number }
>;

export const getPoiEngagementCounts = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => CountsInput.parse(i))
  .handler(async ({ data }): Promise<{ counts: PoiCounts }> => {
    const propertyId = await resolvePropertyId(data.slug);
    if (!propertyId) return { counts: {} };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("poi_engagement_events")
      .select("poi_key,event_type")
      .eq("property_id", propertyId)
      .limit(50000);
    const counts: PoiCounts = {};
    for (const r of rows ?? []) {
      const k = r.poi_key as string;
      if (!counts[k]) counts[k] = { views: 0, likes: 0, dislikes: 0, shares: 0 };
      const et = r.event_type as string;
      if (et === "view") counts[k].views++;
      else if (et === "like") counts[k].likes++;
      else if (et === "dislike") counts[k].dislikes++;
      else if (et === "share") counts[k].shares++;
    }
    return { counts };
  });

export const getMyPoiReactions = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => ReactionsInput.parse(i))
  .handler(async ({ data }) => {
    const propertyId = await resolvePropertyId(data.slug);
    if (!propertyId) return { reactions: {} as Record<string, "like" | "dislike"> };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("poi_engagement_events")
      .select("poi_key,event_type")
      .eq("property_id", propertyId)
      .eq("anon_id", data.anon_id)
      .in("event_type", ["like", "dislike"]);
    const out: Record<string, "like" | "dislike"> = {};
    for (const r of rows ?? []) {
      out[r.poi_key as string] = r.event_type as "like" | "dislike";
    }
    return { reactions: out };
  });

export const getMarketplaceClicks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ property_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows } = await supabase
      .from("poi_engagement_events")
      .select("poi_key")
      .eq("property_id", data.property_id)
      .eq("poi_type", "marketplace_link")
      .eq("event_type", "view");
    const counts: Record<string, number> = {};
    for (const r of rows ?? []) {
      const k = r.poi_key as string;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return { counts };
  });
