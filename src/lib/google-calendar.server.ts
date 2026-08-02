// Acesso server-only ao Google Agenda via connector gateway + vínculo com stakeholders.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GcalCalendar, GcalEvent, GcalAttachment } from "@/lib/google-calendar.types";
import {
  buildMatchIndex,
  resolveStakeholder,
  emailDomain,
  type MatchIndex,
} from "@/lib/stakeholder-matching.server";

export const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
export const CONNECTOR_ID = "google_calendar";

export const GCAL_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

export async function gcal(userId: string, path: string) {
  const { getConnectionKeyForUser } = await import("@/lib/app-user-connections.server");
  const connectionAPIKey = await getConnectionKeyForUser(userId, CONNECTOR_ID);
  if (!connectionAPIKey) throw new Error("Google Agenda não está conectado para este usuário.");
  const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey,
    connectorId: CONNECTOR_ID,
    path,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

export async function fetchCalendars(userId: string): Promise<GcalCalendar[]> {
  const json = (await gcal(userId, "/calendar/v3/users/me/calendarList?maxResults=250")) as {
    items?: Array<{ id: string; summary?: string; primary?: boolean; timeZone?: string }>;
  };
  return (json.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary ?? c.id,
    primary: Boolean(c.primary),
    timeZone: c.timeZone ?? null,
  }));
}

function classifyAttachment(title: string, mimeType: string): GcalAttachment["kind"] {
  const t = title.toLowerCase();
  if (t.includes("transcri")) return "transcript";
  if (t.includes("gravaç") || t.includes("recording") || mimeType.startsWith("video/")) return "recording";
  return "file";
}

/** Índice de vínculo (cadastros + apelidos aprendidos) da conta. */
export async function loadMatchIndex(
  supabase: SupabaseClient,
  accountOwnerId: string,
): Promise<MatchIndex> {
  const [{ data: owners }, { data: providers }, { data: aliases }] = await Promise.all([
    supabase
      .from("property_owners")
      .select("id, name, trade_name, email, doc, phone")
      .eq("account_owner_id", accountOwnerId),
    supabase
      .from("service_providers")
      .select("id, name, trade_name, email, doc, phone")
      .eq("account_owner_id", accountOwnerId),
    supabase
      .from("stakeholder_link_aliases")
      .select("alias_kind, alias_value, stakeholder_type, stakeholder_id")
      .eq("account_owner_id", accountOwnerId),
  ]);
  return buildMatchIndex((owners ?? []) as never, (providers ?? []) as never, (aliases ?? []) as never);
}

/** Busca TODOS os eventos brutos de uma agenda (sem recorte de período). */
async function fetchRawEvents(userId: string, calendarId: string) {
  const base =
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
    `?singleEvents=true&orderBy=startTime&maxResults=2500&showDeleted=false`;
  const items: Array<Record<string, unknown>> = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 40; page++) {
    const path: string = pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base;
    const json = (await gcal(userId, path)) as {
      items?: Array<Record<string, unknown>>;
      nextPageToken?: string;
    };
    items.push(...(json.items ?? []));
    pageToken = json.nextPageToken ?? null;
    if (!pageToken) break;
  }
  return items;
}

const CONFERENCE_URL_RE =
  /(meet\.google\.com|zoom\.us\/j\/|teams\.microsoft\.com\/l\/meetup-join|whereby\.com|meet\.jit\.si|webex\.com\/meet)/i;

/** Extrai o link de conferência de um evento (Meet nativo ou link em outros campos). */
function extractConferenceLink(raw: Record<string, unknown>): string | null {
  const hangout = raw['hangoutLink'] as string | undefined;
  if (hangout) return hangout;

  const conference = raw['conferenceData'] as
    | { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
    | undefined;
  const video = conference?.entryPoints?.find((e) => e.entryPointType === "video" && e.uri);
  if (video?.uri) return video.uri;

  for (const field of ["location", "description"] as const) {
    const value = raw[field] as string | undefined;
    if (!value) continue;
    const match = value.match(/https?:\/\/[^\s<>"')]+/g)?.find((u) => CONFERENCE_URL_RE.test(u));
    if (match) return match;
  }
  return null;
}

/** Somente reuniões reais: precisam ter um link de conferência ativo. */
function isMeeting(raw: Record<string, unknown>): boolean {
  if (raw['status'] === "cancelled") return false;
  // Feriados / aniversários e afins nunca têm conferência, mas descartamos explicitamente.
  const type = raw['eventType'] as string | undefined;
  if (type && type !== "default" && type !== "outOfOffice" && type !== "focusTime") return false;
  return extractConferenceLink(raw) !== null;
}

function mapEvent(
  raw: Record<string, unknown>,
  calendarId: string,
  calendarName: string,
  index: MatchIndex,
): GcalEvent {
  const start = raw['start'] as { dateTime?: string; date?: string } | undefined;
  const end = raw['end'] as { dateTime?: string; date?: string } | undefined;
  const attendeeList =
    (raw['attendees'] as Array<{ email?: string; self?: boolean; organizer?: boolean }> | undefined) ?? [];
  const organizer = raw['organizer'] as { email?: string; self?: boolean } | undefined;
  const attachments =
    (raw['attachments'] as Array<{ title?: string; fileUrl?: string; mimeType?: string }> | undefined) ?? [];
  const summary = String(raw['summary'] ?? "(sem título)");
  const description = (raw['description'] as string) ?? null;
  const location = (raw['location'] as string) ?? null;
  const id = String(raw['id'] ?? "");

  const externalEmails = attendeeList.filter((a) => !a.self && a.email).map((a) => a.email!.toLowerCase());
  if (organizer?.email && !organizer.self) externalEmails.push(organizer.email.toLowerCase());

  const link = resolveStakeholder(index, {
    emails: externalEmails,
    texts: [summary, description ?? "", location ?? ""],
    eventIds: [id],
    titles: [summary],
  });

  const firstEmail = externalEmails[0] ?? null;
  const domain = firstEmail ? emailDomain(firstEmail) : null;

  return {
    id,
    calendarId,
    calendarName,
    summary,
    description,
    location,
    start: start?.dateTime ?? start?.date ?? null,
    end: end?.dateTime ?? end?.date ?? null,
    hangoutLink: extractConferenceLink(raw),
    htmlLink: (raw['htmlLink'] as string) ?? null,
    attendees: attendeeList.map((a) => a.email ?? "").filter(Boolean),
    attachments: attachments
      .filter((a) => a.fileUrl)
      .map((a) => ({
        title: a.title ?? "Anexo",
        url: a.fileUrl!,
        kind: classifyAttachment(a.title ?? "", a.mimeType ?? ""),
      })),
    link: link ? { type: link.type, id: link.id, label: link.label, via: link.via } : null,
    suggestedAlias: domain
      ? ({ kind: "domain", value: domain } as const)
      : firstEmail
        ? ({ kind: "email", value: firstEmail } as const)
        : null,
  };
}

/** Todos os eventos de uma agenda, já vinculados. */
export async function fetchEventsForCalendar(
  supabase: SupabaseClient,
  userId: string,
  calendarId: string,
  calendarName?: string,
): Promise<GcalEvent[]> {
  const [raws, index] = await Promise.all([
    fetchRawEvents(userId, calendarId),
    loadMatchIndex(supabase, userId),
  ]);
  return raws.map((r) => mapEvent(r, calendarId, calendarName ?? calendarId, index));
}

/** Todos os eventos de TODAS as agendas da conta conectada. */
export async function fetchAllEvents(supabase: SupabaseClient, userId: string): Promise<GcalEvent[]> {
  const [calendars, index] = await Promise.all([fetchCalendars(userId), loadMatchIndex(supabase, userId)]);
  const out: GcalEvent[] = [];
  for (const cal of calendars) {
    try {
      const raws = await fetchRawEvents(userId, cal.id);
      out.push(...raws.map((r) => mapEvent(r, cal.id, cal.summary, index)));
    } catch {
      // Uma agenda inacessível não pode derrubar a importação inteira.
    }
  }
  return out.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
}
