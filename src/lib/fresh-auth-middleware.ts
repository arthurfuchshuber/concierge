import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

/**
 * Anexa o token às server functions RENOVANDO ANTES quando falta pouco para
 * vencer (o token dura 1 h). Sem isso, na virada da hora chamadas saíam com
 * token vencido, o servidor recusava e o editor travava em "só visualizar"
 * ou a página caía em "Algo deu errado". Várias chamadas simultâneas
 * aguardam UMA única renovação.
 */
const MARGIN_S = 120;
let refreshing: Promise<string | null> | null = null;

function refreshOnce(): Promise<string | null> {
  if (!refreshing) {
    refreshing = supabase.auth
      .refreshSession()
      .then(({ data }) => data.session?.access_token ?? null)
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function getFreshAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - now < MARGIN_S) {
    const renewed = await refreshOnce();
    // Falha de rede ao renovar: usa o atual se ainda não venceu.
    if (renewed) return renewed;
    return session.expires_at > now ? session.access_token : null;
  }
  return session.access_token;
}

export const attachFreshSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token = typeof window === "undefined" ? null : await getFreshAccessToken();
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
