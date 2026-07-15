import { useEffect, useState } from "react";
import { BellRing, X, Smartphone } from "lucide-react";

type Props = {
  slug: string;
  sessionId: string;
  conversationId: string | undefined;
  /** Só aparece depois que o hóspede enviou pelo menos uma mensagem */
  visible: boolean;
};

const DISMISS_KEY = (slug: string) => `guest-push-dismissed:${slug}`;
const SUBSCRIBED_KEY = (slug: string) => `guest-push-endpoint:${slug}`;

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  // iOS Safari standalone
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
  return out;
}

export function GuestNotificationsPrompt({ slug, sessionId, conversationId, visible }: Props) {
  const [state, setState] = useState<"hidden" | "ask" | "ios-install" | "enabling" | "enabled" | "denied">("hidden");

  useEffect(() => {
    if (!visible) return;
    if (typeof window === "undefined") return;
    // Já dispensou?
    try {
      if (window.localStorage.getItem(DISMISS_KEY(slug)) === "1") return;
      if (window.localStorage.getItem(SUBSCRIBED_KEY(slug))) {
        setState("enabled");
        return;
      }
    } catch {
      // ignore
    }
    // iOS sem PWA: mostrar instrução de instalação
    if (isIOS() && !isStandalone()) {
      setState("ios-install");
      return;
    }
    // Sem suporte a push
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }
    // Já concedeu — tentar subscrever silenciosamente
    if (Notification.permission === "granted") {
      void enable(true);
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    setState("ask");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, slug]);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY(slug), "1");
    } catch {
      // ignore
    }
    setState("hidden");
  }

  async function enable(silent = false) {
    setState("enabling");
    try {
      // 1. Pega VAPID key pública
      const keyRes = await fetch("/api/public/guest-push", { method: "GET" });
      const keyJson = (await keyRes.json().catch(() => ({}))) as { publicKey?: string };
      if (!keyJson.publicKey) throw new Error("VAPID indisponível");

      // 2. Registra o service worker
      const reg = await navigator.serviceWorker.register("/sw-guest-push.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      // 3. Pede permissão
      if (Notification.permission !== "granted") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setState(perm === "denied" ? "denied" : "ask");
          return;
        }
      }

      // 4. Assina o push
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyJson.publicKey).buffer as ArrayBuffer,
        });
      }
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("Assinatura incompleta");

      // 5. Envia ao backend
      const res = await fetch("/api/public/guest-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          slug,
          sessionId,
          conversationId: conversationId ?? null,
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          userAgent: navigator.userAgent.slice(0, 500),
        }),
      });
      if (!res.ok) throw new Error("Falha ao registrar no servidor");

      try {
        window.localStorage.setItem(SUBSCRIBED_KEY(slug), json.endpoint);
      } catch {
        // ignore
      }
      setState("enabled");
      if (silent) {
        // Não mostra confirmação se foi silencioso
        setTimeout(() => setState("hidden"), 100);
      } else {
        setTimeout(() => setState("hidden"), 3000);
      }
    } catch {
      setState("ask");
    }
  }

  if (state === "hidden") return null;

  return (
    <div className="mx-3 my-2 rounded-2xl border border-accent/30 bg-accent/5 p-3">
      <div className="flex items-start gap-2.5">
        <div className="size-8 shrink-0 rounded-full bg-accent/15 text-accent grid place-items-center">
          {state === "ios-install" ? <Smartphone className="size-4" /> : <BellRing className="size-4" />}
        </div>
        <div className="flex-1 min-w-0">
          {state === "ask" && (
            <>
              <p className="text-[12.5px] font-semibold leading-tight">Não perca a resposta do anfitrião</p>
              <p className="text-[11.5px] text-muted-foreground mt-1 leading-relaxed">
                Ative as notificações para receber um aviso assim que ele responder.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => enable(false)}
                  className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-opacity"
                >
                  Ativar notificações
                </button>
                <button
                  onClick={dismiss}
                  className="text-[11.5px] font-medium px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                >
                  Agora não
                </button>
              </div>
            </>
          )}

          {state === "enabling" && (
            <p className="text-[12px] text-muted-foreground">Ativando notificações…</p>
          )}

          {state === "enabled" && (
            <p className="text-[12px] font-medium text-emerald-700">
              Notificações ativadas! Você será avisado quando o anfitrião responder.
            </p>
          )}

          {state === "denied" && (
            <>
              <p className="text-[12.5px] font-semibold leading-tight">Notificações bloqueadas</p>
              <p className="text-[11.5px] text-muted-foreground mt-1 leading-relaxed">
                Para receber as respostas, permita as notificações nas configurações do navegador para este site.
              </p>
            </>
          )}

          {state === "ios-install" && (
            <>
              <p className="text-[12.5px] font-semibold leading-tight">Ative os avisos no iPhone</p>
              <p className="text-[11.5px] text-muted-foreground mt-1 leading-relaxed">
                No iOS, adicione este guia à Tela de Início:
              </p>
              <ol className="text-[11.5px] text-muted-foreground mt-1.5 space-y-0.5 list-decimal ml-4">
                <li>Toque no ícone de compartilhar do Safari.</li>
                <li>Escolha <strong>Adicionar à Tela de Início</strong>.</li>
                <li>Abra o guia pelo ícone e ative as notificações.</li>
              </ol>
            </>
          )}
        </div>
        <button
          onClick={dismiss}
          className="size-6 grid place-items-center rounded-full text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Fechar"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
