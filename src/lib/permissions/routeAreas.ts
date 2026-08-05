/**
 * Mapa rota → CATEGORIA de permissão (página do menu lateral).
 * Usado pela navegação e pelo bloqueio de páginas em `/admin`.
 */
export const ROUTE_PERMISSIONS: Array<{ prefix: string; permission: string }> = [
  // Conta do cliente
  { prefix: "/admin/dashboard", permission: "tenant.dashboard" },
  { prefix: "/admin/guias", permission: "tenant.guias" },
  { prefix: "/admin/properties", permission: "tenant.guias.editor" },
  { prefix: "/admin/stakeholders", permission: "tenant.stakeholders" },
  { prefix: "/admin/hospedes", permission: "tenant.stakeholders.hospedes" },
  { prefix: "/admin/ia", permission: "tenant.ia" },
  { prefix: "/admin/atendimento", permission: "tenant.atendimento" },
  { prefix: "/admin/administrativo", permission: "tenant.administrativo" },
  { prefix: "/admin/assinatura", permission: "tenant.administrativo.assinatura" },
  { prefix: "/admin/integracoes", permission: "tenant.administrativo.integracoes" },
  // Admin do SaaS
  { prefix: "/admin/engajamento", permission: "admin.engajamento" },
  { prefix: "/admin/clientes", permission: "admin.clientes" },
  { prefix: "/admin/recomendacoes-sigma", permission: "admin.recomendacoes-sigma" },
  { prefix: "/admin/inteligencia", permission: "admin.inteligencia" },
  { prefix: "/admin/cidades", permission: "admin.cidades" },
  { prefix: "/admin/taxonomia", permission: "admin.taxonomia" },
  { prefix: "/admin/admins", permission: "admin.admins" },
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
