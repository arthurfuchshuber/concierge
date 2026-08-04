/**
 * Ingestão universal de rastro de uso.
 *
 * Recebe lotes de eventos do navegador (host, equipe e hóspede) e grava no
 * Enterprise Audit Trail. Funciona autenticado ou anônimo: quando há sessão,
 * o evento é atribuído ao usuário; caso contrário fica como visitante/hóspede
 * identificado por um ID anônimo de dispositivo.
 */
import { createServerFn } from "@tanstack/react-start";

export type TrailEventInput = {
  /** Ex.: page_view, click, form_submit, field_changed, copy, scroll_depth. */
  type: string;
  /** Rótulo legível do que aconteceu. */
  label?: string;
  path?: string;
  /** Alvo (texto do botão, nome do campo, href do link...). */
  target?: string;
  category?: "ACTIVITY" | "ERROR" | "AUTHENTICATION";
  severity?: "info" | "notice" | "warning" | "error" | "critical";
  metadata?: Record<string, unknown>;
  at?: string;
};

type Payload = {
  events: TrailEventInput[];
  /** ID anônimo persistido no dispositivo (não é PII). */
  deviceId?: string;
  sessionId?: string;
  /** Slug do guia, quando o rastro vem da área do hóspede. */
  guideSlug?: string;
};

const MAX_EVENTS = 200;

function decodeUserId(token: string | null): string | null {
  if (!token) return null;
  try {
    const raw = token.replace(/^Bearer\s+/i, "");
    const part = raw.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(
      Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"),
    ) as { sub?: string; email?: string };
    return json.sub ?? null;
  } catch {
    return null;
  }
}

function decodeEmail(token: string | null): string | null {
  if (!token) return null;
  try {
    const raw = token.replace(/^Bearer\s+/i, "");
    const part = raw.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(
      Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"),
    ) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

export const ingestTrail = createServerFn({ method: "POST" })
  .inputValidator((input: Payload) => ({
    events: (input?.events ?? []).slice(0, MAX_EVENTS),
    deviceId: input?.deviceId,
    sessionId: input?.sessionId,
    guideSlug: input?.guideSlug,
  }))
  .handler(async ({ data }) => {
    if (!data.events.length) return { ok: true, stored: 0 };

    const { getRequestHeader, getRequestIP } = await import("@tanstack/react-start/server");
    const auth = getRequestHeader("authorization") ?? null;
    const userId = decodeUserId(auth);
    const email = decodeEmail(auth);
    const userAgent = getRequestHeader("user-agent") ?? null;
    let ip: string | null = null;
    try {
      ip = getRequestIP({ xForwardedFor: true }) ?? null;
    } catch {
      ip = null;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logSystemEvents } = await import("@/lib/ai/audit/events.server");

    await logSystemEvents(
      supabaseAdmin,
      data.events.map((e) => ({
        tenantId: userId,
        userId,
        actorType: userId ? ("USER" as const) : ("GUEST" as const),
        actorId: userId ?? data.deviceId ?? null,
        actorName: email ?? (data.guideSlug ? `hóspede:${data.guideSlug}` : "visitante"),
        eventType: e.type,
        eventCategory: e.category ?? "ACTIVITY",
        entityType: e.target ? "ui_element" : "page",
        entityId: e.target ?? e.path ?? null,
        description: e.label ?? null,
        source: data.guideSlug ? "guest_web" : "web_app",
        channel: "web",
        ipReference: ip,
        severity: e.severity ?? "info",
        correlationId: data.sessionId ?? null,
        metadata: {
          path: e.path ?? null,
          device_id: data.deviceId ?? null,
          session_id: data.sessionId ?? null,
          guide_slug: data.guideSlug ?? null,
          user_agent: userAgent,
          occurred_at: e.at ?? new Date().toISOString(),
          ...(e.metadata ?? {}),
        },
        result: e.severity === "error" || e.severity === "critical" ? ("failure" as const) : ("success" as const),
      })),
    );

    return { ok: true, stored: data.events.length };
  });
