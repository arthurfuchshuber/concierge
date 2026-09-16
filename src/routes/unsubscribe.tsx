import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/unsubscribe")({
  head: () => ({
    meta: [
      { title: "Cancelar e-mails — ConciergeIA" },
      {
        name: "description",
        content:
          "Cancele o recebimento de e-mails do ConciergeIA em poucos segundos, com confirmação segura.",
      },
      { property: "og:title", content: "Cancelar e-mails — ConciergeIA" },
      {
        property: "og:description",
        content: "Gerencie o recebimento de e-mails do ConciergeIA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: UnsubscribePage,
});

type State = "loading" | "valid" | "invalid" | "used" | "done" | "error";

function UnsubscribePage() {
  const [state, setState] = useState<State>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const token =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("token")
      : null;

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as {
          valid?: boolean;
          email?: string;
          used?: boolean;
        };
        if (body?.used) return setState("used");
        if (r.ok && body?.valid !== false) {
          setEmail(body?.email ?? null);
          return setState("valid");
        }
        setState("invalid");
      })
      .catch(() => setState("error"));
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await fetch("/email/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setState(r.ok ? "done" : "error");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh grid place-items-center px-4 bg-background">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-sm">
        <p className="text-[11px] tracking-[2px] text-primary font-semibold">CONCIERGEIA</p>
        <h1 className="font-display text-2xl mt-2 mb-3">Cancelar e-mails</h1>

        {state === "loading" && (
          <p className="text-sm text-muted-foreground">Validando seu link…</p>
        )}

        {state === "valid" && (
          <>
            <p className="text-sm text-muted-foreground">
              Confirme para parar de receber e-mails
              {email ? ` em ${email}` : ""}.
            </p>
            <button
              onClick={confirm}
              disabled={busy}
              className="mt-5 w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-60"
            >
              {busy ? "Processando…" : "Confirmar cancelamento"}
            </button>
          </>
        )}

        {state === "done" && (
          <p className="text-sm text-muted-foreground">
            Pronto. Você não receberá mais e-mails deste endereço.
          </p>
        )}

        {state === "used" && (
          <p className="text-sm text-muted-foreground">
            Este link já foi utilizado — o cancelamento já está ativo.
          </p>
        )}

        {state === "invalid" && (
          <p className="text-sm text-muted-foreground">
            Link inválido ou expirado. Abra o link mais recente que você recebeu por e-mail.
          </p>
        )}

        {state === "error" && (
          <p className="text-sm text-destructive">
            Não foi possível concluir agora. Tente novamente em alguns minutos.
          </p>
        )}
      </div>
    </main>
  );
}
