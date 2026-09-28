/** Baixa as fotos externas do anúncio (Airbnb) e guarda uma cópia no
 *  armazenamento do próprio sistema, para o guia nunca depender do link
 *  do Airbnb (que pode sair do ar). Foto que falhar ao baixar é descartada
 *  — nunca salvamos um link quebrado. Arquivo original, sem compressão. */
const BUCKET = "property-images";

function isOwnStorage(url: string) {
  return /\/storage\/v1\/object\/(?:public|sign|authenticated)\/property-images\//.test(url);
}

function hiRes(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("muscache.com")) u.searchParams.delete("im_w");
    return u.toString();
  } catch {
    return url;
  }
}

export async function mirrorExternalPhotos(
  urls: string[],
  folder: string,
  opts: { replaceFolder?: boolean } = {},
): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const storage = supabaseAdmin.storage.from(BUCKET);
  // Arquivos anteriores da pasta: só são apagados DEPOIS que o novo lote
  // baixou com sucesso — nunca deixamos o imóvel sem fotos.
  let previous: string[] = [];
  if (opts.replaceFolder) {
    const { data } = await storage.list(folder, { limit: 1000 });
    previous = (data ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`);
  }
  const out: string[] = [];
  const newPaths = new Set<string>();
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url) continue;
    if (isOwnStorage(url)) {
      out.push(url);
      continue;
    }
    try {
      let res = await fetch(hiRes(url));
      if (!res.ok) res = await fetch(url);
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "image/jpeg";
      if (!type.startsWith("image/")) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength < 1000) continue;
      const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await storage.upload(path, buf, { contentType: type, upsert: false });
      if (error) continue;
      newPaths.add(path);
      const { data } = await storage.createSignedUrl(path, 60 * 60 * 24 * 7);
      if (data?.signedUrl) out.push(data.signedUrl);
    } catch {
      // descarta a foto que não baixou
    }
  }
  if (opts.replaceFolder && newPaths.size > 0) {
    const stale = previous.filter((p) => !newPaths.has(p));
    if (stale.length) await storage.remove(stale).catch(() => undefined);
  }
  return out;
}
