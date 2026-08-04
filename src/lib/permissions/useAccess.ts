import {
  usePermission,
  type UsePermissionOptions,
} from "@/lib/permissions/usePermission";
import { requiredLevelFor, type AccessScope, type AccessState } from "@/lib/permissions/permission.client";

export type UseAccessOptions = Omit<UsePermissionOptions, "required"> & AccessScope;

/**
 * `useAccess` — variante orientada a recurso + ação.
 * A ação é traduzida para o nível exigido (ver/listar → READ; demais → WRITE),
 * exatamente como `canAccess()` faz no backend.
 */
export function useAccess(
  resource: string,
  action: string,
  context: UseAccessOptions = {},
): AccessState {
  return usePermission(resource, { ...context, required: requiredLevelFor(action) });
}
