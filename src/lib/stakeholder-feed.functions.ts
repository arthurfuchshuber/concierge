import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type StakeholderFeedEvent = {
  id: string;
  source: "calendar";
  title: string;
  at: string | null;
  calendarName: string;
  htmlLink: string | null;
  hangoutLink: string | null;
  attendees: string[];
  attachments: Array<{ title: string; url: string; kind: "recording" | "transcript" | "file" }>;
  via: string;
};

export type StakeholderFeedDocument = {
  id: string;
  source: "clicksign";
  name: string;
  status: string | null;
  at: string | null;
  urlSigned: string | null;
  urlOriginal: string | null;
  signers: Array<{ name?: string; email?: string; status?: string }>;
};

export type StakeholderFeed = {
  events: StakeholderFeedEvent[];
  documents: StakeholderFeedDocument[];
  calendarError: string | null;
};

const INPUT = z.object({
  type: z.enum(["owner", "provider"]),
  id: z.string().uuid(),
});

/**
 * Puxa TUDO que as integrações já vincularam a este cadastro:
 * eventos/gravações/transcrições do Google Agenda e documentos do ClickSign.
 */
export const getStakeholderIntegrationFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => INPUT.parse(raw))
  .handler(async ({ data, context }): Promise<StakeholderFeed> => {
    const { supabase, userId } = context;

    const docsPromise = supabase
      .from("clicksign_documents")
      .select("id, name, status, url_signed, url_original, finished_at, signers, synced_at")
      .eq("account_owner_id", userId)
      .eq("stakeholder_type", data.type)
      .eq("stakeholder_id", data.id)
      .order("synced_at", { ascending: false });

    let events: StakeholderFeedEvent[] = [];
    let calendarError: string | null = null;
    try {
      const { getConnectionKeyForUser } = await import("@/lib/app-user-connections.server");
      const { CONNECTOR_ID, fetchAllEvents } = await import("@/lib/google-calendar.server");
      const key = await getConnectionKeyForUser(userId, CONNECTOR_ID);
      if (key) {
        const all = await fetchAllEvents(supabase, userId);
        events = all
          .filter((e) => e.link && e.link.type === data.type && e.link.id === data.id)
          .map((e) => ({
            id: e.id,
            source: "calendar" as const,
            title: e.summary,
            at: e.start,
            calendarName: e.calendarName,
            htmlLink: e.htmlLink,
            hangoutLink: e.hangoutLink,
            attendees: e.attendees,
            attachments: e.attachments,
            via: e.link!.via,
          }));
      }
    } catch (e) {
      calendarError = e instanceof Error ? e.message : String(e);
    }

    const { data: docs } = await docsPromise;
    const documents: StakeholderFeedDocument[] = (docs ?? []).map((d) => ({
      id: d.id as string,
      source: "clicksign" as const,
      name: (d.name as string) ?? "Documento",
      status: (d.status as string) ?? null,
      at: ((d.finished_at as string) ?? (d.synced_at as string)) ?? null,
      urlSigned: (d.url_signed as string) ?? null,
      urlOriginal: (d.url_original as string) ?? null,
      signers: Array.isArray(d.signers) ? (d.signers as StakeholderFeedDocument["signers"]) : [],
    }));

    return { events, documents, calendarError };
  });
