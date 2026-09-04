import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Indica se existe uma sessão ativa no navegador.
 * Serve para só disparar chamadas protegidas depois que o token existe —
 * sem isso, as chamadas saem sem cabeçalho de autorização e o servidor
 * responde com erro (500) durante o carregamento ou após expirar a sessão.
 *
 * null = ainda verificando.
 */
export function useHasSession(): boolean | null {
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setHasSession(!!data.session?.access_token);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setHasSession(!!session?.access_token);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return hasSession;
}
