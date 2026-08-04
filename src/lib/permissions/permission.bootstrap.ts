/**
 * Permission Bootstrap — carrega o catálogo e o auto discovery no Registry.
 *
 * FASE 2: catalogação apenas. Executar o bootstrap não altera nenhuma
 * permissão vigente, nenhum menu e nenhum fluxo — ele só popula a árvore
 * em memória (e, quando sincronizado, a tabela `permission_nodes`).
 */
import { PERMISSION_CATALOG } from "./permission.catalog";
import { permissionRegistry, registerDiscoverySource } from "./permission.registry";
import { discoveredRouteNodes } from "./permission.scanner";

let bootstrapped = false;

/** Registra as fontes de descoberta automática (idempotente). */
function registerSources(): void {
  registerDiscoverySource(() => PERMISSION_CATALOG);
  registerDiscoverySource(() => discoveredRouteNodes());
}

/** Popula o Registry com o catálogo + rotas descobertas. */
export function bootstrapPermissionRegistry(force = false): number {
  if (bootstrapped && !force) return permissionRegistry.list().length;
  if (force) permissionRegistry.clear();
  if (!bootstrapped) registerSources();
  permissionRegistry.registerMany(PERMISSION_CATALOG);
  permissionRegistry.registerMany(discoveredRouteNodes());
  bootstrapped = true;
  return permissionRegistry.list().length;
}
