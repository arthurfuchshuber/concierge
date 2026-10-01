/**
 * Campos obrigatórios da aba "A casa" (dados básicos do imóvel): tipo do
 * imóvel, endereço completo e calendário do Airbnb. Compartilhado entre a
 * tela "Novo imóvel", a trava de informações pendentes e o "Salvar" do editor
 * completo (admin.properties.$id.tsx) — inclusive no modo "houseOnly" usado
 * pelo link "Editar" do imóvel em Stakeholders, já que é a MESMA tela (sem
 * página/componente duplicado) — sempre a mesma lista, em todo lugar que
 * salva o imóvel.
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
  // Cidade e País não são pedidos à parte desde 01/10/2026: são travados no
  // editor e preenchidos pelo ENDEREÇO completo (que esta lista já exige) —
  // e também pelo Importar do Airbnb. Continuam obrigatórios para PUBLICAR
  // (publish-requirements).
  if (!(p.airbnb_ical_url ?? "").trim()) missing.push("URL do calendário Airbnb");
  return missing;
}
