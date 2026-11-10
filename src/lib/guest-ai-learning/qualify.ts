/**
 * ESCOPO de um aprendizado (10/11/2026) — núcleo PURO. `property` (este imóvel), `city` (todos os imóveis da
 * MESMA conta na mesma cidade) ou `account` (todos os imóveis da conta).
 *
 * Isolamento: réplica só para imóveis do MESMO dono do imóvel de origem, nunca de outra conta; imóvel
 * arquivado fica de fora. Cada réplica passa de novo pelas travas (`evaluateCandidate`) e é aprovada pela RPC de
 * revisão com a sessão de quem decidiu (que confere a permissão imóvel a imóvel).
 */
export type LearningScope = "property" | "city" | "account";

export interface PropertyRef {
  id: string;
  ownerId: string | null;
  city: string | null;
  archived: boolean;
}

export interface QualificationPlan {
  /** imóveis que recebem uma réplica aprovada (sem o de origem) */
  replicateTo: string[];
}

const normCity = (c: string | null) =>
  (c ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

export function planQualification(
  input: { scope: LearningScope; origin: PropertyRef },
  properties: readonly PropertyRef[],
): QualificationPlan {
  const o = input.origin;
  if (input.scope === "property" || !o.ownerId) return { replicateTo: [] };
  const city = normCity(o.city);
  const targets = properties.filter(
    (p) =>
      p.id !== o.id &&
      !p.archived &&
      p.ownerId === o.ownerId &&
      (input.scope === "account" || (city !== "" && normCity(p.city) === city)),
  );
  return { replicateTo: [...new Set(targets.map((p) => p.id))] };
}

/**
 * Escopo ATUAL de uma entrada aprovada, deduzido das réplicas ativas (10/11/2026): sem réplica ⇒ imóvel;
 * réplicas só na cidade do imóvel de origem enquanto o dono tem imóveis em outras cidades ⇒ cidade; senão ⇒ conta.
 */
export function inferScope(origin: PropertyRef, replicaPropertyIds: readonly string[], ownerProperties: readonly PropertyRef[]): LearningScope {
  if (replicaPropertyIds.length === 0) return "property";
  const city = normCity(origin.city);
  const byId = new Map(ownerProperties.map((p) => [p.id, p]));
  const allSameCity = replicaPropertyIds.every((id) => normCity(byId.get(id)?.city ?? null) === city);
  const otherCities = ownerProperties.some((p) => p.id !== origin.id && !p.archived && normCity(p.city) !== city);
  return allSameCity && city !== "" && otherCities ? "city" : "account";
}

export const SCOPE_LABEL: Record<LearningScope, string> = { property: "Imóvel", city: "Cidade", account: "Conta" };
