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
  /** Nome informado no formulário de acesso do hóspede, quando houver. */
  actorName?: string;
};


const MAX_EVENTS = 50;

/**
 * Identidade VERIFICADA do autor.
 *
 * Antes o token era apenas decodificado em base64 — qualquer pessoa poderia
 * forjar `sub`/`email` e gravar rastro em nome de outro usuário. Agora o token
 * é validado pelo serviço de autenticação; se não for válido, o evento entra
 * como visitante anônimo.
 */
async function verifiedActor(
  authHeader: string | null,
): Promise<{ userId: string | null; email: string | null }> {
  const token = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { userId: null, email: null };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return { userId: null, email: null };
    return { userId: data.user.id, email: data.user.email ?? null };
  } catch {
    return { userId: null, email: null };
  }
}

/**
 * Freio simples por origem: o endpoint é público (o hóspede não tem login),
 * então limitamos a quantidade de lotes por minuto para que ninguém consiga
 * inflar a trilha de auditoria.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_BATCHES = 30;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function allowRate(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_MAX_BATCHES;
}

export const ingestTrail = createServerFn({ method: "POST" })
  .inputValidator((input: Payload) => ({
    events: (input?.events ?? []).slice(0, MAX_EVENTS),
    deviceId: input?.deviceId,
    sessionId: input?.sessionId,
    guideSlug: input?.guideSlug,
    actorName: typeof input?.actorName === "string" ? input.actorName.slice(0, 120) : undefined,
  }))
  .handler(async ({ data }) => {
    if (!data.events.length) return { ok: true, stored: 0 };

    const { getRequestHeader, getRequestIP } = await import("@tanstack/react-start/server");
    const auth = getRequestHeader("authorization") ?? null;
    const { userId, email } = await verifiedActor(auth);
    const userAgent = getRequestHeader("user-agent") ?? null;
    let ip: string | null = null;
    try {
      ip = getRequestIP({ xForwardedFor: true }) ?? null;
    } catch {
      ip = null;
    }

    if (!allowRate(userId ?? data.deviceId ?? ip ?? "anon")) {
      return { ok: true, stored: 0, throttled: true };
    }


    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logSystemEvents } = await import("@/lib/ai/audit/events.server");

    // Autor: nome do perfil > nome do formulário de acesso > e-mail > visitante.
    let profileName: string | null = null;
    if (userId) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
      profileName = ((prof as { full_name?: string } | null)?.full_name ?? "").trim() || null;
    }
    const actorName = profileName ?? data.actorName ?? email ?? "visitante";

    await logSystemEvents(
      supabaseAdmin,
      data.events.map((e) => ({
        tenantId: userId,
        userId,
        actorType: userId ? ("USER" as const) : ("GUEST" as const),
        actorId: userId ?? data.deviceId ?? null,
        actorName,

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
