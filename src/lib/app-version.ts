import { useEffect } from "react";

/** Versão da build carregada por este navegador (injetada no build). */
export const CLIENT_BUILD_ID: string =
  typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "dev";

const CHECK_INTERVAL_MS = 60_000;
const RELOAD_FLAG = "sg-app-reloaded-for";

async function fetchServerBuildId(): Promise<string | null> {
  try {
    const res = await fetch("/api/public/version", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: string };
    return typeof data.buildId === "string" ? data.buildId : null;
  } catch {
    return null;
  }
}

/**
 * Mantém todos os usuários logados sempre na última versão publicada:
 * ao detectar uma build diferente da que está aberta, recarrega a página.
 */
export function useAppVersionWatcher() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const check = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      const serverId = await fetchServerBuildId();
      if (cancelled || !serverId || serverId === CLIENT_BUILD_ID) return;
      // Evita laço de recarga caso algo dê errado com a nova versão.
      try {
        if (window.sessionStorage.getItem(RELOAD_FLAG) === serverId) return;
        window.sessionStorage.setItem(RELOAD_FLAG, serverId);
      } catch { /* noop */ }
      window.location.reload();
    };

    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    const onFocus = () => { void check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onFocus);
    void check();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, []);
}
