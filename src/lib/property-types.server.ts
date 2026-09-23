import type { SupabaseClient } from "@supabase/supabase-js";

export type PropertyType = { id: string; slug: string; label: string };

export const DEFAULT_PROPERTY_TYPES: Array<{ slug: string; label: string }> = [
  { slug: "casa", label: "Casa" },
  { slug: "apartamento", label: "Apartamento" },
  { slug: "chale", label: "Chalé" },
  { slug: "studio", label: "Studio" },
  { slug: "flat-kitnet", label: "Flat / Kitnet" },
  { slug: "pousada", label: "Pousada" },
  { slug: "sitio-fazenda", label: "Sítio / Fazenda" },
  { slug: "outros", label: "Outros" },
];

export function slugifyPropertyType(v: string) {
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
