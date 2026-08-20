import { useEffect, useState } from "react";
import { BellRing, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { enablePush, isPushSupported, currentPushSubscription } from "@/lib/push-client";

const DISMISS_KEY = "push-banner-dismissed";

export function PushNotificationBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;
      try {
        if (localStorage.getItem(DISMISS_KEY) === "1") return;
      } catch { /* ignore */ }
      if (!isPushSupported()) return;
      if (typeof Notification !== "undefined" && Notification.permission === "denied") return;
      const sub = await currentPushSubscription().catch(() => null);
      if (sub) return;
      setVisible(true);
    })();
  }, []);

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setVisible(false);
  }

  async function handleEnable() {
    setBusy(true);
    try {
      // iOS Chrome/Safari fora do modo standalone não suporta push
      const nav = window.navigator as Navigator & { standalone?: boolean };
      const standalone = nav.standalone || window.matchMedia?.("(display-mode: standalone)").matches;
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isIOS && !standalone) {
        toast.info("No iPhone, adicione o app à Tela de Início para receber notificações.");
        return;
      }
      const res = await enablePush();
      if (res.ok) {
        toast.success("Notificações ativadas!");
        dismiss();
      } else if (res.reason === "denied") {
        toast.error("Permissão negada pelo navegador.");
      } else if (res.reason === "unsupported") {
        toast.error("Navegador não suporta notificações push.");
      } else {
        toast.error("Não foi possível ativar as notificações.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao ativar notificações");
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="mx-3 mt-3 sm:mx-4 sm:mt-4">
      <div className="ds-surface relative border border-accent/25 bg-accent/[0.07] p-4 flex items-start gap-3">
        <span className="shrink-0 size-10 rounded-lg bg-gradient-to-br from-brand-purple to-brand-magenta grid place-items-center text-white shadow-sm">
          <BellRing className="size-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1 pr-6">
          <p className="ds-card-title">Ative as notificações</p>
          <p className="ds-body text-muted-foreground mt-0.5">
            Saiba na hora quando um hóspede precisar de ajuda humana.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleEnable}
              disabled={busy}
              className="h-9 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-brand-purple to-brand-magenta text-white px-4 text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Ativar
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="h-9 inline-flex items-center rounded-full border border-border bg-secondary/40 px-4 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
            >
              Agora não
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="absolute top-3 right-3 size-6 grid place-items-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
