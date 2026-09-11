import { useRef, useState } from "react";
import { Camera, Video, Paperclip, Mic, X, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";

/**
 * Anexos de PENDÊNCIA (pedido explícito, 07/09/2026) — os mesmos quatro
 * botões dos registros da reserva, reaproveitados na criação de uma
 * pendência e na comprovação da resolução.
 *
 * Diferença importante em relação aos registros de reserva: aqui os
 * arquivos ficam RETIDOS EM MEMÓRIA até a ação principal terminar. Na
 * criação, a pendência ainda não existe (não há id pra vincular); na
 * conclusão, o envio só faz sentido se a conclusão de fato for gravada.
 * Por isso o fluxo é: escolher arquivos → salvar/concluir → só então subir
 * os anexos (ver `uploadPendingAttachments`). Nada de arquivo órfão no
 * storage quando a pessoa desiste no meio.
 *
 * Também não há seletor de categoria aqui: a categoria de um anexo de
 * pendência é a da própria pendência — perguntar de novo seria fricção à
 * toa.
 */
export type PendingAttachment = {
  /** Chave local só pra renderizar/remover antes do upload. */
  key: string;
  blob: Blob;
  name: string;
  mime: string;
  durationMs?: number;
  kind: "photo" | "video" | "audio" | "file";
};

function inferKind(mime: string): PendingAttachment["kind"] {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

function extFor(kind: string, mime: string): string {
  if (kind === "audio") {
    if (mime.includes("mp4")) return "m4a";
    if (mime.includes("mpeg")) return "mp3";
    return "webm";
  }
  const sub = mime.split("/")[1] ?? "bin";
  return sub.replace("jpeg", "jpg").split(";")[0];
}

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Sobe os anexos retidos e grava cada um como registro da pendência. Chamar
 * DEPOIS que a pendência existe (criação) ou foi concluída (comprovação).
 * Falha de um arquivo não derruba os outros — nem a ação principal, que já
 * aconteceu.
 */
/** Forma do payload aceito por `attachTaskRecord` — declarada à mão porque
 * derivar do server fn não dá um tipo utilizável aqui. */
export type AttachTaskRecordInput = {
  propertyId: string;
  taskId: string;
  logId?: string;
  reservationId?: string;
  isResolution: boolean;
  path: string;
  kind: "photo" | "video" | "audio" | "file";
  mime: string;
  sizeBytes: number;
  durationMs: number | null;
  fileName: string | null;
  caption: string | null;
};

export async function uploadPendingAttachments(
  attachFn: (args: { data: AttachTaskRecordInput }) => Promise<unknown>,
  files: PendingAttachment[],
  ctx: {
    propertyId: string;
    taskId: string;
    logId?: string;
    reservationId?: string;
    isResolution: boolean;
  },
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const f of files) {
    try {
      const path = `${ctx.propertyId}/task-${ctx.taskId}/${crypto.randomUUID()}.${extFor(f.kind, f.mime)}`;
      const { error: upErr } = await supabase.storage
        .from("reservation-records")
        .upload(path, f.blob, { contentType: f.mime, upsert: false });
      if (upErr) throw new Error(upErr.message);
      await attachFn({
        data: {
          propertyId: ctx.propertyId,
          taskId: ctx.taskId,
          logId: ctx.logId,
          reservationId: ctx.reservationId,
          isResolution: ctx.isResolution,
          path,
          kind: f.kind,
          mime: f.mime,
          sizeBytes: f.blob.size,
          durationMs: f.durationMs ?? null,
          fileName: f.name,
          caption: null,
        },
      });
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

/** Acrescenta um anexo à lista, preservando os que já estavam lá. */
function appendAttachment(
  files: PendingAttachment[],
  onChange: (next: PendingAttachment[]) => void,
  blob: Blob,
  name: string,
  mime: string,
  durationMs?: number,
) {
  onChange([
    ...files,
    { key: crypto.randomUUID(), blob, name, mime, durationMs, kind: inferKind(mime) },
  ]);
}

/**
 * Só o microfone, separado do resto — pedido explícito (07/09/2026): na
 * conclusão de pendência ele fica junto do campo "Como foi resolvido", pra
 * quem prefere explicar falando em vez de digitar. Grava assim que é tocado
 * (autoStart), sem exigir um segundo clique.
 */
export function AudioAttachButton({
  files,
  onChange,
  disabled,
}: {
  files: PendingAttachment[];
  onChange: (next: PendingAttachment[]) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  if (recording) {
    return (
      <AudioRecorderButton
        autoStart
        maxSeconds={120}
        compact
        onCancel={() => setRecording(false)}
        onRecorded={(a) => {
          setRecording(false);
          appendAttachment(
            files,
            onChange,
            a.blob,
            `audio-${Date.now()}.${a.mime.includes("mp4") ? "m4a" : "webm"}`,
            a.mime,
            a.durationMs,
          );
        }}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setRecording(true)}
      aria-label="Gravar áudio"
      title="Gravar áudio"
      className="grid size-8 shrink-0 place-items-center rounded-[0.3rem] border border-border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      <Mic className="size-3.5" />
    </button>
  );
}

export function AttachmentPicker({
  files,
  onChange,
  disabled,
  showAudio = true,
}: {
  files: PendingAttachment[];
  onChange: (next: PendingAttachment[]) => void;
  disabled?: boolean;
  /** false quando o microfone é renderizado à parte (ver AudioAttachButton). */
  showAudio?: boolean;
}) {
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);

  function add(blob: Blob, name: string, mime: string, durationMs?: number) {
    appendAttachment(files, onChange, blob, name, mime, durationMs);
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    add(f, f.name, f.type || "application/octet-stream");
  }

  async function onAudio(a: RecordedAudio) {
    setRecording(false);
    add(
      a.blob,
      `audio-${Date.now()}.${a.mime.includes("mp4") ? "m4a" : "webm"}`,
      a.mime,
      a.durationMs,
    );
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-50";

  return (
    <div>
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

      {recording ? (
        <AudioRecorderButton
          autoStart
          maxSeconds={120}
          onRecorded={onAudio}
          onCancel={() => setRecording(false)}
          compact
        />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => photoRef.current?.click()}
            className={btn}
          >
            <Camera className="size-3.5" /> Foto
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => videoRef.current?.click()}
            className={btn}
          >
            <Video className="size-3.5" /> Vídeo
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className={btn}
          >
            <Paperclip className="size-3.5" /> Arquivo
          </button>
          {showAudio && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setRecording(true)}
              aria-label="Gravar áudio"
              title="Gravar áudio"
              className="grid size-8 place-items-center rounded-lg border border-border/60 bg-secondary/30 text-foreground/80 hover:bg-secondary/50 disabled:opacity-50"
            >
              <Mic className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {files.map((f) => (
            <div
              key={f.key}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2 py-1.5"
            >
              {f.kind === "photo" ? (
                <img
                  src={URL.createObjectURL(f.blob)}
                  alt=""
                  className="size-9 shrink-0 rounded-md border border-border/50 object-cover"
                />
              ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border/50 bg-secondary/40 text-muted-foreground">
                  {f.kind === "video" ? (
                    <Video className="size-4" />
                  ) : f.kind === "audio" ? (
                    <Mic className="size-4" />
                  ) : (
                    <FileText className="size-4" />
                  )}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] font-medium">{f.name}</div>
                <div className="text-[10px] text-muted-foreground">{fmtSize(f.blob.size)}</div>
              </div>
              <button
                type="button"
                onClick={() => onChange(files.filter((x) => x.key !== f.key))}
                aria-label="Remover anexo"
                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Indicador de envio dos anexos, usado enquanto a ação principal termina. */
export function AttachmentsSending({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
      <Loader2 className="size-3 animate-spin" /> enviando {count}{" "}
      {count === 1 ? "anexo" : "anexos"}…
    </div>
  );
}
