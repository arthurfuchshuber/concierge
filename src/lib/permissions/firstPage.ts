/**
 * PRIMEIRA PÁGINA DO MENU DO USUÁRIO (pedido explícito, 15/11/2026): todo acesso
 * ao painel cai na primeira página que o menu lateral oferece a quem entrou —
 * Dashboard → Operacional para quem tem Dashboard; sem ele, o próximo item
 * liberado, na MESMA ordem do menu (Dashboard, Stakeholders, Guias Digitais,
 * Atendimento, Administrativo). Uma lista só, usada pela porta de entrada
 * (`/admin`) e pelo redirecionamento de página bloqueada.
 */
export const FIRST_PAGE_ORDER: Array<{ to: string; permission: string }> = [
  { to: "/admin/dashboard", permission: "tenant.dashboard" },
  { to: "/admin/proprietarios", permission: "tenant.stakeholders" },
  { to: "/admin/hospedes", permission: "tenant.stakeholders.hospedes" },
  { to: "/admin/prestadores", permission: "tenant.stakeholders" },
  { to: "/admin/guias", permission: "tenant.guias" },
  { to: "/admin/atendimento", permission: "tenant.atendimento" },
  { to: "/admin/administrativo", permission: "tenant.administrativo" },
  // Admin do SaaS (sem conta de cliente selecionada o menu do cliente fica oculto).
  { to: "/admin/engajamento", permission: "admin.engajamento" },
  { to: "/admin/clientes", permission: "admin.clientes" },
  { to: "/admin/recomendacoes-sigma", permission: "admin.recomendacoes-sigma" },
  { to: "/admin/taxonomia", permission: "admin.taxonomia" },
  { to: "/admin/admins", permission: "admin.admins" },
];

export const FIRST_PAGE_FALLBACK = "/admin/dashboard";

/** Primeira página liberada, na ordem do menu; `null` se nenhuma. */
export function firstAllowedPage(can: (permission: string) => boolean): string | null {
  return FIRST_PAGE_ORDER.find((p) => can(p.permission))?.to ?? null;
}
