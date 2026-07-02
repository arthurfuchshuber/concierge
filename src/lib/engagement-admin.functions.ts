import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Detect device type from user_agent string
function detectDevice(ua: string | null): "mobile" | "tablet" | "desktop" {
  if (!ua) return "desktop";
  const u = ua.toLowerCase();
  if (/ipad|android(?!.*mobile)|tablet/i.test(u)) return "tablet";
  if (/iphone|android.*mobile|mobile|blackberry|windows phone/i.test(u)) return "mobile";
  return "desktop";
}

export const getEngagementOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: props, error: propsErr } = await supabase
      .from("properties")
      .select("id, name, slug, published, updated_at, wifi_ssid, wifi_password, checkin_instructions, house_rules, tagline, hero_image_url, recommendations:property_recommendations(id)")
      .eq("owner_id", userId)
      .order("name", { ascending: true });
    if (propsErr) throw propsErr;

    const propertyIds = (props ?? []).map((p) => p.id);
    if (propertyIds.length === 0) {
      return {
        properties: [],
        logs: [],
        conversations: [],
        metrics: [],
        feedback: [],
        timeseries: [],
        sectionEvents: [],
        deviceBreakdown: { mobile: 0, tablet: 0, desktop: 0 },
        hostUsability: {
          totalGuides: 0,
          publishedGuides: 0,
          guidesWithFaqs: 0,
          guidesWithKnowledge: 0,
          guidesWithBehavior: 0,
          lastEditedAt: null as string | null,
          guideCompleteness: [] as Array<{ id: string; name: string; score: number; published: boolean }>,
        },
      };
    }

    const [
      { data: logs, error: logsErr },
      { data: convs, error: convsErr },
      { data: msgs, error: msgsErr },
      { data: feedback, error: fbErr },
      { count: knowCount },
      { count: behCount },
    ] = await Promise.all([
      supabase
        .from("guide_access_logs")
        .select("id, property_id, guest_name, reservation_code, checkin_date, guest_phone, guest_phone_country, user_agent, created_at")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase
        .from("property_chat_conversations")
        .select("id, property_id, guest_name, guest_session_id, created_at, last_message_at")
        .in("property_id", propertyIds)
        .order("last_message_at", { ascending: false })
        .limit(1000),
      supabase
        .from("property_chat_messages")
        .select("id, conversation_id, role, created_at, property_chat_conversations!inner(property_id)")
        .in("property_chat_conversations.property_id", propertyIds)
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("chat_message_feedback")
        .select("message_id, conversation_id, property_id, reason, resolved, behavior_id, created_at")
        .eq("owner_id", userId),
      supabase.from("host_knowledge").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("enabled", true),
      supabase.from("host_behavior").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("enabled", true),
    ]);
    if (logsErr) throw logsErr;
    if (convsErr) throw convsErr;
    if (msgsErr) throw msgsErr;
    if (fbErr) throw fbErr;

    // Section events — track which sections guests open (fire-and-forget, table may not exist yet)
    let sectionEventsRaw: Array<{ property_id: string; section: string; created_at: string }> = [];
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: se } = await (supabaseAdmin.from("guide_section_events" as never) as ReturnType<typeof supabaseAdmin.from>)
        .select("property_id, section, created_at")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false })
        .limit(5000) as { data: typeof sectionEventsRaw | null };
      sectionEventsRaw = se ?? [];
    } catch {
      // Table may not exist yet — degrade gracefully
    }

    // Section aggregation: count by section across all properties
    const sectionCount = new Map<string, number>();
    const sectionByProp = new Map<string, Map<string, number>>();
    for (const e of sectionEventsRaw) {
      sectionCount.set(e.section, (sectionCount.get(e.section) ?? 0) + 1);
      let m = sectionByProp.get(e.property_id);
      if (!m) { m = new Map(); sectionByProp.set(e.property_id, m); }
      m.set(e.section, (m.get(e.section) ?? 0) + 1);
    }
    const sectionEvents = Array.from(sectionCount.entries())
      .map(([section, count]) => ({ section, count }))
      .sort((a, b) => b.count - a.count);
    const sectionEventsByProperty: Record<string, Array<{ section: string; count: number }>> = {};
    for (const [pid, m] of sectionByProp.entries()) {
      sectionEventsByProperty[pid] = Array.from(m.entries())
        .map(([section, count]) => ({ section, count }))
        .sort((a, b) => b.count - a.count);
    }

    // Device breakdown from user_agent (global + per property)
    const deviceBreakdown = { mobile: 0, tablet: 0, desktop: 0 };
    const deviceByProp: Record<string, { mobile: number; tablet: number; desktop: number }> = {};
    for (const l of logs ?? []) {
      const d = detectDevice(l.user_agent);
      deviceBreakdown[d]++;
      const cur = deviceByProp[l.property_id] ?? { mobile: 0, tablet: 0, desktop: 0 };
      cur[d]++;
      deviceByProp[l.property_id] = cur;
    }

    type PropMetric = {
      name: string;
      slug: string;
      accesses: number;
      conversations: number;
      messages: number;
      uniqueGuests: Set<string>;
      sessionsWithoutChat: number;
      lastAccess: string | null;
      feedbackCount: number;
    };
    const byProp = new Map<string, PropMetric>();
    for (const p of props ?? []) {
      byProp.set(p.id, {
        name: p.name as string,
        slug: p.slug as string,
        accesses: 0,
        conversations: 0,
        messages: 0,
        uniqueGuests: new Set(),
        sessionsWithoutChat: 0,
        lastAccess: null,
        feedbackCount: 0,
      });
    }

    // Track sessions that started a conversation
    const sessionsWithChat = new Set<string>();
    for (const c of convs ?? []) {
      sessionsWithChat.add(`${c.property_id}:${c.guest_session_id}`);
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
    for (const msg of msgs ?? []) {
      const propId = (msg as { property_chat_conversations?: { property_id?: string } }).property_chat_conversations?.property_id;
      if (!propId) continue;
      const m = byProp.get(propId);
      if (m) m.messages++;
    }
    for (const f of feedback ?? []) {
      const m = byProp.get(f.property_id);
      if (m) m.feedbackCount++;
    }

    const metrics = Array.from(byProp.entries()).map(([id, m]) => ({
      property_id: id,
      property_name: m.name,
      property_slug: m.slug,
      total_accesses: m.accesses,
      total_conversations: m.conversations,
      total_messages: m.messages,
      unique_guests: m.uniqueGuests.size,
      ai_adoption_rate: m.accesses > 0 ? Math.round((m.conversations / m.accesses) * 100) : 0,
      last_access: m.lastAccess,
      feedback_count: m.feedbackCount,
    }));

    // 30-day time series
    const now = new Date();
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const dayMap = new Map<string, { date: string; accesses: number; conversations: number }>();
    for (const d of days) dayMap.set(d, { date: d, accesses: 0, conversations: 0 });
    const timeseriesByProp: Record<string, Array<{ date: string; accesses: number; conversations: number }>> = {};
    function ensureProp(pid: string) {
      if (!timeseriesByProp[pid]) {
        timeseriesByProp[pid] = days.map((d) => ({ date: d, accesses: 0, conversations: 0 }));
      }
      return timeseriesByProp[pid];
    }
    for (const l of logs ?? []) {
      const d = String(l.created_at).slice(0, 10);
      const e = dayMap.get(d);
      if (e) e.accesses++;
      const arr = ensureProp(l.property_id);
      const idx = days.indexOf(d);
      if (idx >= 0) arr[idx].accesses++;
    }
    for (const c of convs ?? []) {
      const d = String(c.created_at).slice(0, 10);
      const e = dayMap.get(d);
      if (e) e.conversations++;
      const arr = ensureProp(c.property_id);
      const idx = days.indexOf(d);
      if (idx >= 0) arr[idx].conversations++;
    }
    const timeseries = Array.from(dayMap.values());

    // Guide completeness score (0–100)
    function guideScore(p: NonNullable<typeof props>[number]): number {
      let score = 0;
      if (p.published) score += 20;
      if (p.hero_image_url) score += 15;
      if (p.tagline) score += 10;
      if (p.wifi_ssid) score += 15;
      if (p.checkin_instructions) score += 20;
      if (p.house_rules) score += 10;
      if (p.wifi_password) score += 10;
      const recCount = Array.isArray((p as { recommendations?: unknown[] }).recommendations)
        ? ((p as { recommendations: unknown[] }).recommendations).length
        : 0;
      if (recCount > 0) score += 0; // already counted via published
      return Math.min(score, 100);
    }

    // FAQs per property
    const { data: faqRows } = await supabase
      .from("property_faqs")
      .select("property_id")
      .in("property_id", propertyIds);
    const propsWithFaqs = new Set((faqRows ?? []).map((r) => r.property_id));

    const lastEditedAt = (props ?? []).reduce<string | null>((acc, p) => {
      const t = (p as { updated_at?: string | null }).updated_at ?? null;
      if (!t) return acc;
      if (!acc || t > acc) return t;
      return acc;
    }, null);

    const guideCompleteness = (props ?? []).map((p) => ({
      id: p.id,
      name: p.name as string,
      score: guideScore(p),
      published: !!(p as { published?: boolean }).published,
    }));

    const propLookup = new Map((props ?? []).map((p) => [p.id, p.name as string]));
    const logsWithProp = (logs ?? []).map((l) => ({ ...l, property_name: propLookup.get(l.property_id) ?? "—" }));
    const convsWithProp = (convs ?? []).map((c) => ({ ...c, property_name: propLookup.get(c.property_id) ?? "—" }));

    return {
      properties: props ?? [],
      logs: logsWithProp,
      conversations: convsWithProp,
      metrics,
      feedback: feedback ?? [],
      timeseries,
      timeseriesByProperty: timeseriesByProp,
      sectionEvents,
      sectionEventsByProperty,
      deviceBreakdown,
      deviceByProperty: deviceByProp,
      hostUsability: {
        totalGuides: (props ?? []).length,
        publishedGuides: (props ?? []).filter((p) => !!(p as { published?: boolean }).published).length,
        guidesWithFaqs: propsWithFaqs.size,
        guidesWithKnowledge: knowCount ?? 0,
        guidesWithBehavior: behCount ?? 0,
        lastEditedAt,
        guideCompleteness,
      },
    };
  });
