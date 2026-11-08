/**
 * Registro central das ferramentas de consulta da IA Guest (lugares, trajetos, clima, voos). Para plugar uma
 * ferramenta nova: implementar `GuestTool` (spec + parse + execute) e acrescentá-la a `GUEST_TOOLS`. Nada mais
 * muda: o executor, o gerador do Copiloto e o gateway tratam qualquer ferramenta pelo mesmo contrato.
 */
import type { LlmToolSpec } from "@/lib/guest-ai/llm/contracts";
import type { GuestTool, GuestToolContext, ToolAvailability } from "./contracts";
import { searchCityPlaces } from "./google-places";
import { calculatePropertyDistance } from "./google-routes";
import { getWeatherForecast } from "./weather";
import { getFlightStatus } from "./flights";

export const GUEST_TOOLS: ReadonlyMap<string, GuestTool<unknown>> = new Map(
  ([searchCityPlaces, calculatePropertyDistance, getWeatherForecast, getFlightStatus] as GuestTool<unknown>[]).map((t) => [
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
export function toolSpecsFor(
  ctx: GuestToolContext | null,
  availability: ToolAvailability = { weather: false, flights: false },
): LlmToolSpec[] {
  if (!ctx || (!ctx.origin && !ctx.city)) return [];
  const specs: LlmToolSpec[] = [searchCityPlaces.spec];
  if (ctx.origin) specs.push(calculatePropertyDistance.spec);
  // Etapa 3 (08/11/2026): clima precisa das coordenadas do imóvel; voos só com o segredo configurado.
  if (ctx.origin && availability.weather) specs.push(getWeatherForecast.spec);
  if (availability.flights) specs.push(getFlightStatus.spec);
  return specs;
}
