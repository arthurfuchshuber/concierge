import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, ImagePlus, X, Check, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AudioRecorderButton } from "@/components/handoff/AudioRecorderButton";
import {
  listPropertyDetails,
  savePropertyDetail,
  deletePropertyDetail,
  transcribeDetailAudio,
  type PropertyDetail,
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
    <div className="flex flex-wrap gap-2 mt-2">
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

function DetailForm({
  propertyId,
  initial,
  onDone,
  onCancel,
}: {
  propertyId: string;
  initial?: PropertyDetail;
  onDone: () => void;
  onCancel: () => void;
}) {
  const saveFn = useServerFn(savePropertyDetail);
  const transcribeFn = useServerFn(transcribeDetailAudio);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList) {
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, 8 - images.length)) {
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleAudio(audio: { blob: Blob; mime: string }) {
    const base64 = await blobToBase64(audio.blob);
    const { text } = await transcribeFn({ data: { propertyId, audioBase64: base64, mimeType: audio.mime } });
    setContent((prev) => (prev ? `${prev.trim()} ${text}` : text));
    toast.success("Áudio transcrito");
  }

  async function save() {
    if (!content.trim()) {
      toast.error("Escreva ou grave alguma informação.");
      return;
    }
    setSaving(true);
    try {
      await saveFn({
        data: {
          id: initial?.id ?? null,
          propertyId,
          title: title.trim() || null,
          content: content.trim(),
          images,
          source: "text",
        },
      });
      toast.success("Detalhe salvo — a IA já aprendeu.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-3 sm:p-4 space-y-3">
      <Input
        value={title}
        maxLength={160}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título (opcional) — ex: Aquecedor da piscina"
      />
      <Textarea
        value={content}
        rows={5}
        maxLength={8000}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Escreva livremente todos os micro detalhes: onde fica, como funciona, o que costuma dar errado, o que o hóspede precisa saber…"
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <DetailImages paths={images} onRemove={(p) => setImages((prev) => prev.filter((x) => x !== p))} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={uploading || images.length >= 8} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <ImagePlus className="size-3.5 mr-1.5" />}
          Imagens
        </Button>
        <div className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5">
          <AudioRecorderButton compact maxSeconds={180} onRecorded={handleAudio} />
          <span className="text-[11px] text-muted-foreground pr-2">Ditar</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
          <Button type="button" size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Check className="size-3.5 mr-1.5" />}
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Detalhamento do Imóvel": cada bloco é uma informação distinta, mas o
 * conjunto é apresentado como uma redação contínua sobre a residência.
 */
export function PropertyDetailsEditor({ propertyId }: { propertyId: string }) {
  const listFn = useServerFn(listPropertyDetails);
  const deleteFn = useServerFn(deletePropertyDetail);
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["property-details", propertyId],
    queryFn: () => listFn({ data: { propertyId } }),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id, propertyId } }),
    onSuccess: () => {
      toast.success("Detalhe removido");
      qc.invalidateQueries({ queryKey: ["property-details", propertyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const details = useMemo(() => data?.details ?? [], [data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["property-details", propertyId] });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg bg-muted/50 border border-border/60 px-3 py-2.5">
        <Sparkles className="size-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Tudo o que você escrever ou ditar aqui vira conhecimento da IA sobre esta residência — inclusive o que não
          aparece no guia público. Cada bloco é uma informação distinta; juntos, formam a redação do imóvel.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : details.length === 0 && !creating ? (
        <p className="text-sm text-muted-foreground">
          Nenhum detalhe ainda. Comece contando os micro detalhes do imóvel.
        </p>
      ) : (
        <article className="space-y-5">
          {details.map((d) =>
            editingId === d.id ? (
              <DetailForm
                key={d.id}
                propertyId={propertyId}
                initial={d}
                onDone={() => {
                  setEditingId(null);
                  refresh();
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <section key={d.id} className="group relative border-l-2 border-border/70 pl-4">
                {d.title && <h4 className="font-display text-base mb-1">{d.title}</h4>}
                <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{d.content}</p>
                <DetailImages paths={d.images} />
                <div className="absolute top-0 right-0 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setEditingId(d.id)}
                    className="grid size-7 place-items-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                    aria-label="Editar detalhe"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => del.mutate(d.id)}
                    className="grid size-7 place-items-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    aria-label="Remover detalhe"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </section>
            ),
          )}
        </article>
      )}

      {creating ? (
        <DetailForm
          propertyId={propertyId}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5 mr-1.5" /> Adicionar detalhe
        </Button>
      )}
    </div>
  );
}
