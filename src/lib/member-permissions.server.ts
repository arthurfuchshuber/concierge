import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemberPermission } from "./member-permissions.functions";

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
  if (error) throw new Error("Não foi possível validar as permissões.");
  if (!data) throw new Error("Sem permissão para esta ação.");
}
