import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { searchAddressCandidatesGoogle } from "@/lib/maps.functions";

export type AddressSuggestion = {
  label: string;
  address: string;
  district: string;
  city: string;
  state: string;
  cep: string;
  // Campos extras (pedido explícito, 06/09/2026): só preenchidos quando quem
  // chamou precisa de coordenada/link do Maps (ex.: endereço do imóvel). O
  // formulário de Prestadores/Proprietários ignora esses campos normalmente,
  // então adicioná-los aqui não muda nada pra quem já consumia este tipo.
  lat: number | null;
  lng: number | null;
  country: string;
  maps_url: string | null;
  place_id: string | null;
};

/**
 * Autocompletar de endereço enquanto a pessoa digita — usado tanto pelo
 * campo de endereço de Prestadores/Proprietários quanto pelo campo
 * "Endereço" do imóvel (ver `AddressAutocomplete`, compartilhado pelos dois).
 * Pedido explícito (06/09/2026): trocar o provedor de Nominatim/OpenStreetMap
 * pelo Google Places, o mesmo já usado no resto do sistema (recomendações,
 * link do Maps do imóvel) — resultado mais preciso e consistente, e já traz
 * lat/lng prontos (sem precisar de uma segunda chamada de geocodificação).
 */
export const searchBrAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ q: z.string().trim().min(3).max(160) }).parse(i))
  .handler(async ({ data }): Promise<AddressSuggestion[]> => {
    try {
      const results = await searchAddressCandidatesGoogle(data.q);
      return results.map((r) => ({
        label: r.label,
        address: r.address,
        district: r.district,
        city: r.city,
        state: r.state,
        cep: r.cep,
        lat: r.lat,
        lng: r.lng,
        country: r.country,
        maps_url: r.maps_url,
        place_id: r.place_id,
      }));
    } catch {
      // Silencioso: a pessoa pode preencher manualmente (mesmo racional de antes).
      return [];
    }
  });
