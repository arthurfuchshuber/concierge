/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Dados bancários da empresa: o titular, os membros ativos da conta e o admin SaaS conectam e enxergam.
// `ownerId` é a conta em tela; o servidor valida o acesso e grava SEMPRE sob o titular, nunca sob o membro.

export const listBankConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ ownerId: z.string().uuid().nullish() }).parse(raw ?? {}))
  .handler(async ({ data: input, context }) => {
    // Mesma resolução de conta das demais integrações (titular, membro ativo ou admin SaaS):
    // o status de Bancos/Asaas PJ tem que refletir a conta que está na tela.
    const { resolveManagedAccountOwnerId } = await import("@/lib/account-scope.server");
    const userId = await resolveManagedAccountOwnerId(context.supabase, context.userId, input.ownerId);
    const supabase =
      userId === context.userId
        ? context.supabase
        : ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as typeof context.supabase);
    const [{ data: items }, { data: accounts }] = await Promise.all([
      supabase
        .from("malvo_items")
        .select("malvo_item_id, connector_name, status, execution_status, last_updated_at, consent_expires_at, environment, last_synced_at")
        .eq("account_owner_id", userId)
        .is("deleted_at", null)
        .order("created_at"),
      supabase
        .from("malvo_accounts")
        .select("malvo_account_id, malvo_item_id, name, marketing_name, type, subtype, number, bank_data, balance, currency_code, balance_updated_at")
        .eq("account_owner_id", userId),
    ]);
    const { count } = await supabase
      .from("malvo_transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_owner_id", userId)
      .is("deleted_at", null);
    return { items: items ?? [], accounts: accounts ?? [], transactions: count ?? 0 };
  });

export const getBankConnectToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ itemId: z.string().max(100).optional(), ownerId: z.string().uuid().nullish() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { createConnectToken } = await import("@/lib/malvo.server");
    const { resolveManagedAccountOwnerId } = await import("@/lib/account-scope.server");
    const owner = await resolveManagedAccountOwnerId(context.supabase, context.userId, data.ownerId);
    if (data.itemId) await assertOwnItem(owner, data.itemId);
    return { connectToken: await createConnectToken(owner, data.itemId) };
  });

/** `ownerId` já foi autorizado por resolveManagedAccountOwnerId; a RLS esconde as linhas do titular de um membro, então a conferência usa o cliente administrativo. */
async function assertOwnItem(ownerId: string, itemId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("malvo_items")
    .select("malvo_item_id")
    .eq("malvo_item_id", itemId)
    .eq("account_owner_id", ownerId)
    .maybeSingle();
  if (!data) throw new Error("Conexão bancária não encontrada.");
}

/** Chamado logo após o widget concluir (best-effort; o webhook continua sendo a fonte da verdade). */
export const syncBankConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ itemId: z.string().min(1).max(100), ownerId: z.string().uuid().nullish() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { malvoFetch, syncMalvoItem } = await import("@/lib/malvo.server");
    const { resolveManagedAccountOwnerId } = await import("@/lib/account-scope.server");
    const owner = await resolveManagedAccountOwnerId(context.supabase, context.userId, data.ownerId);
    // Checa o dono real ignorando RLS: item de outra conta é rejeitado mesmo invisível ao chamador.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: known } = await supabaseAdmin
      .from("malvo_items")
      .select("account_owner_id")
      .eq("malvo_item_id", data.itemId)
      .maybeSingle();
    if (known && (known as { account_owner_id: string }).account_owner_id !== owner) {
      throw new Error("Conexão bancária não encontrada.");
    }
    if (!known) {
      // Conexão recém-criada: só aceita se o próprio Malvo disser que é deste usuário.
      const item = await malvoFetch(`/items/${encodeURIComponent(data.itemId)}`);
      if (!item || item.clientUserId !== owner) throw new Error("Conexão bancária não encontrada.");
    }
    return syncMalvoItem(data.itemId, owner);
  });

export const disconnectBank = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ itemId: z.string().min(1).max(100), ownerId: z.string().uuid().nullish() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { resolveManagedAccountOwnerId } = await import("@/lib/account-scope.server");
    const owner = await resolveManagedAccountOwnerId(context.supabase, context.userId, data.ownerId);
    await assertOwnItem(owner, data.itemId);
    const { malvoFetch } = await import("@/lib/malvo.server");
    await malvoFetch(`/items/${encodeURIComponent(data.itemId)}`, { method: "DELETE" });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("malvo_items")
      .update({ deleted_at: new Date().toISOString() } as never)
      .eq("malvo_item_id", data.itemId)
      .eq("account_owner_id", owner);
    return { ok: true };
  });
