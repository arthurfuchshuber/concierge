import { toast } from "sonner";

/** Campos do imóvel usados pela aba "Imóveis" (menu ⋯ e janela de informações). */
export type PropertyListItem = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  owner_contact_id?: string | null;
  hero_image_url?: string | null;
  gallery_images?: string[] | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  maps_url?: string | null;
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  lock_code?: string | null;
  checkin_time?: string | null;
  checkout_time?: string | null;
  airbnb_guest_count?: number | null;
  airbnb_bedroom_count?: number | null;
  airbnb_bed_count?: number | null;
  airbnb_listing_url?: string | null;
  published?: boolean | null;
  guide_created?: boolean | null;
  slug: string;
  /** Preenchido pela lista: id do anúncio na conexão com o Airbnb. */
  airbnbListingId?: string | null;
};

/** Endereço completo em uma linha: "Rua, 1200 — Cidade/UF". */
export function fullAddressOf(p: PropertyListItem): string {
  const place = [p.city, p.state].filter(Boolean).join("/");
  return [p.address, place].filter(Boolean).join(" — ");
}

/** Link do Google Maps: o salvo no imóvel; senão coordenadas; senão busca pelo endereço. */
export function mapsLinkOf(p: PropertyListItem): string | null {
  if (p.maps_url) return p.maps_url;
  if (p.lat != null && p.lng != null)
    return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  const addr = fullAddressOf(p);
  return addr
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`
    : null;
}

/** Anúncio no Airbnb: a URL salva ou, na falta dela, a do id da conexão. */
export function airbnbUrlOf(p: PropertyListItem): string | null {
  if (p.airbnb_listing_url) return p.airbnb_listing_url;
  if (p.airbnbListingId) return `https://www.airbnb.com.br/rooms/${p.airbnbListingId}`;
  return null;
}

/** "Guia ativo" = guia criado e publicado. Sem ele o menu oferece "Criar Guia Digital". */
export function hasActiveGuide(p: PropertyListItem): boolean {
  return !!p.guide_created && !!p.published && !!p.slug;
}

export function openPublicGuide(slug: string) {
  if (typeof window === "undefined") return;
  window.open(`${window.location.origin}/g/${slug}`, "_blank", "noopener,noreferrer");
}

export function copyText(value: string, okMessage: string) {
  navigator.clipboard
    .writeText(value)
    .then(() => toast.success(okMessage))
    .catch(() => toast.error("Não foi possível copiar"));
}
