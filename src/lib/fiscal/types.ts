/** Classes de resposta HTTP (v4.4 AR-09). Não são estado persistido do documento. */
export type ResponseClass = "accepted" | "rejected_definitive" | "retryable_before_send" | "inconclusive" | "unsupported";

export type UnknownReason = "timeout" | "connection_lost" | "response_not_persisted" | "crash_after_sent";

/** Resultado normalizado de uma consulta ao provedor. */
export type QueryResult = "authorized" | "rejected" | "processing" | "cancelled" | "absent" | "unmapped";

export interface FocusHttpResult {
  status: number;
  body: unknown;
}
