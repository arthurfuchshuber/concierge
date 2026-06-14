import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Upload, X, Film, Image as ImageIcon, GripVertical } from "lucide-react";
import { toast } from "sonner";

export type MediaItem = { url: string; type: "image" | "video" };

type Props = {
  value: MediaItem[];
  onChange: (next: MediaItem[]) => void;
  folder?: string;
  max?: number;
  className?: string;
};

const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 60 * 1024 * 1024;

export function MediaUpload({ value, onChange, folder = "checkin", max = 8, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const remaining = Math.max(0, max - value.length);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    if (remaining <= 0) {
      toast.error(`Máximo de ${max} arquivos`);
      return;
    }
    const list = Array.from(files).slice(0, remaining);
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const added: MediaItem[] = [];
      for (const file of list) {
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        if (!isImage && !isVideo) {
          toast.error(`"${file.name}" não é imagem ou vídeo`);
          continue;
        }
        if (isImage && file.size > MAX_IMAGE) {
          toast.error(`Imagem grande demais (máx 10MB): ${file.name}`);
          continue;
        }
        if (isVideo && file.size > MAX_VIDEO) {
          toast.error(`Vídeo grande demais (máx 60MB): ${file.name}`);
          continue;
        }
        const ext = file.name.split(".").pop()?.toLowerCase() || (isImage ? "jpg" : "mp4");
        const path = `${u.user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from("property-images").upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
        if (error) {
          toast.error(error.message);
          continue;
        }
        const { data: signed, error: signErr } = await supabase.storage
          .from("property-images")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        if (signErr || !signed?.signedUrl) {
          toast.error("Falha ao gerar URL");
          continue;
        }
        added.push({ url: signed.signedUrl, type: isImage ? "image" : "video" });
      }
      if (added.length) onChange([...value, ...added]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  }

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {value.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          {value.map((m, i) => (
            <li key={`${m.url}-${i}`} className="relative group rounded-lg overflow-hidden border border-border bg-muted/40 aspect-square">
              {m.type === "image" ? (
                <img src={m.url} alt="" className="size-full object-cover" />
              ) : (
                <video src={m.url} className="size-full object-cover" muted playsInline preload="metadata" />
              )}
              <div className="absolute top-1 left-1 size-6 grid place-items-center rounded-full bg-background/85 text-foreground">
                {m.type === "image" ? <ImageIcon className="size-3" /> : <Film className="size-3" />}
              </div>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute top-1 right-1 size-6 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground shadow"
                aria-label="Remover"
              >
                <X className="size-3.5" />
              </button>
              <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  className="size-6 grid place-items-center rounded-full bg-background/85 hover:bg-background disabled:opacity-30"
                  aria-label="Mover para cima"
                >
                  <GripVertical className="size-3 rotate-90" />
                </button>
                <span className="text-[10px] font-medium text-background bg-foreground/80 rounded px-1.5 py-0.5">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === value.length - 1}
                  className="size-6 grid place-items-center rounded-full bg-background/85 hover:bg-background disabled:opacity-30"
                  aria-label="Mover para baixo"
                >
                  <GripVertical className="size-3 -rotate-90" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading || remaining <= 0}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 hover:bg-muted/60 transition-colors text-xs text-muted-foreground p-3 disabled:opacity-50"
      >
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        <span>
          {uploading
            ? "Enviando…"
            : remaining > 0
            ? `Adicionar foto ou vídeo · ${value.length}/${max}`
            : `Limite atingido (${max})`}
        </span>
      </button>
    </div>
  );
}
