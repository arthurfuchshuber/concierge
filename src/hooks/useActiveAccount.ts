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
    enabled: !isAdmin && !adminLoading,
  });
  const { impersonation } = useImpersonation();

  const accounts = useMemo(() => q.data?.accounts ?? [], [q.data]);
  const hasOwn = q.data?.hasOwnProperties ?? true;
  const needsAccount = !isAdmin && !impersonation && !!q.data && !hasOwn && accounts.length >= 1;

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
    !isAdmin && !impersonation && (adminLoading || (q.isLoading && !q.data) || needsAccount);

  return { accounts, hasOwn, impersonation, isAdmin, resolving, query: q };
}
