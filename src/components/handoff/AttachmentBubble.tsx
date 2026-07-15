import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { signChatAttachmentUrl } from "@/lib/chat-attachments.functions";
import { FileText, Download, Loader2, Play, Pause } from "lucide-react";

export type AttachmentInfo = {
  type: "image" | "audio" | "video" | "document";
  mime: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  name: string | null;
  /** For guest side we already receive a signed URL from the API. */
  url?: string | null;
  /** For staff side we get the storage path and sign it here. */
  path?: string | null;
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number | null): string {
  if (!ms || ms < 1000) return "0:00";
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

/**
 * Renders a chat attachment. If `url` is already provided, uses it directly.
 * Otherwise (staff view), signs the storage path via server function.
 */
export function AttachmentBubble({ attachment }: { attachment: AttachmentInfo }) {
  const signFn = useServerFn(signChatAttachmentUrl);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(attachment.url ?? null);
  const [loading, setLoading] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (attachment.url) {
      setResolvedUrl(attachment.url);
      return;
    }
    if (!attachment.path) return;
    setLoading(true);
    signFn({ data: { path: attachment.path } })
      .then((res) => {
        if (!cancelled) setResolvedUrl(res.url);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.path, attachment.url, signFn]);

  if (loading && !resolvedUrl) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="size-3 animate-spin" /> carregando anexo…
      </div>
    );
  }
  if (!resolvedUrl) {
    return <div className="text-xs text-muted-foreground italic">anexo indisponível</div>;
  }

  if (attachment.type === "image") {
    return (
      <a href={resolvedUrl} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={resolvedUrl}
          alt={attachment.name ?? "Imagem"}
          className="max-w-[260px] max-h-[300px] w-auto h-auto rounded-lg object-cover"
          loading="lazy"
        />
      </a>
    );
  }

  if (attachment.type === "video") {
    return (
      <video
        src={resolvedUrl}
        controls
        className="max-w-[260px] max-h-[320px] rounded-lg bg-black"
        preload="metadata"
      />
    );
  }

  if (attachment.type === "audio") {
    return (
      <AudioPlayer
        src={resolvedUrl}
        durationMs={attachment.durationMs}
        onPlayingChange={setAudioPlaying}
        playing={audioPlaying}
      />
    );
  }

  // document
  return (
    <a
      href={resolvedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-background/60 border border-border hover:bg-background transition-colors"
      download={attachment.name ?? undefined}
    >
      <FileText className="size-4 text-muted-foreground" />
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium truncate max-w-[200px]">
          {attachment.name ?? "Documento"}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {formatSize(attachment.sizeBytes)}
        </span>
      </div>
      <Download className="size-3.5 text-muted-foreground ml-1" />
    </a>
  );
}

function AudioPlayer({
  src,
  durationMs,
  playing,
  onPlayingChange,
}: {
  src: string;
  durationMs: number | null;
  playing: boolean;
  onPlayingChange: (v: boolean) => void;
}) {
  const [audio] = useState(() => new Audio(src));
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onTime = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };
    const onEnd = () => {
      onPlayingChange(false);
      setProgress(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    if (playing) {
      audio.pause();
      onPlayingChange(false);
    } else {
      audio.play().then(() => onPlayingChange(true)).catch(() => {});
    }
  }

  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-background/60 border border-border min-w-[180px]">
      <button
        type="button"
        onClick={toggle}
        className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground shrink-0"
        aria-label={playing ? "Pausar" : "Tocar"}
      >
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-0.5" />}
      </button>
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {formatDuration(durationMs)}
      </span>
    </div>
  );
}
