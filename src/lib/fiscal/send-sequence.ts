import { classifySend, FocusTransportError } from "./focus/client";
import type { FocusHttpResult, ResponseClass, UnknownReason } from "./types";

/** Portas do banco (funções atômicas da migration). Injetadas para permitir injeção de falha nos testes. */
export interface SendPorts {
  plan(operationId: string, adapterVersion: string): Promise<string>;
  recordPayload(attemptId: string, bodyHash: string, redacted: unknown): Promise<void>;
  markSent(attemptId: string, authorizationId: string): Promise<{ ok: boolean; reason?: string }>;
  markUnknown(attemptId: string, reason: UnknownReason): Promise<void>;
  recordResponse(attemptId: string, cls: ResponseClass, httpStatus: number, bodyHash: string, redacted: unknown): Promise<void>;
  /** S3 — única chamada de rede. */
  send(): Promise<FocusHttpResult>;
}

export type SendOutcome =
  | { kind: "denied"; reason: string }
  | { kind: "responded"; responseClass: ResponseClass; httpStatus: number }
  | { kind: "unknown"; reason: UnknownReason };

/**
 * P (payload puro, calculado por quem chama) → S1 persiste E2 → S2 comita `sent` → S3 HTTP → S4 persiste E3.
 * Regras: nada vai à rede antes de `sent` comprometido; qualquer falha depois de `sent` vira unknown_result
 * (resolvido só por consulta); NUNCA há reenvio automático.
 */
export async function runSendSequence(
  ports: SendPorts,
  args: { operationId: string; authorizationId: string; payloadHash: string; redactedPayload: unknown; adapterVersion: string; hashBody: (b: unknown) => string; redactBody: (b: unknown) => unknown },
): Promise<SendOutcome> {
  const attempt = await ports.plan(args.operationId, args.adapterVersion);
  await ports.recordPayload(attempt, args.payloadHash, args.redactedPayload);       // S1
  const sent = await ports.markSent(attempt, args.authorizationId);                 // S2
  if (!sent.ok) return { kind: "denied", reason: sent.reason ?? "denied" };

  let res: FocusHttpResult;
  try {
    res = await ports.send();                                                       // S3
  } catch (e) {
    const reason: UnknownReason = e instanceof FocusTransportError ? e.reason : "connection_lost";
    await ports.markUnknown(attempt, reason);
    return { kind: "unknown", reason };
  }

  const cls = classifySend(res.status);
  try {
    await ports.recordResponse(attempt, cls, res.status, args.hashBody(res.body), args.redactBody(res.body));   // S4
  } catch {
    // resposta recebida mas não persistida: não perde a intenção; vira unknown e a consulta resolve
    await ports.markUnknown(attempt, "response_not_persisted");
    return { kind: "unknown", reason: "response_not_persisted" };
  }
  return { kind: "responded", responseClass: cls, httpStatus: res.status };
}
