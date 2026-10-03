import { useHasSession } from "@/hooks/useHasSession";
import { useImpersonation } from "@/hooks/useImpersonation";

/**
 * O QUE UMA CONSULTA DE PERMISSÃO PRECISA SABER ANTES DE SAIR.
 *
 * 1. `sessionReady` — só consulta com o token já no navegador. Antes, a
 *    consulta saía no primeiro render (ao abrir o painel ou ao voltar de um
 *    refresh) SEM cabeçalho de autorização; o servidor respondia 401, a falha
 *    era engolida e a pessoa via "Você não tem acesso a esta área" por 30 s.
 * 2. `accountOwnerId` — a empresa ativa. Faz parte da chave de cache e do
 *    pedido: a decisão é por empresa.
 */
export function useAccessEnv() {
  const hasSession = useHasSession();
  const { impersonation } = useImpersonation();
  return {
    sessionReady: hasSession === true,
    accountOwnerId: impersonation?.userId ?? null,
  };
}
