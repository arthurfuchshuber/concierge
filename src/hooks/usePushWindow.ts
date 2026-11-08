// Lê `?janela=` (destino do clique no push) e devolve qual janela do
// Dashboard abrir. Cada leitura gera um `nonce` novo — clicar duas vezes no
// mesmo push reabre a janela. O parâmetro é removido da URL logo depois, para
// que recarregar a página não reabra a janela sozinha.

import { useEffect, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { isPushWindow, type PushWindow } from "@/lib/push-format";

export function usePushWindow(): { win: PushWindow; nonce: number } | null {
  const router = useRouter();
  const href = useRouterState({ select: (s) => s.location.href });
  const [state, setState] = useState<{ win: PushWindow; nonce: number } | null>(null);

  useEffect(() => {
    let url: URL;
    try {
      url = new URL(href, "https://x.invalid");
    } catch {
      return;
    }
    const value = url.searchParams.get("janela");
    if (!isPushWindow(value)) return;
    setState({ win: value, nonce: Date.now() });
    url.searchParams.delete("janela");
    const rest = url.searchParams.toString();
    router.history.replace(`${url.pathname}${rest ? `?${rest}` : ""}${url.hash}`);
  }, [href, router]);

  return state;
}
