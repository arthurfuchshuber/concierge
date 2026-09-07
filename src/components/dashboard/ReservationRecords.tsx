import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Paperclip,
  Camera,
  Video,
  FileText,
  Download,
  Loader2,
  Send,
  Trash2,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import {
  listReservationRecords,
  attachReservationRecord,
  createReservationRecordNote,
  deleteReservationRecord,
  type ReservationRecord,
} from "@/lib/reservation-records.functions";
import type { ArrivalRow } from "@/lib/dashboard-arrival-types";

// "Registros da reserva" (pedido explícito, 07/09/2026): mesmo ícone em
// QUALQUER status do card (Check-in, Estadia, Checkout, Fila de Limpeza,
// Concluídos, Não Compareceu) abrindo uma linha do tempo ÚNICA por reserva
// — tudo cai no mesmo lugar, não importa em qual card foi registrado.
type CardMode = "checkin" | "checkout" | "stay" | "cleaning" | "done" | "no_show";

const MODE_LABEL: Record<CardMode, string> = {
  checkin: "Check-in",
  checkout: "Checkout",
  stay: "Estadia",
  cleaning: "Fila de Limpeza",
  done: "Concluído",
  no_show: "Não Compareceu",
};
// Mesmas cores já usadas nas colunas do Kanban (KanbanColumn tone=…), só
// pra etiqueta de origem de cada registro na linha do tempo.
const MODE_TONE: Record<CardMode, string> = {
  checkin: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  checkout: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  stay: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30",
  cleaning: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30",
  done: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/30",
  no_show: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30",
};

/** Mesmo critério de statusTarget/resolveTarget (advanceArrival, markNoShow,
 * auto-checkout): `logId` só é um UUID real quando não é o placeholder
 * "ical:<reservation_id>" usado por reservas só-iCal. */
function resolveReservationTarget(row: { logId: string; reservationId: string | null }): {
  logId?: string;
  reservationId?: string;
} {
  const logId = /^[0-9a-f-]{36}$/i.test(row.logId) ? row.logId : undefined;
  const reservationId = row.reservationId ?? (row.logId.startsWith("ical:") ? row.logId.slice(5) : undefined);
  return { logId, reservationId: reservationId ?? undefined };
}

function inferKind(mime: string): "photo" | "video" | "audio" | "file" {
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

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function RecordEntry({ r, onDelete }: { r: ReservationRecord; onDelete: (id: string) => void }) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1 rounded-lg border border-border/60 bg-card px-2.5 py-2">
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${MODE_TONE[r.cardMode]}`}
          >
            {MODE_LABEL[r.cardMode]}
          </span>
          <span className="text-[10.5px] text-muted-foreground ml-auto tabular-nums">
            {fmtWhen(r.createdAt)}
            {r.createdByName ? ` · ${r.createdByName}` : ""}
          </span>
        </div>

        {r.kind === "note" && <p className="text-xs text-foreground/90 whitespace-pre-wrap break-words">{r.body}</p>}

        {r.kind === "photo" && r.url && (
          <a href={r.url} target="_blank" rel="noreferrer" className="block">
            <img src={r.url} alt={r.fileName ?? "Foto"} className="max-h-56 w-auto rounded-md border border-border/50" />
          </a>
        )}

        {r.kind === "video" && r.url && (
          <video src={r.url} controls className="max-h-56 w-full rounded-md border border-border/50 bg-black" />
        )}

        {r.kind === "audio" && r.url && (
          <audio src={r.url} controls className="w-full h-9" />
        )}

        {r.kind === "file" && r.url && (
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-md border border-border/50 bg-secondary/30 px-2 py-1.5 hover:bg-secondary/50"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs">{r.fileName ?? "Arquivo"}</span>
            <Download className="size-3.5 shrink-0 text-muted-foreground" />
          </a>
        )}

        {r.body && r.kind !== "note" && <p className="mt-1.5 text-xs text-foreground/80 whitespace-pre-wrap break-words">{r.body}</p>}

        {r.sizeBytes ? <div className="mt-1 text-[10px] text-muted-foreground">{fmtSize(r.sizeBytes)}</div> : null}
      </div>
      <button
        type="button"
        onClick={() => onDelete(r.id)}
        title="Excluir registro"
        aria-label="Excluir registro"
        className="shrink-0 grid place-items-center size-7 mt-0.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function ReservationRecordsDialog({
  open,
  onOpenChange,
  row,
  mode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: ArrivalRow;
  mode: CardMode;
}) {
  const target = useMemo(() => resolveReservationTarget(row), [row.logId, row.reservationId]);
  const listFn = useServerFn(listReservationRecords);
  const attachFn = useServerFn(attachReservationRecord);
  const noteFn = useServerFn(createReservationRecordNote);
  const deleteFn = useServerFn(deleteReservationRecord);
  const qc = useQueryClient();
  const queryKey = ["reservation-records", target.logId ?? "", target.reservationId ?? ""];

  const q = useQuery({
    queryKey,
    queryFn: () => listFn({ data: target }),
    enabled: open,
    staleTime: 10_000,
  });

  const [uploading, setUploading] = useState(false);
  const [text, setText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: invalidate,
    onError: () => toast.error("Não consegui excluir o registro."),
  });

  async function uploadAndAttach(file: Blob, opts: { name?: string | null; mime?: string; durationMs?: number }) {
    const mime = opts.mime ?? (file as File).type ?? "application/octet-stream";
    const kind = inferKind(mime);
    setUploading(true);
    setErrorMsg(null);
    try {
      const ext = extFor(kind, mime);
      const folder = target.logId ?? target.reservationId;
      const path = `${row.propertyId}/${folder}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("reservation-records")
        .upload(path, file, { contentType: mime, upsert: false });
      if (upErr) throw new Error(upErr.message);
      await attachFn({
        data: {
          propertyId: row.propertyId,
          logId: target.logId,
          reservationId: target.reservationId,
          cardMode: mode,
          path,
          kind,
          mime,
          sizeBytes: file.size,
          durationMs: opts.durationMs ?? null,
          fileName: opts.name ?? null,
          caption: null,
        },
      });
      invalidate();
    } catch (e) {
      setErrorMsg((e as Error).message || "Falha ao enviar o registro.");
    } finally {
      setUploading(false);
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    await uploadAndAttach(f, { name: f.name, mime: f.type });
  }

  async function onAudioRecorded(audio: RecordedAudio) {
    const filename = `audio-${Date.now()}.${audio.mime.includes("mp4") ? "m4a" : "webm"}`;
    await uploadAndAttach(audio.blob, { name: filename, mime: audio.mime, durationMs: audio.durationMs });
  }

  const noteMutation = useMutation({
    mutationFn: (body: string) =>
      noteFn({ data: { propertyId: row.propertyId, logId: target.logId, reservationId: target.reservationId, cardMode: mode, body } }),
    onSuccess: () => {
      setText("");
      invalidate();
    },
    onError: () => toast.error("Não consegui salvar a descrição."),
  });

  const records = q.data?.records ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-lg border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50">
          <DialogTitle className="text-base font-display leading-tight truncate">
            {row.guestName && row.guestName !== row.reservationCode ? row.guestName : "Registros da reserva"}
          </DialogTitle>
          <div className="ds-meta mt-0.5 truncate">{row.propertyName ?? "Imóvel"}</div>
        </DialogHeader>

        <div className="sg-elegant-scroll max-h-[46vh] overflow-y-auto px-3 py-3 bg-secondary/10">
          {q.isLoading ? (
            <div className="py-10 grid place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Nenhum registro ainda — fotos, vídeos, áudios, arquivos ou descrições ficam aqui, juntos, não
              importa em qual etapa forem adicionados.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {records.map((r) => (
                <RecordEntry key={r.id} r={r} onDelete={(id) => deleteMutation.mutate(id)} />
              ))}
            </div>
          )}
        </div>

        <div className="px-3 pt-2.5 pb-3 border-t border-border/50">
          {uploading && (
            <div className="pb-1.5 text-[10.5px] text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> enviando…
            </div>
          )}
          {errorMsg && <div className="pb-1.5 text-[10.5px] text-destructive">{errorMsg}</div>}

          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFilePicked} />
          <input ref={videoInputRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={onFilePicked} />
          <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} />

          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            <button
              type="button"
              disabled={uploading}
              onClick={() => photoInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-50"
            >
              <Camera className="size-3.5" /> Foto
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => videoInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-50"
            >
              <Video className="size-3.5" /> Vídeo
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-50"
            >
              <Paperclip className="size-3.5" /> Arquivo
            </button>
            <AudioRecorderButton disabled={uploading} maxSeconds={120} onRecorded={onAudioRecorded} compact />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim() || noteMutation.isPending) return;
              noteMutation.mutate(text.trim());
            }}
            className="flex items-center gap-2"
          >
            <div className="flex-1 min-w-0 flex items-center rounded-full border border-border bg-background px-3 h-9">
              <StickyNote className="size-3.5 text-muted-foreground shrink-0 mr-1.5" />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Descrever situação, problema ou auditoria…"
                className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="submit"
              disabled={!text.trim() || noteMutation.isPending}
              className="shrink-0 grid place-items-center size-9 rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              aria-label="Salvar descrição"
            >
              {noteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Ícone que abre o painel "Registros da reserva" — mesmo tamanho/estilo dos
 * outros botões de ação do card (Maps, "⋮"), presente em QUALQUER status. */
export function ReservationRecordsButton({
  row,
  mode,
  compact,
}: {
  row: ArrivalRow;
  mode: CardMode;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Registros da reserva"
        title="Registros da reserva (fotos, vídeos, áudios, arquivos e descrições)"
        className={`grid place-items-center rounded-lg bg-background/60 border border-border/50 hover:bg-primary/[0.08] ${compact ? "size-6" : "size-9"}`}
      >
        <Paperclip className={compact ? "size-3.5" : "size-4"} />
      </button>
      {open && <ReservationRecordsDialog open={open} onOpenChange={setOpen} row={row} mode={mode} />}
    </>
  );
}
