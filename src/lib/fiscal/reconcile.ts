import { mapQueryStatus, type FocusDocumentPath } from "./focus/client";
import type { FocusHttpResult, QueryResult } from "./types";

export interface ReconcileCandidate { operationId: string; ref: string; documentKind: FocusDocumentPath; opKind: string }

export interface ReconcilePorts {
  query(c: ReconcileCandidate): Promise<FocusHttpResult>;
  applyQuery(operationId: string, result: QueryResult, providerStatus: string | null, protocol: string | null, accessKey: string | null, bodyHash: string, redacted: unknown): Promise<void>;
  hash(body: unknown): string;
  redact(body: unknown): unknown;
}

export type ReconcileOutcome = { operationId: string; result: QueryResult | "transport_error" };

/** Consulta o provedor e aplica o resultado. Falha de transporte NÃO altera nada (a próxima rodada tenta de novo). */
export async function reconcileOne(ports: ReconcilePorts, c: ReconcileCandidate): Promise<ReconcileOutcome> {
  let res: FocusHttpResult;
  try { res = await ports.query(c); } catch { return { operationId: c.operationId, result: "transport_error" }; }
  const m = mapQueryStatus(res.status, res.body);
  // `cancelled` só é aplicável a operação de cancelamento; numa emissão vira "unmapped" (não presume)
  const result: QueryResult = m.result === "cancelled" && c.opKind !== "cancel" ? "unmapped" : m.result === "authorized" && c.opKind === "cancel" ? "unmapped" : m.result;
  await ports.applyQuery(c.operationId, result, m.providerStatus, m.protocol, m.accessKey, ports.hash(res.body), ports.redact(res.body));
  return { operationId: c.operationId, result };
}
