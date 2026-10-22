/**
 * Foto de capa do anúncio do Airbnb: leitura nativa (fetch + meta `og:image`),
 * sem Firecrawl e sem IA — custo zero. Cada imóvel guarda SOMENTE essa foto
 * (`hero_image_url` e `gallery_images = [capa]`).
 */
export function listingIdFromUrl(url: string | null | undefined): string | null {
  const m = String(url ?? "").match(/\/rooms\/(?:plus\/)?(\d{5,})/);
  return m ? m[1]! : null;
}

export function extractCoverFromHtml(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!m) return null;
  const url = m[1]!.replace(/&amp;/g, "&");
  if (!/^https:\/\//.test(url)) return null;
  // Remove o redimensionamento da prévia social para guardar a foto original.
  return url.replace(/\?im_w=\d+.*$/, "");
}

export async function fetchListingCover(listingId: string): Promise<string | null> {
  const res = await fetch(`https://www.airbnb.com.br/rooms/${listingId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  return extractCoverFromHtml(await res.text());
}

/** Revisão diária: atualiza a capa de todos os imóveis com anúncio e mantém só 1 foto. */
export async function refreshAllListingCovers(): Promise<{ checked: number; updated: number; failed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("properties")
    .select("id, airbnb_listing_url, hero_image_url, gallery_images")
    .is("archived_at" as never, null);
  const rows = (data ?? []) as Array<{ id: string; airbnb_listing_url: string | null; hero_image_url: string | null; gallery_images: string[] | null }>;
  const { data: raw } = await supabaseAdmin.from("property_listing_raw_data" as never).select("property_id, airbnb_listing_id");
  const rawMap = new Map(((raw ?? []) as Array<{ property_id: string; airbnb_listing_id: string | null }>).map((r) => [r.property_id, r.airbnb_listing_id]));
  let checked = 0, updated = 0, failed = 0;
  for (const p of rows) {
    const id = listingIdFromUrl(p.airbnb_listing_url) ?? rawMap.get(p.id) ?? null;
    let cover: string | null = null;
    if (id) {
      checked++;
      cover = await fetchListingCover(id);
      if (!cover) failed++;
    }
    cover ??= p.hero_image_url ?? p.gallery_images?.[0] ?? null;
    if (!cover) continue;
    const same = p.hero_image_url === cover && (p.gallery_images ?? []).length === 1 && p.gallery_images![0] === cover;
    if (same) continue;
    const { error } = await supabaseAdmin.from("properties").update({ hero_image_url: cover, gallery_images: [cover] } as never).eq("id", p.id);
    if (!error) updated++;
  }
  return { checked, updated, failed };
}
