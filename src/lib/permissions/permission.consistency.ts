/**
 * Permission Consistency — rotina de validação da árvore de permissões.
 *
 * FASE 2: apenas diagnostica e gera relatório/log. Nada é bloqueado.
 */
import { permissionRegistry } from "./permission.registry";
import { discoverRoutes, type DiscoveredRoute } from "./permission.scanner";
import type { PermissionNodeDefinition } from "./permission.types";

export type ConsistencyIssue = {
  code:
    | "ROUTE_WITHOUT_NODE"
    | "NODE_WITHOUT_ROUTE"
    | "BROKEN_PARENT"
    | "DUPLICATE_SLUG"
    | "DEPRECATED_ACTIVE";
  severity: "info" | "warning" | "error";
  slug: string | null;
  route: string | null;
  message: string;
};

export type ConsistencyReport = {
  generatedAt: string;
  totalNodes: number;
  totalRoutes: number;
  ok: boolean;
  issues: ConsistencyIssue[];
};

function routeIsCovered(route: DiscoveredRoute, nodes: PermissionNodeDefinition[]): boolean {
  if (route.catalogSlug) return true;
  return nodes.some((n) => n.route === route.route || n.slug === route.slug);
}

/** Verifica se existe qualquer rota ou recurso sem Permission Node. */
export function buildConsistencyReport(): ConsistencyReport {
  const nodes = permissionRegistry.list();
  // Só rotas permissionáveis (allowlist) entram no diagnóstico de cobertura;
  // páginas públicas/marketing/legais são ignoradas por definição.
  const routes = discoverRoutes().filter((r) => r.permissionable);

  const issues: ConsistencyIssue[] = [];

  for (const route of routes) {
    if (!routeIsCovered(route, nodes)) {
      issues.push({
        code: "ROUTE_WITHOUT_NODE",
        severity: "warning",
        slug: route.slug,
        route: route.route,
        message: `A rota "${route.route}" não possui Permission Node correspondente.`,
      });
    }
  }

  const structural = permissionRegistry.validate();
  for (const error of structural.errors) {
    issues.push({
      code: "BROKEN_PARENT",
      severity: "error",
      slug: null,
      route: null,
      message: error,
    });
  }

  for (const node of nodes) {
    if (node.deprecated && node.active) {
      issues.push({
        code: "DEPRECATED_ACTIVE",
        severity: "info",
        slug: node.slug,
        route: node.route ?? null,
        message: `O nó "${node.slug}" está marcado como descontinuado, porém continua ativo.`,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totalNodes: nodes.length,
    totalRoutes: routes.length,
    ok: issues.every((i) => i.severity === "info"),
    issues,
  };
}

/** Gera log estruturado da inconsistência (consumido pelo Admin SaaS futuramente). */
export function logConsistencyReport(report: ConsistencyReport): void {
  if (report.ok) {
    console.info(
      `[permissions][consistency] árvore consistente — ${report.totalNodes} nós / ${report.totalRoutes} rotas.`,
    );
    return;
  }
  console.warn(
    `[permissions][consistency] ${report.issues.length} inconsistência(s) detectada(s).`,
    report.issues,
  );
}
