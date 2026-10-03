/**
 * URL ESTÁVEL POR ARQUIVO, NO NAVEGADOR (03/10/2026).
 *
 * A lista de Registros é relida a cada minuto, ao voltar para a aba e a cada
 * aviso ao vivo, e cada leitura traz URLs assinadas novas. Para o navegador,
 * URL nova = imagem nova: o cache era ignorado e todo quadradinho piscava e
 * baixava de novo. Aqui lembramos a PRIMEIRA URL de cada arquivo e a
 * devolvemos nas leituras seguintes — mesma URL, cache do navegador, imagem na
 * hora. A URL assinada vale 1h; reaproveitamos por 40 min, com folga.
 */
const TTL_MS = 40 * 60_000;
const MAX_ENTRIES = 4000;
const cache = new Map<string, { url: string; at: number }>();

export function stableMediaUrl(storagePath: string | null | undefined, url: string | null): string | null {
  if (!storagePath || !url) return url;
  const now = Date.now();
  const hit = cache.get(storagePath);
  if (hit && now - hit.at < TTL_MS) return hit.url;
  if (cache.size >= MAX_ENTRIES) {
    for (const k of cache.keys()) {
      cache.delete(k);
      if (cache.size < MAX_ENTRIES * 0.8) break;
    }
  }
  cache.set(storagePath, { url, at: now });
  return url;
}

/**
 * Aquece o cache do navegador com as imagens que vão aparecer primeiro, para
 * que, quando o cartão pintar, o arquivo já esteja baixado e decodificado.
 */
const warmed = new Set<string>();
export function warmImages(urls: ReadonlyArray<string | null | undefined>, max = 24): void {
  if (typeof window === "undefined") return;
  let n = 0;
  for (const u of urls) {
    if (!u || warmed.has(u)) continue;
    if (n++ >= max) break;
    warmed.add(u);
    const img = new Image();
    img.decoding = "async";
    img.src = u;
  }
}
