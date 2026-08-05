import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyAccounts } from "@/lib/active-account.functions";
import { useImpersonation, setImpersonation } from "@/hooks/useImpersonation";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/**
 * Garante que um membro de equipe sempre abra o painel já dentro da empresa
 * à qual ele pertence — sem passar por um estado intermediário "sem conta"
 * (que mostrava "Sem plano · 0" e listas vazias).
 *
 * `resolving` fica true enquanto a empresa ativa ainda não foi definida, para
 * que a tela espere em vez de renderizar dados da conta errada.
 */
export function useActiveAccount() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const listFn = useServerFn(listMyAccounts);
  const q = useQuery({
    queryKey: ["my-accounts"],
    queryFn: () => listFn(),
    staleTime: 5 * 60_000,
    enabled: !adminLoading,
  });
  const { impersonation } = useImpersonation();

  const accounts = useMemo(() => q.data?.accounts ?? [], [q.data]);
  const hasOwn = q.data?.hasOwnProperties ?? true;
  /**
   * Auto-seleção da conta ativa no primeiro acesso.
   *  - Membro de equipe (sem imóveis próprios): abre direto na conta.
   *  - Admin do SaaS que também é membro de contas de cliente: abre na
   *    primeira conta pela ordem STATUS + ALFABÉTICA (definida no backend).
   */
  const needsAccount =
    !impersonation && !!q.data && accounts.length >= 1 && (isAdmin || !hasOwn);

  /**
   * Admin do SaaS sem vínculo com nenhuma conta de cliente: o menu da conta
   * fica OCULTO até que ele escolha um cliente no seletor.
   */
  const awaitingAccountChoice =
    isAdmin && !impersonation && !!q.data && accounts.length === 0;

  useEffect(() => {
    if (!needsAccount) return;
    const a = accounts[0];
    setImpersonation({
      userId: a.ownerId,
      name: a.name || a.email || "Conta",
      email: a.email,
    });
  }, [needsAccount, accounts]);

  const resolving =
    !impersonation && (adminLoading || (q.isLoading && !q.data) || needsAccount);

  return { accounts, hasOwn, impersonation, isAdmin, resolving, awaitingAccountChoice, query: q };
}
