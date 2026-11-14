import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron do vigia de encaminhamentos sem resposta (agendar a cada 5 min). FAIL-CLOSED: sem `CRON_SECRET` configurado
 * ou com cabeçalho diferente ⇒ 401. Use o mesmo segredo/cabeçalho dos demais crons do projeto.
 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env["CRON_SECRET"];
  const given = request.headers.get("x-cron-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given !== secret) return new Response("unauthorized", { status: 401 });
  const { runHandoffWatchdog } = await import("@/lib/handoff-watchdog.server");
  const out = await runHandoffWatchdog();
  return Response.json(out);
}

export const Route = createFileRoute("/api/public/cron/handoff-watchdog")({
  server: { handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) } },
});
