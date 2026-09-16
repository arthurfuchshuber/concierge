/**
 * A INSCRIÇÃO DE PUSH DO HÓSPEDE — um lugar só (11/09/2026).
 *
 * O passo a passo (buscar a chave VAPID, registrar o service worker, pedir a
 * permissão, assinar, mandar ao servidor) vivia dentro de
 * `GuestNotificationsPrompt`. Com o pedido de 11/09 — oferecer as notificações
 * no fim do formulário de primeiro acesso, e não só depois da primeira
 * mensagem no chat — ele precisaria existir em dois componentes. Duas cópias
 * de um fluxo de cinco etapas não ficam iguais por muito tempo; é o mesmo tipo
 * de divergência que deixou o WhatsApp cego para áudio por semanas.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ, e é importante: forçar. Permissão de navegador
 * não se força, se pede — uma vez. Um "Bloquear" é definitivo até a pessoa ir
 * nas configurações do site. Por isso quem chama daqui deve ter perguntado
 * antes, com a própria interface ("pergunta macia"), e só chamar quando a
 * resposta for sim.
 */

/** O identificador da sessão do hóspede neste guia. Igual ao do chat. */
export function isPreviewMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("preview") === "1";
  } catch {
    return false;
  }
}

export function guestSessionId(slug: string): string {
  const preview = isPreviewMode();
  const key = preview ? `guide-chat-session:preview:${slug}` : `guide-chat-session:${slug}`;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const id = `${preview ? "preview-" : ""}${crypto.randomUUID()}`;
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    return `${preview ? "preview-" : ""}${Math.random().toString(36).slice(2)}`;
  }
}

export const GUEST_PUSH_DISMISS_KEY = (slug: string) => `guest-push-dismissed:${slug}`;
export const GUEST_PUSH_ENDPOINT_KEY = (slug: string) => `guest-push-endpoint:${slug}`;

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

/** O navegador tem as peças necessárias para push? */
export function guestPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * O que faz sentido mostrar a este hóspede, neste aparelho, agora.
 *
 *  · `ask`        — dá para pedir: mostre a pergunta macia;
 *  · `ios-install`— iPhone fora da Tela de Início. A Apple não oferece push no
 *                   Safari comum; o caminho é instalar, e isso é um gesto que
 *                   só o hóspede pode fazer. 71% dos hóspedes deste sistema
 *                   caem aqui (medido em `guide_access_logs`);
 *  · `enabled`    — já inscrito neste aparelho;
 *  · `denied`     — o navegador bloqueou este site. Insistir não reabre;
 *  · `unsupported`— não há push neste navegador. Não mostre nada.
 */
export type GuestPushState = "ask" | "ios-install" | "enabled" | "denied" | "unsupported";

export function guestPushState(slug: string): GuestPushState {
  if (typeof window === "undefined") return "unsupported";
  try {
    if (window.localStorage.getItem(GUEST_PUSH_ENDPOINT_KEY(slug))) return "enabled";
  } catch {
    /* localStorage bloqueado: segue o fluxo normal */
  }
  if (isIOS() && !isStandalone()) return "ios-install";
  if (!guestPushSupported()) return "unsupported";
  if (Notification.permission === "granted") return "ask"; // reassinar é barato
  if (Notification.permission === "denied") return "denied";
  return "ask";
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export type GuestPushResult =
  { ok: true } | { ok: false; reason: "unsupported" | "denied" | "dismissed" | "error" };

/**
 * Pede a permissão e registra a inscrição.
 *
 * Chame SEMPRE a partir de um toque do hóspede: navegadores descartam o pedido
 * de permissão quando ele não nasce de um gesto.
 */
export async function enableGuestPush(params: {
  slug: string;
  sessionId: string;
  conversationId?: string | null;
}): Promise<GuestPushResult> {
  if (!guestPushSupported()) return { ok: false, reason: "unsupported" };

  try {
    // 1. A chave pública do servidor. Vem primeiro porque, sem ela, não
    //    adianta gastar o pedido de permissão do hóspede.
    const keyRes = await fetch("/api/public/guest-push", { method: "GET" });
    const keyJson = (await keyRes.json().catch(() => ({}))) as { publicKey?: string };
    if (!keyJson.publicKey) return { ok: false, reason: "error" };

    // 2. Permissão. Três respostas, e "fechou sem responder" não é "negou" —
    //    a diferença decide a mensagem que o hóspede lê depois.
    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm === "denied") return { ok: false, reason: "denied" };
      if (perm !== "granted") return { ok: false, reason: "dismissed" };
    }

    // 3. Service worker. Espera o registro do cache terminar antes: no
    //    primeiro acesso esta tela aparece segundos depois do boot, e as duas
    //    chamadas cruzadas deixariam o escopo com o script sem tratador de
    //    push — inscrição viva e nenhuma notificação chegando.
    const { aguardarRegistroDeCache } = await import("@/lib/offline/sw-register");
    await aguardarRegistroDeCache();
    const reg = await navigator.serviceWorker.register("/sw-guest-push.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    // 4. Assinatura.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyJson.publicKey).buffer as ArrayBuffer,
      });
    }
    const json = sub.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, reason: "error" };
    }

    // 5. Registro no servidor. `conversationId` costuma ser nulo aqui — no fim
    //    do formulário o hóspede ainda não falou com ninguém — e isso está
    //    certo: a rota amarra a inscrição à conversa quando ela nascer, e o
    //    envio também procura por sessão + imóvel (ver `guest-push.server.ts`).
    const res = await fetch("/api/public/guest-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "subscribe",
        slug: params.slug,
        sessionId: params.sessionId,
        conversationId: params.conversationId ?? null,
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent.slice(0, 500),
      }),
    });
    if (!res.ok) return { ok: false, reason: "error" };

    try {
      window.localStorage.setItem(GUEST_PUSH_ENDPOINT_KEY(params.slug), json.endpoint);
    } catch {
      /* sem localStorage a inscrição continua valendo no servidor */
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}
