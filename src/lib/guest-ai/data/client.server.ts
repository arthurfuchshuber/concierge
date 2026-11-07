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

/** Única chamada `rpc` do módulo: sempre atrás de uma lista FECHADA conferida pelo adaptador. */
async function invokeRpc(client: RpcCapableClient, fn: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ data: unknown; error: unknown }> {
  if (signal?.aborted) return { data: null, error: { code: "aborted" } };
  const q = client.rpc(fn, args);
  return await (signal && typeof q.abortSignal === "function" ? q.abortSignal(signal) : q);
}

export function copilotRpcFrom(client: RpcCapableClient, signal?: AbortSignal): GuestAiCopilotRpc {
  return {
    async call(fn, args) {
      if (!(COPILOT_RPC_FUNCTIONS as readonly string[]).includes(fn)) return { data: null, error: { code: "copilot_rpc_not_allowed" } };
      return await invokeRpc(client, fn, args, signal);
    },
  };
}

/**
 * GATE G2 · AUDITORIA das ações operacionais: as ÚNICAS RPCs são as de registro em `guest_ai_ops_actions`
 * (EXECUTE só service_role). A escrita nos cards NÃO passa por este módulo: é feita fora dele
 * (`src/lib/guest-ai-ops-apply.server.ts`) com as rotinas oficiais do painel.
 */
export const OPS_RPC_FUNCTIONS = [
  "guest_ai_ops_record",
  "guest_ai_ops_claim",
  "guest_ai_ops_finish",
] as const;
export type OpsRpcFunction = (typeof OPS_RPC_FUNCTIONS)[number];
export interface GuestAiOpsRpc {
  call(fn: OpsRpcFunction, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export function opsRpcFrom(client: RpcCapableClient, signal?: AbortSignal): GuestAiOpsRpc {
  return {
    async call(fn, args) {
      if (!(OPS_RPC_FUNCTIONS as readonly string[]).includes(fn)) return { data: null, error: { code: "ops_rpc_not_allowed" } };
      return await invokeRpc(client, fn, args, signal);
    },
  };
}

export async function getGuestAiOpsRpc(signal?: AbortSignal): Promise<GuestAiOpsRpc> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return opsRpcFrom(supabaseAdmin as unknown as RpcCapableClient, signal);
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

/**
 * COPILOTO · VISÃO — leitura de anexos do hóspede no storage, RESTRITA ao bucket `chat-attachments` e só
 * a `download` (nenhuma escrita, listagem, URL assinada ou outro bucket). Caminho inválido (absoluto, com
 * `..`, vazio ou longo demais) é recusado sem consulta. Falha devolve `null`; nunca lança nem registra o
 * caminho. Só `data/guest-images.server.ts` usa esta porta.
 */
export const GUEST_AI_ATTACHMENT_BUCKET = "chat-attachments";
export interface GuestAiAttachmentStorage {
  download(path: string, signal?: AbortSignal): Promise<Uint8Array | null>;
}
interface StorageCapableClient {
  storage: {
    from(bucket: string): {
      download(path: string, options?: unknown): Promise<{ data: Blob | null; error: unknown }>;
    };
  };
}
const SAFE_ATTACHMENT_PATH = /^[\w-][\w.\-/]{0,511}$/;

export function attachmentStorageFrom(client: StorageCapableClient): GuestAiAttachmentStorage {
  return {
    async download(path, signal) {
      if (typeof path !== "string" || !SAFE_ATTACHMENT_PATH.test(path) || path.includes("..") || path.includes("//"))
        return null;
      if (signal?.aborted) return null;
      try {
        const { data, error } = await client.storage.from(GUEST_AI_ATTACHMENT_BUCKET).download(path);
        if (error || !data || signal?.aborted) return null;
        return new Uint8Array(await data.arrayBuffer());
      } catch {
        return null;
      }
    },
  };
}

export async function getGuestAiAttachmentStorage(): Promise<GuestAiAttachmentStorage> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return attachmentStorageFrom(supabaseAdmin as unknown as StorageCapableClient);
}
