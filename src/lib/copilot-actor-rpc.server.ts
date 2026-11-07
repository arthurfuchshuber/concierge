/**
 * COPILOTO · Gate G1 (decisão do titular D2, 06/11/2026) — RPCs das AÇÕES DO ATENDENTE com ator explícito.
 *
 * As RPCs `copilot_actor_*` só podem ser executadas por `service_role` (migration
 * `20261107000000_copilot_g1a_actor_rpcs.sql`). Nenhum navegador as alcança: só as Server Functions do TanStack
 * Start, depois de `requireSupabaseAuth` validar a sessão. O ator (`p_actor`) é SEMPRE o usuário da sessão
 * validada (`context.userId`), nunca um valor vindo do pedido. Acesso ao imóvel, permissão `chat_respond`,
 * token de envio e vínculo da mensagem continuam conferidos no banco, sobre `p_actor`.
 *
 * Só servidor: carregado por import dinâmico; o cliente administrativo nunca entra no bundle do navegador.
 */

export const COPILOT_ACTOR_RPC = {
  edit: "copilot_actor_edit",
  discard: "copilot_actor_discard",
  claimSend: "copilot_actor_claim_send",
  finishSend: "copilot_actor_finish_send",
  reconcileSend: "copilot_actor_reconcile_send",
} as const;
export type CopilotActorRpcName = (typeof COPILOT_ACTOR_RPC)[keyof typeof COPILOT_ACTOR_RPC];

/** Cliente com `rpc` (na produção, o cliente administrativo `service_role`). */
export interface CopilotActorDb {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export type CopilotActorRpcResult = Record<string, unknown> & { result?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cliente administrativo do servidor (padrão das ações do atendente). */
export async function defaultCopilotActorDb(): Promise<CopilotActorDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as CopilotActorDb;
}

/**
 * Chama uma RPC do atendente como `service_role`, com `p_actor` = usuário da sessão validada.
 * Ator ausente ou malformado ⇒ erro antes de qualquer chamada (fail-closed). Erro do banco ⇒ código fechado.
 */
export async function copilotActorRpc(
  db: CopilotActorDb,
  fn: CopilotActorRpcName,
  actor: string,
  args: Record<string, unknown>,
): Promise<CopilotActorRpcResult> {
  if (typeof actor !== "string" || !UUID.test(actor)) throw new Error("copilot_actor_invalid");
  // o ator da sessão vem por último: nenhum argumento do chamador o substitui
  const { data, error } = await db.rpc(fn, { ...args, p_actor: actor });
  if (error) throw new Error(`copilot_rpc_failed:${fn}`);
  return (typeof data === "object" && data !== null ? data : {}) as CopilotActorRpcResult;
}
