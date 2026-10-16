/**
 * Reduz o tamanho de vídeos no próprio celular ANTES do envio, mantendo
 * qualidade de auditoria (até 1080p, ~5 Mbps H.264 + AAC). Vídeos de celular
 * costumam vir em 4K/20-50 Mbps — viram 4-8x menores sem perda visível.
 *
 * Usa a codificação de vídeo nativa do navegador (WebCodecs). Se o aparelho
 * não suportar, se der erro ou se o resultado não ficar menor, devolve o
 * ORIGINAL — nunca impede o envio.
 */
const MIN_BYTES = 8 * 1024 * 1024; // abaixo disso não compensa
const TARGET_BITRATE = 5_000_000;
const MAX_SHORT_SIDE = 1080;

export async function comprimirVideo(
  blob: Blob,
  opts: { signal?: AbortSignal; onProgress?: (p: number) => void } = {},
): Promise<{ blob: Blob; mime: string; compressed: boolean }> {
  const original = { blob, mime: blob.type || "video/mp4", compressed: false };
  if (blob.size < MIN_BYTES || typeof window === "undefined" || !("VideoEncoder" in window)) return original;
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return original;
    const duration = await input.computeDuration();
    const w = track.displayWidth;
    const h = track.displayHeight;
    // Já está leve (bitrate baixo e resolução ≤1080p): manda como está.
    const bitrate = duration > 0 ? (blob.size * 8) / duration : Infinity;
    const short = Math.min(w, h);
    if (bitrate <= TARGET_BITRATE * 1.3 && short <= MAX_SHORT_SIDE) return original;
    const scale = short > MAX_SHORT_SIDE ? MAX_SHORT_SIDE / short : 1;
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new mb.BufferTarget(),
    });
    const conversion = await mb.Conversion.init({
      input,
      output,
      video: { width: even(w * scale), height: even(h * scale), fit: "contain", codec: "avc", bitrate: TARGET_BITRATE },
      audio: { codec: "aac", bitrate: 128_000 },
    });
    if (!conversion.isValid) return original;
    if (opts.onProgress) conversion.onProgress = (p) => opts.onProgress?.(Math.round(p * 100));
    const onAbort = () => void conversion.cancel();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await conversion.execute();
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
    const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buf || buf.byteLength >= blob.size * 0.9) return original;
    return { blob: new Blob([buf], { type: "video/mp4" }), mime: "video/mp4", compressed: true };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    console.warn("[video-compress] usando original", e);
    return original;
  }
}
