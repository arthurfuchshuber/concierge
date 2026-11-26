/**
 * Restringe IDs de "quem concluiu" (`cleaning_done_by`, gravável pelo usuário)
 * às pessoas das contas donas dos imóveis consultados: o titular e membros
 * ativos. Evita usar a consulta privilegiada para descobrir nomes de terceiros.
 */
export async function scopeDoneByIds(
  propertyIds: string[],
  doneByIds: string[],
): Promise<{ allowed: string[]; ownerIds: string[] }> {
  if (doneByIds.length === 0 || propertyIds.length === 0) return { allowed: [], ownerIds: [] };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: props } = await supabaseAdmin
    .from("properties")
    .select("owner_id")
    .in("id", propertyIds);
  const ownerIds = Array.from(
    new Set(((props ?? []) as Array<{ owner_id: string | null }>).map((p) => p.owner_id).filter((v): v is string => !!v)),
  );
  if (ownerIds.length === 0) return { allowed: [], ownerIds };
  const { data: members } = await supabaseAdmin
    .from("account_members")
    .select("member_user_id")
    .in("owner_id", ownerIds)
    .eq("status", "active")
    .in("member_user_id", doneByIds);
  const ok = new Set<string>(ownerIds);
  for (const m of (members ?? []) as Array<{ member_user_id: string | null }>)
    if (m.member_user_id) ok.add(m.member_user_id);
  return { allowed: doneByIds.filter((id) => ok.has(id)), ownerIds };
}
