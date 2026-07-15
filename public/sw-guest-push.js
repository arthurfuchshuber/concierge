// Service Worker dedicado a Web Push do HÓSPEDE (guia público).
// Recebe respostas do anfitrião/atendente e mostra notificação + som + badge.

self.addEventListener("install", () => {
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
    payload = { title: "Nova mensagem", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Nova mensagem do anfitrião";
  const body = payload.body || "Você recebeu uma resposta.";
  const url = (payload.data && payload.data.url) || "/";
  const tag = (payload.data && payload.data.tag) || "guest-reply";
  const conversationId = payload.data && payload.data.conversationId;

  const options = {
    body,
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag,
    renotify: true,
    requireInteraction: false,
    vibrate: [180, 90, 180],
    data: { url, conversationId, ts: Date.now() },
  };

  event.waitUntil(
    (async () => {
      try {
        const all = await self.clients.matchAll({ includeUncontrolled: true });
        all.forEach((c) =>
          c.postMessage({ type: "guest-push", conversationId, url, payload }),
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
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            await client.focus();
            client.postMessage({ type: "guest-focus", url });
            return;
          }
        } catch {}
      }
      await self.clients.openWindow(url);
    })(),
  );
});
