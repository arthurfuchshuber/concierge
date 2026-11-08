/**
 * Registro central das ferramentas de consulta da IA Guest. Para plugar uma ferramenta nova (clima, voos,
 * visão…): implementar `GuestTool` (spec + parse + execute) e acrescentá-la a `GUEST_TOOLS`. Nada mais
 * muda: o executor, o gerador do Copiloto e o gateway tratam qualquer ferramenta pelo mesmo contrato.
 */
import type { LlmToolSpec } from "@/lib/guest-ai/llm/contracts";
import type { GuestTool, GuestToolContext } from "./contracts";
import { searchCityPlaces } from "./google-places";
import { calculatePropertyDistance } from "./google-routes";

export const GUEST_TOOLS: ReadonlyMap<string, GuestTool<unknown>> = new Map(
  ([searchCityPlaces, calculatePropertyDistance] as GuestTool<unknown>[]).map((t) => [
    t.spec.name,
    Object.freeze(t),
  ]),
);

export function getGuestTool(name: string): GuestTool<unknown> | null {
  return GUEST_TOOLS.get(name) ?? null;
}

/**
 * Ferramentas oferecidas ao modelo neste turno. Sem cidade nem coordenadas do imóvel não há como consultar
 * nada com segurança ⇒ nenhuma. Sem coordenadas, só a busca de lugares (sem distância).
 */
export function toolSpecsFor(ctx: GuestToolContext | null): LlmToolSpec[] {
  if (!ctx || (!ctx.origin && !ctx.city)) return [];
  const specs: LlmToolSpec[] = [searchCityPlaces.spec];
  if (ctx.origin) specs.push(calculatePropertyDistance.spec);
  return specs;
}
