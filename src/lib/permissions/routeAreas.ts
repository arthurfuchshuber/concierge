/**
 * Mapa rota → área de permissão do painel da conta.
 * Usado pela navegação e pelo bloqueio de páginas em `/admin`.
 */
export const ROUTE_PERMISSIONS: Array<{ prefix: string; permission: string }> = [
  { prefix: "/admin/dashboard", permission: "tenant.dashboard" },
  { prefix: "/admin/guias", permission: "tenant.imoveis" },
  { prefix: "/admin/properties", permission: "tenant.imoveis.editor" },
  { prefix: "/admin/stakeholders", permission: "tenant.stakeholders" },
  { prefix: "/admin/hospedes", permission: "tenant.stakeholders.hospedes" },
  { prefix: "/admin/ia", permission: "tenant.ia" },
  { prefix: "/admin/atendimento", permission: "tenant.conversas" },
  { prefix: "/admin/administrativo", permission: "tenant.administrativo" },
  { prefix: "/admin/cidades", permission: "tenant.cidades" },
  { prefix: "/admin/taxonomia", permission: "tenant.cidades.taxonomia" },
];

export const ROUTE_PERMISSION_LIST = [
  ...new Set(ROUTE_PERMISSIONS.map((r) => r.permission)),
];

export function permissionForPath(pathname: string): string | null {
  const match = ROUTE_PERMISSIONS.filter((r) => pathname.startsWith(r.prefix)).sort(
    (a, b) => b.prefix.length - a.prefix.length,
  )[0];
  return match?.permission ?? null;
}
