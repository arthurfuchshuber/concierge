import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook da Stripe. Valida a assinatura `Stripe-Signature` sobre o corpo cru e aplica o evento
 * (cada handler relê o estado na Stripe, então repetição/ordem não importam). Falha → 500 e a
 * própria Stripe reenvia.
 */
export const Route = createFileRoute("/api/public/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secrets = [process.env["STRIPE_WEBHOOK_SECRET"], process.env["STRIPE_WEBHOOK_SECRET_PREV"]].filter(
          (s): s is string => !!s,
        );
        if (!secrets.length) return new Response("Unauthorized", { status: 401 });
        const raw = await request.text();
        const { verifyStripeSignature } = await import("@/lib/billing/stripe.server");
        if (!(await verifyStripeSignature(raw, request.headers.get("stripe-signature"), secrets))) {
          return new Response("Invalid signature", { status: 401 });
        }
        let evt: { id?: unknown; type?: unknown; data?: { object?: unknown } } | null = null;
        try {
          evt = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        if (!evt || typeof evt.id !== "string" || typeof evt.type !== "string" || !evt.data?.object) {
          return new Response("Bad event", { status: 400 });
        }
        try {
          const { handleStripeEvent } = await import("@/lib/billing/stripe-webhook.server");
          await handleStripeEvent(evt as never);
          return Response.json({ received: true });
        } catch (err) {
          console.error("[stripe-webhook]", evt.type, err instanceof Error ? err.message : err);
          return new Response("Retry", { status: 500 });
        }
      },
    },
  },
});
