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
const MIN_REMAINING_MS = 5 * 60_000;
const FALLBACK_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 4000;
const cache = new Map<string, { url: string; expiresAt: number }>();

/** Validade REAL da URL assinada (claim `exp` do token), não a hora em que chegou. */
function signedExpiry(url: string, now: number): number {
  try {
    const token = new URL(url, "http://x").searchParams.get("token");
    if (token) {
      const part = token.split(".")[1];
      if (part) {
        const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
        if (typeof json.exp === "number") return json.exp * 1000;
      }
    }
  } catch {
    /* sem token legível */
  }
  return now + FALLBACK_TTL_MS;
}

export function stableMediaUrl(storagePath: string | null | undefined, url: string | null): string | null {
  if (!storagePath || !url) return url;
  const now = Date.now();
  const hit = cache.get(storagePath);
  if (hit && hit.expiresAt - now > MIN_REMAINING_MS) return hit.url;
  if (cache.size >= MAX_ENTRIES) {
    for (const k of cache.keys()) {
      cache.delete(k);
      if (cache.size < MAX_ENTRIES * 0.8) break;
    }
  }
  cache.set(storagePath, { url, expiresAt: signedExpiry(url, now) });
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
