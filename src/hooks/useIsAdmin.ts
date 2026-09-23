import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkIsAdmin } from "@/lib/admin-subs.functions";
import { useHasSession } from "@/hooks/useHasSession";

export function useIsAdmin() {
  const fetcher = useServerFn(checkIsAdmin);
  // Sem sessão (saindo da conta, token expirado) a chamada iria sem cabeçalho
  // de autorização e derrubava a tela. Só consulta quando há token.
  const hasSession = useHasSession();
  const q = useQuery({
    queryKey: ["is-admin"],
    queryFn: () => fetcher(),
    staleTime: 60_000,
    enabled: hasSession === true,
    retry: false,
  });
  return { isAdmin: !!q.data?.isAdmin, isLoading: hasSession === null || (hasSession && q.isLoading) };
}

