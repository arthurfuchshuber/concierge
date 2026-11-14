/**
 * FiscalGuard — decisão de acesso ao módulo fiscal (fail-closed).
 * Regras aprovadas: o admin SaaS NÃO tem acesso ao conteúdo fiscal; só o dono da conta ou membro ATIVO dela;
 * módulo habilitado para a conta; permissão da árvore (`tenant.fiscal.*`). Autorizar atos fiscais exige o nó
 * `tenant.fiscal.autorizacoes.autorizar` concedido DIRETAMENTE ao membro (herança não conta).
 */
export type FiscalAction =
  | "empresas.ver" | "empresas.cadastrar" | "empresas.certificado" | "empresas.desativar"
  | "documentos.ver" | "documentos.preparar" | "documentos.consultar" | "documentos.baixar" | "documentos.cancelar-preparar"
  | "autorizacoes.ver" | "autorizacoes.autorizar" | "autorizacoes.rejeitar"
  | "provedor.ver" | "provedor.configurar" | "provedor.webhook" | "provedor.testar"
  | "auditoria";

export interface FiscalGuardPorts {
  moduleEnabled(ownerId: string): Promise<boolean>;
  isActiveMember(ownerId: string, userId: string): Promise<boolean>;
  /** Permissão efetiva da árvore para o membro naquela conta. */
  hasPermission(userId: string, ownerId: string, slug: string, level: "READ" | "WRITE"): Promise<boolean>;
  /** Concessão DIRETA do nó (sem herança). */
  hasDirectGrant(userId: string, ownerId: string, slug: string): Promise<boolean>;
}

const READ_ACTIONS = new Set<FiscalAction>(["empresas.ver", "documentos.ver", "autorizacoes.ver", "provedor.ver", "auditoria"]);

export class FiscalAccessError extends Error {
  constructor(readonly code: "module_disabled" | "not_in_account" | "permission_denied" | "invalid_input", message: string) {
    super(message);
    this.name = "FiscalAccessError";
  }
}

export function fiscalSlug(action: FiscalAction): string {
  return action === "auditoria" ? "tenant.fiscal.auditoria" : `tenant.fiscal.${action}`;
}

export async function requireFiscalAccess(
  ports: FiscalGuardPorts,
  args: { userId: string; ownerId: string; action: FiscalAction },
): Promise<void> {
  const { userId, ownerId, action } = args;
  if (!userId || !ownerId) throw new FiscalAccessError("invalid_input", "Contexto fiscal inválido.");
  if (!(await ports.moduleEnabled(ownerId))) throw new FiscalAccessError("module_disabled", "O módulo fiscal não está habilitado para esta conta.");
  const isOwner = userId === ownerId;
  if (!isOwner && !(await ports.isActiveMember(ownerId, userId))) throw new FiscalAccessError("not_in_account", "Sem acesso a esta conta.");
  const slug = fiscalSlug(action);
  if (action === "autorizacoes.autorizar") {
    // ato fiscal: nem o dono é "herdeiro implícito" de autorização de terceiros, mas o dono da conta pode autorizar
    if (isOwner) return;
    if (!(await ports.hasDirectGrant(userId, ownerId, slug))) throw new FiscalAccessError("permission_denied", "Sem permissão para autorizar atos fiscais.");
    return;
  }
  if (isOwner) return;
  if (!(await ports.hasPermission(userId, ownerId, slug, READ_ACTIONS.has(action) ? "READ" : "WRITE"))) {
    throw new FiscalAccessError("permission_denied", "Sem permissão para esta ação fiscal.");
  }
}
