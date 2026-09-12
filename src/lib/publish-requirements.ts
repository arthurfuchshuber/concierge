/**
 * Campos obrigatórios para publicar um guia.
 * Usado tanto no cliente (avisos) quanto no servidor (bloqueio real da chave
 * de publicação em /admin/guias e no salvamento do editor).
 */
export type PublishCandidate = Record<string, unknown>;

// Etiqueta (tagline) de guia cujo horário de chegada/saída depende de uma
// reserva real — único tipo para o qual o calendário do Airbnb é exigido
// para publicar (ver regra de "airbnb_ical_url" abaixo). Fonte única do
// valor, reaproveitada por EtiquetaSelect.tsx e pelo editor do imóvel para
// não duplicar a string em vários lugares.
export const ETIQUETA_CHECKIN_CHECKOUT = "Check-In & Check-Out";

export const PUBLISH_REQUIRED_COLUMNS = [
  "property_type_id",
  "maps_url",
  "city",
  "country",
  "airbnb_ical_url",
  "name",
  "slug",
  "tagline",
  "gallery_images",
  "checkin_instructions",
  "checkin_time",
  "checkout_instructions",
  "checkout_time",
] as const;

const RULES: Array<{ key: string; label: string; check: (p: PublishCandidate) => boolean }> = [
  { key: "property_type_id", label: "Tipo do imóvel", check: (p) => !!p.property_type_id },
  { key: "maps_url", label: "Link do Google Maps — Entrada principal", check: (p) => !!str(p.maps_url) },
  { key: "city", label: "Endereço — Cidade", check: (p) => !!str(p.city) },
  { key: "country", label: "Endereço — País", check: (p) => !!str(p.country) },
  {
    key: "airbnb_ical_url",
    label: "URL do calendário Airbnb",
    // Disponível para qualquer plano (ver admin.properties.$id.tsx), mas só
    // é obrigatório para publicar guias do tipo "Check-In & Check-Out" —
    // nos demais tipos de guia, o calendário é opcional.
    check: (p) => str(p.tagline) !== ETIQUETA_CHECKIN_CHECKOUT || !!str(p.airbnb_ical_url),
  },
  { key: "name", label: "Identidade visual — Nome do imóvel", check: (p) => !!str(p.name) },
  { key: "slug", label: "Identidade visual — URL pública", check: (p) => !!str(p.slug) },
  { key: "tagline", label: "Identidade visual — Tipo do guia", check: (p) => !!str(p.tagline) },
  {
    key: "gallery_images",
    label: "Fotos da residência (ao menos 1 foto)",
    check: (p) => Array.isArray(p.gallery_images) && (p.gallery_images as unknown[]).length > 0,
  },
  { key: "checkin_instructions", label: "Instruções de chegada — Passo a passo", check: (p) => !!str(p.checkin_instructions) },
  { key: "checkin_time", label: "Horários de check-in — Check-in a partir de", check: (p) => !!str(p.checkin_time) },
  { key: "checkout_instructions", label: "Instruções de saída — Passo a passo", check: (p) => !!str(p.checkout_instructions) },
  { key: "checkout_time", label: "Horários de check-out — Check-out até", check: (p) => !!str(p.checkout_time) },
];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/** Lista dos rótulos que ainda faltam para o guia poder ser publicado. */
export function missingPublishFields(p: PublishCandidate): string[] {
  return RULES.filter((r) => !r.check(p)).map((r) => r.label);
}

export function publishBlockMessage(missing: string[], propertyName?: string | null): string {
  const who = propertyName ? `“${propertyName}”: ` : "";
  return `${who}Para publicar, preencha antes: ${missing.join(", ")}.`;
}
