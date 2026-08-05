import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAccessDecisions } from "@/lib/permissions/permission.access.functions";
import type { AccessLevelInput } from "@/lib/permissions/permissionClient";

/**
 * `useAreaAccess` — decisões do backend para VÁRIAS áreas em uma única consulta.
 *
 * Regra: o frontend nunca decide permissão; aqui só transportamos a decisão
 * já tomada pelo Authorization Runtime. Enquanto carrega, `loading` é true e
 * a UI deve aguardar (não mostrar nem esconder prematuramente).
 */
export function useAreaAccess(namespaces: string[], required: AccessLevelInput = "READ") {
  const list = [...new Set(namespaces.filter(Boolean))].sort();
  const fetcher = useServerFn(getMyAccessDecisions);

  const query = useQuery({
    queryKey: ["area-access", required, list.join("|")],
    queryFn: () =>
      fetcher({
        data: {
          permissions: list,
          required,
          propertyId: null,
          clientId: null,
          recordId: null,
        },
      }),
    enabled: list.length > 0,
    staleTime: 30_000,
    retry: false,
  });

  const decisions = query.data?.decisions ?? {};

  /** Área liberada? Sem uma decisão positiva do backend, o acesso fica fechado. */
  function can(namespace: string): boolean {
    const decision = decisions[namespace];
    if (!decision) return query.isLoading;
    return decision.allowed;
  }

  function reasonFor(namespace: string): string {
    return decisions[namespace]?.reason ?? "";
  }

  return { can, reasonFor, loading: query.isLoading, ready: !query.isLoading, decisions };
}
