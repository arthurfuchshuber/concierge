import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberPermission } from "./member-permissions.functions";

const MEMBER_PERMISSION_DEFAULTS: Record<MemberPermission, boolean> = {
  library_view: true,
  library_edit: false,
  ai_view: true,
  ai_train: false,
  chat_view: true,
  chat_respond: false,
  operation_view: true,
  operation_edit: false,
  guests_view: true,
  guests_edit: false,
  clients_manage: false,
  trial_manage: false,
  pricing_override: false,
};

/**
 * Server-side guard: throws if the caller does not have `permission`
 * within `ownerId`'s account. The owner themselves always passes.
 * Uses the SQL security-definer function `public.has_member_permission`.
 */
export async function requireMemberPermission(
  supabase: SupabaseClient,
  userId: string,
  ownerId: string,
  permission: MemberPermission,
): Promise<void> {
  if (userId === ownerId) return;
  const { data, error } = await supabase.rpc("has_member_permission", {
    _user_id: userId,
    _owner_id: ownerId,
    _permission: permission,
  });
  if (!error) {
    if (!data) throw new Error("Sem permissão para esta ação.");
    return;
  }

  // Fallback server-side para o caso de a chamada RPC ser bloqueada por grant/cache.
  // Mantém a hierarquia correta: só passa se o usuário for membro ativo da conta
  // alvo e a permissão explícita/default dessa conta permitir a ação.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: member, error: memberError } = await supabaseAdmin
    .from("account_members")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("member_user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (memberError) throw new Error("Não foi possível validar as permissões.");
  if (!member) throw new Error("Sem permissão para esta ação.");

  const { data: row, error: rowError } = await supabaseAdmin
    .from("account_member_permissions")
    .select("granted")
    .eq("owner_id", ownerId)
    .eq("member_user_id", userId)
    .eq("permission", permission)
    .maybeSingle();
  if (rowError) throw new Error("Não foi possível validar as permissões.");

  const granted = row ? !!row.granted : MEMBER_PERMISSION_DEFAULTS[permission];
  if (!granted) throw new Error("Sem permissão para esta ação.");
}
