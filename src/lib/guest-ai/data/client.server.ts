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

export async function getGuestAiDb(): Promise<GuestAiDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as GuestAiDb;
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

export function leaseRpcFrom(client: { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }): GuestAiLeaseRpc {
  return {
    async call(fn, args) {
      if (!(LEASE_RPC_FUNCTIONS as readonly string[]).includes(fn)) return { data: null, error: { code: "lease_rpc_not_allowed" } };
      return await client.rpc(fn, args);
    },
  };
}

export async function getGuestAiLeaseRpc(): Promise<GuestAiLeaseRpc> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return leaseRpcFrom(supabaseAdmin as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> });
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
