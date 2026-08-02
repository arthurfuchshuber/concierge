import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_calendar";

const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

export type GcalStatus = {
  connected: boolean;
  email: string | null;
  calendarsCount: number;
  error: string | null;
};

export type GcalCalendar = {
  id: string;
  summary: string;
  primary: boolean;
  timeZone: string | null;
};

export type GcalAttachment = {
  title: string;
  url: string;
  kind: "recording" | "transcript" | "file";
};

export type GcalEvent = {
  id: string;
  calendarId: string;
  summary: string;
  start: string | null;
  end: string | null;
  hangoutLink: string | null;
  htmlLink: string | null;
  attendees: string[];
  attachments: GcalAttachment[];
  /** Vínculo automático com proprietário/prestador cadastrado. */
  link: { type: "owner" | "provider"; id: string; label: string; via: string } | null;
  /** Melhor identificador externo do evento (para o vínculo manual). */
  suggestedAlias: { kind: "email" | "domain"; value: string } | null;
};


/** Status da conexão do anfitrião logado com o Google Agenda. */
export const getMyGoogleCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GcalStatus> => {
    const { getConnectionKeyForUser } = await import("@/lib/app-user-connections.server");
    const connectionAPIKey = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (!connectionAPIKey) return { connected: false, email: null, calendarsCount: 0, error: null };

    const { callAsAppUser } = await import("@/integrations/lovable/appUserConnector");
    try {
      const res = await callAsAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey,
        connectorId: CONNECTOR_ID,
        path: "/calendar/v3/users/me/calendarList?maxResults=250",
      });
      if (!res.ok) {
        const body = await res.text();
        return { connected: true, email: null, calendarsCount: 0, error: `Google ${res.status}: ${body.slice(0, 180)}` };
      }
      const json = (await res.json()) as { items?: Array<{ id: string; primary?: boolean }> };
      const items = json.items ?? [];
      const primary = items.find((c) => c.primary) ?? items[0];
      return {
        connected: true,
        email: primary?.id ?? null,
        calendarsCount: items.length,
        error: null,
      };
    } catch (e) {
      return { connected: true, email: null, calendarsCount: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });

/** Inicia o consentimento OAuth do anfitrião (modo redirect + code exchange). */
export const startGoogleCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientAPIKey = process.env['GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY'];
    if (!clientAPIKey) throw new Error("GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY is not set");

    const request = getRequest();
    if (!request) throw new Error("O OAuth precisa iniciar a partir de uma requisição do app.");
    const returnUrl = new URL("/oauth/google-calendar/return", request.url).toString();

    const { getConnectionKeyForUser } = await import("@/lib/app-user-connections.server");
    const existing = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);

    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      appUserId: context.userId,
      clientAPIKey,
      returnUrl,
      connectionAPIKey: existing ?? undefined,
      credentialsConfiguration: { scopes: SCOPES },
    });
    return { authorizationUrl };
  });

/** Troca o código de uso único pela chave de conexão e guarda criptografada. */
export const completeGoogleCalendarConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ code: z.string().min(1).max(2000) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(GATEWAY_BASE_URL, data.code);
    if (connectorId !== CONNECTOR_ID) throw new Error("O OAuth retornou um conector inesperado.");
    const { saveConnectionKeyForUser } = await import("@/lib/app-user-connections.server");
    await saveConnectionKeyForUser(context.userId, connectorId, connectionAPIKey);
    return { ok: true };
  });

/** Remove a conexão do anfitrião (no gateway e localmente). */
export const disconnectMyGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getConnectionKeyForUser, deleteConnectionForUser } = await import("@/lib/app-user-connections.server");
    const connectionAPIKey = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (connectionAPIKey) {
      const { disconnectAppUser } = await import("@/integrations/lovable/appUserConnector");
      try {
        await disconnectAppUser({ gatewayBaseUrl: GATEWAY_BASE_URL, connectionAPIKey, connectorId: CONNECTOR_ID });
      } catch {
        // Mesmo que o gateway falhe, removemos o vínculo local.
      }
    }
    await deleteConnectionForUser(context.userId, CONNECTOR_ID);
    return { ok: true };
  });

async function gcal(userId: string, path: string) {
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

/** Todas as agendas da conta conectada. */
export const listMyGoogleCalendars = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GcalCalendar[]> => {
    const json = (await gcal(context.userId, "/calendar/v3/users/me/calendarList?maxResults=250")) as {
      items?: Array<{ id: string; summary?: string; primary?: boolean; timeZone?: string }>;
    };
    return (json.items ?? []).map((c) => ({
      id: c.id,
      summary: c.summary ?? c.id,
      primary: Boolean(c.primary),
      timeZone: c.timeZone ?? null,
    }));
  });

function classifyAttachment(title: string, mimeType: string): GcalAttachment["kind"] {
  const t = title.toLowerCase();
  if (t.includes("transcri")) return "transcript";
  if (t.includes("gravaç") || t.includes("recording") || mimeType.startsWith("video/")) return "recording";
  return "file";
}

const EVENTS_INPUT = z.object({
  calendarId: z.string().min(1).max(300).default("primary"),
});

/**
 * TODOS os eventos da agenda (sem recorte de período), já com gravações e
 * transcrições do Meet e com o vínculo automático ao proprietário/prestador.
 */
export const listMyGoogleCalendarEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => EVENTS_INPUT.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<GcalEvent[]> => {
    const base =
      `/calendar/v3/calendars/${encodeURIComponent(data.calendarId)}/events` +
      `?singleEvents=true&orderBy=startTime&maxResults=2500&showDeleted=false`;

    const items: Array<Record<string, unknown>> = [];
    let pageToken: string | null = null;
    // Sem filtro de data: percorre todas as páginas do histórico da agenda.
    for (let page = 0; page < 40; page++) {
      const path: string = pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base;
      const json = (await gcal(context.userId, path)) as {
        items?: Array<Record<string, unknown>>;
        nextPageToken?: string;
      };
      items.push(...(json.items ?? []));
      pageToken = json.nextPageToken ?? null;
      if (!pageToken) break;
    }

    const { supabase, userId } = context;
    const [{ data: owners }, { data: providers }, { data: aliases }] = await Promise.all([
      supabase.from("property_owners").select("id, name, trade_name, email, doc, phone").eq("account_owner_id", userId),
      supabase.from("service_providers").select("id, name, trade_name, email, doc, phone").eq("account_owner_id", userId),
      supabase
        .from("stakeholder_link_aliases")
        .select("alias_kind, alias_value, stakeholder_type, stakeholder_id")
        .eq("account_owner_id", userId),
    ]);
    const matching = await import("@/lib/stakeholder-matching.server");
    const index = matching.buildMatchIndex(
      (owners ?? []) as never,
      (providers ?? []) as never,
      (aliases ?? []) as never,
    );

    return items.map((raw) => {
      const start = raw['start'] as { dateTime?: string; date?: string } | undefined;
      const end = raw['end'] as { dateTime?: string; date?: string } | undefined;
      const attendeeList = (raw['attendees'] as Array<{ email?: string; self?: boolean; organizer?: boolean }> | undefined) ?? [];
      const organizer = raw['organizer'] as { email?: string; self?: boolean } | undefined;
      const attachments = (raw['attachments'] as Array<{ title?: string; fileUrl?: string; mimeType?: string }> | undefined) ?? [];
      const summary = String(raw['summary'] ?? "(sem título)");

      // Participantes externos: quem não é a própria conta conectada.
      const externalEmails = attendeeList
        .filter((a) => !a.self && a.email)
        .map((a) => a.email!.toLowerCase());
      if (organizer?.email && !organizer.self) externalEmails.push(organizer.email.toLowerCase());

      const link = matching.resolveStakeholder(index, {
        emails: externalEmails,
        texts: [summary, String(raw['description'] ?? ""), String(raw['location'] ?? "")],
      });

      const firstEmail = externalEmails[0] ?? null;
      const domain = firstEmail ? matching.emailDomain(firstEmail) : null;

      return {
        id: String(raw['id'] ?? ""),
        calendarId: data.calendarId,
        summary,
        start: start?.dateTime ?? start?.date ?? null,
        end: end?.dateTime ?? end?.date ?? null,
        hangoutLink: (raw['hangoutLink'] as string) ?? null,
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
    });
  });

