import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listUnsyncedProperties } from "@/lib/airbnb-account.functions";
import { usePermission } from "@/lib/permissions/usePermission";
import { useImpersonation } from "@/hooks/useImpersonation";

/**
 * Consulta ÚNICA de imóveis sem integração, compartilhada pelo aviso obrigatório
 * (SyncRequiredGate) e pela faixa de alerta (SyncAlertBanner): mesma chave de cache,
 * então abrir as duas não gera uma segunda consulta.
 */
export function useUnsyncedProperties() {
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const perm = usePermission("tenant.stakeholders.proprietarios.imoveis", { required: "WRITE" });
  const listFn = useServerFn(listUnsyncedProperties);
  const q = useQuery({
    queryKey: ["unsynced-properties", accountOwnerId ?? "self"],
    queryFn: () => listFn({ data: { accountOwnerId } }),
    enabled: perm.allowed && !perm.loading,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
  return { perm, q, accountOwnerId };
}
