import type { SupabaseClient } from "@supabase/supabase-js";

export type ProviderCategory = { id: string; slug: string; label: string };

export const DEFAULT_PROVIDER_CATEGORIES: Array<{ slug: string; label: string }> = [
  { slug: "limpeza", label: "Limpeza" },
  { slug: "manutencao", label: "Manutenção" },
  { slug: "portaria", label: "Portaria" },
  { slug: "lavanderia", label: "Lavanderia" },
  { slug: "jardinagem", label: "Jardinagem" },
  { slug: "piscina", label: "Piscina" },
  { slug: "outros", label: "Outros" },
];

export function slugifyCategory(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/** Conta ativa: a própria (se o usuário tem guias) ou a única da qual é membro. */
export async function resolveAccountOwnerId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const [{ data: own }, { data: memberships }] = await Promise.all([
    supabase.from("properties").select("id").eq("owner_id", userId).limit(1),
    supabase
      .from("account_members")
      .select("owner_id")
      .eq("member_user_id", userId)
      .eq("status", "active"),
  ]);
  if ((own ?? []).length > 0) return userId;
  const ids = Array.from(new Set((memberships ?? []).map((m) => m.owner_id as string)));
  if (ids.length === 1) return ids[0];
  return userId;
}
