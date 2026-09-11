import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Camera,
  RotateCcw,
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
import { track } from "@/lib/trail";
import { enviarMidia, garantirToken } from "@/lib/media-upload";
import {
  apagarRascunho,
  chaveRascunho,
  gravarRascunho,
  lerRascunho,
  resumoRascunho,
  type RascunhoSituacao,
} from "@/lib/offline/situation-draft";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import { CATEGORY_BY_KEY } from "@/components/dashboard/record-categories";
import {
  RECORD_TITLE_MAX,
  SITUATION_MEDIA_MAX,
  appendSituationMedia,
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
  const appendFn = useServerFn(appendSituationMedia);
  const meta = CATEGORY_BY_KEY.get(category);
  const requiresTitle = !!meta?.createsTask;

  const [items, setItems] = useState<DraftItem[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  /** Quantos arquivos já foram resolvidos e quanto do atual já subiu.
   *
   *  O `pct` existe por causa do relato de 11/09: "o botão ficou carregando
   *  sem ser liberado". Um vídeo de 40 MB em rede móvel demora minutos, e sem
   *  número na tela "está indo" e "travou" são a mesma coisa — a pessoa troca
   *  de aplicativo e aí trava de verdade. */
  const [progresso, setProgresso] = useState<{ feitos: number; total: number; pct: number } | null>(
    null,
  );
  /** Erro do último envio, MOSTRADO NA FOLHA. Um toast some em quatro
   *  segundos e não deixa rastro nenhum — foi por isso que ninguém soube
   *  dizer o que tinha acontecido. */
  const [erro, setErro] = useState<string | null>(null);
  /** Permite cortar um envio pendurado sem recarregar a página. */
  const cancelarRef = useRef<AbortController | null>(null);
  /** A situação já criada nesta folha. Guardada para que "tentar de novo" NÃO
   *  abra uma segunda situação com as mesmas provas. */
  const grupoRef = useRef<string | null>(null);

  /**
   * RASCUNHO GUARDADO NO APARELHO (11/09/2026).
   *
   * Em 11/09 o app reiniciou sozinho com esta folha aberta e um vídeo de
   * auditoria dentro — e levou o vídeo e o texto junto. A prestadora refilmou
   * tudo. A partir daqui, cada mudança cai no IndexedDB COM os arquivos, e ao
   * reabrir a folha oferecemos retomar.
   *
   * Oferecer, e não restaurar sozinho: quem descartou de propósito não quer a
   * pia de meia hora atrás voltando por conta própria.
   */
  const chave = chaveRascunho(propertyId, target);
  const [rascunho, setRascunho] = useState<RascunhoSituacao | null>(null);

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
    setErro(null);
    setRascunho(null);
    grupoRef.current = null;
    let vivo = true;
    void lerRascunho(chave).then((r) => {
      if (vivo && r) setRascunho(r);
    });
    return () => {
      vivo = false;
    };
  }, [open, initial, initialTitle, chave]);

  /* Grava o rascunho a cada respiro. O atraso evita escrever a cada tecla
     digitada no título — e o que realmente precisa sobreviver (os arquivos)
     muda poucas vezes. */
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      void gravarRascunho(chave, {
        criadoEm: Date.now(),
        propertyId,
        logId: target.logId,
        reservationId: target.reservationId,
        cardMode,
        category,
        title,
        description,
        midias: items.map((i) => ({
          key: i.key,
          blob: i.blob,
          kind: i.kind,
          mime: i.mime,
          name: i.name,
          durationMs: i.durationMs,
        })),
      });
    }, 900);
    return () => clearTimeout(t);
  }, [open, chave, propertyId, target, cardMode, category, title, description, items]);

  function retomarRascunho() {
    if (!rascunho) return;
    setTitle(rascunho.title);
    setDescription(rascunho.description);
    setItems(
      rascunho.midias.map((m) => ({
        key: m.key,
        blob: m.blob,
        kind: m.kind,
        mime: m.mime,
        name: m.name,
        durationMs: m.durationMs,
        previewUrl: m.kind === "photo" || m.kind === "video" ? URL.createObjectURL(m.blob) : null,
      })),
    );
    setRascunho(null);
  }

  function descartarRascunho() {
    setRascunho(null);
    void apagarRascunho(chave);
  }

  // Os previews são object URLs; soltar ao desmontar evita segurar o vídeo
  // inteiro na memória do celular. O revoke só pode acontecer no unmount —
  // se dependesse de `items`, adicionar a 2ª foto invalidaria a 1ª miniatura.
  // (correção do Lovable, commit 9301f2d — o efeito com `[items]` rodava a
  // limpeza a cada item novo e a foto anterior virava quadrado vazio.)
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

  function cancelarEnvio() {
    cancelarRef.current?.abort();
  }

  async function save() {
    if (!canSave) return;
    setErro(null);
    setSaving(true);
    const ctrl = new AbortController();
    cancelarRef.current = ctrl;
    setProgresso(items.length ? { feitos: 0, total: items.length, pct: 0 } : null);

    /* SALVAR PRIMEIRO, SUBIR DEPOIS — UMA MÍDIA POR VEZ (11/09/2026).
     *
     * O que havia aqui: um laço que subia TODOS os arquivos e, só no fim,
     * gravava a situação. Um vídeo de auditoria tem 30-55 MB; a faxineira está
     * no imóvel, em rede móvel, e sai do navegador para gravar cada um. Quando
     * o celular mata a aba durante o envio — e mata —, TUDO se perde.
     *
     * Agora a situação nasce primeiro, com o texto, e cada arquivo se junta a
     * ela na hora em que sobe.
     *
     * E A SEGUNDA METADE DA CORREÇÃO (11/09, depois do relato "o botão ficou
     * carregando sem liberar"): antes de qualquer coisa, GARANTIR A SESSÃO. O
     * envio saía com o token ainda não restaurado e a política do bucket, que
     * exige `auth.uid()`, negava em silêncio — zero arquivos no armazenamento
     * o dia inteiro. Ver `media-upload.ts` e `_authenticated/route.tsx`.
     */
    try {
      const token = await garantirToken();
      if (!token) {
        setErro("Sua sessão expirou. Entre de novo e registre — o texto continua aqui.");
        return;
      }

      // A situação nasce UMA vez por folha. Numa segunda tentativa reusamos o
      // mesmo grupo, senão cada toque viraria uma situação repetida.
      let groupId = grupoRef.current;
      if (!groupId) {
        const criada = await createFn({
          data: {
            propertyId,
            logId: target.logId,
            reservationId: target.reservationId,
            cardMode,
            category,
            title: title.trim() || null,
            description: description.trim() || null,
            media: [],
            pendingMedia: items.length,
          },
        });
        groupId = (criada as { groupId?: string })?.groupId ?? null;
        if (!groupId) throw new Error("Não consegui abrir o registro.");
        grupoRef.current = groupId;
        if ((criada as { taskCreated?: boolean })?.taskCreated) {
          toast.success("Situação registrada e pendência aberta.");
        } else if (items.length === 0) {
          toast.success("Situação registrada.");
        }
      }

      // A tela fica acesa enquanto sobe: com a aba em segundo plano o sistema
      // operacional mata o envio muito mais cedo.
      let lock: { release: () => Promise<void> } | null = null;
      try {
        const wl = (
          navigator as Navigator & {
            wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
          }
        ).wakeLock;
        lock = wl ? await wl.request("screen") : null;
      } catch {
        /* sem wake lock o envio continua, só fica mais frágil */
      }

      const folder = target.logId ?? target.reservationId;
      const enviados: string[] = [];
      const falharam: string[] = [];
      let ultimaMensagem: string | null = null;
      let feitos = 0;

      for (const it of items) {
        if (ctrl.signal.aborted) break;
        const path = `${propertyId}/${folder}/${crypto.randomUUID()}.${extFor(it.kind, it.mime)}`;
        const r = await enviarMidia({
          bucket: "reservation-records",
          path,
          blob: it.blob,
          // Alguns Android devolvem o arquivo SEM tipo. `??` não pega string
          // vazia, então o tipo ia vazio para o servidor e o registro era
          // recusado na validação. Aqui há um padrão de verdade.
          contentType: it.mime || "application/octet-stream",
          signal: ctrl.signal,
          onProgress: (pct) => setProgresso({ feitos, total: items.length, pct }),
        });

        if (r.ok) {
          try {
            await appendFn({
              data: {
                groupId,
                propertyId,
                path,
                kind: it.kind,
                mime: it.mime || "application/octet-stream",
                sizeBytes: it.blob.size,
                durationMs: it.durationMs,
              },
            });
            enviados.push(it.key);
          } catch (e) {
            falharam.push(it.name || it.kind);
            ultimaMensagem = (e as Error)?.message ?? null;
          }
        } else if (r.motivo === "cancelado") {
          break;
        } else {
          falharam.push(it.name || it.kind);
          ultimaMensagem = r.mensagem;
          /* A FALHA DEIXA RASTRO (11/09/2026).
           *
           * O envio anterior falhava em silêncio: nenhum erro no servidor,
           * nenhum evento, nada. Só descobrimos porque a equipe reclamou e eu
           * fui cavar o banco. Agora cada arquivo que não sobe vira um evento
           * com tamanho, tipo e MOTIVO — se acontecer de novo, aparece
           * sozinho. */
          track({
            type: "record_media_failed",
            label: "Falha ao enviar mídia de situação",
            category: "ERROR",
            severity: "error",
            metadata: {
              kind: it.kind,
              mime: it.mime || null,
              sizeBytes: it.blob.size,
              motivo: r.motivo,
              propertyId,
              groupId,
            },
          });
        }

        feitos += 1;
        setProgresso({ feitos, total: items.length, pct: 0 });
      }

      await lock?.release().catch(() => {});

      // O que subiu sai da folha: "tentar de novo" reenvia só o que faltou, e
      // nunca duplica o que já está registrado.
      if (enviados.length) {
        setItems((prev) => {
          for (const it of prev) {
            if (enviados.includes(it.key) && it.previewUrl) URL.revokeObjectURL(it.previewUrl);
          }
          return prev.filter((it) => !enviados.includes(it.key));
        });
      }

      if (ctrl.signal.aborted) {
        setErro(
          enviados.length
            ? `Envio cancelado. ${enviados.length} arquivo(s) já ficaram guardados; o resto continua aqui.`
            : "Envio cancelado. O texto já está salvo — toque em registrar quando quiser.",
        );
        return;
      }

      if (falharam.length) {
        setErro(
          `${ultimaMensagem ?? "Não consegui enviar."} ${enviados.length} de ${items.length} arquivo(s) subiram. Toque em "Registrar situação" para tentar o resto — o que já subiu está guardado.`,
        );
        onSaved();
        return;
      }

      if (items.length > 0) toast.success("Situação registrada.");
      // Deu tudo certo: o rascunho cumpriu o papel e sai de cena.
      void apagarRascunho(chave);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setErro((e as Error).message || "Não consegui registrar a situação.");
    } finally {
      cancelarRef.current = null;
      setProgresso(null);
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
          {/* O QUE FICOU PARA TRÁS (11/09/2026). Aparece só quando existe algo
              guardado deste mesmo imóvel e reserva — na folha limpa do dia a
              dia esta faixa não existe. */}
          {rascunho && (
            <div className="rounded-[0.35rem] border border-[#E82DAE]/30 bg-[#7C1AD8]/[0.07] px-3 py-2.5">
              <div className="flex items-start gap-2">
                <RotateCcw className="mt-px size-3.5 shrink-0 text-[#c084fc]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] font-bold leading-snug text-foreground">
                    Você tem um registro não enviado
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">
                    {resumoRascunho(rascunho)} — ficou guardado neste aparelho. Nada foi perdido.
                  </p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={descartarRascunho}
                  className="px-1.5 py-1 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  Começar do zero
                </button>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={retomarRascunho}
                  className="rounded-[0.3rem] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-3 py-1.5 text-[11px] font-bold text-white"
                >
                  Retomar
                </button>
              </div>
            </div>
          )}

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

        {/* O ERRO MORA NA FOLHA, não num toast que some (11/09/2026): a
            pessoa precisa ler o que houve E ter o botão de tentar de novo
            embaixo, sem perder nada do que já digitou. */}
        {erro && (
          <p className="flex items-start gap-1.5 border-t border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>{erro}</span>
          </p>
        )}

        {/* Enquanto sobe, o pior inimigo é a pessoa trocar de aba: o sistema
            operacional mata o envio. A barra e a porcentagem existem para
            segurá-la aqui — foi a falta delas que fez o envio parecer travado. */}
        {progresso && (
          <div className="border-t border-border/60 bg-amber-500/[0.07] px-3.5 py-2">
            <div className="h-1 w-full overflow-hidden rounded-full bg-amber-500/20">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE] transition-[width] duration-300"
                style={{ width: `${Math.max(3, progresso.pct)}%` }}
              />
            </div>
            <p className="mt-1.5 text-center text-[11px] leading-snug text-amber-600 dark:text-amber-400">
              Enviando os arquivos — mantenha esta tela aberta. O texto já está salvo.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-border/50 bg-secondary/20 px-3.5 py-2.5">
          {/* NUNCA PRENDER NINGUÉM (11/09/2026): antes este botão ficava
              desabilitado durante o envio e o diálogo não fechava, então um
              envio pendurado só saía recarregando a página — e aí perdia
              tudo. Agora ele CORTA o envio; o que já subiu fica guardado. */}
          <button
            type="button"
            onClick={saving ? cancelarEnvio : () => onOpenChange(false)}
            className="rounded-[0.3rem] px-2.5 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          >
            {saving ? "Cancelar envio" : "Descartar"}
          </button>
          <span className="flex-1" />
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-[0.3rem] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-3.5 py-2 text-[12px] font-bold text-white disabled:from-muted disabled:to-muted disabled:text-muted-foreground"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {progresso
              ? `Enviando ${Math.min(progresso.feitos + 1, progresso.total)} de ${progresso.total}${progresso.pct > 0 ? ` · ${progresso.pct}%` : "…"}`
              : erro
                ? "Tentar de novo"
                : "Registrar situação"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
