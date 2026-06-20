import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getEngagementOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: props, error: propsErr } = await supabase
      .from("properties")
      .select("id, name, slug, published, updated_at")
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
        hostUsability: {
          totalGuides: 0,
          publishedGuides: 0,
          guidesWithFaqs: 0,
          guidesWithKnowledge: 0,
          guidesWithBehavior: 0,
          lastEditedAt: null as string | null,
        },
      };
    }

    const [
      { data: logs, error: logsErr },
      { data: convs, error: convsErr },
      { data: msgs, error: msgsErr },
      { data: feedback, error: fbErr },
      { count: faqsCount },
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
      supabase.from("property_faqs").select("property_id", { count: "exact", head: true }).in("property_id", propertyIds),
      supabase.from("host_knowledge").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("enabled", true),
      supabase.from("host_behavior").select("id", { count: "exact", head: true }).eq("owner_id", userId).eq("enabled", true),
    ]);
    if (logsErr) throw logsErr;
    if (convsErr) throw convsErr;
    if (msgsErr) throw msgsErr;
    if (fbErr) throw fbErr;

    type PropMetric = {
      name: string;
      slug: string;
      accesses: number;
      conversations: number;
      messages: number;
      uniqueGuests: Set<string>;
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
        lastAccess: null,
        feedbackCount: 0,
      });
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
      const propId = (msg as any).property_chat_conversations?.property_id as string | undefined;
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
      last_access: m.lastAccess,
      feedback_count: m.feedbackCount,
    }));

    // 30-day time series of accesses & conversations
    const now = new Date();
    const days: string[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const dayMap = new Map<string, { date: string; accesses: number; conversations: number }>();
    for (const d of days) dayMap.set(d, { date: d, accesses: 0, conversations: 0 });
    for (const l of logs ?? []) {
      const d = String(l.created_at).slice(0, 10);
      const e = dayMap.get(d);
      if (e) e.accesses++;
    }
    for (const c of convs ?? []) {
      const d = String(c.created_at).slice(0, 10);
      const e = dayMap.get(d);
      if (e) e.conversations++;
    }
    const timeseries = Array.from(dayMap.values());

    // Host usability — distinct properties that have FAQs (count > 0)
    const { data: faqRows } = await supabase
      .from("property_faqs")
      .select("property_id")
      .in("property_id", propertyIds);
    const propsWithFaqs = new Set((faqRows ?? []).map((r) => r.property_id));
    const lastEditedAt = (props ?? []).reduce<string | null>((acc, p) => {
      const t = (p as any).updated_at as string | null;
      if (!t) return acc;
      if (!acc || t > acc) return t;
      return acc;
    }, null);

    const propLookup = new Map((props ?? []).map((p) => [p.id, p.name as string]));
    const logsWithProp = (logs ?? []).map((l) => ({ ...l, property_name: propLookup.get(l.property_id) ?? "—" }));
    const convsWithProp = (convs ?? []).map((c) => ({ ...c, property_name: propLookup.get(c.property_id) ?? "—" }));

    void faqsCount;
    return {
      properties: props ?? [],
      logs: logsWithProp,
      conversations: convsWithProp,
      metrics,
      feedback: feedback ?? [],
      timeseries,
      hostUsability: {
        totalGuides: (props ?? []).length,
        publishedGuides: (props ?? []).filter((p) => (p as any).published).length,
        guidesWithFaqs: propsWithFaqs.size,
        guidesWithKnowledge: knowCount ?? 0,
        guidesWithBehavior: behCount ?? 0,
        lastEditedAt,
      },
    };
  });
