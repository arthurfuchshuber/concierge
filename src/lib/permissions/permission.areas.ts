/**
 * Áreas exibidas na página de Permissões — derivadas DIRETAMENTE do catálogo.
 *
 * Categoria  = página do menu lateral (PAGE)
 * Subcategoria = aba/subpágina (TAB | SUBPAGE)
 * Atividade  = ação dentro da aba (RESOURCE | SECTION | FIELD)
 *
 * Não existe lista paralela: mexer no catálogo muda esta tela automaticamente.
 */
import { PERMISSION_CATALOG } from "./permission.catalog";
import { SAAS_NAMESPACE, TENANT_NAMESPACE, isSaasSlug } from "./permission.slugs";
import type { PermissionNodeDefinition } from "./permission.types";

export type AreaItem = {
  namespace: string;
  label: string;
  /** 0 = categoria, 1 = subcategoria, 2 = atividade. */
  depth: number;
};

export type AreaGroup = {
  /** Slug da categoria (página do menu). */
  namespace: string;
  title: string;
  items: AreaItem[];
};

function sortDefs(a: PermissionNodeDefinition, b: PermissionNodeDefinition) {
  return (a.displayOrder ?? a.order ?? 0) - (b.displayOrder ?? b.order ?? 0);
}

function buildGroups(namespace: string): AreaGroup[] {
  const all = PERMISSION_CATALOG.filter(
    (n) => n.slug !== TENANT_NAMESPACE && n.slug !== SAAS_NAMESPACE,
  ).filter((n) => (namespace === SAAS_NAMESPACE ? isSaasSlug(n.slug) : !isSaasSlug(n.slug)));

  const childrenOf = (slug: string) =>
    all.filter((n) => n.parentSlug === slug).sort(sortDefs);

  return all
    .filter((n) => n.type === "PAGE")
    .sort(sortDefs)
    .map((pageNode) => {
      const items: AreaItem[] = [
        { namespace: pageNode.slug, label: `${pageNode.label ?? pageNode.name} (página)`, depth: 0 },
      ];
      for (const subNode of childrenOf(pageNode.slug)) {
        items.push({ namespace: subNode.slug, label: subNode.label ?? subNode.name, depth: 1 });
        for (const action of childrenOf(subNode.slug)) {
          items.push({ namespace: action.slug, label: action.label ?? action.name, depth: 2 });
          for (const leaf of childrenOf(action.slug)) {
            items.push({ namespace: leaf.slug, label: leaf.label ?? leaf.name, depth: 2 });
          }
        }
      }
      return {
        namespace: pageNode.slug,
        title: pageNode.label ?? pageNode.name,
        items,
      };
    });
}

/** Categorias da conta do cliente (menu lateral do anfitrião). */
export const ACCOUNT_AREAS: AreaGroup[] = buildGroups(TENANT_NAMESPACE);

/** Categorias do Admin do SaaS. */
export const SAAS_AREAS: AreaGroup[] = buildGroups(SAAS_NAMESPACE);

const TYPE_LABEL: Record<string, string> = {
  PAGE: "Página",
  SUBPAGE: "Subpágina",
  TAB: "Aba",
  SECTION: "Seção",
  RESOURCE: "Ação",
  FIELD: "Campo",
};

export type AreaGrantLine = {
  slug: string;
  label: string;
  kind: string;
  depth: number;
  route: string | null;
  description: string | null;
};

/**
 * Tudo o que uma permissão libera: o próprio nó e TODOS os descendentes
 * (páginas, abas, seções, ações), gerado do catálogo — nunca desatualiza.
 */
export function describeAreaGrant(namespace: string): AreaGrantLine[] {
  const out: AreaGrantLine[] = [];
  const walk = (slug: string, depth: number) => {
    const node = PERMISSION_CATALOG.find((n) => n.slug === slug);
    if (!node) return;
    out.push({
      slug,
      label: node.label ?? node.name,
      kind: TYPE_LABEL[node.type] ?? node.type,
      depth,
      route: node.route ?? null,
      description: node.description ?? null,
    });
    PERMISSION_CATALOG.filter((n) => n.parentSlug === slug)
      .sort(sortDefs)
      .forEach((c) => walk(c.slug, depth + 1));
  };
  walk(namespace, 0);
  return out;
}
