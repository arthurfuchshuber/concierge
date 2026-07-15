import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Consolidação por hóspede: chave = (property_id, telefone_normalizado, checkin_date)
 * quando telefone existe, senão (property_id, nome_normalizado, checkin_date).
 *
 * Une:
 *  - guide_access_logs (identidade + reserva)
 *  - guide_section_events (sessões / navegação, tempo)
 *  - property_chat_conversations + messages (chat com IA)
 *  - chat_message_feedback (marcadores de "não útil")
 */

const InputSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
  propertyIds: z.array(z.string()).nullable().optional(),
  q: z.string().nullable().optional(),
  asUserId: z.string().uuid().nullable().optional(),
});

const GuestDetailInput = z.object({ guestKey: z.string(), asUserId: z.string().uuid().nullable().optional() });

function daysFor(period: "7d" | "30d" | "90d" | "all"): number {
  return period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
}

export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).replace(/\D+/g, "").replace(/^0+/, "");
}
function normalizeName(n: string | null | undefined): string {
  return (n ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function guestKeyOf(input: { propertyId: string; phone: string; name: string; checkinDate: string }): string {
  const idPart = input.phone ? `p:${input.phone}` : `n:${input.name}`;
  return `${input.propertyId}|${idPart}|${input.checkinDate}`;
}

const GAP_MS = 20 * 60 * 1000;
const MIN_MS = 5 * 1000;

type Evt = { property_id: string; section: string; guest_session_id: string | null; guest_name: string | null; guest_phone: string | null; created_at: string };
type Session = { sid: string; propertyId: string; start: number; end: number; sections: Array<{ section: string; at: string }>; phone: string; name: string };

function sessionize(events: Evt[]): Session[] {
  const bySid = new Map<string, Evt[]>();
  for (const e of events) {
    if (!e.guest_session_id) continue;
    const arr = bySid.get(e.guest_session_id) ?? [];
    arr.push(e); bySid.set(e.guest_session_id, arr);
  }
  const out: Session[] = [];
  for (const [sid, arr] of bySid) {
    arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const phone = normalizePhone(arr.find((e) => e.guest_phone)?.guest_phone ?? null);
    const name = normalizeName(arr.find((e) => e.guest_name)?.guest_name ?? null);
    let start = new Date(arr[0].created_at).getTime();
    let last = start;
    let sections: Array<{ section: string; at: string }> = [{ section: arr[0].section, at: arr[0].created_at }];
    for (let i = 1; i < arr.length; i++) {
      const t = new Date(arr[i].created_at).getTime();
      if (t - last > GAP_MS) {
        out.push({ sid, propertyId: arr[0].property_id, start, end: last, sections, phone, name });
        start = t; sections = [];
      }
      sections.push({ section: arr[i].section, at: arr[i].created_at });
      last = t;
    }
    out.push({ sid, propertyId: arr[0].property_id, start, end: last, sections, phone, name });
  }
  return out;
}

function sessionSeconds(s: Session): number {
  return Math.max(MIN_MS, s.end - s.start) / 1000;
}

async function loadCommon(
  ctx: { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string },
  input: z.infer<typeof InputSchema>,
) {
  let effectiveUserId = ctx.userId;
  let supabase = ctx.supabase;
  if (input.asUserId && input.asUserId !== ctx.userId) {
    const { data: isAdmin } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Acesso negado");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    supabase = supabaseAdmin as unknown as typeof ctx.supabase;
    effectiveUserId = input.asUserId;
  }
  const userId = effectiveUserId;
  const days = daysFor(input.period);
  const since = new Date(Date.now() - days * 86400_000);

  const { data: props, error: pErr } = await supabase
    .from("properties").select("id, name, city").eq("owner_id", userId);
  if (pErr) throw pErr;
  const allIds = (props ?? []).map((p) => p.id as string);
  const nameById = new Map<string, string>((props ?? []).map((p) => [p.id as string, p.name as string]));
  const cityById = new Map<string, string | null>((props ?? []).map((p) => [p.id as string, (p as { city: string | null }).city]));
  const req = input.propertyIds ?? null;
  const filteredIds = req && req.length > 0 && !req.includes("all") ? req.filter((id) => allIds.includes(id)) : allIds;

  if (filteredIds.length === 0) {
    return { filteredIds, nameById, cityById, since, logs: [], events: [], convs: [], msgs: [], feedback: [] };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [logsQ, eventsQ, convsQ, msgsQ, feedbackQ] = await Promise.all([
    supabase.from("guide_access_logs")
      .select("id, property_id, guest_name, reservation_code, checkin_date, guest_phone, guest_phone_country, user_agent, created_at")
      .in("property_id", filteredIds).gte("created_at", since.toISOString()).limit(20000),
    (supabaseAdmin.from("guide_section_events" as never) as ReturnType<typeof supabaseAdmin.from>)
      .select("property_id, section, guest_session_id, guest_name, guest_phone, created_at")
      .in("property_id", filteredIds).gte("created_at", since.toISOString())
      .order("created_at", { ascending: true }).limit(40000) as Promise<{ data: Evt[] | null }>,
    supabase.from("property_chat_conversations")
      .select("id, property_id, guest_session_id, guest_name, created_at, last_message_at")
      .in("property_id", filteredIds).gte("created_at", since.toISOString()).limit(10000),
    supabase.from("property_chat_messages")
      .select("id, conversation_id, role, content, created_at, property_chat_conversations!inner(property_id)")
      .in("property_chat_conversations.property_id", filteredIds)
      .gte("created_at", since.toISOString()).order("created_at", { ascending: true }).limit(30000),
    supabase.from("chat_message_feedback")
      .select("message_id, conversation_id, property_id, reason, resolved, created_at")
      .eq("owner_id", userId).in("property_id", filteredIds).gte("created_at", since.toISOString()),
  ]);
  return {
    filteredIds, nameById, cityById, since,
    logs: (logsQ.data ?? []) as Array<{ id: string; property_id: string; guest_name: string; reservation_code: string | null; checkin_date: string; guest_phone: string | null; guest_phone_country: string | null; created_at: string }>,
    events: (eventsQ.data ?? []) as Evt[],
    convs: (convsQ.data ?? []) as Array<{ id: string; property_id: string; guest_session_id: string; guest_name: string | null; created_at: string; last_message_at: string }>,
    msgs: (msgsQ.data ?? []) as Array<{ id: string; conversation_id: string; role: string; content: string | null; created_at: string }>,
    feedback: (feedbackQ.data ?? []) as Array<{ message_id: string; conversation_id: string; resolved: boolean }>,
  };
}

type GuestAgg = {
  key: string;
  propertyId: string; propertyName: string; propertyCity: string | null;
  guestName: string; phone: string; phoneCountry: string | null;
  reservationCode: string | null; checkinDate: string;
  firstAccess: string; lastActivity: string;
  totalSeconds: number; sessionsCount: number;
  sectionsCount: number;
  messagesCount: number;
  conversationsCount: number;
  hasUnresolvedFeedback: boolean;
  accessesCount: number;
  avgSessionSeconds: number;
  maxSessionSeconds: number;
  topSection: string | null;
  topSectionSeconds: number;
};

const SECTION_GAP_MS = 20 * 60 * 1000;
const SECTION_MIN_MS = 5 * 1000;

function buildGuestIndex(data: Awaited<ReturnType<typeof loadCommon>>) {
  const { logs, events, convs, msgs, feedback, nameById, cityById } = data;

  const sessions = sessionize(events);
  const sessionByPhoneName = new Map<string, Session[]>();
  for (const s of sessions) {
    const idKey = s.phone ? `${s.propertyId}|p:${s.phone}` : (s.name ? `${s.propertyId}|n:${s.name}` : `${s.propertyId}|sid:${s.sid}`);
    const arr = sessionByPhoneName.get(idKey) ?? [];
    arr.push(s); sessionByPhoneName.set(idKey, arr);
  }

  const convBySid = new Map<string, Array<typeof convs[number]>>();
  for (const c of convs) {
    if (!c.guest_session_id) continue;
    const arr = convBySid.get(c.guest_session_id) ?? [];
    arr.push(c); convBySid.set(c.guest_session_id, arr);
  }
  const msgsByConv = new Map<string, typeof msgs>();
  for (const m of msgs) {
    const arr = msgsByConv.get(m.conversation_id) ?? [];
    arr.push(m); msgsByConv.set(m.conversation_id, arr);
  }
  const unresolvedByConv = new Set<string>();
  for (const f of feedback) if (!f.resolved) unresolvedByConv.add(f.conversation_id);

  const guests = new Map<string, GuestAgg>();
  for (const l of logs) {
    const phone = normalizePhone(l.guest_phone);
    const name = normalizeName(l.guest_name);
    const key = guestKeyOf({ propertyId: l.property_id, phone, name, checkinDate: l.checkin_date });
    const existing = guests.get(key);
    const propertyName = nameById.get(l.property_id) ?? "";
    if (existing) {
      if (l.created_at < existing.firstAccess) existing.firstAccess = l.created_at;
      if (l.created_at > existing.lastActivity) existing.lastActivity = l.created_at;
      if (!existing.reservationCode && l.reservation_code) existing.reservationCode = l.reservation_code;
      existing.accessesCount++;
    } else {
      guests.set(key, {
        key,
        propertyId: l.property_id, propertyName,
        guestName: l.guest_name, phone, phoneCountry: l.guest_phone_country,
        reservationCode: l.reservation_code, checkinDate: l.checkin_date,
        firstAccess: l.created_at, lastActivity: l.created_at,
        totalSeconds: 0, sessionsCount: 0, sectionsCount: 0,
        messagesCount: 0, conversationsCount: 0,
        hasUnresolvedFeedback: false,
        accessesCount: 1,
        avgSessionSeconds: 0, maxSessionSeconds: 0,
        topSection: null, topSectionSeconds: 0,
      });
    }
  }

  for (const g of guests.values()) {
    const idKey = g.phone ? `${g.propertyId}|p:${g.phone}` : `${g.propertyId}|n:${normalizeName(g.guestName)}`;
    const ss = sessionByPhoneName.get(idKey) ?? [];
    const uniqueSections = new Set<string>();
    const secondsBySection = new Map<string, number>();
    let maxS = 0;
    for (const s of ss) {
      const sec = sessionSeconds(s);
      g.totalSeconds += sec;
      g.sessionsCount++;
      if (sec > maxS) maxS = sec;
      // duração por seção: gap para o próximo evento na mesma sessão
      const items = s.sections;
      for (let i = 0; i < items.length; i++) {
        uniqueSections.add(items[i].section);
        const tCur = new Date(items[i].at).getTime();
        const tNext = i < items.length - 1 ? new Date(items[i + 1].at).getTime() : tCur + SECTION_MIN_MS;
        const dur = Math.min(SECTION_GAP_MS, Math.max(SECTION_MIN_MS, tNext - tCur)) / 1000;
        secondsBySection.set(items[i].section, (secondsBySection.get(items[i].section) ?? 0) + dur);
      }
      const cs = convBySid.get(s.sid) ?? [];
      for (const c of cs) {
        g.conversationsCount++;
        const msgs = msgsByConv.get(c.id) ?? [];
        g.messagesCount += msgs.length;
        if (unresolvedByConv.has(c.id)) g.hasUnresolvedFeedback = true;
        if (c.last_message_at > g.lastActivity) g.lastActivity = c.last_message_at;
      }
    }
    g.sectionsCount = uniqueSections.size;
    g.totalSeconds = Math.round(g.totalSeconds);
    g.maxSessionSeconds = Math.round(maxS);
    g.avgSessionSeconds = g.sessionsCount > 0 ? Math.round(g.totalSeconds / g.sessionsCount) : 0;
    let topName: string | null = null;
    let topSec = 0;
    for (const [k, v] of secondsBySection) {
      if (v > topSec) { topSec = v; topName = k; }
    }
    g.topSection = topName;
    g.topSectionSeconds = Math.round(topSec);
  }

  return { guests, sessions, convs, msgs, msgsByConv, unresolvedByConv, sessionByPhoneName, convBySid };
}

export const getEngagementGuests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const common = await loadCommon(context, data);
    const built = buildGuestIndex(common);
    const q = (data.q ?? "").trim().toLowerCase();
    const guestList = Array.from(built.guests.values())
      .filter((g) => {
        if (!q) return true;
        return (
          g.guestName.toLowerCase().includes(q) ||
          (g.phone && g.phone.includes(q.replace(/\D+/g, ""))) ||
          (g.reservationCode ?? "").toLowerCase().includes(q) ||
          g.propertyName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

    // Tabela macro de conversas
    const conversations = built.convs
      .map((c) => {
        const msgs = built.msgsByConv.get(c.id) ?? [];
        const firstUser = msgs.find((m) => m.role === "user");
        // encontrar hóspede via sessão
        let matchedGuest: GuestAgg | null = null;
        const ss = built.sessionByPhoneName;
        for (const g of built.guests.values()) {
          const idKey = g.phone ? `${g.propertyId}|p:${g.phone}` : `${g.propertyId}|n:${normalizeName(g.guestName)}`;
          const gs = ss.get(idKey) ?? [];
          if (gs.some((s) => s.sid === c.guest_session_id)) { matchedGuest = g; break; }
        }
        return {
          id: c.id,
          propertyId: c.property_id,
          propertyName: common.nameById.get(c.property_id) ?? "",
          guestName: matchedGuest?.guestName ?? c.guest_name ?? "—",
          phone: matchedGuest?.phone ?? "",
          checkinDate: matchedGuest?.checkinDate ?? null,
          guestKey: matchedGuest?.key ?? null,
          firstMessage: (firstUser?.content ?? "").slice(0, 140),
          messagesCount: msgs.length,
          hasUnresolvedFeedback: built.unresolvedByConv.has(c.id),
          startedAt: c.created_at,
          lastMessageAt: c.last_message_at,
        };
      })
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));

    return {
      properties: Array.from(common.nameById.entries()).map(([id, name]) => ({ id, name })),
      guests: guestList,
      conversations,
    };
  });

export type EngagementGuestsPayload = Awaited<ReturnType<typeof getEngagementGuests>>;
export type GuestListItem = EngagementGuestsPayload["guests"][number];
export type ConversationRow = EngagementGuestsPayload["conversations"][number];

// ------- Detail --------------------------------------------------------

export const getGuestDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GuestDetailInput.parse(i))
  .handler(async ({ data, context }) => {
    // A chave carrega propertyId|p:phone|checkin OU propertyId|n:name|checkin.
    // Recarregamos um período longo (365d) para não perder eventos antigos.
    const common = await loadCommon(context, { period: "all", propertyIds: null, asUserId: data.asUserId ?? null });
    const built = buildGuestIndex(common);
    const g = built.guests.get(data.guestKey);
    if (!g) throw new Error("Hóspede não encontrado");
    const idKey = g.phone ? `${g.propertyId}|p:${g.phone}` : `${g.propertyId}|n:${normalizeName(g.guestName)}`;
    const ss = (built.sessionByPhoneName.get(idKey) ?? []).sort((a, b) => a.start - b.start);
    const sessions = ss.map((s) => ({
      sid: s.sid,
      startedAt: new Date(s.start).toISOString(),
      endedAt: new Date(s.end).toISOString(),
      durationSeconds: Math.round(sessionSeconds(s)),
      sectionsSequence: s.sections.map((it) => ({ section: it.section, at: it.at })),
    }));
    const conversations: Array<{
      id: string; startedAt: string; lastMessageAt: string;
      messages: Array<{ id: string; role: string; content: string; createdAt: string; feedback?: { reason: string | null; resolved: boolean } | null }>;
    }> = [];
    for (const s of ss) {
      const cs = built.convBySid.get(s.sid) ?? [];
      for (const c of cs) {
        const msgs = (built.msgsByConv.get(c.id) ?? []).map((m) => ({
          id: m.id, role: m.role, content: m.content ?? "", createdAt: m.created_at,
        }));
        conversations.push({
          id: c.id, startedAt: c.created_at, lastMessageAt: c.last_message_at,
          messages: msgs,
        });
      }
    }
    return { guest: g, sessions, conversations };
  });

export type GuestDetailPayload = Awaited<ReturnType<typeof getGuestDetail>>;
