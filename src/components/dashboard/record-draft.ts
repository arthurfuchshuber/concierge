/**
 * O RASCUNHO DA SITUAÇÃO — os arquivos que a pessoa já capturou e que ainda
 * não saíram do aparelho.
 *
 * Vive fora do componente porque três telas o tocam (a folha da situação, a
 * linha do tempo da reserva e, no futuro, a unificação) e porque exportar
 * função junto com componente quebra o fast refresh.
 */

export type DraftKind = "photo" | "video" | "audio" | "file";

export type DraftItem = {
  key: string;
  blob: Blob;
  kind: DraftKind;
  mime: string;
  name: string | null;
  durationMs: number | null;
  /** object URL para a miniatura; só existe em foto/vídeo. */
  previewUrl: string | null;
};

export type SituationTarget = { logId?: string; reservationId?: string };

export function inferKind(mime: string): DraftKind {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

export function extFor(kind: string, mime: string): string {
  if (kind === "audio") {
    if (mime.includes("mp4")) return "m4a";
    if (mime.includes("mpeg")) return "mp3";
    return "webm";
  }
  const sub = mime.split("/")[1] ?? "bin";
  return sub.replace("jpeg", "jpg").split(";")[0];
}

export function draftItemFrom(
  file: Blob,
  opts: { name?: string | null; mime?: string; durationMs?: number | null },
): DraftItem {
  const mime = opts.mime ?? (file as File).type ?? "application/octet-stream";
  const kind = inferKind(mime);
  return {
    key: crypto.randomUUID(),
    blob: file,
    kind,
    mime,
    name: opts.name ?? (file as File).name ?? null,
    durationMs: opts.durationMs ?? null,
    previewUrl: kind === "photo" || kind === "video" ? URL.createObjectURL(file) : null,
  };
}
