import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { completeGoogleCalendarConnection } from "@/lib/google-calendar.functions";

export const Route = createFileRoute("/oauth/google-calendar/return")({
  component: OAuthReturn,
  head: () => ({
    meta: [
      { title: "Conectando Google Agenda | SigmaConcierge" },
      { name: "description", content: "Finalizando a conexão da sua conta Google Agenda com o SigmaConcierge." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function OAuthReturn() {
  const [message, setMessage] = useState("Finalizando conexão…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const notify = (type: "appUserConnectorOAuthComplete" | "appUserConnectorOAuthFailed") => {
      window.opener?.postMessage({ type, connectorId: "google_calendar" }, window.location.origin);
      window.close();
    };

    if (params.get("success") !== "true") {
      setMessage(params.get("error") ?? "A autorização não foi concluída.");
      notify("appUserConnectorOAuthFailed");
      return;
    }
    const code = params.get("code");
    if (!code) {
      if (params.get("offline_access_allowed") === "false") {
        notify("appUserConnectorOAuthComplete");
        return;
      }
      setMessage("A autorização terminou sem código de troca.");
      notify("appUserConnectorOAuthFailed");
      return;
    }
    void completeGoogleCalendarConnection({ data: { code } })
      .then(() => notify("appUserConnectorOAuthComplete"))
      .catch(() => {
        setMessage("Não foi possível concluir a conexão.");
        notify("appUserConnectorOAuthFailed");
      });
  }, []);

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
