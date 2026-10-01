/**
 * Recorte por residência (escopo PROPERTY).
 *
 * Regra do produto: um membro da equipe só enxerga as residências que ele
 * atende. Se nenhuma residência estiver marcada para ele, ele não vê NENHUMA —
 * listas, cards, calendário e indicadores ficam zerados.
 *
 * Retorna:
 *  - `null` quando não há recorte (titular da conta): enxerga tudo da conta.
 *  - `string[]` (possivelmente vazio) com os IDs permitidos.
 *
 * `tenantId` = conta ativa. Obrigatório para quem participa de várias
 * empresas: o recorte sempre é o da conta aberta.
 */
export async function visiblePropertyIds(
  userId: string,
  tenantId?: string | null,
): Promise<string[] | null> {
  if (tenantId && tenantId === userId) return null;
  const { resolveSubjectSnapshot } = await import("./permission.resolve.server");
  const snapshot = await resolveSubjectSnapshot(userId, tenantId ? { tenantId } : {});
  const roles = snapshot.subject.systemRoles ?? [];
  if (!snapshot.subject.isTenantMember) return null;
  if (roles.includes("SYSTEM") || roles.includes("CRON")) return null;
  // Admin do SaaS olhando outra conta: leitura total (auditoria).
  if (roles.includes("ADMIN_SAAS") && snapshot.status !== "active") return null;
  // Vínculo inexistente/revogado nesta conta: nada.
  if (snapshot.status !== "active") return [];
  if (snapshot.allProperties === true) return null;
  return snapshot.properties;
}

/** Aplica o recorte a uma lista de IDs já obtida via RLS. */
export async function filterVisiblePropertyIds(
  userId: string,
  ids: string[],
  tenantId?: string | null,
): Promise<string[]> {
  const allowed = await visiblePropertyIds(userId, tenantId);
  if (allowed === null) return ids;
  const set = new Set(allowed);
  return ids.filter((id) => set.has(id));
}
