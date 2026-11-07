// Clique no push com o app JÁ ABERTO (07/11/2026: "cada push precisa ser
// clicável e ir para algum lugar"). O service worker foca a janela e manda
// `handoff-focus` com o destino do push. Push de conversa é tratado pelo
// FloatingHandoffDock (abre o chat); aqui navegamos para o destino dos
// demais — o Dashboard abre a janela certa a partir de `?janela=`.
//
// Com o app fechado o próprio service worker abre a URL, e o mesmo
// `?janela=` faz o trabalho (ver `usePushWindow`).

import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { listenToPushMessages } from "@/lib/push-client";

/** Só caminhos internos (nunca uma URL de outro site vinda do payload). */
export function internalPushPath(url: string | undefined | null): string | null {
  if (!url || typeof url !== "string") return null;
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  return url;
}

export function usePushNavigation() {
  const router = useRouter();
  useEffect(() => {
    return listenToPushMessages((msg) => {
      if (msg.type !== "handoff-focus") return;
      if (msg.conversationId) return; // conversa → FloatingHandoffDock
      const path = internalPushPath(msg.url);
      if (!path) return;
      router.history.push(path);
    });
  }, [router]);
}
