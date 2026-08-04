/**
 * Lovable Guardian — governança da árvore de permissões.
 *
 * FASE 2: apenas arquitetura. O Guardian detecta recursos novos que ainda não
 * possuem Permission Node e prepara a proposta de decisão. NENHUMA interação
 * visual é implementada nesta fase e nada é registrado automaticamente sem
 * decisão explícita.
 */
import { permissionRegistry } from "./permission.registry";
import { discoverRoutes } from "./permission.scanner";
import { discoveredRouteNodes } from "./permission.scanner";
import type { PermissionNodeDefinition } from "./permission.types";

/** Decisões possíveis diante de um recurso novo. */
export type GuardianDecision = "auto-register" | "review" | "internal";

export type GuardianFinding = {
  slug: string;
  label: string;
  type: PermissionNodeDefinition["type"];
  route: string | null;
  origin: "route" | "module";
  suggestedParentSlug: string | null;
  definition: PermissionNodeDefinition;
};

export type GuardianReport = {
  generatedAt: string;
  hasNewResources: boolean;
  message: string;
  /** Opções que serão oferecidas ao desenvolvedor em fases futuras. */
  options: Array<{ decision: GuardianDecision; label: string }>;
  findings: GuardianFinding[];
};

const GUARDIAN_MESSAGE =
  "Foram identificados novos recursos que ainda não fazem parte da árvore de permissões.";

const GUARDIAN_OPTIONS: GuardianReport["options"] = [
  { decision: "auto-register", label: "Registrar automaticamente" },
  { decision: "review", label: "Revisar antes de registrar" },
  { decision: "internal", label: "Marcar como recurso interno" },
];

/** Detecta recursos de experiência do usuário ainda ausentes do Registry. */
export function inspect(): GuardianReport {
  const known = new Set(permissionRegistry.list().map((n) => n.slug));
  const knownRoutes = new Set(
    permissionRegistry
      .list()
      .map((n) => n.route)
      .filter((r): r is string => Boolean(r)),
  );

  const findings: GuardianFinding[] = discoveredRouteNodes()
    .filter((def) => !known.has(def.slug) && !(def.route && knownRoutes.has(def.route)))
    .map((def) => ({
      slug: def.slug,
      label: def.label ?? def.name,
      type: def.type,
      route: def.route ?? null,
      origin: "route" as const,
      suggestedParentSlug: def.parentSlug ?? null,
      definition: def,
    }));

  return {
    generatedAt: new Date().toISOString(),
    hasNewResources: findings.length > 0,
    message: findings.length ? GUARDIAN_MESSAGE : "Árvore de permissões atualizada.",
    options: GUARDIAN_OPTIONS,
    findings,
  };
}

/**
 * Aplica uma decisão de governança a um conjunto de achados.
 * `review` não altera nada — apenas devolve os itens para revisão manual.
 */
export function applyDecision(
  findings: GuardianFinding[],
  decision: GuardianDecision,
): PermissionNodeDefinition[] {
  if (decision === "review") return findings.map((f) => f.definition);

  const defs = findings.map<PermissionNodeDefinition>((f) => ({
    ...f.definition,
    isHidden: decision === "internal" ? true : (f.definition.isHidden ?? false),
    isSystem: true,
  }));

  if (decision === "auto-register") permissionRegistry.registerMany(defs);
  return defs;
}

/** Total de rotas de experiência do usuário observadas pelo Guardian. */
export function observedRouteCount(): number {
  return discoverRoutes().filter((r) => !r.technical).length;
}

export const lovableGuardian = { inspect, applyDecision, observedRouteCount };
