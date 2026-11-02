/**
 * Middleware global de auditoria de chamadas de servidor.
 *
 * O QUE ENTRA NA TRILHA (02/11/2026, autorizado pelo cliente):
 *   · AÇÕES (salvar, confirmar, excluir, enviar…): SEMPRE, e a gravação é
 *     AGUARDADA antes da resposta. Antes ela rodava "solta" depois da
 *     resposta e o servidor encerrava antes de terminar — só 1 de 9
 *     confirmações de check-in/checkout de uma semana ficou registrada.
 *   · LEITURAS (list…, get…, count…, check…): só quando FALHAM. Eram 98% da
 *     trilha (~550 mil linhas/dia, 6,5 GB) e não dizem quem fez o quê.
 *
 * Registra quem chamou, qual função, o que foi enviado, duração, resultado e
 * erro. Auditoria nunca derruba a operação — falhas de log são engolidas.
 */
import { createMiddleware } from "@tanstack/react-start";

/** Funções que não podem ser auditadas (evita recursão infinita de logs). */
const SKIP = new Set(["ingestTrail", "recordClientEvent", "listSystemEvents", "getSystemEventTimeline", "getAuditAnalytics", "listAuditTenants"]);

/**
 * Leitura pelo NOME da função (o método HTTP não serve: há leituras em POST e
 * ao menos uma gravação em GET, `backfillPropertyCoords`). Efeitos automáticos
 * dentro de leituras (semear categorias padrão, encerrar conversas paradas,
 * cache) não são ações de alguém e não entram.
 */
const READ_NAME =
  /^(list|get|count|check|fetch|search|load|read|lookup|preview|validate|verify|is|has)[A-Z]|^admin(List|Get)[A-Z]|^compare[A-Z]/;
export function isReadCall(name: string): boolean {
  return READ_NAME.test(name);
}

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
  async (opts) => {
    const { next, method, serverFnMeta } = opts;
    const name = serverFnMeta?.name ?? serverFnMeta?.id ?? "unknown";
    if (SKIP.has(name)) return next();

    const payload = (opts as unknown as { data?: unknown }).data;
    const startedAt = Date.now();
    const read = isReadCall(name);
    try {
      const result = await next();
      if (!read) await record(name, method, startedAt, null, payload, serverFnMeta?.filename);
      return result;
    } catch (error) {
      await record(name, method, startedAt, error, payload, serverFnMeta?.filename);
      throw error;
    }
  },
);

const nameCache = new Map<string, { name: string | null; until: number }>();

async function record(
  name: string,
  method: string,
  startedAt: number,
  error: unknown,
  payload: unknown,
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
    const { logSystemEvent } = await import("@/lib/audit/events.server");
    const { describeServerCall, sanitizeArgs } = await import("@/lib/audit-fn-labels.server");
    let actorLabel: string | null = actor.email;
    if (actor.id) {
      // Nome em cache por instância (10 min): agora a gravação é aguardada, então
      // a consulta do perfil não deve se repetir a cada ação da mesma pessoa.
      const hit = nameCache.get(actor.id);
      if (hit && hit.until > Date.now()) {
        actorLabel = hit.name ?? actor.email;
      } else {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", actor.id)
          .maybeSingle();
        const name = ((prof as { full_name?: string } | null)?.full_name ?? "").trim() || null;
        nameCache.set(actor.id, { name, until: Date.now() + 10 * 60_000 });
        actorLabel = name ?? actor.email;
      }
    }
    await logSystemEvent(supabaseAdmin, {
      tenantId: actor.id,
      userId: actor.id,
      actorType: actor.id ? "USER" : "GUEST",
      actorId: actor.id,
      actorName: actorLabel ?? actor.email ?? "visitante",
      eventType: error ? "server_fn_failed" : "server_fn_called",
      eventCategory: error ? "ERROR" : "SERVER_CALL",

      entityType: "server_function",
      entityId: name,
      description: describeServerCall(name, payload, !!error),
      severity: error ? "error" : "info",
      source: "server",
      ipReference: ip,
      metadata: {
        function: name,
        file: filename ?? null,
        method,
        duration_ms: Date.now() - startedAt,
        actor_email: actor.email,
        args: sanitizeArgs(payload),
        error: error instanceof Error ? error.message.slice(0, 300) : error ? String(error).slice(0, 300) : null,
      },
      result: error ? "failure" : "success",
    });
  } catch {
    /* nunca propaga */
  }
}
