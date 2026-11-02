/**
 * F2-B · B1 — CONTRATOS do shadow (apenas tipos; a implementação operacional é da B3).
 *
 * Gatilho aprovado: coletor + worker assíncrono por cron (nunca o job legado de 15 s). O
 * `slot.server.ts` continua inalterado devolvendo `null`.
 *
 * PRIVACIDADE (decisão vinculante de 02/11/2026): o registro shadow guarda SOMENTE metadados
 * técnicos de observabilidade. Nenhum texto de resposta, rascunho, prompt, mensagem do hóspede
 * ou credencial — por isso não existe nenhum campo de texto livre neste contrato.
 */
import type { LlmErrorCode, LlmUsage } from "@/lib/guest-ai/llm/contracts";
import type { GuestSurface, StayPhase } from "@/lib/guest-ai/types";
import type { FallbackKind, ModelCaseRelation, Strategy, TurnStage, ValidationBlock } from "@/lib/guest-ai/orchestrator/contracts";
import type { CapabilityId } from "@/lib/guest-ai/orchestrator/capabilities";

export type ShadowStatus = "queued" | "running" | "completed" | "fallback" | "failed" | "superseded" | "skipped";

/** Item de fila (B3): identificadores apenas; o conteúdo é sempre relido e revalidado pelo backend. */
export interface ShadowJob {
  runId: string;
  messageId: string;
  conversationId: string;
  surface: GuestSurface;
  status: ShadowStatus;
  attempts: number;
}

/** Resultado persistido de uma execução shadow: metadados técnicos, sem nenhum texto livre. */
export interface ShadowRunRecord {
  runId: string;
  messageId: string;
  conversationId: string;
  propertyId: string | null;
  tenantId: string | null;
  status: ShadowStatus;
  outcome: "draft" | "fallback";
  fallbackKind: FallbackKind | null;
  llmCode: LlmErrorCode | null;
  stage: TurnStage;
  phase: StayPhase | null;
  strategy: Strategy | null;
  caseRelation: ModelCaseRelation | null;
  handoffNeeded: boolean | null;
  credentialIntent: "none" | "would_deliver" | null;
  validatorVerdict: "pass" | "block" | null;
  validatorBlocks: ValidationBlock[];
  capabilityNeeds: CapabilityId[];
  groundedOnCount: number;
  model: string;
  promptVersion: string | null;
  latencyMs: number;
  llmLatencyMs: number | null;
  usage: LlmUsage | null;
  costUsd: number | null;
  /** Sempre true: impossível confundir com uma resposta efetivamente enviada. */
  isShadow: true;
}

/** Porta de persistência (B3 implementa; B1 só define). */
export interface ShadowStore {
  save(record: ShadowRunRecord): Promise<void>;
}
