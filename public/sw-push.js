// O cache offline mora em `sw-cache.js` e é carregado aqui de propósito:
// só existe UM service worker por escopo, e este arquivo pode ser o que
// vence a disputa. Assim, tenha o aparelho ativado push ou não, o cache
// existe. Nada abaixo desta linha mudou. (11/09/2026)
importScripts("/sw-cache.js");

// Service Worker dedicado a Web Push (isolado do PWA app-shell).
// Recebe eventos push do backend e mostra notificação + envia mensagem
// para clientes abertos tocarem som/atualizarem badge.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "ConciergeIA", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Hóspede precisa de você";
  const body = payload.body || "Um hóspede solicitou atendimento humano.";
  const url = (payload.data && payload.data.url) || "/atendimento";
  const tag = (payload.data && payload.data.tag) || "handoff";
  const conversationId = payload.data && payload.data.conversationId;

  const critical = !!(payload.data && (payload.data.critical || payload.data.urgency === "high"));
  const style = (payload.data && payload.data.style) || null;

  // Estilos dedicados às notificações de limpeza — visual distinto das
  // notificações operacionais (esteira de check-in/check-out).
  const CLEANING_STYLES = {
    "cleaning-ready": {
      vibrate: [80, 60, 80, 60, 240],
      requireInteraction: true,
      silent: false,
      actions: [{ action: "open", title: "Abrir operação" }],
      dir: "ltr",
    },
    "cleaning-done": {
      vibrate: [40, 40, 40],
      requireInteraction: false,
      silent: false,
      actions: [{ action: "open", title: "Abrir operação" }],
      dir: "ltr",
    },
  };
  const cleaning = style ? CLEANING_STYLES[style] : null;

  const options = {
    body,
    icon: "/favicon.png",
    // Ícone pequeno do Android: o sistema usa só o CONTORNO (canal alfa) e pinta numa cor;
    // por isso é a silhueta branca do "A" em fundo transparente (o favicon é opaco e virava um borrão).
    badge: "/notification-badge.png",
    image: undefined,
    tag,
    renotify: true,
    requireInteraction: cleaning ? cleaning.requireInteraction : true,
    vibrate: cleaning ? cleaning.vibrate : critical ? [300, 100, 300, 100, 300] : [200, 100, 200],
    actions: cleaning ? cleaning.actions : undefined,
    data: { url, conversationId, critical, style, ts: Date.now() },
  };

  event.waitUntil(
    (async () => {
      // Atualiza badge do ícone quando suportado
      try {
        const all = await self.clients.matchAll({ includeUncontrolled: true });
        // notifica clientes abertos para tocar som e atualizar UI
        all.forEach((c) =>
          c.postMessage({
            type: "handoff-push",
            conversationId,
            url,
            payload,
          }),
        );
      } catch {}
      try {
        if (self.registration.showNotification) {
          await self.registration.showNotification(title, options);
        }
      } catch {}
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/atendimento";
  let conversationId = event.notification.data && event.notification.data.conversationId;
  if (!conversationId) {
    try { conversationId = new URL(url, self.location.origin).searchParams.get("conversation") || undefined; } catch {}
  }
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // App já aberto: traz para frente e manda o app abrir o destino do
      // push (conversa → chat; operação → janela certa do Dashboard). Antes
      // só focava e a pessoa ficava na tela em que estava.
      for (const client of all) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            await client.focus();
            client.postMessage({ type: "handoff-focus", url, conversationId });
            return;
          }
        } catch {}
      }
      await self.clients.openWindow(url);
    })(),
  );
});
