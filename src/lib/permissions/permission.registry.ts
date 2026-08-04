/**
 * Permission Registry — catálogo central de Permission Nodes.
 *
 * FASE 2: o catálogo completo do ConciergeIA é declarado e descoberto
 * automaticamente aqui. O registry continua desconectado das telas, menus e
 * regras de acesso atuais — ele apenas cataloga a árvore.
 *
 * Regras:
 *  - slug único e padronizado (`pai.filho.neto`);
 *  - nunca criar duplicidade (registro é idempotente e faz merge);
 *  - nunca criar árvore quebrada (pais ausentes são criados automaticamente).
 */
import { resolveSlug, ROOT_SLUGS } from "./permission.slugs";
import type {
  AccessLevel,
  PermissionNodeDefinition,
  PermissionNodeType,
} from "./permission.types";

/** Deriva o slug do pai a partir do slug pontuado (`a.b.c` → `a.b`). */
export function deriveParentSlug(slug: string): string | null {
  const parts = slug.split(".");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(".");
}


/** Rótulo legível gerado a partir do último segmento do slug. */
function humanize(slug: string): string {
  const last = slug.split(".").pop() ?? slug;
  return last
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Tipo provável de um pai criado automaticamente, pela profundidade do slug.
 * O namespace raiz (`tenant` / `admin`) não conta como nível.
 */
function inferTypeFromDepth(slug: string): PermissionNodeType {
  const depth = slug.split(".").length - (ROOT_SLUGS.some((r) => slug.startsWith(r)) ? 1 : 0);
  if (depth <= 0) return "PAGE";
  if (depth === 1) return "PAGE";
  if (depth === 2) return "SUBPAGE";
  if (depth === 3) return "TAB";
  return "SECTION";
}


class PermissionRegistry {
  private nodes = new Map<string, PermissionNodeDefinition>();

  /** Registra um nó. Idempotente por slug — faz merge, nunca duplica. */
  register(def: PermissionNodeDefinition): PermissionNodeDefinition {
    // FASE 3.5 — todo slug entra no registry já canonizado (namespaces).
    const slug = resolveSlug(def.slug);
    const legacy = new Set<string>();
    if (slug !== def.slug) legacy.add(def.slug);

    const previous = this.nodes.get(slug);
    for (const l of previous?.legacySlugs ?? []) legacy.add(l);
    for (const l of def.legacySlugs ?? []) legacy.add(l);

    const rawParent =
      def.parentSlug !== undefined
        ? def.parentSlug
        : (previous?.parentSlug ?? deriveParentSlug(slug));
    const parentSlug = rawParent ? resolveSlug(rawParent) : deriveParentSlug(slug);

    const normalized: PermissionNodeDefinition = {
      ...previous,
      ...def,
      slug,
      parentSlug: parentSlug ?? null,
      legacySlugs: [...legacy],
      description: def.description ?? previous?.description ?? null,
      order: def.order ?? previous?.order ?? 0,
      active: def.active ?? previous?.active ?? true,
      label: def.label ?? previous?.label ?? def.name,
      route: def.route ?? previous?.route ?? null,
      icon: def.icon ?? previous?.icon ?? null,
      displayOrder: def.displayOrder ?? previous?.displayOrder ?? def.order ?? 0,
      isSystem: def.isSystem ?? previous?.isSystem ?? true,
      isHidden: def.isHidden ?? previous?.isHidden ?? false,
      version: def.version ?? previous?.version ?? 1,
      deprecated: def.deprecated ?? previous?.deprecated ?? false,
      source: def.source ?? previous?.source ?? "manual",
      feature: def.feature ?? previous?.feature ?? null,
      maxAccessLevel: def.maxAccessLevel ?? previous?.maxAccessLevel ?? "WRITE",
      isPermissionable: def.isPermissionable ?? previous?.isPermissionable ?? true,
    };
    this.nodes.set(normalized.slug, normalized);
    this.ensureParent(normalized);
    return normalized;
  }


  /**
   * AUTO HERANÇA — garante que todo ancestral exista.
   * Caso o pai ainda não exista, ele é criado automaticamente.
   */
  private ensureParent(node: PermissionNodeDefinition): void {
    let parentSlug = node.parentSlug ?? null;
    while (parentSlug && !this.nodes.has(parentSlug)) {
      const created: PermissionNodeDefinition = {
        slug: parentSlug,
        name: humanize(parentSlug),
        label: humanize(parentSlug),
        type: inferTypeFromDepth(parentSlug),
        parentSlug: deriveParentSlug(parentSlug),
        description: "Agrupamento criado automaticamente pela auto herança.",
        order: 0,
        displayOrder: 0,
        active: true,
        isSystem: true,
        isHidden: false,
        version: 1,
        deprecated: false,
        source: "auto-parent",
        feature: null,
        maxAccessLevel: "WRITE",
        isPermissionable: node.isPermissionable ?? true,
      };

      this.nodes.set(created.slug, created);
      parentSlug = created.parentSlug ?? null;
    }
  }

  /** Registra vários nós de uma vez. */
  registerMany(defs: PermissionNodeDefinition[]): void {
    for (const d of defs) this.register(d);
  }


  has(slug: string): boolean {
    return this.nodes.has(slug) || this.nodes.has(resolveSlug(slug));
  }

  get(slug: string): PermissionNodeDefinition | null {
    return this.nodes.get(slug) ?? this.nodes.get(resolveSlug(slug)) ?? null;
  }

  list(): PermissionNodeDefinition[] {
    return [...this.nodes.values()].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.slug.localeCompare(b.slug),
    );
  }

  /** Somente nós que podem receber permissão (exclui públicos/marketing). */
  listPermissionable(): PermissionNodeDefinition[] {
    return this.list().filter((n) => n.isPermissionable !== false);
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
