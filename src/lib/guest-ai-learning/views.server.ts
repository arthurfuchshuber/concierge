/**
 * Leituras para as telas de aprendizado (10/11/2026): escopo atual (pelas réplicas) de entradas aprovadas.
 * Recebe o cliente de quem chama (sessão: respeita RLS; admin do SaaS: cliente de serviço). Só leitura.
 */
import { inferScope, type LearningScope, type PropertyRef } from "./qualify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from(table: string): any };

export interface OriginEntry {
  id: string;
  propertyId: string;
}

export const isReplica = (refs: unknown): boolean =>
  Array.isArray(refs) && refs.some((r) => typeof r === "string" && r.startsWith("replica:"));

const ref = (p: Record<string, unknown>): PropertyRef => ({
  id: String(p["id"]),
  ownerId: (p["owner_id"] as string | null) ?? null,
  city: (p["city"] as string | null) ?? null,
  archived: !!p["archived_at"],
});

/** Escopo atual e nº de réplicas ativas de cada entrada de origem. Falha de leitura ⇒ "imóvel", 0. */
export async function scopesFor(db: Db, origins: readonly OriginEntry[]): Promise<Map<string, { scope: LearningScope; replicas: number }>> {
  const out = new Map<string, { scope: LearningScope; replicas: number }>();
  for (const o of origins) out.set(o.id, { scope: "property", replicas: 0 });
  if (origins.length === 0) return out;
  try {
    const { data: reps } = await db
      .from("guest_ai_learning_entries")
      .select("property_id, evidence_refs")
      .eq("status", "approved")
      .overlaps("evidence_refs", origins.map((o) => `replica:${o.id}`));
    const byOrigin = new Map<string, string[]>();
    for (const r of (reps ?? []) as Array<Record<string, unknown>>) {
      for (const x of (r["evidence_refs"] as string[] | null) ?? []) {
        if (typeof x === "string" && x.startsWith("replica:")) {
          const id = x.slice(8);
          byOrigin.set(id, [...(byOrigin.get(id) ?? []), String(r["property_id"])]);
        }
      }
    }
    const pids = [...new Set(origins.map((o) => o.propertyId))];
    const { data: originProps } = await db.from("properties").select("id, owner_id, city, archived_at").in("id", pids);
    const origMap = new Map(((originProps ?? []) as Array<Record<string, unknown>>).map((p) => [String(p["id"]), ref(p)]));
    const owners = [...new Set([...origMap.values()].map((p) => p.ownerId).filter((x): x is string => !!x))];
    const { data: ownerProps } = owners.length
      ? await db.from("properties").select("id, owner_id, city, archived_at").in("owner_id", owners)
      : { data: [] };
    const all = ((ownerProps ?? []) as Array<Record<string, unknown>>).map(ref);
    for (const o of origins) {
      const reps2 = byOrigin.get(o.id) ?? [];
      const origin = origMap.get(o.propertyId);
      if (!origin) continue;
      out.set(o.id, { scope: inferScope(origin, reps2, all.filter((p) => p.ownerId === origin.ownerId)), replicas: reps2.length });
    }
  } catch {
    /* mantém "imóvel" */
  }
  return out;
}
