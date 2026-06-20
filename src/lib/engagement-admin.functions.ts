import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getEngagementOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: props, error: propsErr } = await supabase
      .from("properties")
      .select("id, name, slug, published")
      .eq("owner_id", userId)
      .order("name", { ascending: true });
    if (propsErr) throw propsErr;

    const propertyIds = (props ?? []).map((p) => p.id);
    if (propertyIds.length === 0) {
      return { properties: [], logs: [], conversations: [], metrics: [] };
    }

    const [{ data: logs, error: logsErr }, { data: convs, error: convsErr }] = await Promise.all([
      supabase
        .from("guide_access_logs")
        .select("id, property_id, guest_name, reservation_code, checkin_date, guest_phone, guest_phone_country, user_agent, created_at")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("property_chat_conversations")
        .select("id, property_id, guest_name, guest_session_id, created_at, last_message_at")
        .in("property_id", propertyIds)
        .order("last_message_at", { ascending: false })
        .limit(500),
    ]);
    if (logsErr) throw logsErr;
    if (convsErr) throw convsErr;

    const byProp = new Map<string, { name: string; slug: string; accesses: number; conversations: number; uniqueGuests: Set<string>; lastAccess: string | null }>();
    for (const p of props ?? []) {
      byProp.set(p.id, { name: p.name as string, slug: p.slug as string, accesses: 0, conversations: 0, uniqueGuests: new Set(), lastAccess: null });
    }
    for (const l of logs ?? []) {
      const m = byProp.get(l.property_id);
      if (!m) continue;
      m.accesses++;
      if (l.guest_name) m.uniqueGuests.add(l.guest_name.trim().toLowerCase());
      if (!m.lastAccess || l.created_at > m.lastAccess) m.lastAccess = l.created_at as string;
    }
    for (const c of convs ?? []) {
      const m = byProp.get(c.property_id);
      if (m) m.conversations++;
    }

    const metrics = Array.from(byProp.entries()).map(([id, m]) => ({
      property_id: id,
      property_name: m.name,
      property_slug: m.slug,
      total_accesses: m.accesses,
      total_conversations: m.conversations,
      unique_guests: m.uniqueGuests.size,
      last_access: m.lastAccess,
    }));

    const propLookup = new Map((props ?? []).map((p) => [p.id, p.name as string]));
    const logsWithProp = (logs ?? []).map((l) => ({ ...l, property_name: propLookup.get(l.property_id) ?? "—" }));
    const convsWithProp = (convs ?? []).map((c) => ({ ...c, property_name: propLookup.get(c.property_id) ?? "—" }));

    return {
      properties: props ?? [],
      logs: logsWithProp,
      conversations: convsWithProp,
      metrics,
    };
  });
