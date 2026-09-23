import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const EventInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  section: z.string().min(1).max(40),
  sessionId: z.string().min(8).max(80),
  guestName: z.string().max(120).optional().nullable(),
  guestPhone: z.string().max(40).optional().nullable(),
  pagePath: z.string().max(200).optional().nullable(),
});

export const trackGuideEvent = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => EventInput.parse(i))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: prop } = await supabaseAdmin
        .from("properties")
        .select("id")
        .eq("slug", data.slug)
        .eq("published", true)
        .maybeSingle();
      if (!prop) return { ok: false };
      await (supabaseAdmin.from("guide_section_events" as never) as ReturnType<typeof supabaseAdmin.from>)
        .insert({
          property_id: prop.id,
          section: data.section,
          guest_session_id: data.sessionId,
          guest_name: data.guestName ?? null,
          guest_phone: data.guestPhone ?? null,
          page_path: data.pagePath ?? null,
        })
        .throwOnError();
    } catch {
      // Analytics failure never surfaces to user
    }
    return { ok: true };
  });

/**
 * Live presence — retorna sessões ativas (últimos 5 min) por hóspede,
 * agrupando o último evento por sessão. Admin-only (do owner).
 */
export const getLivePresence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: props } = await supabase
      .from("properties")
      .select("id, name, slug")
      .eq("owner_id", userId);
    const propertyIds = (props ?? []).map((p) => p.id);
    if (propertyIds.length === 0) return { sessions: [] as Array<{
      session_id: string;
      guest_name: string | null;
      guest_phone: string | null;
      section: string;
      page_path: string | null;
      property_id: string;
      property_name: string;
      property_slug: string;
      last_seen: string;
      first_seen: string;
      events_count: number;
    }> };

    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: events } = await (supabaseAdmin.from("guide_section_events" as never) as ReturnType<typeof supabaseAdmin.from>)
      .select("property_id, section, guest_session_id, guest_name, guest_phone, page_path, created_at")
      .in("property_id", propertyIds)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000) as { data: Array<{
        property_id: string;
        section: string;
        guest_session_id: string | null;
        guest_name: string | null;
        guest_phone: string | null;
        page_path: string | null;
        created_at: string;
      }> | null };

    const propMap = new Map((props ?? []).map((p) => [p.id, p]));
    const map = new Map<string, {
      session_id: string;
      guest_name: string | null;
      guest_phone: string | null;
      section: string;
      page_path: string | null;
      property_id: string;
      property_name: string;
      property_slug: string;
      last_seen: string;
      first_seen: string;
      events_count: number;
    }>();
    for (const e of events ?? []) {
      const sid = e.guest_session_id ?? "anon";
      const key = `${e.property_id}:${sid}`;
      const prop = propMap.get(e.property_id);
      if (!prop) continue;
      const cur = map.get(key);
      if (!cur) {
        map.set(key, {
          session_id: sid,
          guest_name: e.guest_name,
          guest_phone: e.guest_phone,
          section: e.section,
          page_path: e.page_path,
          property_id: e.property_id,
          property_name: (prop as { name: string }).name,
          property_slug: (prop as { slug: string }).slug,
          last_seen: e.created_at,
          first_seen: e.created_at,
          events_count: 1,
        });
      } else {
        cur.events_count += 1;
        if (e.created_at < cur.first_seen) cur.first_seen = e.created_at;
        // events are desc, so last_seen already set
      }
    }
    const sessions = Array.from(map.values()).sort((a, b) => b.last_seen.localeCompare(a.last_seen));
    return { sessions };
  });
