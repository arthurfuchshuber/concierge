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
    <div className="w-full bg-accent/10 border-b border-accent/30 px-3 py-1.5 flex items-center justify-center gap-2 text-[12.5px]">
      <BellRing className="size-3.5 text-accent shrink-0" />
      <span className="text-foreground/80 truncate">Ative as notificações para não perder mensagens</span>
      <button
        type="button"
        onClick={handleEnable}
        disabled={busy}
        className="shrink-0 inline-flex items-center gap-1 rounded-full bg-accent text-accent-foreground px-2.5 py-0.5 text-[11.5px] font-semibold hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : null}
        Habilitar
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 size-6 grid place-items-center rounded-full text-muted-foreground hover:text-foreground"
        aria-label="Fechar"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
