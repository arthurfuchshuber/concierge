/**
 * CONTAS QUE RECEBEM O ALERTA DE "IMÓVEIS SEM SINCRONIZAÇÃO" (pedido de 14/10/2026:
 * "SOMENTE conta Anfitrião Sigma" nesta etapa).
 *
 * É o único lugar da regra: para liberar para outra conta, basta acrescentar o id aqui.
 * A checagem acontece no SERVIDOR (`listUnsyncedProperties` devolve `alert`); o cliente
 * só obedece ao que o servidor respondeu.
 */
export const SIGMA_ACCOUNT_ID = "25239e5b-1a66-46f1-b9a2-829c499cc366";

export const SYNC_ALERT_ACCOUNTS: ReadonlySet<string> = new Set([SIGMA_ACCOUNT_ID]);

export function isSyncAlertAccount(accountId: string | null | undefined): boolean {
  return !!accountId; // liberado para todas as contas (28/10/2026)
}
