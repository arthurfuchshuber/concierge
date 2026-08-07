/**
 * Recorte por residência (escopo PROPERTY).
 *
 * Regra do produto: um membro da equipe só enxerga as residências que ele
 * atende. Se nenhuma residência estiver marcada para ele, ele não vê NENHUMA —
 * listas, cards e indicadores ficam zerados, mesmo com permissão de edição.
 *
 * Retorna:
 *  - `null` quando não há recorte (titular da conta ou admin do SaaS fora de
 *    uma conta): enxerga tudo o que a RLS permitir.
 *  - `string[]` (possivelmente vazio) com os IDs permitidos.
 */
export async function visiblePropertyIds(userId: string): Promise<string[] | null> {
  const { resolveSubjectSnapshot } = await import("./permission.resolve.server");
  const snapshot = await resolveSubjectSnapshot(userId);
  const roles = snapshot.subject.systemRoles ?? [];
  const isMember = snapshot.subject.isTenantMember;
  if (!isMember) return null;
  if (roles.includes("SYSTEM") || roles.includes("CRON")) return null;
  // Sem nenhuma residência marcada, o recorte não se aplica: quem tem
  // permissão de visualização/edição enxerga tudo o que a conta possui.
  // O recorte por residência só vale quando alguma foi escolhida.
  if (snapshot.properties.length === 0) return null;
  return snapshot.properties;
}

/** Aplica o recorte a uma lista de IDs já obtida via RLS. */
export async function filterVisiblePropertyIds(
  userId: string,
  ids: string[],
): Promise<string[]> {
  const allowed = await visiblePropertyIds(userId);
  if (allowed === null) return ids;
  const set = new Set(allowed);
  return ids.filter((id) => set.has(id));
}
