import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

function isUnauthorizedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /unauthorized|invalid token|no authorization header|jwt/i.test(msg);
}

async function handleUnauthorized() {
  if (typeof window === "undefined") return;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signOut().catch(() => {});
  } finally {
    if (!window.location.pathname.startsWith("/auth")) {
      window.location.replace("/auth");
    }
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
        retry: 1,                // 1 retry em vez de 3 (padrão)
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
