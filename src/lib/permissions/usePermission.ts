import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccessDecisions } from "@/lib/permissions/permission.access.functions";
import { useAccessEnv } from "@/lib/permissions/useAccessEnv";
import {
  accessQueryKey,
  toAccessState,
  type AccessLevelInput,
  type AccessScope,
  type AccessState,
} from "@/lib/permissions/permissionClient";

export type UsePermissionOptions = AccessScope & {
  required?: AccessLevelInput;
  /** Desliga a consulta (o estado permanece seguro: negado). */
  enabled?: boolean;
  /**
   * Compatibilidade: regra legada já existente na tela (ex.: `isAdmin`).
   * Enquanto a conta não estiver em modo bloqueante, mantém o comportamento
   * atual sem duplicar regra de permissão no frontend.
   */
  legacyAllowed?: boolean;
};

/**
 * `usePermission` — decisão do backend para UMA permissão.
 * Retorna `{ allowed, loading, reason }` (o escopo também vem junto).
 */
export function usePermission(
  permission: string,
  options: UsePermissionOptions = {},
): AccessState {
  const { required = "READ", enabled = true, legacyAllowed, ...scope } = options;
  const fetcher = useServerFn(getMyAccessDecisions);
  const { sessionReady, accountOwnerId } = useAccessEnv();

  const query = useQuery({
    queryKey: [...accessQueryKey([permission], required, scope), accountOwnerId ?? "self"],
    // A falha SOBE (não vira "decisão vazia" guardada em cache): `toAccessState`
    // já trata erro como "sem acesso" no momento, e a próxima tentativa corrige.
    queryFn: () =>
      fetcher({
        data: {
          permissions: [permission],
          required,
          accountOwnerId,
          propertyId: scope.propertyId ?? null,
          clientId: scope.clientId ?? null,
          recordId: scope.recordId ?? null,
        },
      }),
    enabled: enabled && !!permission && sessionReady,
    staleTime: 60_000,
    retry: 3,
    retryDelay: (n) => Math.min(500 * 2 ** n, 4000),
    // Falha persistente: continua tentando sozinho até a conexão voltar.
    refetchInterval: (q) => (q.state.status === "error" ? 5_000 : false),
  });

  // FALHA NÃO É NEGAÇÃO: erro de rede/sessão (ex.: renovação do token na
  // virada da hora) mantém a última decisão conhecida; sem decisão ainda,
  // fica "carregando" — nunca vira "sem permissão" (travava o editor em
  // "apenas visualizar").
  const hasDecision = !!query.data?.decisions?.[permission];
  const state = toAccessState(
    query.data?.decisions?.[permission],
    enabled && (query.isLoading || (!sessionReady && !query.data) || (query.isError && !hasDecision)),
    false,
  );

  if (!enabled) return { ...state, loading: false };
  if (legacyAllowed && !state.loading && !state.allowed) {
    return { ...state, allowed: true, reason: "Acesso mantido pela regra atual da conta." };
  }
  return state;
}
