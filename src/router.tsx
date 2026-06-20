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
