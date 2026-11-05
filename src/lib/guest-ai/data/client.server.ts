/**
 * ÚNICO arquivo de `guest-ai/` autorizado a importar o cliente administrativo.
 * O teste `data-boundary.test.ts` quebra o build se outro arquivo (fora de
 * `__tests__`) mencionar `supabaseAdmin` ou `client.server` do Supabase.
 *
 * O cliente NUNCA sai deste módulo "solto": só as funções de `data/` o usam,
 * sempre com projeções explícitas e depois de um `ValidatedTurn`.
 */

/** Superfície mínima do cliente usada pelo módulo de dados (permite injetar um banco falso nos testes). */
export interface GuestAiDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

/**
 * E4 GLOBAL — FACHADA SOMENTE LEITURA (decisão D9: obrigatória antes do primeiro tick real).
 *
 * O cliente administrativo (service_role, BYPASSRLS) NUNCA sai deste módulo com capacidade de escrita:
 *  - só as tabelas de `GUEST_AI_READ_TABLES` (as que o módulo lê hoje; qualquer outra é recusada antes
 *    de qualquer requisição);
 *  - do construtor de consulta só `select` existe; `insert`, `update`, `upsert`, `delete` e qualquer
 *    outro método lançam `GuestAiReadOnlyError` sem tocar no cliente subjacente (nenhuma requisição sai);
 *  - nenhum acesso a `rpc`, `schema`, `storage`, `auth`, `functions` ou `channel`: a fachada só tem `from`.
 * As ÚNICAS escritas do módulo continuam sendo as portas de RPC de lista fechada (lease, Shadow e, desde
 * 05/11/2026, a geração do Copiloto).
 * Limite honesto: protege contra DEFEITO do código; não protege contra o vazamento da chave service_role
 * (para isso, o papel dedicado no banco — pendência D9b).
 */
export const GUEST_AI_READ_TABLES = [
  "airbnb_accounts",
  "audit_logs",
  "channex_raw_records",
  "channex_twin_links",
  "guest_ai_conversation_leases",
  "guest_arrival_status",
  "guide_access_logs",
  "properties",
  "property_chat_conversations",
  "property_chat_messages",
  "property_checkout_items",
  "property_emergency_contacts",
  "property_faqs",
  "property_listing_raw_data",
  "property_manual_items",
  "property_playbook_entries",
  "property_recommendations",
  "property_reservations",
] as const;
export type GuestAiReadTable = (typeof GUEST_AI_READ_TABLES)[number];

export class GuestAiReadOnlyError extends Error {
  readonly code: "table_not_allowed" | "write_not_allowed";
  constructor(code: "table_not_allowed" | "write_not_allowed") {
    super(code);
    this.name = "GuestAiReadOnlyError";
    this.code = code;
  }
}

/** Envolve QUALQUER cliente com `from` numa fachada só de leitura (exportada para os testes). */
export function readOnlyGuestAiDb(client: GuestAiDb): GuestAiDb {
  return Object.freeze({
    from(table: string) {
      if (!(GUEST_AI_READ_TABLES as readonly string[]).includes(table)) throw new GuestAiReadOnlyError("table_not_allowed");
      const builder = client.from(table);
      return new Proxy(builder, {
        get(target, prop) {
          if (prop === "select") return (Reflect.get(target, prop, target) as (...a: unknown[]) => unknown).bind(target);
          // não é "thenable" nem expõe símbolos do construtor (nada além de `select` sai da fachada)
          if (prop === "then" || typeof prop === "symbol") return undefined;
          return () => {
            throw new GuestAiReadOnlyError("write_not_allowed");
          };
        },
        set() {
          return false;
        },
      });
    },
  });
}

export async function getGuestAiDb(): Promise<GuestAiDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return readOnlyGuestAiDb(supabaseAdmin as unknown as GuestAiDb);
}

/**
 * B3.1 — ÚNICA porta de ESCRITA do módulo: as duas funções atômicas do lease distribuído
 * (`claim_conversation_lease`, `transition_conversation_lease`; EXECUTE só para service_role). Lista
 * fechada: qualquer outro nome é recusado aqui, antes de sair do processo. Só servidor.
 */
export const LEASE_RPC_FUNCTIONS = ["claim_conversation_lease", "transition_conversation_lease"] as const;
export type LeaseRpcFunction = (typeof LEASE_RPC_FUNCTIONS)[number];
export interface GuestAiLeaseRpc {
  call(fn: LeaseRpcFunction, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

/** Cliente com `rpc`; o construtor devolvido pode aceitar `.abortSignal` (PostgREST). */
export interface RpcCapableClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> & { abortSignal?: (s: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }> };
}

/**
 * B3.3: `signal` opcional (retrocompatível — sem ele, comportamento idêntico ao B3.1). Com ele, a
 * chamada é recusada se o prazo já acabou (nenhuma requisição sai) e o sinal é anexado ao construtor
 * PostgREST, que aborta o `fetch` em andamento.
 */
export function leaseRpcFrom(client: RpcCapableClient, signal?: AbortSignal): GuestAiLeaseRpc {
  return {
    async call(fn, args) {
      if (!(LEASE_RPC_FUNCTIONS as readonly string[]).includes(fn)) return { data: null, error: { code: "lease_rpc_not_allowed" } };
      if (signal?.aborted) return { data: null, error: { code: "aborted" } };
      const q = client.rpc(fn, args);
      return await (signal && typeof q.abortSignal === "function" ? q.abortSignal(signal) : q);
    },
  };
}

export async function getGuestAiLeaseRpc(signal?: AbortSignal): Promise<GuestAiLeaseRpc> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return leaseRpcFrom(supabaseAdmin as unknown as RpcCapableClient, signal);
}

/**
 * B3.3 — porta das funções do Shadow (migration `20261104120000_guest_ai_shadow`, EXECUTE só
 * service_role). Lista FECHADA; qualquer outro nome é recusado antes de sair do processo. Só o
 * adaptador `data/shadow-store.server.ts` a usa. Nenhuma escrita direta em tabela existe no módulo.
 */
export const SHADOW_RPC_FUNCTIONS = [
  "shadow_get_control",
  "shadow_trip",
  "shadow_reserve_budget",
  "shadow_evaluate_breakers",
  "shadow_record_execution",
  // E3.1: tick único, reivindicação+início, finalização atômica e reconciliação
  "shadow_acquire_tick",
  "shadow_release_tick",
  "shadow_claim_execution",
  "shadow_finalize_execution",
  "shadow_reconcile",
  // E4 global: porta do imóvel e candidatas escolhidas no banco (só leitura)
  "shadow_property_status",
  "shadow_list_candidates",
] as const;
export type ShadowRpcFunction = (typeof SHADOW_RPC_FUNCTIONS)[number];
export interface GuestAiShadowRpc {
  call(fn: ShadowRpcFunction, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export function shadowRpcFrom(client: RpcCapableClient, signal?: AbortSignal): GuestAiShadowRpc {
  return {
    async call(fn, args) {
      if (!(SHADOW_RPC_FUNCTIONS as readonly string[]).includes(fn)) return { data: null, error: { code: "shadow_rpc_not_allowed" } };
      if (signal?.aborted) return { data: null, error: { code: "aborted" } };
      const q = client.rpc(fn, args);
      return await (signal && typeof q.abortSignal === "function" ? q.abortSignal(signal) : q);
    },
  };
}

export async function getGuestAiShadowRpc(signal?: AbortSignal): Promise<GuestAiShadowRpc> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return shadowRpcFrom(supabaseAdmin as unknown as RpcCapableClient, signal);
}

/**
 * COPILOTO (diretriz de 05/11/2026) — terceira porta de escrita, também de LISTA FECHADA: só as RPCs de
 * GERAÇÃO da migration `20261105150000_guest_ai_copilot_suggestions` (EXECUTE só service_role). As ações do
 * atendente (editar, descartar, enviar) NÃO passam por aqui: correm com o cliente da SESSÃO do usuário
 * (`copilot.functions.ts`), para que a autoria seja `auth.uid()`. Só o adaptador `copilot/store.server.ts` usa esta porta.
 */
export const COPILOT_RPC_FUNCTIONS = ["copilot_claim_generation", "copilot_generation_state", "copilot_store_result", "copilot_purge_expired"] as const;
export type CopilotRpcFunction = (typeof COPILOT_RPC_FUNCTIONS)[number];
export interface GuestAiCopilotRpc {
  call(fn: CopilotRpcFunction, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export function copilotRpcFrom(client: RpcCapableClient, signal?: AbortSignal): GuestAiCopilotRpc {
  return {
    async call(fn, args) {
      if (!(COPILOT_RPC_FUNCTIONS as readonly string[]).includes(fn)) return { data: null, error: { code: "copilot_rpc_not_allowed" } };
      if (signal?.aborted) return { data: null, error: { code: "aborted" } };
      const q = client.rpc(fn, args);
      return await (signal && typeof q.abortSignal === "function" ? q.abortSignal(signal) : q);
    },
  };
}

export async function getGuestAiCopilotRpc(signal?: AbortSignal): Promise<GuestAiCopilotRpc> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return copilotRpcFrom(supabaseAdmin as unknown as RpcCapableClient, signal);
}

/** O turno foi cancelado (prazo do Orchestrator ou cancelamento externo) antes de terminar a leitura. */
export class GuestAiAbortedError extends Error {
  readonly code = "aborted" as const;
  constructor() {
    super("aborted");
    this.name = "GuestAiAbortedError";
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new GuestAiAbortedError();
}

/**
 * F2-B · cancelamento real das leituras do turno. Devolve um cliente que:
 *  - recusa ABRIR nova consulta depois do cancelamento (`GuestAiAbortedError`, nenhuma requisição sai);
 *  - anexa o `signal` a toda consulta (`.abortSignal(signal)` do PostgREST), que o repassa ao `fetch`:
 *    o cancelamento interrompe a requisição HTTP em andamento do lado do cliente.
 * Sem `signal`, devolve o próprio cliente (comportamento F0/F1 inalterado). Só leitura: o módulo
 * de dados não tem escrita alguma (teste estático), então uma consulta que termine depois do
 * cancelamento não tem efeito colateral — o resultado é descartado por quem chamou.
 */
export function abortableDb(db: GuestAiDb, signal?: AbortSignal): GuestAiDb {
  if (!signal) return db;
  return {
    from(table: string) {
      throwIfAborted(signal);
      const builder = db.from(table);
      return new Proxy(builder, {
        get(target, prop) {
          const value = Reflect.get(target, prop, target);
          if (typeof value !== "function") return value;
          if (prop === "select") {
            return (...args: unknown[]) => {
              const query = value.apply(target, args);
              return query && typeof query.abortSignal === "function" ? query.abortSignal(signal) : query;
            };
          }
          return value.bind(target);
        },
      });
    },
  };
}
