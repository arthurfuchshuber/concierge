/**
 * Tenant Isolation Layer.
 *
 * Toda leitura/escrita da IA acontece dentro de um tenant (empresa). O tenant
 * é o dono da conta (`owner_id` do imóvel): usuários, imóveis, hóspedes,
 * memórias, conhecimento e agentes de uma empresa nunca podem cruzar para
 * outra. Este módulo é o único lugar autorizado a resolver e validar o tenant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fronteira de conhecimento (Tenant Knowledge Boundary):
 *   property → owner_portfolio → company_tenant → global
 * Uma informação nunca sobe além do escopo em que foi registrada.
 */
export type KnowledgeScope = "property" | "owner_portfolio" | "company_tenant" | "global";

export const SCOPE_ORDER: KnowledgeScope[] = ["property", "owner_portfolio", "company_tenant", "global"];

export type TenantContext = {
  /** Empresa (conta proprietária). */
  tenantId: string;
  /** Dono da carteira — hoje igual ao tenant; separado para evolução. */
  ownerId: string;
  propertyId: string | null;
};

export class TenantBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantBoundaryError";
  }
}

/** Resolve o tenant a partir de um imóvel. */
export async function resolveTenantByProperty(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<TenantContext> {
  const { data, error } = await supabase
    .from("properties")
    .select("id, owner_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (error || !data?.owner_id) {
    throw new TenantBoundaryError(`Tenant não resolvido para o imóvel ${propertyId}`);
  }
  return { tenantId: String(data.owner_id), ownerId: String(data.owner_id), propertyId: String(data.id) };
}

/** Deriva o tenant de um registro já carregado (evita ida ao banco). */
export function tenantOf(property: Record<string, unknown>): TenantContext {
  const ownerId = String(property.owner_id ?? "");
  if (!ownerId) throw new TenantBoundaryError("Imóvel sem owner_id — tenant indefinido");
  return { tenantId: ownerId, ownerId, propertyId: property.id ? String(property.id) : null };
}

/** Falha ruidosamente se um registro de outro tenant entrar no pipeline. */
export function assertSameTenant(ctx: TenantContext, recordTenantId: string | null | undefined, what: string): void {
  if (!recordTenantId) return; // registro legado, ainda sem tenant atribuído
  if (recordTenantId !== ctx.tenantId) {
    throw new TenantBoundaryError(`Vazamento de tenant bloqueado em ${what}`);
  }
}

/** Remove qualquer item que não pertença ao tenant atual. */
export function filterByTenant<T extends { tenant_id?: string | null; owner_id?: string | null }>(
  ctx: TenantContext,
  rows: T[] | null | undefined,
): T[] {
  return (rows ?? []).filter((r) => {
    const t = r.tenant_id ?? r.owner_id ?? null;
    return !t || t === ctx.tenantId;
  });
}

/**
 * Uma memória só pode ser usada se o escopo em que foi gravada alcança o
 * consumidor atual. Nada privado de um imóvel vaza para a carteira, e nada
 * privado de uma empresa vaza para o sistema global.
 */
export function scopeReaches(
  memoryScope: KnowledgeScope,
  memoryPropertyId: string | null,
  ctx: TenantContext,
): boolean {
  switch (memoryScope) {
    case "property":
      return !!memoryPropertyId && memoryPropertyId === ctx.propertyId;
    case "owner_portfolio":
      return true; // já filtrado por tenant/owner na consulta
    case "company_tenant":
      return true;
    case "global":
      return true;
    default:
      return false;
  }
}

/** Campos de tenant que devem acompanhar toda escrita da IA. */
export function tenantColumns(ctx: TenantContext): { tenant_id: string; owner_id: string } {
  return { tenant_id: ctx.tenantId, owner_id: ctx.ownerId };
}
