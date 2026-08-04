import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { GcalStatus, GcalCalendar, GcalEvent } from "@/lib/google-calendar.types";

export type { GcalStatus, GcalCalendar, GcalEvent, GcalAttachment } from "@/lib/google-calendar.types";

/** Status da conexão do anfitrião logado com o Google Agenda. */
export const getMyGoogleCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GcalStatus> => {
    const { getConnectionKeyForUser } = await import("@/lib/app-user-connections.server");
    const { CONNECTOR_ID, fetchCalendars } = await import("@/lib/google-calendar.server");
    const connectionAPIKey = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (!connectionAPIKey) return { connected: false, email: null, calendarsCount: 0, error: null };
    try {
      const items = await fetchCalendars(context.userId);
      const primary = items.find((c) => c.primary) ?? items[0];
      return { connected: true, email: primary?.id ?? null, calendarsCount: items.length, error: null };
    } catch (e) {
      return {
        connected: true,
        email: null,
        calendarsCount: 0,
        error: e instanceof Error ? e.message : String(e),
      };
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

    const { GATEWAY_BASE_URL, CONNECTOR_ID, GCAL_SCOPES } = await import("@/lib/google-calendar.server");
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
      credentialsConfiguration: { scopes: GCAL_SCOPES },
    });
    return { authorizationUrl };
  });

/** Troca o código de uso único pela chave de conexão e guarda criptografada. */
export const completeGoogleCalendarConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ code: z.string().min(1).max(2000) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { GATEWAY_BASE_URL, CONNECTOR_ID } = await import("@/lib/google-calendar.server");
    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(GATEWAY_BASE_URL, data.code);
    if (connectorId !== CONNECTOR_ID) throw new Error("O OAuth retornou um conector inesperado.");
    const { saveConnectionKeyForUser } = await import("@/lib/app-user-connections.server");
    await saveConnectionKeyForUser(context.userId, connectorId, connectionAPIKey);
    const { auditIntegration } = await import("@/lib/ai/audit/platform.server");
    await auditIntegration("integration_connected", {
      userId: context.userId,
      integration: "google_calendar",
      description: "Google Agenda conectado à conta.",
    });
    return { ok: true };
  });

/** Remove a conexão do anfitrião (no gateway e localmente). */
export const disconnectMyGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { GATEWAY_BASE_URL, CONNECTOR_ID } = await import("@/lib/google-calendar.server");
    const { getConnectionKeyForUser, deleteConnectionForUser } = await import(
      "@/lib/app-user-connections.server"
    );
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
    const { auditIntegration } = await import("@/lib/ai/audit/platform.server");
    await auditIntegration("integration_disconnected", {
      userId: context.userId,
      integration: "google_calendar",
      description: "Google Agenda desconectado da conta.",
      severity: "notice",
    });
    return { ok: true };
  });

/** Todas as agendas da conta conectada. */
export const listMyGoogleCalendars = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GcalCalendar[]> => {
    const { fetchCalendars } = await import("@/lib/google-calendar.server");
    return fetchCalendars(context.userId);
  });

/**
 * TODOS os eventos (sem recorte de período), com gravações/transcrições do Meet
 * e o vínculo com proprietário/prestador. `calendarId: "all"` percorre todas as agendas.
 */
export const listMyGoogleCalendarEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ calendarId: z.string().min(1).max(300).default("all") }).parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<GcalEvent[]> => {
    const { fetchAllEvents, fetchEventsForCalendar } = await import("@/lib/google-calendar.server");
    if (data.calendarId === "all") return fetchAllEvents(context.supabase, context.userId);
    return fetchEventsForCalendar(context.supabase, context.userId, data.calendarId);
  });
