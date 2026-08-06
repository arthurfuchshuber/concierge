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

  const options = {
    body,
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag,
    renotify: true,
    requireInteraction: true,
    vibrate: critical ? [300, 100, 300, 100, 300] : [200, 100, 200],
    data: { url, conversationId, critical, ts: Date.now() },
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
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            await client.focus();
            client.postMessage({ type: "handoff-focus", url });
            return;
          }
        } catch {}
      }
      await self.clients.openWindow(url);
    })(),
  );
});
