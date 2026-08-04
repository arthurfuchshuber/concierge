/**
 * Permission Registry — catálogo central de Permission Nodes.
 *
 * FASE 1: apenas a estrutura. Nenhum módulo existente é registrado ainda.
 * A partir da próxima fase, NENHUMA funcionalidade poderá existir sem estar
 * declarada aqui (o Auto Discovery sincroniza o registry com o banco).
 */
import type { AccessLevel, PermissionNodeDefinition, PermissionNodeType } from "./permission.types";

class PermissionRegistry {
  private nodes = new Map<string, PermissionNodeDefinition>();

  /** Registra (ou substitui) um nó. Idempotente por slug. */
  register(def: PermissionNodeDefinition): PermissionNodeDefinition {
    const normalized: PermissionNodeDefinition = {
      order: 0,
      active: true,
      parentSlug: def.parentSlug ?? null,
      description: def.description ?? null,
      feature: def.feature ?? null,
      maxAccessLevel: def.maxAccessLevel ?? "WRITE",
      ...def,
    };
    this.nodes.set(normalized.slug, normalized);
    return normalized;
  }

  /** Registra vários nós de uma vez. */
  registerMany(defs: PermissionNodeDefinition[]): void {
    for (const d of defs) this.register(d);
  }

  has(slug: string): boolean {
    return this.nodes.has(slug);
  }

  get(slug: string): PermissionNodeDefinition | null {
    return this.nodes.get(slug) ?? null;
  }

  list(): PermissionNodeDefinition[] {
    return [...this.nodes.values()].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.slug.localeCompare(b.slug),
    );
  }

  listByType(type: PermissionNodeType): PermissionNodeDefinition[] {
    return this.list().filter((n) => n.type === type);
  }

  children(parentSlug: string | null): PermissionNodeDefinition[] {
    return this.list().filter((n) => (n.parentSlug ?? null) === parentSlug);
  }

  /** Cadeia do nó até a raiz (inclui o próprio nó, raiz por último). */
  ancestors(slug: string): PermissionNodeDefinition[] {
    const chain: PermissionNodeDefinition[] = [];
    const seen = new Set<string>();
    let current = this.get(slug);
    while (current && !seen.has(current.slug)) {
      seen.add(current.slug);
      chain.push(current);
      current = current.parentSlug ? this.get(current.parentSlug) : null;
    }
    return chain;
  }

  /** Teto de acesso de um nó, respeitando os tetos dos ancestrais. */
  maxAccessLevel(slug: string): AccessLevel {
    const chain = this.ancestors(slug);
    if (!chain.length) return "WRITE";
    let max: AccessLevel = "WRITE";
    for (const node of chain) {
      const level = node.maxAccessLevel ?? "WRITE";
      if (level === "NONE") return "NONE";
      if (level === "READ") max = "READ";
    }
    return max;
  }

  /** Feature de plano exigida pelo nó (herdada do ancestral mais próximo). */
  requiredFeature(slug: string): string | null {
    for (const node of this.ancestors(slug)) {
      if (node.feature) return node.feature;
    }
    return null;
  }

  /** Árvore serializável — usada futuramente pela UI de administração. */
  tree(parentSlug: string | null = null): Array<PermissionNodeDefinition & { children: unknown[] }> {
    return this.children(parentSlug).map((node) => ({
      ...node,
      children: this.tree(node.slug),
    }));
  }

  /** Validação estrutural: pais inexistentes e ciclos. */
  validate(): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const node of this.list()) {
      if (node.parentSlug && !this.has(node.parentSlug)) {
        errors.push(`Nó "${node.slug}" referencia um pai inexistente: "${node.parentSlug}".`);
      }
      const seen = new Set<string>();
      let cursor: PermissionNodeDefinition | null = node;
      while (cursor) {
        if (seen.has(cursor.slug)) {
          errors.push(`Ciclo detectado na hierarquia do nó "${node.slug}".`);
          break;
        }
        seen.add(cursor.slug);
        cursor = cursor.parentSlug ? this.get(cursor.parentSlug) : null;
      }
    }
    return { ok: errors.length === 0, errors };
  }

  /** Somente para testes / bootstrap. */
  clear(): void {
    this.nodes.clear();
  }
}

/** Instância única compartilhada por toda a aplicação. */
export const permissionRegistry = new PermissionRegistry();

export type { PermissionRegistry };

/**
 * AUTO DISCOVERY (FASE 1: somente estrutura, nenhuma automação ativa).
 *
 * `collectDiscoveredNodes` é o ponto de entrada onde, nas próximas fases,
 * os módulos do ConciergeIA declararão seus nós automaticamente. Enquanto
 * nada for declarado, o registry permanece vazio de propósito.
 */
const discoverySources: Array<() => PermissionNodeDefinition[]> = [];

/** Registra uma fonte de descoberta (um módulo do SaaS). */
export function registerDiscoverySource(source: () => PermissionNodeDefinition[]): void {
  discoverySources.push(source);
}

/** Executa todas as fontes e devolve os nós encontrados (sem registrar). */
export function collectDiscoveredNodes(): PermissionNodeDefinition[] {
  return discoverySources.flatMap((source) => {
    try {
      return source();
    } catch (err) {
      console.error("[permissions] fonte de auto discovery falhou", err);
      return [];
    }
  });
}

/** Aplica o auto discovery no registry em memória. */
export function runAutoDiscovery(): PermissionNodeDefinition[] {
  const found = collectDiscoveredNodes();
  permissionRegistry.registerMany(found);
  return found;
}
