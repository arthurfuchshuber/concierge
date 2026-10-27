import { createFileRoute } from "@tanstack/react-router";

/**
 * Avisos do Malvo (Open Finance). Valida a assinatura HMAC sobre o corpo cru,
 * grava o evento (idempotente por eventId) e responde 200 rápido; a fila é
 * drenada logo em seguida e pelo cron `/api/public/cron/malvo-sync`.
 */
export const Route = createFileRoute("/api/public/webhooks/malvo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secrets = [process.env["MALVO_WEBHOOK_SECRET"], process.env["MALVO_WEBHOOK_SECRET_PREV"]].filter(
          (s): s is string => !!s,
        );
        if (!secrets.length) return new Response("Unauthorized", { status: 401 });
        const raw = await request.text();
        const { verifyMalvoSignature, enqueueMalvoEvent } = await import("@/lib/malvo.server");
        const ok = await verifyMalvoSignature(raw, request.headers.get("malvo-signature"), secrets);
        if (!ok) return new Response("Invalid signature", { status: 401 });

        let evt: { event?: unknown; eventId?: unknown } | null = null;
        try {
          evt = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        if (!evt || typeof evt.event !== "string" || typeof evt.eventId !== "string" || evt.eventId.length > 100) {
          return new Response("Bad event", { status: 400 });
        }
        try {
          await enqueueMalvoEvent(evt);
        } catch (err) {
          console.error("[malvo-webhook] enqueue", err);
          return new Response("Retry", { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
