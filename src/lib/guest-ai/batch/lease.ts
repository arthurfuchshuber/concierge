/**
 * F2-B · B3.1 — LEASE POR CONVERSA: máquina de estados e contrato de persistência (puro).
 *
 * ESTADO DA GARANTIA DISTRIBUÍDA: **NÃO DISPONÍVEL nesta etapa.** O schema atual (inspecionado em
 * 03/11/2026) não tem estrutura compatível para um lease persistente e transacional por conversa:
 *  - nenhuma tabela de fila/lease/lock por conversa (só `channex_unit_locks`, lock de NEGÓCIO por
 *    imóvel da conexão Channex — reutilizá-la mudaria a semântica de outro fluxo);
 *  - nenhuma função SQL de claim (`FOR UPDATE SKIP LOCKED`/advisory lock) exposta ao PostgREST; o
 *    Worker fala com o banco só por HTTP (uma transação por requisição), então lock de sessão não
 *    atravessa o processamento;
 *  - `property_chat_conversations.ai_reply_due_at/ai_reply_ctx` pertencem à IA antiga (proibido).
 * A diretriz proíbe criar tabela/coluna/função/migration e proíbe substituir por lock em memória.
 * Por isso este módulo entrega SÓ: (1) a máquina de estados com versão, token e expiração — a mesma
 * que o armazenamento transacional vai aplicar com compare-and-swap; (2) o contrato do
 * armazenamento; (3) `resolveLeaseBackend()`, que responde `unavailable` e faz o coletor recusar
 * qualquer claim. Nenhum armazenamento em memória é oferecido como substituto.
 *
 * Estados (B3.0): collecting → ready → claimed → processing → completed | failed | cancelled;
 * claimed/processing com prazo vencido → expired (recuperável por novo claim). Toda transição exige
 * a versão esperada (compare-and-swap) e, depois do claim, o token do dono: conclusão tardia de um
 * worker antigo nunca sobrescreve o estado atual. Mensagem nova durante a coleta reinicia a janela;
 * depois do claim ela NÃO entra no lote reivindicado (fica para o próximo ciclo).
 */
export const LEASE_VERSION = "lease.2026-11-03.1";

export const LEASE_STATES = ["collecting", "ready", "claimed", "processing", "completed", "expired", "failed", "cancelled"] as const;
export type LeaseState = (typeof LEASE_STATES)[number];
const TERMINAL: ReadonlySet<LeaseState> = new Set(["completed", "failed", "cancelled"]);

export interface LeaseRecord {
  conversationId: string;
  state: LeaseState;
  /** Incrementa a cada transição aceita (compare-and-swap). */
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

export type LeaseEvent =
  | { type: "observe"; messageIds: readonly string[]; now: string }
  | { type: "mark_ready"; batchId: string; messageIds: readonly string[]; expectedVersion: number; now: string }
  | { type: "claim"; token: string; ttlMs: number; expectedVersion: number; now: string }
  | { type: "start"; token: string; expectedVersion: number; now: string }
  | { type: "complete"; token: string; expectedVersion: number; now: string }
  | { type: "fail"; token: string; retryable: boolean; expectedVersion: number; now: string }
  | { type: "cancel"; expectedVersion: number; now: string }
  | { type: "expire"; now: string };

export type LeaseRejection =
  | "version_conflict"
  | "invalid_transition"
  | "lease_held"
  | "stale_owner"
  | "lease_expired"
  | "invalid_event"
  | "already_processed";

export type LeaseResult = { ok: true; record: LeaseRecord; effect: "applied" | "deferred" | "noop" } | { ok: false; reason: LeaseRejection };

export function newLeaseRecord(conversationId: string, now: string): LeaseRecord {
  return { conversationId, state: "collecting", version: 0, batchId: null, messageIds: [], ownerToken: null, leaseExpiresAt: null, attempts: 0, deferredMessageIds: [], updatedAt: now };
}

const t = (v: string | null) => (v ? Date.parse(v) : Number.NaN);
const expiredAt = (r: LeaseRecord, now: number) => (r.state === "claimed" || r.state === "processing") && Number.isFinite(t(r.leaseExpiresAt)) && t(r.leaseExpiresAt) <= now;

/** Aplica um evento. Puro: devolve o registro novo (versão + 1) ou a recusa tipada. */
export function applyLeaseEvent(r: LeaseRecord, e: LeaseEvent): LeaseResult {
  const no = (reason: LeaseRejection): LeaseResult => ({ ok: false, reason });
  if (!r || !e || !Number.isFinite(Date.parse(e.now))) return no("invalid_event");
  const now = Date.parse(e.now);
  const next = (patch: Partial<LeaseRecord>): LeaseResult => ({ ok: true, effect: "applied", record: { ...r, ...patch, version: r.version + 1, updatedAt: e.now } });
  const checkVersion = (v: number) => v === r.version;

  switch (e.type) {
    case "observe": {
      const ids = [...new Set(e.messageIds)];
      if (r.state === "claimed" || r.state === "processing") {
        // Nunca altera retroativamente o lote reivindicado: guarda para o próximo ciclo.
        const fresh = ids.filter((id) => !r.messageIds.includes(id) && !r.deferredMessageIds.includes(id));
        if (!fresh.length) return { ok: true, effect: "noop", record: r };
        return { ok: true, effect: "deferred", record: { ...r, deferredMessageIds: [...r.deferredMessageIds, ...fresh], version: r.version + 1, updatedAt: e.now } };
      }
      if (r.state === "completed" && ids.every((id) => r.messageIds.includes(id))) return { ok: true, effect: "noop", record: r }; // retentativa/duplicata
      if (TERMINAL.has(r.state) || r.state === "expired" || r.state === "ready" || r.state === "collecting") {
        // Novo ciclo (ou reinício da janela): o lote pronto deixa de valer.
        const carry = TERMINAL.has(r.state) ? ids.filter((id) => !(r.state === "completed" && r.messageIds.includes(id))) : ids;
        return next({ state: "collecting", batchId: null, messageIds: carry, ownerToken: null, leaseExpiresAt: null, deferredMessageIds: [], attempts: TERMINAL.has(r.state) ? 0 : r.attempts });
      }
      return no("invalid_transition");
    }
    case "mark_ready":
      if (!checkVersion(e.expectedVersion)) return no("version_conflict");
      if (r.state !== "collecting" || !e.batchId || e.messageIds.length === 0) return no("invalid_transition");
      return next({ state: "ready", batchId: e.batchId, messageIds: [...e.messageIds] });
    case "claim": {
      if (!checkVersion(e.expectedVersion)) return no("version_conflict");
      if (!e.token || !(e.ttlMs > 0)) return no("invalid_event");
      const recover = r.state === "expired" || expiredAt(r, now);
      if (r.state === "claimed" || r.state === "processing") {
        if (!recover) return no("lease_held");
      } else if (r.state !== "ready" && r.state !== "expired") return no("invalid_transition");
      if (r.attempts >= MAX_ATTEMPTS) return no("invalid_transition");
      return next({ state: "claimed", ownerToken: e.token, leaseExpiresAt: new Date(now + e.ttlMs).toISOString(), attempts: r.attempts + 1 });
    }
    case "start":
      if (!checkVersion(e.expectedVersion)) return no("version_conflict");
      if (r.state !== "claimed") return no("invalid_transition");
      if (r.ownerToken !== e.token) return no("stale_owner");
      if (expiredAt(r, now)) return no("lease_expired");
      return next({ state: "processing" });
    case "complete":
      if (r.state === "completed") return no("already_processed");
      if (!checkVersion(e.expectedVersion)) return no("version_conflict");
      if (r.state !== "processing") return no("invalid_transition");
      if (r.ownerToken !== e.token) return no("stale_owner");
      if (expiredAt(r, now)) return no("lease_expired");
      return next({ state: "completed", ownerToken: null, leaseExpiresAt: null });
    case "fail":
      if (!checkVersion(e.expectedVersion)) return no("version_conflict");
      if (r.state !== "processing" && r.state !== "claimed") return no("invalid_transition");
      if (r.ownerToken !== e.token) return no("stale_owner");
      if (e.retryable && r.attempts < MAX_ATTEMPTS) return next({ state: "ready", ownerToken: null, leaseExpiresAt: null });
      return next({ state: "failed", ownerToken: null, leaseExpiresAt: null });
    case "cancel":
      if (!checkVersion(e.expectedVersion)) return no("version_conflict");
      if (TERMINAL.has(r.state)) return no("invalid_transition");
      return next({ state: "cancelled", ownerToken: null, leaseExpiresAt: null });
    case "expire":
      if (!expiredAt(r, now)) return { ok: true, effect: "noop", record: r };
      return next({ state: "expired", ownerToken: null });
    default:
      return no("invalid_event");
  }
}

// ─────────────────────────── Contrato do armazenamento distribuído ───────────────────────────

/**
 * Armazenamento transacional exigido (a implementar quando houver schema autorizado): cada operação é
 * UMA transação no Postgres que lê a linha da conversa com `FOR UPDATE SKIP LOCKED`, aplica
 * `applyLeaseEvent` e grava só se a versão ainda for a esperada.
 */
export interface DistributedLeaseStore {
  readonly guarantee: "postgres_transactional_row_lock";
  load(conversationId: string): Promise<LeaseRecord | null>;
  compareAndSwap(expectedVersion: number, next: LeaseRecord): Promise<"swapped" | "version_conflict" | "locked">;
}

export type LeaseBackendStatus =
  | { available: true; store: DistributedLeaseStore }
  | { available: false; reason: "no_compatible_schema"; dependency: string };

export const LEASE_DEPENDENCY =
  "Tabela própria de lease por conversa (conversation_id único, state, version, batch_id, message_ids, owner_token, lease_expires_at, attempts) " +
  "+ função SQL de claim/transição com FOR UPDATE SKIP LOCKED e compare-and-swap de versão, sem grants a anon/authenticated. Exige autorização de migration.";

/** Única fonte do backend de lease. Nesta etapa: indisponível (sem schema autorizado). */
export function resolveLeaseBackend(): LeaseBackendStatus {
  return { available: false, reason: "no_compatible_schema", dependency: LEASE_DEPENDENCY };
}

/** Status declarado do gate: sem lease distribuído comprovado, a B3.1 NÃO está concluída. */
export const B31_LEASE_GATE = Object.freeze({ distributedLeaseImplemented: false, gateComplete: false });

export type ClaimOutcome =
  | { ok: true; record: LeaseRecord }
  | { ok: false; reason: "lease_backend_unavailable" | "lease_held" | "version_conflict" | "locked" | "not_ready" | "invalid" };

/**
 * Reivindica o lote pronto de uma conversa pelo armazenamento distribuído. Sem backend disponível ⇒
 * recusa SEMPRE (`lease_backend_unavailable`): nenhum processamento pode começar.
 */
export async function claimReadyBatch(backend: LeaseBackendStatus, args: { conversationId: string; token: string; ttlMs: number; now: string }): Promise<ClaimOutcome> {
  if (!backend || backend.available !== true || backend.store?.guarantee !== "postgres_transactional_row_lock") return { ok: false, reason: "lease_backend_unavailable" };
  const current = await backend.store.load(args.conversationId);
  if (!current || current.conversationId !== args.conversationId) return { ok: false, reason: "not_ready" };
  const r = applyLeaseEvent(current, { type: "claim", token: args.token, ttlMs: args.ttlMs, expectedVersion: current.version, now: args.now });
  if (!r.ok) return { ok: false, reason: r.reason === "lease_held" ? "lease_held" : r.reason === "version_conflict" ? "version_conflict" : r.reason === "invalid_transition" ? "not_ready" : "invalid" };
  const swap = await backend.store.compareAndSwap(current.version, r.record);
  if (swap !== "swapped") return { ok: false, reason: swap };
  return { ok: true, record: r.record };
}
