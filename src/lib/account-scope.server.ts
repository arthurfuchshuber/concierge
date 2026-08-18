import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve a conta efetiva sem jamais confiar apenas no identificador enviado
 * pelo navegador. Uma conta solicitada só é aceita para o próprio titular,
 * membro ativo da conta ou administrador SaaS.
 */
export async function resolveAuthorizedAccountOwnerId(
  supabase: SupabaseClient,
  userId: string,
  requestedOwnerId?: string | null,
): Promise<string> {
  if (requestedOwnerId) {
    if (requestedOwnerId === userId) return userId;

    const [{ data: isAdmin, error: adminError }, { data: membership, error: membershipError }] =
      await Promise.all([
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
        supabase
          .from("account_members")
          .select("id")
          .eq("owner_id", requestedOwnerId)
          .eq("member_user_id", userId)
          .eq("status", "active")
          .maybeSingle(),
      ]);

    if (adminError) throw new Error("Não foi possível validar o acesso à conta.");
    if (membershipError) throw new Error("Não foi possível validar o vínculo com a conta.");
    if (isAdmin || membership) return requestedOwnerId;
    throw new Error("Acesso negado à conta solicitada.");
  }

  const [{ data: own }, { data: memberships }] = await Promise.all([
    supabase.from("properties").select("id").eq("owner_id", userId).limit(1),
    supabase
      .from("account_members")
      .select("owner_id")
      .eq("member_user_id", userId)
      .eq("status", "active"),
  ]);

  if ((own ?? []).length > 0) return userId;
  const ownerIds = Array.from(new Set((memberships ?? []).map((row) => String(row.owner_id))));
  if (ownerIds.length === 1) return ownerIds[0];
  return userId;
}
/**
 * Perfil pessoal: nunca herda a conta por vínculo implícito de equipe.
 * Só usa outro titular quando explicitamente solicitado (impersonação) e autorizado.
 */
export async function resolveProfileOwnerId(
  supabase: SupabaseClient,
  userId: string,
  requestedOwnerId?: string | null,
): Promise<string> {
  if (!requestedOwnerId || requestedOwnerId === userId) return userId;
  return resolveAuthorizedAccountOwnerId(supabase, userId, requestedOwnerId);
}
