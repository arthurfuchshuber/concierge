import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron da varredura pós-pausa (agendar a cada 5 min): a IA volta nas mensagens do hóspede que chegaram durante a
 * pausa humana e ficaram sem resposta. FAIL-CLOSED: sem `CRON_SECRET` ou com cabeçalho diferente ⇒ 401.
 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env["CRON_SECRET"];
  const given = request.headers.get("x-cron-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given !== secret) return new Response("unauthorized", { status: 401 });
  const { runPostPauseSweep } = await import("@/lib/post-pause-sweep.server");
  return Response.json(await runPostPauseSweep());
}

export const Route = createFileRoute("/api/public/cron/pos-pausa")({
  server: { handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) } },
});
