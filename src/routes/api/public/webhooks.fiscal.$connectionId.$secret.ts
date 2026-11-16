import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook do provedor fiscal. Autenticidade pelo segredo na URL (guardado só como hash), corpo limitado,
 * gravação idempotente e processamento imediato. O corpo é apenas uma DICA: o estado do documento só muda por consulta ao provedor.
 */
export const Route = createFileRoute("/api/public/webhooks/fiscal/$connectionId/$secret")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuid.test(params.connectionId)) return new Response("Unauthorized", { status: 401 });
        const raw = await request.text();
        const { adminDb } = await import("@/lib/fiscal/service.server");
        const { handleFocusWebhook } = await import("@/lib/fiscal/webhook");
        const { processWebhookEventById } = await import("@/lib/fiscal/service.server");
        const db = await adminDb();
        try {
          const r = await handleFocusWebhook(
            {
              async loadConnection(id) {
                const { data } = await db.from("fiscal_provider_connections").select("webhook_secret_hash, status").eq("id", id).maybeSingle();
                return data ? { webhookSecretHash: (data.webhook_secret_hash as string | null) ?? null, active: data.status === "active" || data.status === "pending" } : null;
              },
              async ingest(id, key, hash, body, ref) {
                const { data, error } = await db.rpc("fiscal_webhook_ingest", { p_connection: id, p_dedupe_key: key, p_body_hash: hash, p_body: body, p_ref: ref });
                if (error) throw new Error(error.message);
                const r = data as { new: boolean; id?: string };
                return { new: r.new, id: r.id };
              },
              async findPending(id, key) {
                const { data } = await db.from("fiscal_webhook_events").select("id").eq("connection_id", id).eq("dedupe_key", key).eq("status", "pending").maybeSingle();
                return (data?.id as string | undefined) ?? null;
              },
              // Processamento imediato (sem cron): consulta a Focus, guarda XML/PDF e marca o evento.
              async process(eventId) { await processWebhookEventById(db, eventId); },
            },
            { connectionId: params.connectionId, secret: params.secret, rawBody: raw },
          );
          return new Response(r.code, { status: r.status });
        } catch (err) {
          console.error("[fiscal-webhook]", err);
          return new Response("Retry", { status: 500 });
        }
      },
    },
  },
});
