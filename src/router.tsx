import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

function isTemporaryError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /timeout|timed out|upstream|reconectando|demorou demais|failed to fetch|network/i.test(msg);
}

function isUnauthorizedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /unauthorized|invalid token|no authorization header|jwt/i.test(msg);
}

let checkingSession = false;

/**
 * "Invalid token" também aparece quando o serviço de login está lento e não
 * consegue validar um token que é válido. Antes de deslogar, tenta renovar a
 * sessão; só manda para /auth se a sessão realmente não existe mais.
 */
async function handleUnauthorized() {
  if (typeof window === "undefined" || checkingSession) return;
  checkingSession = true;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      // Falha de rede/lentidão ao renovar: mantém a sessão e deixa o retry agir.
      if (refreshed.session || (error && !/invalid|expired|not found|revoked/i.test(error.message))) {
        return;
      }
    }
    await supabase.auth.signOut().catch(() => {});
    if (!window.location.pathname.startsWith("/auth")) {
      window.location.replace("/auth");
    }
  } catch {
    /* erro transitório: não desloga */
  } finally {
    checkingSession = false;
  }
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Dados do painel raramente mudam em segundos. Evita refetch
        // desnecessário ao refocar a janela — reduz carga no servidor.
        staleTime: 30_000,       // 30s: considera fresh antes de refetch
        gcTime: 1000 * 60 * 60 * 24 * 7, // 7 dias — necessário p/ cache persistente sobreviver ao reload
        refetchOnWindowFocus: false, // não refetch ao voltar para a aba
        // Erros de autenticação podem ser lentidão momentânea do login:
        // tenta mais vezes, com espera crescente.
        retry: (count, err) => (isUnauthorizedError(err) ? count < 3 : count < 1),
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
    },
    queryCache: new QueryCache({
      onError: (err) => {
        if (isUnauthorizedError(err)) void handleUnauthorized();
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
