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

/** Cliente com `rpc`; o construtor devolvido pode aceitar `.abortSignal` (PostgREST). */
export interface RpcCapableClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> & { abortSignal?: (s: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }> };
}

/**
 * COPILOTO (diretriz de 05/11/2026) — ÚNICA porta de escrita do módulo, de LISTA FECHADA: só as RPCs de
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
