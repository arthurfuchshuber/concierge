/**
 * F2-B · B3.1 — ADAPTADOR do lease distribuído (`DistributedLeaseStore`) sobre o Postgres.
 *
 * Única peça do módulo que ESCREVE no banco, e só pelas duas funções atômicas autorizadas
 * (`claim_conversation_lease`, `transition_conversation_lease`), via `GuestAiLeaseRpc` de
 * `client.server.ts` (lista fechada de funções). A leitura do estado usa projeção explícita SEM o token
 * de posse. O token só existe no retorno do claim e é devolvido ao chamador (nunca logado nem
 * persistido aqui). Instantes, tokens, versões e travas são do banco: este arquivo só traduz.
 *
 * Resposta fora do formato esperado ⇒ `store_error` (nunca interpretada como sucesso).
 */
import type { DistributedLeaseStore, LeaseSnapshot, LeaseState, StoreClaimResult, StoreTransitionResult, TransitionEvent } from "@/lib/guest-ai/batch/lease";
import { DEFAULT_LEASE_TTL_SECONDS, LEASE_STATES } from "@/lib/guest-ai/batch/lease";
import { getGuestAiDb, getGuestAiLeaseRpc, type GuestAiDb, type GuestAiLeaseRpc } from "./client.server";
import { cols } from "./projections";

export const LEASE_TABLE = "guest_ai_conversation_leases";
/** Sem `owner_token`: a posse nunca é lida de volta. */
export const LEASE_SNAPSHOT_COLUMNS = ["conversation_id", "state", "version", "batch_id", "message_ids", "deferred_message_ids", "attempts", "lease_expires_at"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const isState = (v: unknown): v is LeaseState => typeof v === "string" && (LEASE_STATES as readonly string[]).includes(v);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const uuids = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string" && UUID.test(x)) ? (v as string[]) : null);

const CLAIM_FAILS = ["conflict", "unavailable", "stale_version", "not_claimable", "attempts_exhausted", "not_found", "invalid_argument"] as const;
const TRANSITION_OKS = ["applied", "deferred", "noop", "already_processed"] as const;
const TRANSITION_FAILS = ["stale_version", "stale_owner", "lease_expired", "invalid_transition", "not_found", "invalid_argument", "pending_overflow"] as const;

export function parseClaim(data: unknown): StoreClaimResult {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || typeof d.result !== "string") return { result: "store_error", version: null };
  if (d.result === "acquired" || d.result === "recovered") {
    const version = int(d.version);
    const attempts = int(d.attempts);
    const ids = uuids(d.message_ids);
    if (version === null || attempts === null || !ids || ids.length === 0 || typeof d.owner_token !== "string" || !TOKEN.test(d.owner_token) || typeof d.batch_id !== "string" || !UUID.test(d.batch_id) || typeof d.lease_expires_at !== "string" || d.state !== "claimed") {
      return { result: "store_error", version: null };
    }
    return { result: d.result, version, ownerToken: d.owner_token, leaseExpiresAt: d.lease_expires_at, attempts, batchId: d.batch_id, messageIds: ids };
  }
  if ((CLAIM_FAILS as readonly string[]).includes(d.result)) return { result: d.result as (typeof CLAIM_FAILS)[number], version: int(d.version) };
  return { result: "store_error", version: null };
}

export function parseTransition(data: unknown): StoreTransitionResult {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || typeof d.result !== "string") return { result: "store_error", version: null };
  if ((TRANSITION_OKS as readonly string[]).includes(d.result)) {
    const version = int(d.version);
    if (version === null || !isState(d.state)) return { result: "store_error", version: null };
    const out: StoreTransitionResult = { result: d.result as (typeof TRANSITION_OKS)[number], version, state: d.state };
    if (typeof d.batch_id === "string") out.batchId = d.batch_id;
    const ids = uuids(d.message_ids);
    if (ids) out.messageIds = ids;
    return out;
  }
  if ((TRANSITION_FAILS as readonly string[]).includes(d.result)) return { result: d.result as (typeof TRANSITION_FAILS)[number], version: int(d.version) };
  return { result: "store_error", version: null };
}

export function createDistributedLeaseStore(deps: { rpc: GuestAiLeaseRpc; db: GuestAiDb }): DistributedLeaseStore {
  return {
    guarantee: "postgres_transactional_row_lock",
    async load(conversationId: string): Promise<LeaseSnapshot | null> {
      if (!UUID.test(conversationId)) return null;
      const { data, error } = await deps.db.from(LEASE_TABLE).select(cols(LEASE_SNAPSHOT_COLUMNS)).eq("conversation_id", conversationId).maybeSingle();
      if (error) throw new Error("lease_load_failed");
      const r = data as Record<string, unknown> | null;
      if (!r) return null;
      const version = int(r.version);
      const attempts = int(r.attempts);
      if (r.conversation_id !== conversationId || !isState(r.state) || version === null || attempts === null) throw new Error("lease_load_invalid");
      return {
        conversationId,
        state: r.state,
        version,
        batchId: typeof r.batch_id === "string" ? r.batch_id : null,
        messageIds: uuids(r.message_ids ?? []) ?? [],
        deferredMessageIds: uuids(r.deferred_message_ids ?? []) ?? [],
        attempts,
        leaseExpiresAt: typeof r.lease_expires_at === "string" ? r.lease_expires_at : null,
      };
    },
    async claim(conversationId, expectedVersion, ttlSeconds = DEFAULT_LEASE_TTL_SECONDS): Promise<StoreClaimResult> {
      try {
        const { data, error } = await deps.rpc.call("claim_conversation_lease", { p_conversation_id: conversationId, p_expected_version: expectedVersion, p_ttl_seconds: ttlSeconds });
        if (error) return { result: "store_error", version: null };
        return parseClaim(data);
      } catch {
        return { result: "store_error", version: null };
      }
    },
    async transition(conversationId, event: TransitionEvent, expectedVersion, opts = {}): Promise<StoreTransitionResult> {
      try {
        const { data, error } = await deps.rpc.call("transition_conversation_lease", {
          p_conversation_id: conversationId,
          p_event: event,
          p_expected_version: expectedVersion,
          p_owner_token: opts.ownerToken ?? null,
          p_message_ids: opts.messageIds ? [...opts.messageIds] : null,
          p_retryable: typeof opts.retryable === "boolean" ? opts.retryable : null,
          p_ttl_seconds: opts.ttlSeconds ?? DEFAULT_LEASE_TTL_SECONDS,
        });
        if (error) return { result: "store_error", version: null };
        return parseTransition(data);
      } catch {
        return { result: "store_error", version: null };
      }
    },
  };
}

/** Fábrica do servidor (cliente administrativo de `client.server.ts`). Não é importada por produção. */
export async function getDistributedLeaseStore(): Promise<DistributedLeaseStore> {
  return createDistributedLeaseStore({ rpc: await getGuestAiLeaseRpc(), db: await getGuestAiDb() });
}
