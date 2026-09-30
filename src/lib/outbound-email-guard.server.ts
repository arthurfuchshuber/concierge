import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Só quem responde pela conta (titular, co-titular ativo ou admin SaaS) pode
 * disparar e-mails de convite/acesso para endereços externos. Impede que um
 * membro delegado use a conta para mandar e-mails a pessoas arbitrárias.
 */
export async function requireOutboundEmailAuthority(
  supabase: SupabaseClient,
  userId: string,
  ownerId: string,
): Promise<void> {
  if (userId === ownerId) return;
  const [{ data: isAdmin }, { data: member }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase
      .from("account_members")
      .select("role")
      .eq("owner_id", ownerId)
      .eq("member_user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  if (isAdmin || (member as { role?: string } | null)?.role === "owner") return;
  throw new Error("Somente o titular da conta pode enviar convites e liberar acessos.");
}
