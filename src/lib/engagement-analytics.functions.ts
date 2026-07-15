import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Motor de dados da página Engajamento (visão gerencial multi-cliente).
 *
 * O DTO já vem consolidado — cliente só renderiza. Foco: tempo de permanência,
 * profundidade de leitura, atrito no chat, e ranking real de imóveis por
 * engajamento (não apenas volume).
 */

const InputSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
  propertyIds: z.array(z.string()).nullable().optional(),
  device: z.enum(["all", "mobile", "tablet", "desktop"]).default("all"),
  asUserId: z.string().uuid().nullable().optional(),
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
  return 365;
}

function completenessScore(p: {
  published?: boolean | null; hero_image_url?: string | null; tagline?: string | null;
  wifi_ssid?: string | null; wifi_password?: string | null;
  checkin_instructions?: string | null; house_rules?: string | null;
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

// Sessionization: sequência de eventos do mesmo guest_session_id, com
// quebra quando o gap entre eventos exceder GAP_MS. Cada sessão tem
// duração = last - first, com mínimo de MIN_MS (para 1 clique isolado).
const GAP_MS = 20 * 60 * 1000;
const MIN_MS = 5 * 1000;

type SectionEvt = { property_id: string; section: string; guest_session_id: string | null; created_at: string };
type Session = { sid: string; propertyId: string; start: number; end: number; sections: string[] };

function sessionize(events: SectionEvt[]): Session[] {
  const bySid = new Map<string, SectionEvt[]>();
  for (const e of events) {
    if (!e.guest_session_id) continue;
    const arr = bySid.get(e.guest_session_id) ?? [];
    arr.push(e); bySid.set(e.guest_session_id, arr);
  }
  const out: Session[] = [];
  for (const [sid, arr] of bySid) {
    arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
    let start = new Date(arr[0].created_at).getTime();
    let last = start;
    let sections: string[] = [arr[0].section];
    const pid = arr[0].property_id;
    for (let i = 1; i < arr.length; i++) {
      const t = new Date(arr[i].created_at).getTime();
      if (t - last > GAP_MS) {
        out.push({ sid, propertyId: pid, start, end: last, sections });
        start = t; sections = [];
      }
      sections.push(arr[i].section);
      last = t;
    }
    out.push({ sid, propertyId: pid, start, end: last, sections });
  }
  return out;
}

function sessionDurationSeconds(s: Session): number {
  return Math.max(MIN_MS, s.end - s.start) / 1000;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export type EngagementAnalytics = Awaited<ReturnType<typeof runAnalytics>>;

async function runAnalytics(
  input: z.infer<typeof InputSchema>,
  ctx: { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string },
) {
  const { supabase, userId } = ctx;
  const days = daysFor(input.period);
  const since = new Date(Date.now() - days * 86400_000);
  const prevSince = new Date(Date.now() - days * 2 * 86400_000);

  const { data: propsRaw, error: pErr } = await supabase
    .from("properties")
    .select("id, name, slug, published, wifi_ssid, wifi_password, checkin_instructions, house_rules, tagline, hero_image_url")
    .eq("owner_id", userId)
    .order("name", { ascending: true });
  if (pErr) throw pErr;
  const properties = (propsRaw ?? []).map((p) => ({
    id: p.id as string, name: p.name as string, slug: p.slug as string,
    published: !!p.published, completeness: completenessScore(p),
  }));
  const propertyName = new Map(properties.map((p) => [p.id, p.name]));

  const allIds = properties.map((p) => p.id);
  const req = input.propertyIds ?? null;
  const filteredIds = req && req.length > 0 && !req.includes("all") ? req.filter((id) => allIds.includes(id)) : allIds;

  if (filteredIds.length === 0) return emptyPayload(properties);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [logsQ, prevLogsQ, convsQ, msgsQ, feedbackQ, sectionsQ, poiQ, recsQ] = await Promise.all([
    supabase.from("guide_access_logs")
      .select("id, property_id, guest_name, user_agent, created_at")
      .in("property_id", filteredIds).gte("created_at", since.toISOString())
      .order("created_at", { ascending: false }).limit(20000),
    supabase.from("guide_access_logs")
      .select("id, property_id, created_at")
      .in("property_id", filteredIds).gte("created_at", prevSince.toISOString())
      .lt("created_at", since.toISOString()).limit(20000),
    supabase.from("property_chat_conversations")
      .select("id, property_id, guest_session_id, created_at, last_message_at")
      .in("property_id", filteredIds).gte("created_at", since.toISOString()).limit(10000),
    supabase.from("property_chat_messages")
      .select("id, conversation_id, role, created_at, property_chat_conversations!inner(property_id)")
      .in("property_chat_conversations.property_id", filteredIds)
      .gte("created_at", since.toISOString()).limit(20000),
    supabase.from("chat_message_feedback")
      .select("message_id, conversation_id, property_id, reason, resolved, created_at")
      .eq("owner_id", userId).in("property_id", filteredIds).gte("created_at", since.toISOString()),
    (supabaseAdmin.from("guide_section_events" as never) as ReturnType<typeof supabaseAdmin.from>)
      .select("property_id, section, guest_session_id, created_at")
      .in("property_id", filteredIds).gte("created_at", since.toISOString())
      .order("created_at", { ascending: true }).limit(40000) as Promise<{ data: SectionEvt[] | null }>,
    supabase.from("poi_engagement_events")
      .select("property_id, poi_key, poi_type, event_type, created_at")
      .in("property_id", filteredIds).gte("created_at", since.toISOString()).limit(20000),
    supabase.from("property_recommendations")
      .select("property_id, place_id, name").in("property_id", filteredIds).limit(5000),
  ]);
  const logs = logsQ.data ?? [];
  const prevLogs = prevLogsQ.data ?? [];
  const convs = convsQ.data ?? [];
  const msgs = msgsQ.data ?? [];
  const feedback = feedbackQ.data ?? [];
  const sectionsRaw = sectionsQ.data ?? [];
  const poiEvents = poiQ.data ?? [];
  const recs = recsQ.data ?? [];

  const logsF = input.device === "all" ? logs : logs.filter((l) => detectDevice(l.user_agent) === input.device);

  // ---- sessionization ---------------------------------------------------
  const sessions = sessionize(sectionsRaw);
  const sessionsById = new Map<string, Session[]>();
  for (const s of sessions) {
    const arr = sessionsById.get(s.sid) ?? [];
    arr.push(s); sessionsById.set(s.sid, arr);
  }
  const sessionsWithChat = new Set<string>();
  for (const c of convs) if (c.guest_session_id) sessionsWithChat.add(c.guest_session_id);

  // ---- KPIs -------------------------------------------------------------
  const totalAccesses = logsF.length;
  const uniqueSessions = sessions.length;
  const totalChats = convs.length;
  const openFeedback = feedback.filter((f) => !f.resolved).length;
  const chatRate = totalAccesses > 0 ? Math.round((totalChats / totalAccesses) * 100) : 0;
  const autoResolveRate = totalAccesses > 0
    ? Math.round(((totalAccesses - totalChats) / totalAccesses) * 100) : 0;

  const durations = sessions.map(sessionDurationSeconds).sort((a, b) => a - b);
  const avgSessionSeconds = Math.round(percentile(durations, 0.5));
  const p90SessionSeconds = Math.round(percentile(durations, 0.9));
  const depthValues = sessions.map((s) => new Set(s.sections).size);
  const depthAvg = depthValues.length > 0
    ? Math.round((depthValues.reduce((a, b) => a + b, 0) / depthValues.length) * 10) / 10 : 0;
  const depthEngagedRate = depthValues.length > 0
    ? Math.round((depthValues.filter((v) => v >= 3).length / depthValues.length) * 100) : 0;

  function pct(cur: number, prev: number): number | null {
    if (prev === 0) return cur > 0 ? 100 : null;
    return Math.round(((cur - prev) / prev) * 100);
  }

  // ---- séries temporais -------------------------------------------------
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  const dayMap = new Map<string, { date: string; accesses: number; sessions: number; chats: number; avgDurSec: number }>();
  for (const k of dayKeys) dayMap.set(k, { date: k, accesses: 0, sessions: 0, chats: 0, avgDurSec: 0 });
  for (const l of logsF) {
    const k = String(l.created_at).slice(0, 10);
    const row = dayMap.get(k); if (row) row.accesses++;
  }
  const durByDay = new Map<string, number[]>();
  for (const s of sessions) {
    const k = new Date(s.start).toISOString().slice(0, 10);
    const row = dayMap.get(k); if (row) row.sessions++;
    const arr = durByDay.get(k) ?? []; arr.push(sessionDurationSeconds(s)); durByDay.set(k, arr);
  }
  for (const [k, arr] of durByDay) {
    const row = dayMap.get(k);
    if (row) row.avgDurSec = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }
  for (const c of convs) {
    const k = String(c.created_at).slice(0, 10);
    const row = dayMap.get(k); if (row) row.chats++;
  }
  const timeseries = Array.from(dayMap.values());

  // ---- histograma de duração -------------------------------------------
  const durationBuckets = [
    { label: "< 30s", from: 0, to: 30, count: 0 },
    { label: "30s–2min", from: 30, to: 120, count: 0 },
    { label: "2–5min", from: 120, to: 300, count: 0 },
    { label: "5–15min", from: 300, to: 900, count: 0 },
    { label: "> 15min", from: 900, to: Infinity, count: 0 },
  ];
  for (const d of durations) {
    for (const b of durationBuckets) if (d >= b.from && d < b.to) { b.count++; break; }
  }

  // ---- curva de profundidade -------------------------------------------
  const depthCurve = [
    { label: "1 seção", count: 0 },
    { label: "2", count: 0 },
    { label: "3", count: 0 },
    { label: "4", count: 0 },
    { label: "5+", count: 0 },
  ];
  for (const v of depthValues) {
    if (v <= 1) depthCurve[0].count++;
    else if (v === 2) depthCurve[1].count++;
    else if (v === 3) depthCurve[2].count++;
    else if (v === 4) depthCurve[3].count++;
    else depthCurve[4].count++;
  }

  // ---- sections consumo -----------------------------------------------
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

  const KNOWN_SECTIONS = ["wifi", "checkin", "checkout", "house_rules", "manual", "faqs", "emergency", "recommendations", "nearby", "city", "marketplace", "chat"];
  const seenSections = new Set(sectionEntries.map((s) => s.section));
  const silentSections = KNOWN_SECTIONS.filter((s) => !seenSections.has(s));

  // ---- funil ----------------------------------------------------------
  const engagedSessionIds = new Set(sessions.filter((s) => new Set(s.sections).size >= 2).map((s) => s.sid));
  const chatSessionIds = new Set(sessions.filter((s) => sessionsWithChat.has(s.sid)).map((s) => s.sid));
  const badConversations = new Set<string>();
  for (const f of feedback) if (!f.resolved) badConversations.add(f.conversation_id as string);
  const usefulChatSessionIds = new Set<string>();
  for (const c of convs) {
    if (!c.guest_session_id) continue;
    if (!badConversations.has(c.id as string)) usefulChatSessionIds.add(c.guest_session_id);
  }
  const funnel = [
    { key: "sessions", label: "Sessões", value: uniqueSessions },
    { key: "engaged", label: "Explorou ≥ 2 seções", value: engagedSessionIds.size },
    { key: "chat", label: "Iniciou conversa", value: chatSessionIds.size },
    { key: "resolved", label: "Recebeu resposta útil", value: usefulChatSessionIds.size },
  ];

  // ---- por imóvel (agora inclui avgSessionSeconds) --------------------
  const sessionsByProp = new Map<string, Session[]>();
  for (const s of sessions) {
    const arr = sessionsByProp.get(s.propertyId) ?? [];
    arr.push(s); sessionsByProp.set(s.propertyId, arr);
  }
  const perProperty = properties
    .filter((p) => filteredIds.includes(p.id))
    .map((p) => {
      const acc = logsF.filter((l) => l.property_id === p.id).length;
      const chats = convs.filter((c) => c.property_id === p.id).length;
      const ss = sessionsByProp.get(p.id) ?? [];
      const durs = ss.map(sessionDurationSeconds).sort((a, b) => a - b);
      const avg = Math.round(percentile(durs, 0.5));
      const sectionsPerSession = ss.length > 0
        ? Math.round((ss.reduce((n, s) => n + new Set(s.sections).size, 0) / ss.length) * 10) / 10 : 0;
      return {
        id: p.id, name: p.name, slug: p.slug, published: p.published, completeness: p.completeness,
        accesses: acc, chats, sessions: ss.length,
        chatRate: acc > 0 ? Math.round((chats / acc) * 100) : 0,
        sectionsPerSession,
        avgSessionSeconds: avg,
      };
    });

  // ---- feedback pendente ---------------------------------------------
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

  // ---- POIs com nome real ---------------------------------------------
  const placeToName = new Map<string, string>();
  for (const r of recs) {
    const pid = r.place_id as string | null;
    if (pid) placeToName.set(pid, (r.name as string) ?? pid);
  }
  const poiCounts = new Map<string, { key: string; displayName: string; views: number; likes: number; dislikes: number }>();
  for (const e of poiEvents) {
    const k = e.poi_key as string;
    let entry = poiCounts.get(k);
    if (!entry) {
      // poi_key vem como "type:id" ou apenas id; extrai place_id
      const parts = k.split(":");
      const placeCandidate = parts.length > 1 ? parts.slice(1).join(":") : k;
      const display = placeToName.get(placeCandidate) ?? placeToName.get(k) ?? placeCandidate;
      entry = { key: k, displayName: display, views: 0, likes: 0, dislikes: 0 };
      poiCounts.set(k, entry);
    }
    const t = e.event_type as string;
    if (t === "view") entry.views++;
    else if (t === "like") entry.likes++;
    else if (t === "dislike") entry.dislikes++;
  }
  const poiArr = Array.from(poiCounts.values()).sort((a, b) => (b.views + b.likes) - (a.views + a.likes));
  const topPois = poiArr.slice(0, 10);
  const coldPois = poiArr.filter((p) => p.views === 0 && p.likes === 0).slice(0, 10);

  const _ = msgs; // reservado para futuras métricas de mensagem
  void _; void prevLogs; void propertyName;

  return {
    filters: { period: input.period, propertyIds: input.propertyIds ?? null, device: input.device },
    properties,
    kpis: {
      totalAccesses, uniqueSessions, totalChats,
      chatRate, autoResolveRate, openFeedback,
      accessesDelta: pct(totalAccesses, prevLogs.length),
      avgSessionSeconds, p90SessionSeconds,
      depthAvg, depthEngagedRate,
    },
    timeseries,
    durationBuckets: durationBuckets.map((b) => ({ label: b.label, count: b.count })),
    depthCurve,
    sections: sectionEntries,
    silentSections,
    funnel,
    perProperty,
    openFeedbackList,
    topPois,
    coldPois,
  };
}

function emptyPayload(properties: Array<{ id: string; name: string; slug: string; published: boolean; completeness: number }>) {
  return {
    filters: { period: "30d" as const, propertyIds: null as string[] | null, device: "all" as const },
    properties,
    kpis: {
      totalAccesses: 0, uniqueSessions: 0, totalChats: 0, chatRate: 0,
      autoResolveRate: 0, openFeedback: 0, accessesDelta: null as number | null,
      avgSessionSeconds: 0, p90SessionSeconds: 0, depthAvg: 0, depthEngagedRate: 0,
    },
    timeseries: [] as Array<{ date: string; accesses: number; sessions: number; chats: number; avgDurSec: number }>,
    durationBuckets: [] as Array<{ label: string; count: number }>,
    depthCurve: [] as Array<{ label: string; count: number }>,
    sections: [] as Array<{ section: string; opens: number; sessions: number; autoResolveRate: number }>,
    silentSections: [] as string[],
    funnel: [] as Array<{ key: string; label: string; value: number }>,
    perProperty: [] as Array<{ id: string; name: string; slug: string; published: boolean; completeness: number; accesses: number; chats: number; sessions: number; chatRate: number; sectionsPerSession: number; avgSessionSeconds: number }>,
    openFeedbackList: [] as Array<{ message_id: string; conversation_id: string; property_id: string; reason: string | null; created_at: string }>,
    topPois: [] as Array<{ key: string; displayName: string; views: number; likes: number; dislikes: number }>,
    coldPois: [] as Array<{ key: string; displayName: string; views: number; likes: number; dislikes: number }>,
  };
}

export const getEngagementAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InputSchema.parse(i))
  .handler(async ({ data, context }) => runAnalytics(data, context));
