import { useEffect } from "react";

/** Versão da build carregada por este navegador (injetada no build). */
export const CLIENT_BUILD_ID: string =
  typeof __APP_BUILD_ID__ === "string" ? __APP_BUILD_ID__ : "dev";

const CHECK_INTERVAL_MS = 60_000;
const RELOAD_FLAG = "sg-app-reloaded-for";
/** Tentativas de recarga por versão antes da pausa temporária (evita laço se a build nova falhar). */
export const MAX_RELOAD_ATTEMPTS = 3;
const PAUSE_MS = 10 * 60_000;

/** Lê/atualiza o contador de recargas por `serverId`; `false` = pausado (já tentou o máximo há pouco). */
export function registerReloadAttempt(serverId: string, now = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_FLAG);
    let st: { id: string; n: number; at: number } | null = null;
    try {
      st = raw ? (JSON.parse(raw) as { id: string; n: number; at: number }) : null;
    } catch {
      st = null;
    }
    if (!st || st.id !== serverId) st = { id: serverId, n: 0, at: now };
    if (st.n >= MAX_RELOAD_ATTEMPTS) {
      if (now - st.at < PAUSE_MS) return false;
      st = { id: serverId, n: 0, at: now }; // pausa terminou: tenta de novo
    }
    window.sessionStorage.setItem(RELOAD_FLAG, JSON.stringify({ id: serverId, n: st.n + 1, at: now }));
  } catch {
    /* sem sessionStorage (modo privado/iOS): recarrega mesmo assim */
  }
  return true;
}

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
 * RECARGA QUE NÃO VOLTA VELHA (pedido explícito, 24/09/2026: "toda vez que
 * subirmos a atualização no Lovable, forçar o refresh do cache de TODOS OS
 * USUÁRIOS ATIVOS").
 *
 * A recarga sozinha já pedia a página nova, mas o cache offline
 * (`public/sw-cache.js`) guarda o HTML e os arquivos da build: se a rede
 * demorasse mais que o prazo dele, a pessoa recarregava e recebia a versão
 * ANTIGA do cache — e o trava-laço abaixo impedia uma segunda tentativa até o
 * próximo deploy. Agora, antes de recarregar: apaga o HTML e os arquivos de
 * build guardados (as fotos ficam — elas não mudam com versão) e pede ao
 * service worker que busque o próprio script de novo.
 */
export async function dropStaleAppShell(): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ tipo: "ci-limpar-cache" });
    }
  } catch {
    /* segue */
  }
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("ci-"))
          .map((n) => caches.delete(n)),
      );
    }
  } catch {
    /* segue para a recarga */
  }
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration("/");
      await reg?.update().catch(() => {});
    }
  } catch {
    /* segue para a recarga */
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
      // Até 3 tentativas por versão (depois, pausa temporária) — nunca trava para sempre.
      if (!registerReloadAttempt(serverId)) return;
      await dropStaleAppShell();
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
