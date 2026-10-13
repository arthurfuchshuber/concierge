/**
 * SITUAÇÃO DA INTEGRAÇÃO DE UM IMÓVEL (Ativo / Inativo).
 *
 * Definição oficial (13/10/2026): ATIVO = o imóvel foi marcado/habilitado no
 * ConciergeIA e tem anúncio conectado — linha em `property_listing_raw_data`
 * com `airbnb_listing_id` preenchido (mesma fonte de
 * `getConnectedListingsInventory`, em `channex.functions.ts`). INATIVO = o
 * imóvel existe, mas não está habilitado. Anúncios gêmeos pertencem ao MESMO
 * imóvel físico e portanto compartilham o estado: aqui conta-se imóvel, não
 * anúncio.
 *
 * A chave da IA (`airbnb_ai_enabled`) NÃO entra: ela só liga/pausa as
 * respostas automáticas; um imóvel com a IA desligada continua com a
 * integração ativa.
 *
 * Um ÚNICO lugar decide isso — as telas só leem o resultado.
 */
export type PropertyConnectionRow = {
  property_id: string;
  airbnb_listing_id: string | null;
  synced_at: string | null;
};

export type ConnectionProperty = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
};

export type PropertyIntegrationSummary = {
  activeCount: number;
  inactiveCount: number;
  activeItems: Array<ConnectionProperty & { syncedAt: string | null }>;
  inactiveItems: ConnectionProperty[];
};

export function summarizePropertyIntegration(
  properties: ConnectionProperty[],
  connections: PropertyConnectionRow[],
): PropertyIntegrationSummary {
  const byProp = new Map<string, PropertyConnectionRow>();
  for (const c of connections) if (c.airbnb_listing_id) byProp.set(c.property_id, c);
  const activeItems: PropertyIntegrationSummary["activeItems"] = [];
  const inactiveItems: ConnectionProperty[] = [];
  for (const p of properties) {
    const c = byProp.get(p.id);
    if (c) activeItems.push({ ...p, syncedAt: c.synced_at ?? null });
    else inactiveItems.push(p);
  }
  return {
    activeCount: activeItems.length,
    inactiveCount: inactiveItems.length,
    activeItems,
    inactiveItems,
  };
}
