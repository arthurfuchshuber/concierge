import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

type Props = {
  value: string;
  onChange: (url: string) => void;
  /** Subfolder under the user id (e.g. "gallery", "themes/checkin") */
  folder?: string;
  className?: string;
  placeholder?: string;
  aspect?: "square" | "video" | "auto";
};

export function ImageUpload({ value, onChange, folder = "misc", className, placeholder, aspect = "square" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione uma imagem");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Imagem muito grande (máx 10MB)");
      return;
    }
    setUploading(true);
    setProgress(0);
    // Progresso simulado enquanto o upload está em voo — o cliente do Storage
    // não expõe eventos de progresso, então avançamos suavemente até 90% e
    // completamos os 100% quando a resposta chega.
    const tick = window.setInterval(() => {
      setProgress((p) => (p < 90 ? p + Math.max(1, (90 - p) / 8) : p));
    }, 150);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${u.user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("property-images").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });
      if (error) throw error;
      const { data: signed, error: signErr } = await supabase.storage
        .from("property-images")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error("Falha ao gerar URL");
      setProgress(100);
      onChange(signed.signedUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      window.clearInterval(tick);
      window.setTimeout(() => {
        setUploading(false);
        setProgress(0);
      }, 200);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const aspectClass = aspect === "square" ? "aspect-square" : aspect === "video" ? "aspect-video" : "";

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <div className={`relative ${aspectClass} rounded-lg border border-border bg-muted/40 overflow-hidden`}>
        {uploading ? (
          <div className="size-full grid place-items-center gap-2 bg-accent/10 p-3">
            <Loader2 className="size-5 animate-spin text-accent-foreground/80" />
            <span className="text-xs font-medium tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-border/60 overflow-hidden">
              <div
                className="h-full bg-[image:var(--gradient-brand)] transition-[width] duration-150 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : value ? (
          <>
            <img src={value} alt="" className="size-full object-cover" />
            <button
              type="button"
              onClick={() => onChange("")}
              className="absolute top-1.5 right-1.5 size-6 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground text-foreground shadow"
              aria-label="Remover"
            >
              <X className="size-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="size-full grid place-items-center text-[10px] text-muted-foreground uppercase tracking-wider hover:bg-muted/70 transition-colors p-2"
          >
            <span className="flex flex-col items-center gap-1">
              <Upload className="size-4" />
              <span className="text-center leading-tight">{placeholder ?? "Enviar"}</span>
            </span>
          </button>
        )}
      </div>
      {value && !uploading && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1.5 w-full text-xs"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="size-3.5 mr-1" />
          Trocar foto
        </Button>
      )}
    </div>
  );
}
