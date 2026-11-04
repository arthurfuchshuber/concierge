/**
 * E3.1 · registros de teste (normal + fallback de cerca) para chamar `shadow_finalize_execution`
 * diretamente. Só números, códigos e ids sintéticos. Somente teste.
 */
import { buildExecutionRecord, NO_GATEWAY, validateExecutionRecord, type ExecutionMeta } from "@/lib/guest-ai/shadow-exec/extract";
import { recordToRow } from "@/lib/guest-ai/data/shadow-store.server";
import type { ShadowExecutionRecord } from "@/lib/guest-ai/shadow-exec/contracts";
import type { ConvSpec } from "./harness";

export function recordsFor(o: { exec: string; s: ConvSpec; batchId: string; version: number; cost?: string; tokens?: number; calls?: number }) {
  const now = new Date().toISOString();
  const meta: ExecutionMeta = {
    executionId: o.exec, tenantId: o.s.tenant, propertyId: o.s.property, conversationId: o.s.conv, channel: "web", batchId: o.batchId, leaseVersion: o.version,
    modelId: "openai/gpt-5.6-sol", startedAt: now, finishedAt: now, totalMs: 10, leaseMs: 1, contextMs: 1, gatewayMs: 1, validationMs: 1,
    gateway: { ...NO_GATEWAY, calls: o.calls ?? 0, totalTokens: o.tokens ?? 0, costUsd: o.cost ?? "0.00000000", usageSource: o.calls ? "provider" : "none" },
    estimatedInputTokens: null, pauseState: "inactive", executionState: "completed", technicalCode: null, blockCode: null, integrityCode: null,
    budgetExceeded: null, tokenLimitViolation: false, concurrencyDetected: false, forcedDecision: "answer_candidate",
  };
  const ok = validateExecutionRecord(buildExecutionRecord(null, meta, "chain.2026-11-03.3")) as ShadowExecutionRecord;
  const fenced = validateExecutionRecord(
    buildExecutionRecord(null, { ...meta, forcedDecision: "technical_failure", technicalCode: "lease_integrity_failure", executionState: "failed" }, "chain.2026-11-03.3"),
  ) as ShadowExecutionRecord;
  if (!ok || !fenced) throw new Error("fixture inválida");
  return { ok, fenced, okRow: recordToRow(ok), fencedRow: recordToRow(fenced) };
}
