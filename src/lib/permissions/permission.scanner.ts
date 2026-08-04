/**
 * Permission Scanner (Auto Discovery) — descobre automaticamente a estrutura
 * navegável do ConciergeIA e a traduz em Permission Nodes.
 *
 * FASE 2: o scanner apenas cataloga. Ele não bloqueia, não altera menus e não
 * interfere em nenhuma rota. Somente elementos que fazem parte da experiência
 * do usuário são registrados — componentes técnicos internos são ignorados.
 */
import { CATALOG_ROUTE_MAP } from "./permission.catalog";
import { deriveParentSlug } from "./permission.registry";
import type { PermissionNodeDefinition } from "./permission.types";

/** Arquivos de rota que nunca representam experiência do usuário. */
const TECHNICAL_ROUTE_PATTERNS = [
  /\/api\//,
  /__root/,
  /routeTree\.gen/,
  /\/\.well-known/,
  /\[\.mcp\]/,
  /\bmcp\b/,
  /sitemap/,
  /oauth/,
  /\/lovable\//,
  /\.oauth\./,
];

function isTechnicalRoute(file: string): boolean {
  return TECHNICAL_ROUTE_PATTERNS.some((re) => re.test(file));
}

/** Converte o caminho de arquivo de rota em URL do TanStack Router. */
export function fileToRoutePath(file: string): string {
  let rel = file.replace(/^.*\/src\/routes\//, "").replace(/\.tsx?$/, "");
  rel = rel.replace(/\[\.\]/g, ".");
  const segments = rel
    .split("/")
    .flatMap((part) => part.split("."))
    .filter(Boolean)
    .filter((part) => part !== "index" && part !== "route")
    .map((part) => part.replace(/_$/, ""))
    .filter((part) => !/^_/.test(part));
  return "/" + segments.join("/");
}

/** Slug canônico derivado de uma rota (`/admin/dashboard` → `admin.dashboard`). */
export function routeToSlug(route: string): string {
  const parts = route
    .split("/")
    .filter(Boolean)
    .map((p) => p.replace(/^\$/, "").toLowerCase())
    .filter(Boolean);
  return parts.length ? parts.join(".") : "root";
}

function humanize(value: string): string {
  return value
    .replace(/[-_.]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Lista todos os arquivos de rota da aplicação (sem importá-los). */
export function listRouteFiles(): string[] {
  const modules = import.meta.glob("/src/routes/**/*.tsx", { eager: false });
  return Object.keys(modules).sort();
}

export type DiscoveredRoute = {
  file: string;
  route: string;
  slug: string;
  technical: boolean;
  /** Slug do nó do catálogo que já cobre esta rota, quando existir. */
  catalogSlug: string | null;
};

/** Descobre todas as rotas navegáveis e o nó de catálogo correspondente. */
export function discoverRoutes(): DiscoveredRoute[] {
  return listRouteFiles().map((file) => {
    const route = fileToRoutePath(file);
    return {
      file,
      route,
      slug: routeToSlug(route),
      technical: isTechnicalRoute(file),
      catalogSlug: CATALOG_ROUTE_MAP[route] ?? null,
    };
  });
}

/**
 * Converte rotas descobertas que ainda não estão no catálogo em definições
 * de Permission Node (tipo inferido pela profundidade da rota).
 */
export function discoveredRouteNodes(): PermissionNodeDefinition[] {
  return discoverRoutes()
    .filter((r) => !r.technical && !r.catalogSlug)
    .map<PermissionNodeDefinition>((r) => {
      const depth = r.slug.split(".").length;
      return {
        slug: r.slug,
        name: humanize(r.slug.split(".").pop() ?? r.slug),
        label: humanize(r.slug.split(".").pop() ?? r.slug),
        type: depth <= 1 ? "PAGE" : "SUBPAGE",
        parentSlug: deriveParentSlug(r.slug),
        route: r.route,
        description: `Descoberto automaticamente a partir de ${r.file}.`,
        order: 500,
        displayOrder: 500,
        isSystem: true,
        isHidden: false,
        version: 1,
        deprecated: false,
        active: true,
        source: "scanner",
      };
    });
}
