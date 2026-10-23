import { useEffect, useRef } from "react";
import { Camera, FileText, Images, Mic, Paperclip, Plus, Video, X } from "lucide-react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/ui/money-input";
import { DictationField } from "@/components/dashboard/RecordSituationSheet";
import { draftItemFrom, type DraftItem } from "@/components/dashboard/record-draft";
import { RECORD_TITLE_MAX, SITUATION_MEDIA_MAX } from "@/lib/reservation-records.functions";

/**
 * ÚLTIMA PERGUNTA DO SERVIÇO — "Informe os detalhes do serviço:"
 * (mockup 0l, aprovado em 23/10/2026).
 *
 * É a folha de situação de sempre (título com limite de 50 e ditado, descrição
 * com ditado, fotos/vídeos/galeria/arquivo) + o VALOR do serviço. Ordem:
 *  · computador: Título (esquerda) e Valor (direita, 150px) na mesma linha;
 *  · celular: um abaixo do outro (Título, depois Valor);
 *  · depois a Descrição e, por último, as mídias.
 * Não há texto "Prefere falar?" (retirado a pedido): o microfone do campo basta.
 */
export function ServiceDetailsFields({
  propertyId,
  title,
  onTitle,
  cents,
  onCents,
  description,
  onDescription,
  items,
  onItems,
  disabled,
}: {
  propertyId: string;
  title: string;
  onTitle: (v: string) => void;
  cents: number | null;
  onCents: (c: number | null) => void;
  description: string;
  onDescription: (v: string) => void;
  items: DraftItem[];
  onItems: (fn: (prev: DraftItem[]) => DraftItem[]) => void;
  disabled?: boolean;
}) {
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Soltar as miniaturas (object URLs) ao sair — mesmo cuidado da folha de situação.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    };
  }, []);

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    onItems((prev) => {
      const livres = SITUATION_MEDIA_MAX - prev.length;
      if (files.length > livres) toast.error(`Máximo de ${SITUATION_MEDIA_MAX} arquivos por situação.`);
      // O mesmo arquivo escolhido duas vezes não entra em dobro.
      const assinatura = (b: Blob, n: string | null) => `${n ?? ""}|${b.size}|${b.type}`;
      const ja = new Set(prev.map((i) => assinatura(i.blob, i.name)));
      const unicos = files.filter((f) => {
        const k = assinatura(f, f.name);
        if (ja.has(k)) return false;
        ja.add(k);
        return true;
      });
      if (unicos.length < files.length) toast.info("Esse arquivo já está nesta situação.");
      const novos = unicos.slice(0, Math.max(0, livres)).map((f) => draftItemFrom(f, { name: f.name, mime: f.type }));
      return [...prev, ...novos];
    });
  }

  function removeItem(key: string) {
    onItems((prev) => {
      const gone = prev.find((i) => i.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((i) => i.key !== key);
    });
  }

  const KIND_ICON = { photo: Camera, video: Video, audio: Mic, file: Paperclip } as const;
  const chip =
    "inline-flex items-center gap-1.5 rounded-[0.3rem] border border-border/60 bg-secondary/30 px-2 py-1 text-[10.5px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start">
        <div className="min-w-0 sm:flex-1">
          <DictationField
            label="Título"
            required
            value={title}
            onChange={onTitle}
            placeholder="Em poucas palavras, o que houve"
            propertyId={propertyId}
            maxLength={RECORD_TITLE_MAX}
          />
        </div>
        <div className="sm:w-[150px] sm:shrink-0">
          <span className="ds-eyebrow mb-1.5 block text-muted-foreground">Valor</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-display text-[14px] font-bold text-muted-foreground">
              R$
            </span>
            <MoneyInput
              cents={cents}
              onChange={onCents}
              placeholder="0,00"
              disabled={disabled}
              className="h-10 pl-10 font-display text-[17px] font-bold tabular-nums"
            />
          </div>
        </div>
      </div>

      <DictationField
        label="Descrição"
        value={description}
        onChange={onDescription}
        placeholder="Onde, desde quando, o que precisa ser feito"
        propertyId={propertyId}
        multiline
      />

      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="ds-eyebrow text-muted-foreground">Fotos e vídeos</span>
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
                <Icon className="size-4 text-muted-foreground" />
                {it.previewUrl && it.kind === "photo" && (
                  <img
                    src={it.previewUrl}
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                {it.previewUrl && it.kind === "video" && (
                  <>
                    <video
                      src={`${it.previewUrl}#t=0.1`}
                      preload="metadata"
                      muted
                      playsInline
                      aria-hidden
                      tabIndex={-1}
                      className="pointer-events-none absolute inset-0 size-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                    <span className="pointer-events-none absolute bottom-1 left-1 grid size-[15px] place-items-center rounded-full bg-black/60 text-white">
                      <Video className="size-2.5" />
                    </span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => removeItem(it.key)}
                  disabled={disabled}
                  aria-label="Remover"
                  className="absolute right-1 top-1 grid size-[15px] place-items-center rounded-full bg-black/60 text-white"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            );
          })}
          {items.length < SITUATION_MEDIA_MAX && (
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={disabled}
              className="grid size-[62px] place-items-center rounded-[0.25rem] border border-dashed border-[#E82DAE]/45 bg-[#E82DAE]/[0.07] text-[#E82DAE] transition-colors hover:bg-[#E82DAE]/[0.12]"
              aria-label="Adicionar mais uma mídia"
              title="Adicionar mais uma mídia"
            >
              <Plus className="size-5" />
            </button>
          )}
        </div>
        {items.length < SITUATION_MEDIA_MAX && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => photoRef.current?.click()} disabled={disabled} className={chip}>
              <Camera className="size-3" /> Foto
            </button>
            <button type="button" onClick={() => videoRef.current?.click()} disabled={disabled} className={chip}>
              <Video className="size-3" /> Vídeo
            </button>
            <button type="button" onClick={() => galleryRef.current?.click()} disabled={disabled} className={chip}>
              <Images className="size-3" /> Galeria
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled} className={chip}>
              <FileText className="size-3" /> Arquivo
            </button>
          </div>
        )}
      </div>

      <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPicked} />
      <input ref={videoRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={onPicked} />
      <input ref={galleryRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={onPicked} />
      <input ref={fileRef} type="file" multiple className="hidden" onChange={onPicked} />
    </div>
  );
}
