import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ImagePlus, X, Check, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AudioRecorderButton } from "@/components/handoff/AudioRecorderButton";
import {
  listPropertyDetails,
  savePropertyDetail,
  deletePropertyDetail,
  transcribeDetailAudio,
} from "@/lib/property-details.functions";

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return btoa(bin);
}

function DetailImages({ paths, onRemove }: { paths: string[]; onRemove?: (p: string) => void }) {
  const { data: urls } = useQuery({
    queryKey: ["detail-images", paths],
    enabled: paths.length > 0,
    queryFn: async () => {
      const out: Record<string, string> = {};
      for (const p of paths) {
        const { data } = await supabase.storage.from("property-images").createSignedUrl(p, 60 * 60);
        if (data?.signedUrl) out[p] = data.signedUrl;
      }
      return out;
    },
  });
  if (!paths.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {paths.map((p) => (
        <div key={p} className="relative size-20 rounded-lg overflow-hidden border border-border bg-muted/40">
          {urls?.[p] ? <img src={urls[p]} alt="" className="size-full object-cover" /> : null}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(p)}
              className="absolute top-0.5 right-0.5 size-5 grid place-items-center rounded-full bg-background/90 hover:bg-destructive hover:text-destructive-foreground"
              aria-label="Remover imagem"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * "Detalhamento do Imóvel": um único campo livre (redação contínua) que cresce
 * conforme o usuário escreve — sem blocos nem botão "adicionar detalhe".
 * Persiste em um único registro de `property_details`; registros antigos são
 * mesclados no texto e removidos ao salvar.
 */
export function PropertyDetailsEditor({ propertyId }: { propertyId: string }) {
  const listFn = useServerFn(listPropertyDetails);
  const saveFn = useServerFn(savePropertyDetail);
  const deleteFn = useServerFn(deletePropertyDetail);
  const transcribeFn = useServerFn(transcribeDetailAudio);
  const qc = useQueryClient();

  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["property-details", propertyId],
    queryFn: () => listFn({ data: { propertyId } }),
  });

  const details = data?.details ?? [];
  const primaryId = details[0]?.id ?? null;
  const legacyIds = details.slice(1).map((d) => d.id);

  useEffect(() => {
    if (!data || loaded) return;
    const merged = details
      .map((d) => [d.title ? `${d.title}` : "", d.content].filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n\n");
    setText(merged);
    setImages(details.flatMap((d) => d.images));
    setLoaded(true);
  }, [data, loaded, details]);

  // Auto-grow: a altura acompanha o conteúdo, como o campo de prompt da IA.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 180)}px`;
  }, [text, loaded]);

  async function handleFiles(files: FileList) {
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, 12 - images.length)) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name}: imagem muito grande (máx 10MB)`);
          continue;
        }
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${u.user.id}/detalhes/${propertyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from("property-images")
          .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
        if (error) throw error;
        added.push(path);
      }
      setImages((prev) => [...prev, ...added]);
      setDirty(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleAudio(audio: { blob: Blob; mime: string }) {
    const base64 = await blobToBase64(audio.blob);
    const { text: transcript } = await transcribeFn({
      data: { propertyId, audioBase64: base64, mimeType: audio.mime },
    });
    setText((prev) => (prev.trim() ? `${prev.trim()}\n\n${transcript}` : transcript));
    setDirty(true);
    toast.success("Áudio transcrito");
  }

  async function save() {
    setSaving(true);
    try {
      await saveFn({
        data: {
          id: primaryId,
          propertyId,
          title: null,
          content: text.trim(),
          images,
          source: "text",
        },
      });
      for (const id of legacyIds) {
        await deleteFn({ data: { id, propertyId } });
      }
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["property-details", propertyId] });
      toast.success("Detalhamento salvo — a IA já aprendeu.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg bg-muted/50 border border-border/60 px-3 py-2.5">
        <Sparkles className="size-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Escreva livremente todos os micro detalhes desta residência — o que não aparece no guia público. Tudo aqui
          vira conhecimento da IA.
        </p>
      </div>

      {isLoading && !loaded ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          <textarea
            ref={taRef}
            value={text}
            maxLength={40000}
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
            placeholder="Ex: O aquecedor da piscina fica no armário externo à direita; leva cerca de 40 minutos para aquecer. A fechadura da porta dos fundos emperra quando chove — basta puxar e girar…"
            className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm leading-relaxed outline-none focus:border-primary/60 focus:ring-0 overflow-hidden"
          />

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <DetailImages paths={images} onRemove={(p) => { setImages((prev) => prev.filter((x) => x !== p)); setDirty(true); }} />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={uploading || images.length >= 12}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <ImagePlus className="size-3.5 mr-1.5" />}
              Imagens
            </Button>
            <div className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5">
              <AudioRecorderButton compact maxSeconds={180} onRecorded={handleAudio} />
              <span className="text-[11px] text-muted-foreground pr-2">Ditar</span>
            </div>
            <div className="ml-auto">
              <Button type="button" size="sm" onClick={save} disabled={saving || !dirty}>
                {saving ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Check className="size-3.5 mr-1.5" />}
                Salvar detalhamento
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
