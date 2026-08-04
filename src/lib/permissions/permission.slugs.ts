/**
 * Permission Slugs — estratégia única de nomenclatura da árvore (FASE 3.5).
 *
 * Namespaces:
 *  - `admin.*`  → recursos exclusivos do Admin do SaaS;
 *  - `tenant.*` → recursos da conta do cliente (anfitrião e equipe).
 *
 * Todo slug legado (sem namespace) é migrado automaticamente para o namespace
 * de conta, mantendo o histórico em `SLUG_ALIASES` e na tabela
 * `permission_node_slug_history`.
 */

export const TENANT_NAMESPACE = "tenant";
export const SAAS_NAMESPACE = "admin";

export type PermissionNamespace = typeof TENANT_NAMESPACE | typeof SAAS_NAMESPACE;

/** Raízes canônicas da árvore. */
export const ROOT_SLUGS: PermissionNamespace[] = [TENANT_NAMESPACE, SAAS_NAMESPACE];

/** Namespace ao qual um slug canônico pertence. */
export function namespaceOf(slug: string): PermissionNamespace {
  return slug === SAAS_NAMESPACE || slug.startsWith(`${SAAS_NAMESPACE}.`)
    ? SAAS_NAMESPACE
    : TENANT_NAMESPACE;
}

export function isSaasSlug(slug: string): boolean {
  return namespaceOf(slug) === SAAS_NAMESPACE;
}

export function isTenantSlug(slug: string): boolean {
  return namespaceOf(slug) === TENANT_NAMESPACE;
}

/** True quando o slug já está namespaced. */
export function isNamespaced(slug: string): boolean {
  return ROOT_SLUGS.some((ns) => slug === ns || slug.startsWith(`${ns}.`));
}

/**
 * Converte qualquer slug em seu formato canônico.
 * Slugs legados (`dashboard`, `administrativo.equipe`) recebem `tenant.`.
 */
export function canonicalSlug(slug: string): string {
  const clean = slug
    .trim()
    .toLowerCase()
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");
  if (!clean) return TENANT_NAMESPACE;
  if (isNamespaced(clean)) return clean;
  return `${TENANT_NAMESPACE}.${clean}`;
}

/**
 * HISTÓRICO DE MIGRAÇÃO — slug antigo → slug canônico.
 *
 * Resolve explicitamente o conflito `admin.equipe` (derivado da rota
 * `/admin/administrativo`, que é da conta do cliente) versus
 * `administrativo.equipe` (nó do catálogo). O vencedor é
 * `tenant.administrativo.equipe`.
 */
export const SLUG_ALIASES: Record<string, string> = {
  "admin.equipe": "tenant.administrativo.equipe",
  "admin.administrativo": "tenant.administrativo",
  "admin.dashboard": "tenant.dashboard",
  "admin.atendimento": "tenant.conversas",
  "admin.guias": "tenant.imoveis",
  "admin.stakeholders": "tenant.stakeholders",
  "admin.engajamento": "tenant.engajamento",
  "admin.ia": "tenant.ia",
  "admin.inteligencia": "tenant.inteligencia",
  "admin.cidades": "tenant.cidades",
  "admin.assinatura": "tenant.administrativo.assinatura",
  "admin.integracoes": "tenant.administrativo.integracoes",
  "admin.hospedes": "tenant.stakeholders.hospedes",
};

/** Aplica aliases + canonicalização (idempotente). */
export function resolveSlug(slug: string): string {
  const direct = SLUG_ALIASES[slug];
  if (direct) return direct;
  const canonical = canonicalSlug(slug);
  return SLUG_ALIASES[canonical] ?? canonical;
}

/** Pares (antigo → novo) para persistir no histórico. */
export function slugHistoryPairs(): Array<{ old_slug: string; new_slug: string; reason: string }> {
  return Object.entries(SLUG_ALIASES).map(([oldSlug, newSlug]) => ({
    old_slug: oldSlug,
    new_slug: newSlug,
    reason: "Normalização de namespaces (Fase 3.5)",
  }));
}

/* ------------------------------------------------------------------ rotas */

/**
 * ALLOWLIST — apenas estas famílias de rota geram recursos permissionáveis.
 * Todo o resto (marketing, autenticação, legal, landing, guia público de
 * leitura, APIs) é catalogado como NÃO permissionável.
 */
export const PERMISSIONABLE_ROUTE_PREFIXES = ["/admin", "/painel"];

/** Rotas que nunca são permissionáveis (públicas, legais, técnicas, auth). */
export const NON_PERMISSIONABLE_ROUTES = new Set([
  "/",
  "/auth",
  "/precos",
  "/confianca",
  "/privacidade",
  "/termos",
  "/reembolso",
]);

const NON_PERMISSIONABLE_PATTERNS = [
  /^\/api\//,
  /^\/g\//,
  /^\/g$/,
  /^\/oauth/,
  /^\/lovable/,
  /^\/\.well-known/,
  /^\/\.mcp/,
  /^\/mcp/,
  /sitemap/,
  /robots/,
];

/** Rotas do Admin do SaaS (namespace `admin.*`). */
export const SAAS_ROUTES = new Set(["/admin/admins"]);

/** Decide se uma rota descoberta pode virar Permission Node. */
export function isPermissionableRoute(route: string): boolean {
  if (NON_PERMISSIONABLE_ROUTES.has(route)) return false;
  if (NON_PERMISSIONABLE_PATTERNS.some((re) => re.test(route))) return false;
  return PERMISSIONABLE_ROUTE_PREFIXES.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  );
}

/**
 * Slug canônico de uma rota permissionável.
 * `/admin/admins` → `admin.admins`; `/admin/dashboard` → `tenant.dashboard`.
 */
export function slugForRoute(route: string): string {
  const parts = route
    .split("/")
    .filter(Boolean)
    .map((p) => p.replace(/^\$/, "").toLowerCase())
    .filter(Boolean);
  if (!parts.length) return TENANT_NAMESPACE;

  if (SAAS_ROUTES.has(route)) return resolveSlug(parts.join("."));

  // Rotas /admin/* pertencem à conta do cliente — o prefixo de URL "admin"
  // é apenas o painel, não o namespace de permissões.
  const withoutPanel = parts[0] === "admin" || parts[0] === "painel" ? parts.slice(1) : parts;
  const base = withoutPanel.length ? withoutPanel.join(".") : "dashboard";
  return resolveSlug(`${TENANT_NAMESPACE}.${base}`);
}
