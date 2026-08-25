/**
 * Campos obrigatórios da aba "A casa" (dados básicos do imóvel): tipo do
 * imóvel, endereço completo e calendário do Airbnb. Compartilhado entre a
 * tela "Novo imóvel", a trava de informações pendentes, o "Salvar" do editor
 * completo (admin.properties.$id.tsx) e o popup de edição rápida
 * (PropertyQuickEditDialog) — sempre a mesma lista, em todo lugar que salva
 * o imóvel, para que as duas telas nunca voltem a divergir.
 *
 * Proprietário é validado à parte (não é um campo de "A casa").
 */
export type HouseFieldsInput = {
  property_type_id: string | null;
  maps_url: string;
  address: string;
  city: string;
  country: string;
  airbnb_ical_url: string | null;
};

export function missingRequiredHouseFields(p: HouseFieldsInput): string[] {
  const missing: string[] = [];
  if (!p.property_type_id) missing.push("Tipo do imóvel");
  if (!p.maps_url.trim()) missing.push("Link do Google Maps (entrada principal)");
  if (!p.address.trim()) missing.push("Endereço");
  if (!p.city.trim()) missing.push("Cidade");
  if (!p.country.trim()) missing.push("País");
  if (!(p.airbnb_ical_url ?? "").trim()) missing.push("URL do calendário Airbnb");
  return missing;
}
