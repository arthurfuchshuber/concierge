import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccessDecisions } from "@/lib/permissions/permission.access.functions";
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

  const query = useQuery({
    queryKey: accessQueryKey([permission], required, scope),
    queryFn: () =>
      fetcher({
        data: {
          permissions: [permission],
          required,
          propertyId: scope.propertyId ?? null,
          clientId: scope.clientId ?? null,
          recordId: scope.recordId ?? null,
        },
      }),
    enabled: enabled && !!permission,
    staleTime: 60_000,
    retry: false,
  });

  const state = toAccessState(
    query.data?.decisions?.[permission],
    enabled && query.isLoading,
    query.isError,
  );

  if (!enabled) return { ...state, loading: false };
  if (legacyAllowed && !state.loading && !state.allowed) {
    return { ...state, allowed: true, reason: "Acesso mantido pela regra atual da conta." };
  }
  return state;
}
