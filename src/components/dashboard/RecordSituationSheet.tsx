import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  FileText,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  StickyNote,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import { CATEGORY_BY_KEY } from "@/components/dashboard/record-categories";
import {
  RECORD_TITLE_MAX,
  SITUATION_MEDIA_MAX,
  createRecordSituation,
  transcribeRecordAudio,
  type RecordCategory,
} from "@/lib/reservation-records.functions";
import type { CardMode } from "@/components/dashboard/record-categories";
import {
  draftItemFrom,
  extFor,
  type DraftItem,
  type SituationTarget,
} from "@/components/dashboard/record-draft";

/**
 * A FOLHA DA SITUAÇÃO (pedido explícito, 10/09/2026).
 *
 * "cada vez que o prestador for gravar video/audio/foto, etc.. criar uma
 *  'folha' para aquela situação e um botão 'registrar situação' para que ele
 *  consiga registrar uma nova, e assim por diante"
 *
 * Antes, a captura subia o arquivo na hora e acabava ali: sem título, sem
 * descrição, e cada toque virava um registro (e uma pendência) separado. Agora
 * a captura ABRE ESTA FOLHA e nada sai do aparelho até "Registrar situação":
 *
 *  · a faixa de mídias, com o "+" para juntar mais arquivos DA MESMA situação
 *    (a categoria já é da situação — o "+" não pergunta de novo);
 *  · título curto e descrição, cada um com microfone que vira TEXTO;
 *  · um envio só, que cria UMA pendência com todas as provas dentro.
 *
 * ÁUDIO AQUI É SEMPRE DITADO (pedido explícito, 10/09/2026): "esse botão de
 * áudio ali em mídias não tem que existir, pois há a descrição para caso a
 * pessoa queira explicar por áudio". Ou seja, quem quiser falar fala no
 * microfone do campo e o texto fica gravado — ninguém depois precisa parar a
 * operação para escutar um anexo de voz só para saber do que se trata.
 */

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não consegui ler o áudio."));
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

const KIND_ICON = { photo: Camera, video: Video, audio: Mic, file: Paperclip } as const;

/**
 * Campo de texto com DITADO. O microfone monta o gravador já gravando; ao
 * parar, o áudio vai para a transcrição e o texto cai no campo (somando ao
 * que já estava escrito, nunca substituindo).
 */
export function DictationField({
  label,
  required,
  value,
  onChange,
  placeholder,
  propertyId,
  maxLength,
  multiline,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  propertyId: string;
  maxLength?: number;
  multiline?: boolean;
}) {
  const transcribeFn = useServerFn(transcribeRecordAudio);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onRecorded(audio: RecordedAudio) {
    setRecording(false);
    setBusy(true);
    try {
      const base64 = await blobToBase64(audio.blob);
      const { text } = await transcribeFn({
        data: { propertyId, audioBase64: base64, mimeType: audio.mime },
      });
      const clean = (text ?? "").trim();
      if (!clean) {
        toast.error("Não entendi o áudio. Tente de novo ou digite.");
        return;
      }
      const merged = value.trim() ? `${value.trim()} ${clean}` : clean;
      onChange(maxLength ? merged.slice(0, maxLength) : merged);
    } catch {
      toast.error("Não consegui transcrever agora. Pode digitar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="ds-eyebrow text-muted-foreground">{label}</span>
        {required && (
          <span className="text-[9px] font-bold uppercase tracking-wide text-rose-500">
            obrigatório
          </span>
        )}
        {maxLength && (
          <span className="ml-auto text-[9.5px] font-semibold tabular-nums text-muted-foreground">
            {value.length}/{maxLength}
          </span>
        )}
      </div>

      <div
        className={`flex items-start gap-2 rounded-[0.3rem] border bg-background/60 px-2.5 py-2 ${
          recording ? "border-[#E82DAE]/60" : "border-border/60"
        }`}
      >
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={3}
            className="min-w-0 flex-1 resize-none bg-transparent text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
          />
        ) : (
          <input
            value={value}
            maxLength={maxLength}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
          />
        )}
        <button
          type="button"
          onClick={() => setRecording(true)}
          disabled={recording || busy}
          aria-label={`Ditar ${label.toLowerCase()}`}
          title={`Ditar ${label.toLowerCase()}`}
          className="grid size-[26px] shrink-0 place-items-center rounded-full bg-foreground/[0.07] text-muted-foreground transition-colors hover:bg-foreground/[0.12] hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
        </button>
      </div>

      {recording && (
        <div className="mt-1.5">
          <AudioRecorderButton
            autoStart
            compact
            maxSeconds={90}
            onRecorded={onRecorded}
            onCancel={() => setRecording(false)}
          />
        </div>
      )}
    </div>
  );
}

export function RecordSituationSheet({
  open,
  onOpenChange,
  propertyId,
  propertyLabel,
  target,
  cardMode,
  category,
  initial,
  initialTitle,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: string;
  propertyLabel: string;
  target: SituationTarget;
  cardMode: CardMode;
  category: RecordCategory;
  /** Primeira mídia, capturada antes da folha abrir. */
  initial: DraftItem | null;
  /** Texto já digitado no campo "Descrever situação" — vira o título. */
  initialTitle?: string;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createRecordSituation);
  const meta = CATEGORY_BY_KEY.get(category);
  const requiresTitle = !!meta?.createsTask;

  const [items, setItems] = useState<DraftItem[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Cada abertura começa uma situação NOVA — é o "e assim por diante" do
  // pedido: registrou uma, a próxima captura abre uma folha limpa.
  useEffect(() => {
    if (!open) return;
    setItems(initial ? [initial] : []);
    setTitle(initialTitle ?? "");
    setDescription("");
  }, [open, initial, initialTitle]);

  // Os previews são object URLs; soltar ao desmontar evita segurar o vídeo
  // inteiro na memória do celular. O revoke só pode acontecer no unmount —
  // se dependesse de `items`, adicionar a 2ª foto invalidaria a 1ª miniatura.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    };
  }, []);


  function addItem(item: DraftItem) {
    setItems((prev) => {
      if (prev.length >= SITUATION_MEDIA_MAX) {
        toast.error(`Máximo de ${SITUATION_MEDIA_MAX} arquivos por situação.`);
        return prev;
      }
      return [...prev, item];
    });
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    addItem(draftItemFrom(f, { name: f.name, mime: f.type }));
  }

  function removeItem(key: string) {
    setItems((prev) => {
      const gone = prev.find((i) => i.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((i) => i.key !== key);
    });
  }

  const canSave =
    !saving && (items.length > 0 || !!title.trim()) && (!requiresTitle || !!title.trim());

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const folder = target.logId ?? target.reservationId;
      const media = [];
      for (const it of items) {
        const path = `${propertyId}/${folder}/${crypto.randomUUID()}.${extFor(it.kind, it.mime)}`;
        const { error } = await supabase.storage
          .from("reservation-records")
          .upload(path, it.blob, { contentType: it.mime, upsert: false });
        if (error) throw new Error(error.message);
        media.push({
          path,
          kind: it.kind,
          mime: it.mime,
          sizeBytes: it.blob.size,
          durationMs: it.durationMs,
        });
      }
      const res = await createFn({
        data: {
          propertyId,
          logId: target.logId,
          reservationId: target.reservationId,
          cardMode,
          category,
          title: title.trim() || null,
          description: description.trim() || null,
          media,
        },
      });
      toast.success(
        res?.taskCreated ? "Situação registrada e pendência aberta." : "Situação registrada.",
      );
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || "Não consegui registrar a situação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent
        className="w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border-border/60 bg-card/95 p-0 backdrop-blur-xl sm:w-full sm:max-w-sm"
        aria-describedby={undefined}
      >
        <DialogHeader className="space-y-0 border-b border-border/50 px-3.5 pb-2.5 pr-11 pt-3.5 text-left">
          <div className="flex items-center gap-2">
            <DialogTitle className="ds-card-title min-w-0 flex-1 truncate">
              Nova situação
            </DialogTitle>
            <span
              className={`shrink-0 rounded-[0.25rem] px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.05em] ${meta?.tone ?? ""}`}
            >
              {meta?.short ?? "Registro"}
            </span>
          </div>
          <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
            {propertyLabel}
          </span>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-3.5 overflow-y-auto px-3.5 py-3">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="ds-eyebrow text-muted-foreground">Mídias</span>
              <span className="ml-auto text-[9.5px] font-semibold tabular-nums text-muted-foreground">
                {items.length}/{SITUATION_MEDIA_MAX}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {items.map((it) => {
                const Icon = KIND_ICON[it.kind];
                return (
                  <span
                    key={it.key}
                    className="relative grid size-[62px] place-items-center overflow-hidden rounded-[0.25rem] bg-gradient-to-br from-secondary/70 to-secondary/30"
                  >
                    {it.previewUrl && it.kind === "photo" ? (
                      <img src={it.previewUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <Icon className="size-4 text-muted-foreground" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeItem(it.key)}
                      aria-label="Remover"
                      className="absolute right-1 top-1 grid size-[15px] place-items-center rounded-full bg-black/60 text-white"
                    >
                      <X className="size-2.5" />
                    </button>
                    {it.kind === "audio" && it.durationMs && (
                      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 text-right text-[7.5px] font-bold tabular-nums text-white">
                        {Math.round(it.durationMs / 1000)}s
                      </span>
                    )}
                  </span>
                );
              })}

              {/* SÓ O "+", centrado (pedido explícito, 10/09/2026): a legenda
                  "mesma situação" dentro do quadrado confundia mais do que
                  explicava. O que ele faz continua dito no `title`. */}
              {items.length < SITUATION_MEDIA_MAX && (
                <button
                  type="button"
                  onClick={() => photoRef.current?.click()}
                  className="grid size-[62px] place-items-center rounded-[0.25rem] border border-dashed border-[#E82DAE]/45 bg-[#E82DAE]/[0.07] text-[#E82DAE] transition-colors hover:bg-[#E82DAE]/[0.12]"
                  aria-label="Adicionar mais uma mídia a esta situação"
                  title="Adicionar mais uma mídia a esta situação"
                >
                  <Plus className="size-5" />
                </button>
              )}
            </div>

            {/* A bandeja do "+" — sem perguntar a categoria de novo: ela já é
                da situação. SEM ÁUDIO aqui (pedido explícito, 10/09/2026):
                "há a descrição para caso a pessoa queira explicar por áudio".
                Áudio na situação é DITADO — vira texto no campo, que qualquer
                um lê depois; anexo de voz obrigaria a operação a parar e
                escutar. */}
            {items.length < SITUATION_MEDIA_MAX && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => photoRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-[0.3rem] border border-border/60 bg-secondary/30 px-2 py-1 text-[10.5px] font-medium text-foreground/80 hover:bg-secondary/50"
                >
                  <Camera className="size-3" /> Foto
                </button>
                <button
                  type="button"
                  onClick={() => videoRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-[0.3rem] border border-border/60 bg-secondary/30 px-2 py-1 text-[10.5px] font-medium text-foreground/80 hover:bg-secondary/50"
                >
                  <Video className="size-3" /> Vídeo
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-[0.3rem] border border-border/60 bg-secondary/30 px-2 py-1 text-[10.5px] font-medium text-foreground/80 hover:bg-secondary/50"
                >
                  <FileText className="size-3" /> Arquivo
                </button>
              </div>
            )}
          </div>

          <DictationField
            label="Título"
            required={requiresTitle}
            value={title}
            onChange={setTitle}
            placeholder="Em poucas palavras, o que houve"
            propertyId={propertyId}
            maxLength={RECORD_TITLE_MAX}
          />

          <DictationField
            label="Descrição"
            value={description}
            onChange={setDescription}
            placeholder="Onde, desde quando, o que precisa ser feito"
            propertyId={propertyId}
            multiline
          />

          <p className="flex items-start gap-1.5 text-[9.5px] leading-relaxed text-muted-foreground">
            <StickyNote className="mt-px size-3 shrink-0" />
            {/* A faixa de mídias não tem mais microfone, então o texto que
                comparava os dois deixou de fazer sentido. */}
            <span>
              Prefere falar? Toque no microfone do campo —{" "}
              <b className="font-semibold text-foreground/80">o que você falar vira texto</b> aqui
              mesmo, e dá para corrigir antes de registrar.
            </span>
          </p>
        </div>

        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPicked}
        />
        <input
          ref={videoRef}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={onPicked}
        />
        <input ref={fileRef} type="file" className="hidden" onChange={onPicked} />

        <div className="flex items-center gap-2 border-t border-border/50 bg-secondary/20 px-3.5 py-2.5">
          <button
            type="button"
            disabled={saving}
            onClick={() => onOpenChange(false)}
            className="rounded-[0.3rem] px-2.5 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Descartar
          </button>
          <span className="flex-1" />
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-[0.3rem] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-3.5 py-2 text-[12px] font-bold text-white disabled:from-muted disabled:to-muted disabled:text-muted-foreground"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Registrar situação
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
