/**
 * Registro de confiança em tempo de execução.
 *
 * `ValidatedTurn` e `CredentialGrant` só valem se foram EMITIDOS pelo módulo
 * dono (data/scope.server.ts e policy/grants.ts). O tipo TypeScript sozinho não
 * impede um objeto forjado em JS; este registro impede: as funções de dados
 * recusam qualquer objeto que não esteja aqui. Os objetos emitidos são
 * congelados.
 */
const registries = {
  turn: new WeakSet<object>(),
  grant: new WeakSet<object>(),
};

export type TrustKind = keyof typeof registries;

export function issue<T extends object>(kind: TrustKind, value: T): Readonly<T> {
  const frozen = Object.freeze(value);
  registries[kind].add(frozen);
  return frozen;
}

export function isIssued(kind: TrustKind, value: unknown): boolean {
  return typeof value === "object" && value !== null && registries[kind].has(value);
}

export class GuestAiSecurityError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "GuestAiSecurityError";
  }
}

export function assertIssued(kind: TrustKind, value: unknown, code: string): void {
  if (!isIssued(kind, value)) throw new GuestAiSecurityError(code);
}
