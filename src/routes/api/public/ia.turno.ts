import { createFileRoute } from "@tanstack/react-router";

/**
 * TURNO DA IA EM REQUISIÇÃO PRÓPRIA (17/11/2026). Disparado pelo banco (`dispatch_guest_ai_turn`, pg_net com espera
 * de 150 s) logo depois que o webhook grava a mensagem do hóspede. Roda o MESMO turno do webhook
 * (`runAirbnbAiTurn`: geração, barreira pré-envio, encaminhamento, entrega) com os prazos de `LONG_TURN`.
 * FAIL-CLOSED: sem `CRON_SECRET` ou com cabeçalho diferente ⇒ 401; corpo inválido ⇒ 400.
 */
async function handle(request: Request): Promise<Response> {
  const secret = process.env["CRON_SECRET"];
  const given = request.headers.get("x-cron-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given !== secret) return new Response("unauthorized", { status: 401 });
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return new Response("invalid_json", { status: 400 });
  }
  const { parseAirbnbTurnPayload, runAirbnbAiTurn } = await import("@/lib/channex-messages.server");
  const turn = parseAirbnbTurnPayload(body);
  if (!turn) return new Response("invalid_turn", { status: 400 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const started = Date.now();
  try {
    await runAirbnbAiTurn(supabaseAdmin, turn, { longTurn: true });
  } catch (e) {
    console.error("[ia/turno] turno falhou", turn.convId, e);
    return Response.json({ ok: false, ms: Date.now() - started }, { status: 500 });
  }
  return Response.json({ ok: true, ms: Date.now() - started });
}

export const Route = createFileRoute("/api/public/ia/turno")({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});
