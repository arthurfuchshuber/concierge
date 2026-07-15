// Helpers do lado do navegador para registrar o service worker de push,
// pedir permissão e assinar/desassinar. Uso: chamar `enablePush()` a partir
// de um botão em Configurações → Notificações.

import { getVapidPublicKey, subscribePush, unsubscribePush } from "./push.functions";

const SW_URL = "/sw-push.js";
const SW_SCOPE = "/";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!isPushSupported()) throw new Error("Push não suportado neste navegador");
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function enablePush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const reg = await registerPushServiceWorker();

  const { publicKey } = await getVapidPublicKey();
  const applicationServerKey = urlBase64ToUint8Array(publicKey);

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: "invalid_subscription" };
  }

  await subscribePush({
    data: {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent,
    },
  });

  return { ok: true };
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {}
  try {
    await unsubscribePush({ data: { endpoint } });
  } catch {}
}

/**
 * Escuta mensagens do SW de push (som, badge, foco de conversa).
 * Retorna função de cleanup.
 */
export function listenToPushMessages(
  handler: (msg: { type: string; conversationId?: string; url?: string; payload?: any }) => void,
): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  const listener = (event: MessageEvent) => {
    if (!event.data || typeof event.data !== "object") return;
    handler(event.data);
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
