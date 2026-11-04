/**
 * F2-B · B3.1 — LEASE POR CONVERSA: modelo de referência da máquina de estados + contrato do
 * armazenamento distribuído (puro).
 *
 * O armazenamento REAL é o Postgres (`supabase/migrations/20261104000000_guest_ai_conversation_leases.sql`):
 * tabela `guest_ai_conversation_leases` + funções `claim_conversation_lease` (FOR UPDATE SKIP LOCKED +
 * compare-and-swap de versão, token gerado pelo banco) e `transition_conversation_lease` (CAS de
 * versão + token, instantes do banco). O adaptador fica na camada `data/` (lease-store).
 *
 * `applyLeaseEvent` é o MODELO DE REFERÊNCIA: as mesmas regras, na mesma ordem de verificação que as
 * funções SQL. Os testes com Postgres real executam as mesmas sequências nos dois e exigem o mesmo
 * resultado (teste baseado em modelo). O modelo não coordena nada sozinho: só o banco garante
 * exclusividade entre workers.
 *
 * Estados: collecting → ready → claimed → processing → completed | failed | cancelled; claimed/
 * processing com prazo vencido → expired (recuperável por NOVO claim: nova posse, nova versão; o dono
 * anterior perde a autoridade e não pode renovar). Ordem das verificações nos eventos com posse
 * (start/renew/complete/fail): versão → estado com posse → token → prazo vigente → estado específico.
 * Mensagem nova depois do claim nunca entra no lote reivindicado (vai para `deferredMessageIds`).
 * Tentativas: no máximo 3 aquisições efetivas por ciclo; conflito de concorrência não conta.
 */
import { LEASE_GATE_EVIDENCE } from "./lease-gate-evidence";

export const LEASE_VERSION = "lease.2026-11-04.1";

export const LEASE_STATES = ["collecting", "ready", "claimed", "processing", "completed", "expired", "failed", "cancelled"] as const;
export type LeaseState = (typeof LEASE_STATES)[number];
const TERMINAL: ReadonlySet<LeaseState> = new Set(["completed", "failed", "cancelled"]);

export interface LeaseRecord {
  conversationId: string;
  state: LeaseState;
  /** Incrementa a cada transição aceita (compare-and-swap). Linha ausente = versão 0. */
  version: number;
  batchId: string | null;
  messageIds: readonly string[];
  ownerToken: string | null;
  leaseExpiresAt: string | null;
  attempts: number;
  /** Mensagens que chegaram depois do claim (ficam para o próximo ciclo). */
  deferredMessageIds: readonly string[];
  updatedAt: string;
}

export const MAX_ATTEMPTS = 3;
export const MAX_BATCH_MESSAGES = 20;
/** Prazo inicial do lease (diretriz B3.1: 30 s; o banco aceita 5–300 s). */
export const DEFAULT_LEASE_TTL_SECONDS = 30;

export type LeaseEvent =
  | { type: "observe"; messageIds: readonly string[]; now: string; expectedVersion?: number }
  | { type: "mark_ready"; batchId: string; messageIds: readonly string[]; expectedVersion: number; now: string }
  | { type: "claim"; token: string; ttlMs: number; expectedVersion: number; now: string }
  | { type: "start"; token: string; expectedVersion: number; now: string }
  | { type: "renew"; token: string; ttlMs: number; expectedVersion: number; now: string }
  | { type: "complete"; token: string; expectedVersion: number; now: string }
  | { type: "fail"; token: string; retryable: boolean; expectedVersion: number; now: string }
  | { type: "cancel"; expectedVersion: number; now: string; token?: string | null }
  | { type: "expire"; now: string };

export type LeaseRejection =
  | "version_conflict"
  | "invalid_transition"
  | "lease_held"
  | "stale_owner"
  | "lease_expired"
  | "invalid_event"
  | "already_processed"
  | "attempts_exhausted";

export type LeaseResult = { ok: true; record: LeaseRecord; effect: "applied" | "deferred" | "noop" } | { ok: false; reason: LeaseRejection };

export function newLeaseRecord(conversationId: string, now: string): LeaseRecord {
  return { conversationId, state: "collecting", version: 0, batchId: null, messageIds: [], ownerToken: null, leaseExpiresAt: null, attempts: 0, deferredMessageIds: [], updatedAt: now };
}

const t = (v: string | null) => (v ? Date.parse(v) : Number.NaN);
const holding = (r: LeaseRecord) => r.state === "claimed" || r.state === "processing";
const expiredAt = (r: LeaseRecord, now: number) => holding(r) && Number.isFinite(t(r.leaseExpiresAt)) && t(r.leaseExpiresAt) <= now;
const liveAt = (r: LeaseRecord, now: number) => holding(r) && Number.isFinite(t(r.leaseExpiresAt)) && t(r.leaseExpiresAt) > now;

/** Aplica um evento ao modelo. Puro: devolve o registro novo (versão + 1) ou a recusa tipada. */
export function applyLeaseEvent(r: LeaseRecord, e: LeaseEvent): LeaseResult {
  const no = (reason: LeaseRejection): LeaseResult => ({ ok: false, reason });
  if (!r || !e || !Number.isFinite(Date.parse(e.now))) return no("invalid_event");
  const now = Date.parse(e.now);
  const next = (patch: Partial<LeaseRecord>): LeaseResult => ({ ok: true, effect: "applied", record: { ...r, ...patch, version: r.version + 1, updatedAt: e.now } });
  const checkVersion = (v: number) => v === r.version;
  // 'complete' repetido sobre o próprio lote concluído: idempotente e explícito (antes da versão, como no SQL)
  if (e.type === "complete" && r.state === "completed") return no("already_processed");

  switch (e.type) {
    case "observe": {
      // CAS também na observação quando a versão é informada (o banco sempre exige)
      if (e.expectedVersion !== undefined && !checkVersion(e.expectedVersion)) return no("version_conflict");
      const ids = [...new Set(e.messageIds)];
      if (ids.length === 0) return no("invalid_event");
      if (holding(r)) {
        // Nunca altera retroativamente o lote reivindicado: guarda para o próximo ciclo.
        const fresh = ids.filter((id) => !r.messageIds.includes(id) && !r.deferredMessageIds.includes(id));
        if (!fresh.length) return { ok: true, effect: "noop", record: r };
        return { ok: true, effect: "deferred", record: { ...r, deferredMessageIds: [...r.deferredMessageIds, ...fresh], version: r.version + 1, updatedAt: e.now } };
      }
      let carry = ids;
      if (r.state === "completed") {
        carry = ids.filter((id) => !r.messageIds.includes(id));
        if (!carry.length) return { ok: true, effect: "noop", record: r }; // retentativa/duplicata
      }
      return next({ state: "collecting", batchId: null, messageIds: carry, ownerToken: null, leaseExpiresAt: null, deferredMessageIds: [], attempts: TERMINAL.has(r.state) ? 0 : r.attempts });
    }
    case "mark_ready":
      if (!checkVersion(e.expectedVersion)) return no("version_conflict");
      if (r.state !== "collecting") return no("invalid_transition");
      if (!e.batchId || e.messageIds.length === 0 || e.messageIds.length > MAX_BATCH_MESSAGES) return no("invalid_event");
      return next({ state: "ready", batchId: e.batchId, messageIds: [...e.messageIds] });
    case "claim": {
      if (!checkVersion(e.expectedVersion)) return no("version_conflict");
      if (!e.token || !(e.ttlMs > 0)) return no("invalid_event");
      const recover = r.state === "expired" || expiredAt(r, now);
      if (holding(r) && !recover) return no("lease_held");
      if (r.state !== "ready" && !recover) return no("invalid_transition");
      if (r.attempts >= MAX_ATTEMPTS) return no("attempts_exhausted");
      if (!r.batchId || r.messageIds.length === 0) return no("invalid_transition");
      return next({ state: "claimed", ownerToken: e.token, leaseExpiresAt: new Date(now + e.ttlMs).toISOString(), attempts: r.attempts + 1 });
    }
    case "complete":
    case "start":
    case "renew":
    case "fail": {
      if (!checkVersion(e.expectedVersion)) return no("version_conflict");
      if (!holding(r)) return no("invalid_transition");
      if (!e.token || r.ownerToken !== e.token) return no("stale_owner");
      if (!liveAt(r, now)) return no("lease_expired");
      if (e.type === "start") return r.state === "claimed" ? next({ state: "processing" }) : no("invalid_transition");
      if (e.type === "renew") return e.ttlMs > 0 ? next({ leaseExpiresAt: new Date(now + e.ttlMs).toISOString() }) : no("invalid_event");
      if (e.type === "complete") return r.state === "processing" ? next({ state: "completed", ownerToken: null, leaseExpiresAt: null }) : no("invalid_transition");
      return next({ state: e.retryable && r.attempts < MAX_ATTEMPTS ? "ready" : "failed", ownerToken: null, leaseExpiresAt: null });
    }
    case "cancel":
      if (!checkVersion(e.expectedVersion)) return no("version_conflict");
      if (TERMINAL.has(r.state)) return no("invalid_transition");
      // posse vigente só pode ser cancelada pelo próprio dono
      if (liveAt(r, now) && (!e.token || e.token !== r.ownerToken)) return no("stale_owner");
      return next({ state: "cancelled", ownerToken: null, leaseExpiresAt: null });
    case "expire":
      if (!expiredAt(r, now)) return { ok: true, effect: "noop", record: r };
      return next({ state: "expired", ownerToken: null });
    default:
      return no("invalid_event");
  }
}

// ─────────────────────────── Contrato do armazenamento distribuído ───────────────────────────

/** Estado público de um lease (sem o token de posse). */
export interface LeaseSnapshot {
  conversationId: string;
  state: LeaseState;
  version: number;
  batchId: string | null;
  messageIds: readonly string[];
  deferredMessageIds: readonly string[];
  attempts: number;
  leaseExpiresAt: string | null;
}

export type StoreClaimResult =
  | { result: "acquired" | "recovered"; version: number; ownerToken: string; leaseExpiresAt: string; attempts: number; batchId: string; messageIds: readonly string[] }
  | { result: "conflict" | "unavailable" | "stale_version" | "not_claimable" | "attempts_exhausted" | "not_found" | "invalid_argument" | "store_error"; version: number | null };

export type TransitionEvent = "observe" | "mark_ready" | "start" | "renew" | "complete" | "fail" | "cancel" | "expire";
export type StoreTransitionResult =
  | { result: "applied" | "deferred" | "noop" | "already_processed"; version: number; state: LeaseState; batchId?: string | null; messageIds?: readonly string[] }
  | { result: "stale_version" | "stale_owner" | "lease_expired" | "invalid_transition" | "not_found" | "invalid_argument" | "store_error"; version: number | null };

/**
 * Armazenamento transacional: cada operação é UMA chamada a uma função do Postgres que trava a linha,
 * confere versão (e token) e grava. O cliente nunca envia o registro inteiro: só o evento.
 */
export interface DistributedLeaseStore {
  readonly guarantee: "postgres_transactional_row_lock";
  load(conversationId: string): Promise<LeaseSnapshot | null>;
  claim(conversationId: string, expectedVersion: number, ttlSeconds?: number): Promise<StoreClaimResult>;
  transition(
    conversationId: string,
    event: TransitionEvent,
    expectedVersion: number,
    opts?: { ownerToken?: string | null; messageIds?: readonly string[]; retryable?: boolean; ttlSeconds?: number },
  ): Promise<StoreTransitionResult>;
}

export type LeaseBackendStatus =
  | { available: true; store: DistributedLeaseStore }
  | { available: false; reason: "no_store" | "store_without_transactional_guarantee"; dependency: string };

export const LEASE_DEPENDENCY =
  "Migration 20261104000000_guest_ai_conversation_leases aplicada (tabela + claim_/transition_conversation_lease, EXECUTE só service_role) " +
  "e o adaptador da camada data/ (lease-store). A migration ainda NÃO foi aplicada em produção (exige homologação).";

/** Só aceita armazenamento que declara a garantia transacional do Postgres. */
export function resolveLeaseBackend(store?: DistributedLeaseStore | null): LeaseBackendStatus {
  if (!store) return { available: false, reason: "no_store", dependency: LEASE_DEPENDENCY };
  if (store.guarantee !== "postgres_transactional_row_lock") return { available: false, reason: "store_without_transactional_guarantee", dependency: LEASE_DEPENDENCY };
  return { available: true, store };
}

export type ClaimOutcome =
  | { ok: true; claim: Extract<StoreClaimResult, { result: "acquired" | "recovered" }> }
  | { ok: false; reason: "lease_backend_unavailable" | Exclude<StoreClaimResult["result"], "acquired" | "recovered"> };

/**
 * Reivindica o lote pronto de uma conversa: lê o estado (versão) e chama a função atômica do banco.
 * Sem backend transacional ⇒ recusa SEMPRE. Conflito de concorrência não é falha de processamento.
 */
export async function claimReadyBatch(backend: LeaseBackendStatus, args: { conversationId: string; ttlSeconds?: number }): Promise<ClaimOutcome> {
  if (!backend || backend.available !== true || backend.store?.guarantee !== "postgres_transactional_row_lock") return { ok: false, reason: "lease_backend_unavailable" };
  const snap = await backend.store.load(args.conversationId);
  if (!snap) return { ok: false, reason: "not_found" };
  const r = await backend.store.claim(args.conversationId, snap.version, args.ttlSeconds ?? DEFAULT_LEASE_TTL_SECONDS);
  if (r.result === "acquired" || r.result === "recovered") return { ok: true, claim: r };
  return { ok: false, reason: r.result };
}

// ─────────────────────────── Gate B3.1 (derivado de evidência) ───────────────────────────

/** Critérios verificáveis em execução real (Postgres com conexões independentes). */
export const LEASE_RUNTIME_CRITERIA = [
  "migration_applied",
  "rls_and_privileges",
  "skip_locked_real_concurrency",
  "cas_version",
  "stale_owner_rejected",
  "expiry_recovery_new_owner",
  "expired_owner_cannot_renew",
  "retries_capped_at_3",
  "batch_strict_closure",
  "deferred_no_loss_no_dup",
  "different_conversations_parallel",
  "model_matches_database",
  "store_adapter_against_real_db",
] as const;

/**
 * Gate derivado da EVIDÊNCIA gravada pela suíte Postgres real (`b31-lease-pg.test.ts`). Um teste
 * permanente confere que os hashes da evidência batem com a migration e com o adaptador atuais —
 * qualquer mudança invalida o gate até a suíte real rodar de novo. Typecheck, build, mutação e suíte
 * completa são verificados no relatório de entrega (não são observáveis em tempo de execução).
 */
export const B31_LEASE_GATE = Object.freeze({
  distributedLeaseImplemented: true,
  runtimeCriteria: Object.freeze(Object.fromEntries(LEASE_RUNTIME_CRITERIA.map((c) => [c, LEASE_GATE_EVIDENCE.criteria[c] === true]))) as Readonly<Record<(typeof LEASE_RUNTIME_CRITERIA)[number], boolean>>,
  gateComplete: LEASE_RUNTIME_CRITERIA.every((c) => LEASE_GATE_EVIDENCE.criteria[c] === true) && LEASE_GATE_EVIDENCE.migrationSha256.length === 64 && LEASE_GATE_EVIDENCE.storeSha256.length === 64,
});
