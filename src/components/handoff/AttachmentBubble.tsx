import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { signChatAttachmentUrl } from "@/lib/chat-attachments.functions";
import { FileText, Download, Loader2 } from "lucide-react";


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
    // Player nativo do navegador — funciona cross-browser (Chrome, Safari, Firefox)
    // e sempre expõe o botão de download como fallback quando o codec não é suportado
    // (ex.: webm/opus gravado no Chrome sendo aberto em iOS Safari).
    const mime = attachment.mime ?? undefined;
    return (
      <div className="flex flex-col gap-1 min-w-[220px]">
        <audio
          controls
          preload="metadata"
          className="w-full max-w-[280px] h-10"
        >
          <source src={resolvedUrl} type={mime} />
          {/* Fallback sem type quando o mime do banco veio vazio/desconhecido */}
          <source src={resolvedUrl} />
          Seu navegador não suporta reprodução deste áudio.
        </audio>
        <a
          href={resolvedUrl}
          download={attachment.name ?? "audio"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground w-fit"
        >
          <Download className="size-3" /> Baixar
        </a>
      </div>
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

