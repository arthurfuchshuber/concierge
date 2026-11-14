/**
 * FiscalGuard — acesso ao módulo fiscal, fail-closed e `owner_only` (diretriz do proprietário, 14/11/2026).
 * Só o TITULAR da conta (userId === ownerId) com o módulo habilitado. Administradores operacionais, membros de equipe,
 * prestadores e o admin SaaS recebem 403. Não há acesso por herança nem por permissão da árvore.
 */
export type FiscalAction =
  | "empresas.ver" | "empresas.cadastrar" | "empresas.certificado" | "empresas.desativar"
  | "documentos.ver" | "documentos.preparar" | "documentos.consultar" | "documentos.baixar" | "documentos.cancelar-preparar"
  | "autorizacoes.ver" | "autorizacoes.autorizar" | "autorizacoes.rejeitar"
  | "provedor.ver" | "provedor.configurar" | "provedor.webhook" | "provedor.testar"
  | "auditoria";

export interface FiscalGuardPorts {
  moduleEnabled(ownerId: string): Promise<boolean>;
}

export class FiscalAccessError extends Error {
  /** HTTP equivalente: 403 para tudo que não é entrada inválida. */
  readonly httpStatus: 403 | 400;
  constructor(readonly code: "module_disabled" | "not_owner" | "invalid_input", message: string) {
    super(message);
    this.name = "FiscalAccessError";
    this.httpStatus = code === "invalid_input" ? 400 : 403;
  }
}

export async function requireFiscalAccess(
  ports: FiscalGuardPorts,
  args: { userId: string; ownerId: string; action: FiscalAction },
): Promise<void> {
  const { userId, ownerId } = args;
  if (!userId || !ownerId) throw new FiscalAccessError("invalid_input", "Contexto fiscal inválido.");
  // Dono primeiro: quem não é o titular não descobre se o módulo está habilitado.
  if (userId !== ownerId) throw new FiscalAccessError("not_owner", "Acesso restrito ao titular da conta.");
  if (!(await ports.moduleEnabled(ownerId))) throw new FiscalAccessError("module_disabled", "O módulo fiscal não está habilitado para esta conta.");
}
