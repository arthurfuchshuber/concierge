/**
 * QUALIFICAÇÃO DE UM APRENDIZADO na aprovação (10/11/2026) — núcleo PURO.
 *
 * Temporalidade: `permanent` (segue para aprovação) ou `one_off` (pontual/provisória: é RECUSADO como regra
 * contínua com a justificativa "Situação pontual"). Abrangência (só se permanente): `property` (este imóvel),
 * `city` (todos os imóveis da MESMA conta na mesma cidade) ou `account` (todos os imóveis da conta).
 *
 * Isolamento: réplica só para imóveis do MESMO dono do imóvel de origem, nunca de outra conta; imóvel
 * arquivado fica de fora. Cada réplica passa de novo pelas travas (`evaluateCandidate`) e é aprovada pela RPC de
 * revisão com a sessão de quem decidiu (que confere a permissão imóvel a imóvel).
 */
export type Temporality = "permanent" | "one_off";
export type LearningScope = "property" | "city" | "account";

export const ONE_OFF_NOTE = "Situação pontual";

export interface PropertyRef {
  id: string;
  ownerId: string | null;
  city: string | null;
  archived: boolean;
}

export interface QualificationPlan {
  action: "approve" | "reject";
  note: string | null;
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
  input: { temporality: Temporality; scope: LearningScope; origin: PropertyRef },
  properties: readonly PropertyRef[],
): QualificationPlan {
  if (input.temporality === "one_off") return { action: "reject", note: ONE_OFF_NOTE, replicateTo: [] };
  const o = input.origin;
  if (input.scope === "property" || !o.ownerId) return { action: "approve", note: null, replicateTo: [] };
  const city = normCity(o.city);
  const targets = properties.filter(
    (p) =>
      p.id !== o.id &&
      !p.archived &&
      p.ownerId === o.ownerId &&
      (input.scope === "account" || (city !== "" && normCity(p.city) === city)),
  );
  return { action: "approve", note: null, replicateTo: [...new Set(targets.map((p) => p.id))] };
}
