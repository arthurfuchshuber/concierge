import type { ReactNode } from "react";
import { usePermission, type UsePermissionOptions } from "@/lib/permissions/usePermission";
import { requiredLevelFor } from "@/lib/permissions/permissionClient";

export type PermissionGateProps = UsePermissionOptions & {
  /** Slug do nó de permissão (ex.: "tenant.imoveis.editor"). */
  permission: string;
  /** Alternativa a `required`: a ação é traduzida para READ/WRITE. */
  action?: string;
  /** Conteúdo exibido quando permitido. */
  children: ReactNode;
  /** Conteúdo exibido quando negado (padrão: nada). */
  fallback?: ReactNode;
  /** Conteúdo exibido durante a verificação (padrão: nada). */
  loadingFallback?: ReactNode;
};

/**
 * `<PermissionGate>` — exibe o conteúdo apenas quando o backend autoriza.
 *
 * Estado seguro por construção: durante o carregamento ou em caso de falha
 * na verificação, o conteúdo protegido NÃO é renderizado.
 */
export function PermissionGate({
  permission,
  action,
  children,
  fallback = null,
  loadingFallback = null,
  ...options
}: PermissionGateProps) {
  const required = options.required ?? (action ? requiredLevelFor(action) : "READ");
  const { allowed, loading } = usePermission(permission, { ...options, required });

  if (loading) return <>{loadingFallback}</>;
  return <>{allowed ? children : fallback}</>;
}

/** Aviso padrão reutilizável para áreas negadas. */
export function PermissionDeniedNotice({ message }: { message?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
      {message ?? "Você não tem permissão para visualizar esta área."}
    </div>
  );
}

export default PermissionGate;
