/**
 * Middleware global de auditoria de chamadas de servidor.
 *
 * Toda chamada a um server function é registrada: quem chamou, qual função,
 * duração, resultado e erro (quando houver). Auditoria nunca derruba a
 * operação — falhas de log são engolidas.
 */
import { createMiddleware } from "@tanstack/react-start";

/** Funções que não podem ser auditadas (evita recursão infinita de logs). */
const SKIP = new Set(["ingestTrail", "recordClientEvent", "listSystemEvents", "getSystemEventTimeline", "getAuditAnalytics", "listAuditTenants"]);

function subFromToken(token: string | null): { id: string | null; email: string | null } {
  if (!token) return { id: null, email: null };
  try {
    const part = token.replace(/^Bearer\s+/i, "").split(".")[1];
    if (!part) return { id: null, email: null };
    const json = JSON.parse(
      Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"),
    ) as { sub?: string; email?: string };
    return { id: json.sub ?? null, email: json.email ?? null };
  } catch {
    return { id: null, email: null };
  }
}

export const auditServerCalls = createMiddleware({ type: "function" }).server(
  async ({ next, method, serverFnMeta }) => {
    const name = serverFnMeta?.name ?? serverFnMeta?.id ?? "unknown";
    if (SKIP.has(name)) return next();

    const startedAt = Date.now();
    try {
      const result = await next();
      void record(name, method, startedAt, null, serverFnMeta?.filename);
      return result;
    } catch (error) {
      void record(name, method, startedAt, error, serverFnMeta?.filename);
      throw error;
    }
  },
);

async function record(
  name: string,
  method: string,
  startedAt: number,
  error: unknown,
  filename?: string,
): Promise<void> {
  try {
    const { getRequestHeader, getRequestIP } = await import("@tanstack/react-start/server");
    const actor = subFromToken(getRequestHeader("authorization") ?? null);
    let ip: string | null = null;
    try {
      ip = getRequestIP({ xForwardedFor: true }) ?? null;
    } catch {
      ip = null;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logSystemEvent } = await import("@/lib/ai/audit/events.server");
    let actorLabel: string | null = actor.email;
    if (actor.id) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", actor.id)
        .maybeSingle();
      actorLabel = ((prof as { full_name?: string } | null)?.full_name ?? "").trim() || actor.email;
    }
    await logSystemEvent(supabaseAdmin, {
      tenantId: actor.id,
      userId: actor.id,
      actorType: actor.id ? "USER" : "GUEST",
      actorId: actor.id,
      actorName: actorLabel ?? "visitante",
      eventType: error ? "server_fn_failed" : "server_fn_called",
      eventCategory: error ? "ERROR" : "SERVER_CALL",

      entityType: "server_function",
      entityId: name,
      description: `${method} ${name}${error ? " — falhou" : ""}`,
      severity: error ? "error" : "info",
      source: "server",
      ipReference: ip,
      metadata: {
        function: name,
        file: filename ?? null,
        method,
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message.slice(0, 300) : error ? String(error).slice(0, 300) : null,
      },
      result: error ? "failure" : "success",
    });
  } catch {
    /* nunca propaga */
  }
}
