/**
 * Compressão leve de FOTOS no próprio celular antes do envio (12/10/2026).
 * Fotos de 8-12 MB viram ~1 MB com nitidez de sobra para auditoria (lado
 * maior 2560px, JPEG/WebP 0,85). Qualquer falha devolve o arquivo original —
 * nunca impede um envio. Vídeos não passam por aqui.
 */
const MAX_LADO = 2560;
const LIMITE_BYTES = 1_500_000;

export async function comprimirImagem(blob: Blob, mime: string): Promise<Blob> {
  if (typeof document === "undefined") return blob;
  if (mime !== "image/jpeg" && mime !== "image/webp") return blob;
  if (blob.size <= LIMITE_BYTES) return blob;
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const escala = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * escala);
    const h = Math.round(bmp.height * escala);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, 0.85));
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}
