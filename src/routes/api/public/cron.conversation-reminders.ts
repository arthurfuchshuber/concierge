import { createFileRoute } from "@tanstack/react-router";

/**
 * Cron: lembra o atendente responsável, a cada ~1h, que uma conversa
 * assumida por ele continua em aberto (sem resolução). Deve rodar com
 * frequência menor que 1h (ex.: a cada 15-20min) — a própria função decide
 * quem já recebeu lembrete recentemente via `last_reminder_at`, então rodar
 * o cron mais vezes não gera push duplicado. Protegido por `x-cron-secret`.
 */
export const Route = createFileRoute("/api/public/cron/conversation-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = process.env["CRON_SECRET"];
        if (!cronSecret || request.headers.get("x-cron-secret") !== cronSecret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendOpenConversationReminders } = await import("@/lib/handoff.server");
        try {
          const result = await sendOpenConversationReminders(supabaseAdmin);
          return Response.json({ ok: true, ...result });
        } catch (err) {
          console.error("[cron:conversation-reminders]", err);
          return Response.json({ ok: false, error: "scan failed" }, { status: 500 });
        }
      },
    },
  },
});
