import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Motor de dados para a página Engajamento (Behavioral Analytics).
 *
 * Retorna UM único DTO com todas as fatias que a nova página consome,
 * já filtrado por período/imóvel/dispositivo. A ideia é minimizar
 * cálculos pesados no cliente — o Recharts recebe arrays prontos.
 */

const InputSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
  propertyId: z.string().nullable().optional(),
  device: z.enum(["all", "mobile", "tablet", "desktop"]).default("all"),
});

function detectDevice(ua: string | null): "mobile" | "tablet" | "desktop" {
  if (!ua) return "desktop";
  const u = ua.toLowerCase();
  if (/ipad|android(?!.*mobile)|tablet/i.test(u)) return "tablet";
  if (/iphone|android.*mobile|mobile|blackberry|windows phone/i.test(u)) return "mobile";
  return "desktop";
}

function daysFor(period: "7d" | "30d" | "90d" | "all"): number {
  if (period === "7d") return 7;
  if (period === "30d") return 30;
  if (period === "90d") return 90;
  return 365; // "all" ainda capamos em 1 ano para performance
}

function completenessScore(p: {
  published?: boolean | null;
  hero_image_url?: string | null;
  tagline?: string | null;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  checkin_instructions?: string | null;
  house_rules?: string | null;
}): number {
  let s = 0;
  if (p.published) s += 20;
  if (p.hero_image_url) s += 15;
  if (p.tagline) s += 10;
  if (p.wifi_ssid) s += 15;
  if (p.wifi_password) s += 10;
  if (p.checkin_instructions) s += 20;
  if (p.house_rules) s += 10;
  return Math.min(s, 100);
}

export type EngagementAnalytics = Awaited<ReturnType<typeof runAnalytics>>;

async function runAnalytics(input: z.infer<typeof InputSchema>, ctx: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  userId: string;
}) {
  const { supabase, userId } = ctx;
  const days = daysFor(input.period);
  const since = new Date(Date.now() - days * 86400_000);
  const prevSince = new Date(Date.now() - days * 2 * 86400_000);

  // ------- properties ---------------------------------------------------
  const { data: propsRaw, error: pErr } = await supabase
    .from("properties")
    .select("id, name, slug, published, updated_at, wifi_ssid, wifi_password, checkin_instructions, house_rules, tagline, hero_image_url")
    .eq("owner_id", userId)
    .order("name", { ascending: true });
  if (pErr) throw pErr;
  const properties = (propsRaw ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    slug: p.slug as string,
    published: !!p.published,
    completeness: completenessScore(p),
  }));

  const allIds = properties.map((p) => p.id);
  const filteredIds = input.propertyId && input.propertyId !== "all"
    ? [input.propertyId]
    : allIds;

  if (filteredIds.length === 0) {
    return emptyPayload(properties);
  }

  // ------- pulls em paralelo -------------------------------------------
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [
    logsQ, prevLogsQ, convsQ, msgsQ, feedbackQ, sectionsQ, poiQ,
  ] = await Promise.all([
    supabase
      .from("guide_access_logs")
      .select("id, property_id, guest_name, user_agent, created_at")
      .in("property_id", filteredIds)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(10000),
    supabase
      .from("guide_access_logs")
      .select("id, property_id, created_at")
      .in("property_id", filteredIds)
      .gte("created_at", prevSince.toISOString())
      .lt("created_at", since.toISOString())
      .limit(10000),
    supabase
      .from("property_chat_conversations")
      .select("id, property_id, guest_session_id, created_at, last_message_at")
      .in("property_id", filteredIds)
      .gte("created_at", since.toISOString())
      .limit(5000),
    supabase
      .from("property_chat_messages")
      .select("id, conversation_id, role, content, created_at, property_chat_conversations!inner(property_id)")
      .in("property_chat_conversations.property_id", filteredIds)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .limit(10000),
    supabase
      .from("chat_message_feedback")
      .select("message_id, conversation_id, property_id, reason, resolved, created_at")
      .eq("owner_id", userId)
      .in("property_id", filteredIds)
      .gte("created_at", since.toISOString()),
    (supabaseAdmin.from("guide_section_events" as never) as ReturnType<typeof supabaseAdmin.from>)
      .select("property_id, section, guest_session_id, created_at, page_path")
      .in("property_id", filteredIds)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(20000) as Promise<{ data: Array<{ property_id: string; section: string; guest_session_id: string | null; created_at: string; page_path: string | null }> | null }>,
    supabase
      .from("poi_engagement_events")
      .select("property_id, poi_key, poi_type, event_type, created_at")
      .in("property_id", filteredIds)
      .gte("created_at", since.toISOString())
      .limit(20000),
  ]);
  const logs = logsQ.data ?? [];
  const prevLogs = prevLogsQ.data ?? [];
  const convs = convsQ.data ?? [];
  const msgs = msgsQ.data ?? [];
  const feedback = feedbackQ.data ?? [];
  const sectionsRaw = sectionsQ.data ?? [];
  const poiEvents = poiQ.data ?? [];

  // filtro dispositivo (aplicado sobre logs por user_agent — impacta KPIs
  // e séries; sections/chat não têm UA, então só filtramos quando dá)
  const logsF = input.device === "all"
    ? logs
    : logs.filter((l) => detectDevice(l.user_agent) === input.device);

  // ------- sessionization ----------------------------------------------
  const sessionsWithChat = new Set<string>();
  for (const c of convs) if (c.guest_session_id) sessionsWithChat.add(c.guest_session_id);

  const sessionSections = new Map<string, Set<string>>(); // sid -> set of sections
  const sessionPropertyId = new Map<string, string>();
  for (const s of sectionsRaw) {
    if (!s.guest_session_id) continue;
    let set = sessionSections.get(s.guest_session_id);
    if (!set) { set = new Set(); sessionSections.set(s.guest_session_id, set); }
    set.add(s.section);
    sessionPropertyId.set(s.guest_session_id, s.property_id);
  }

  // Feedback não resolvido em cada conversa
  const badConversations = new Set<string>();
  for (const f of feedback) {
    if (!f.resolved) badConversations.add(f.conversation_id as string);
  }
  const usefulChatSessions = new Set<string>();
  for (const c of convs) {
    if (!c.guest_session_id) continue;
    if (!badConversations.has(c.id as string)) usefulChatSessions.add(c.guest_session_id);
  }

  // ------- KPIs ---------------------------------------------------------
  const totalAccesses = logsF.length;
  const prevAccesses = prevLogs.length;
  const uniqueSessions = sessionSections.size;
  const totalChats = convs.length;
  const openFeedback = feedback.filter((f) => !f.resolved).length;
  const chatRate = totalAccesses > 0 ? Math.round((totalChats / totalAccesses) * 100) : 0;
  const autoResolveRate = totalAccesses > 0
    ? Math.round(((totalAccesses - totalChats) / totalAccesses) * 100)
    : 0;

  function pct(cur: number, prev: number): number | null {
    if (prev === 0) return cur > 0 ? 100 : null;
    return Math.round(((cur - prev) / prev) * 100);
  }

  // ------- séries temporais --------------------------------------------
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  const dayMap = new Map<string, { date: string; accesses: number; sessions: number; chats: number }>();
  for (const k of dayKeys) dayMap.set(k, { date: k, accesses: 0, sessions: 0, chats: 0 });

  for (const l of logsF) {
    const k = String(l.created_at).slice(0, 10);
    const row = dayMap.get(k); if (row) row.accesses++;
  }
  const seenSessionOnDay = new Set<string>();
  for (const s of sectionsRaw) {
    if (!s.guest_session_id) continue;
    const k = String(s.created_at).slice(0, 10);
    const uniqKey = `${k}|${s.guest_session_id}`;
    if (seenSessionOnDay.has(uniqKey)) continue;
    seenSessionOnDay.add(uniqKey);
    const row = dayMap.get(k); if (row) row.sessions++;
  }
  for (const c of convs) {
    const k = String(c.created_at).slice(0, 10);
    const row = dayMap.get(k); if (row) row.chats++;
  }
  const timeseries = Array.from(dayMap.values());

  // ------- heatmap dia da semana × hora --------------------------------
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const l of logsF) {
    const d = new Date(l.created_at as string);
    heatmap[d.getDay()][d.getHours()]++;
  }

  // ------- device mix + comportamento por dispositivo ------------------
  const deviceMix = { mobile: 0, tablet: 0, desktop: 0 };
  for (const l of logs) deviceMix[detectDevice(l.user_agent)]++;

  // ------- sections consumo --------------------------------------------
  const sectionOpens = new Map<string, number>();
  const sectionSessions = new Map<string, Set<string>>();
  for (const s of sectionsRaw) {
    sectionOpens.set(s.section, (sectionOpens.get(s.section) ?? 0) + 1);
    if (s.guest_session_id) {
      let set = sectionSessions.get(s.section);
      if (!set) { set = new Set(); sectionSessions.set(s.section, set); }
      set.add(s.guest_session_id);
    }
  }
  const sectionEntries = Array.from(sectionOpens.entries()).map(([section, opens]) => {
    const sessSet = sectionSessions.get(section) ?? new Set<string>();
    const sess = sessSet.size;
    let sessChat = 0;
    for (const sid of sessSet) if (sessionsWithChat.has(sid)) sessChat++;
    const autoResolve = sess > 0 ? Math.round(((sess - sessChat) / sess) * 100) : 0;
    return { section, opens, sessions: sess, autoResolveRate: autoResolve };
  }).sort((a, b) => b.opens - a.opens);

  // Seções conhecidas do produto — se não apareceram nesse recorte,
  // são candidatas a "silenciosas".
  const KNOWN_SECTIONS = [
    "wifi", "checkin", "checkout", "house_rules", "manual", "faqs",
    "emergency", "recommendations", "nearby", "city", "marketplace", "chat",
  ];
  const seenSections = new Set(sectionEntries.map((s) => s.section));
  const silentSections = KNOWN_SECTIONS.filter((s) => !seenSections.has(s));

  // ------- funil -------------------------------------------------------
  const engagedSessions = new Set<string>();
  for (const [sid, set] of sessionSections.entries()) if (set.size >= 2) engagedSessions.add(sid);
  const startedChatFromSessions = new Set<string>();
  for (const sid of sessionSections.keys()) if (sessionsWithChat.has(sid)) startedChatFromSessions.add(sid);
  const usefulChatFromSessions = new Set<string>();
  for (const sid of startedChatFromSessions) if (usefulChatSessions.has(sid)) usefulChatFromSessions.add(sid);

  const funnel = [
    { key: "sessions", label: "Sessões", value: uniqueSessions },
    { key: "engaged", label: "Explorou ≥ 2 seções", value: engagedSessions.size },
    { key: "chat", label: "Iniciou conversa", value: startedChatFromSessions.size },
    { key: "resolved", label: "Recebeu resposta útil", value: usefulChatFromSessions.size },
  ];

  // ------- por imóvel --------------------------------------------------
  const perProperty = properties
    .filter((p) => filteredIds.includes(p.id))
    .map((p) => {
      const acc = logsF.filter((l) => l.property_id === p.id).length;
      const chats = convs.filter((c) => c.property_id === p.id).length;
      const sSess = new Set<string>();
      for (const [sid, pid] of sessionPropertyId.entries()) if (pid === p.id) sSess.add(sid);
      const sectionsPerSession = sSess.size > 0
        ? Math.round((Array.from(sSess).reduce((n, sid) => n + (sessionSections.get(sid)?.size ?? 0), 0) / sSess.size) * 10) / 10
        : 0;
      const uniqueGuests = new Set(
        logsF.filter((l) => l.property_id === p.id).map((l) => (l.guest_name ?? "").trim().toLowerCase()).filter(Boolean),
      ).size;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        published: p.published,
        completeness: p.completeness,
        accesses: acc,
        chats,
        sessions: sSess.size,
        chatRate: acc > 0 ? Math.round((chats / acc) * 100) : 0,
        sectionsPerSession,
        uniqueGuests,
      };
    });

  // ------- perguntas frequentes do chat (primeira msg do user) ---------
  const firstUserMsgByConv = new Map<string, string>();
  for (const m of msgs) {
    if (m.role !== "user") continue;
    if (firstUserMsgByConv.has(m.conversation_id as string)) continue;
    const c = (m.content as string | null) ?? "";
    if (c.trim()) firstUserMsgByConv.set(m.conversation_id as string, c.trim());
  }
  const termCount = new Map<string, number>();
  const STOP = new Set(["que", "com", "para", "por", "uma", "sobre", "como", "onde", "quando", "qual", "quais", "meu", "minha", "estou", "tem", "tenho", "the", "and", "for", "you", "are", "have", "this", "that", "with", "posso", "vocês", "voces", "esta", "está", "isso", "isto", "aqui", "muito", "obrigado", "obrigada", "oi", "olá", "ola", "bom", "boa", "dia", "tarde", "noite"]);
  for (const text of firstUserMsgByConv.values()) {
    const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
    const seen = new Set<string>();
    for (const w of words) {
      if (seen.has(w)) continue;
      seen.add(w);
      termCount.set(w, (termCount.get(w) ?? 0) + 1);
    }
  }
  const topQuestions = Array.from(termCount.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([term, count]) => ({ term, count }));

  // ------- feedback pendente -------------------------------------------
  const openFeedbackList = feedback
    .filter((f) => !f.resolved)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 20)
    .map((f) => ({
      message_id: f.message_id as string,
      conversation_id: f.conversation_id as string,
      property_id: f.property_id as string,
      reason: f.reason as string | null,
      created_at: f.created_at as string,
    }));

  // ------- POIs --------------------------------------------------------
  const poiCounts = new Map<string, { key: string; views: number; likes: number; dislikes: number }>();
  for (const e of poiEvents) {
    const k = e.poi_key as string;
    let entry = poiCounts.get(k);
    if (!entry) { entry = { key: k, views: 0, likes: 0, dislikes: 0 }; poiCounts.set(k, entry); }
    const t = e.event_type as string;
    if (t === "view") entry.views++;
    else if (t === "like") entry.likes++;
    else if (t === "dislike") entry.dislikes++;
  }
  const poiArr = Array.from(poiCounts.values()).sort((a, b) => (b.views + b.likes) - (a.views + a.likes));
  const topPois = poiArr.slice(0, 10);
  const coldPois = poiArr.filter((p) => p.views === 0 && p.likes === 0).slice(0, 10);

  return {
    filters: { period: input.period, propertyId: input.propertyId ?? null, device: input.device },
    properties,
    kpis: {
      totalAccesses,
      uniqueSessions,
      totalChats,
      chatRate,
      autoResolveRate,
      openFeedback,
      accessesDelta: pct(totalAccesses, prevAccesses),
    },
    timeseries,
    heatmap,
    deviceMix,
    sections: sectionEntries,
    silentSections,
    funnel,
    perProperty,
    topQuestions,
    openFeedbackList,
    topPois,
    coldPois,
  };
}

function emptyPayload(properties: Array<{ id: string; name: string; slug: string; published: boolean; completeness: number }>) {
  return {
    filters: { period: "30d" as const, propertyId: null as string | null, device: "all" as const },
    properties,
    kpis: {
      totalAccesses: 0, uniqueSessions: 0, totalChats: 0, chatRate: 0,
      autoResolveRate: 0, openFeedback: 0, accessesDelta: null as number | null,
    },
    timeseries: [] as Array<{ date: string; accesses: number; sessions: number; chats: number }>,
    heatmap: Array.from({ length: 7 }, () => Array(24).fill(0)) as number[][],
    deviceMix: { mobile: 0, tablet: 0, desktop: 0 },
    sections: [] as Array<{ section: string; opens: number; sessions: number; autoResolveRate: number }>,
    silentSections: [] as string[],
    funnel: [] as Array<{ key: string; label: string; value: number }>,
    perProperty: [] as Array<{ id: string; name: string; slug: string; published: boolean; completeness: number; accesses: number; chats: number; sessions: number; chatRate: number; sectionsPerSession: number; uniqueGuests: number }>,
    topQuestions: [] as Array<{ term: string; count: number }>,
    openFeedbackList: [] as Array<{ message_id: string; conversation_id: string; property_id: string; reason: string | null; created_at: string }>,
    topPois: [] as Array<{ key: string; views: number; likes: number; dislikes: number }>,
    coldPois: [] as Array<{ key: string; views: number; likes: number; dislikes: number }>,
  };
}

export const getEngagementAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InputSchema.parse(i))
  .handler(async ({ data, context }) => runAnalytics(data, context));
