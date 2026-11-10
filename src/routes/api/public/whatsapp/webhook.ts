import { createFileRoute } from "@tanstack/react-router";

/**
 * Rota NEUTRA do WhatsApp, reservada para a Cloud API oficial da Meta (etapa futura). Desde 10/11/2026 o canal
 * está em STANDBY (a integração Sinch foi removida): responde 200 informativo, sem ler, gravar nem encaminhar nada.
 */
const standby = () =>
  Response.json(
    { ok: true, status: "standby", reason: "whatsapp_channel_standby_for_meta" },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      GET: async () => standby(),
      POST: async () => standby(),
    },
  },
});
