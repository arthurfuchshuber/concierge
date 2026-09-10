import { useEffect, useMemo, useRef, useState } from "react";
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
  Mic,
  Play,
  Pause,
  Package,
  AlertTriangle,
  Sparkles,
  Wrench,
  ListChecks,
  MoreVertical,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AudioRecorderButton, type RecordedAudio } from "@/components/handoff/AudioRecorderButton";
import {
  CATEGORIES,
  CATEGORY_BY_KEY,
  MODE_LABEL,
  fmtDayLabel,
  type CardMode,
} from "@/components/dashboard/record-categories";
import {
  listReservationRecords,
  attachReservationRecord,
  createReservationRecordNote,
  deleteReservationRecord,
  type ReservationRecord,
  type RecordCategory,
} from "@/lib/reservation-records.functions";
import type { ArrivalRow } from "@/lib/dashboard-arrival-types";

/**
 * Categoria usada como último recurso quando, por algum motivo, a escolha
 * não chegou até o envio (a folha SEMPRE aparece antes da captura, então na
 * prática isso não acontece).
 *
 * Pedido explícito (07/09/2026): NENHUMA categoria é sugerida/destacada na
 * folha — a escolha é sempre 100% do usuário, sem viés visual. Antes
 * "Observação / Outros" vinha marcada como sugerida.
 */
const FALLBACK_CATEGORY: RecordCategory = "other";

/** Mesmo critério de statusTarget/resolveTarget (advanceArrival, markNoShow,
 * auto-checkout): `logId` só é um UUID real quando não é o placeholder
 * "ical:<reservation_id>" usado por reservas só-iCal. */
function resolveReservationTarget(row: { logId: string; reservationId: string | null }): {
  logId?: string;
  reservationId?: string;
} {
  const logId = /^[0-9a-f-]{36}$/i.test(row.logId) ? row.logId : undefined;
  const reservationId =
    row.reservationId ?? (row.logId.startsWith("ical:") ? row.logId.slice(5) : undefined);
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

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Player de áudio próprio — o controle nativo do navegador destoa do app
 * (aparece com "00:00 / 00:00", botão de AirPlay etc.) e muda de cara em
 * cada plataforma. */
function AudioPlayer({ url, durationMs }: { url: string; durationMs: number | null }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const total = durationMs ? durationMs / 1000 : 0;
  const shown = elapsed || total;
  const mm = String(Math.floor(shown / 60)).padStart(2, "0");
  const ss = String(Math.floor(shown % 60)).padStart(2, "0");

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-2">
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setElapsed(el.currentTime);
          if (el.duration && Number.isFinite(el.duration))
            setProgress((el.currentTime / el.duration) * 100);
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setElapsed(0);
        }}
      />
      <button
        type="button"
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (el.paused) {
            void el.play();
            setPlaying(true);
          } else {
            el.pause();
            setPlaying(false);
          }
        }}
        aria-label={playing ? "Pausar áudio" : "Tocar áudio"}
        className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
      >
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </button>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/70">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE] transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
        {mm}:{ss}
      </span>
    </div>
  );
}

function CategoryBadge({ category }: { category: RecordCategory }) {
  const meta = CATEGORY_BY_KEY.get(category) ?? CATEGORIES[4];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.tone}`}
    >
      <Icon className="size-3 shrink-0" />
      {meta.label}
    </span>
  );
}

/** Um bloco da linha do tempo: 1 registro, ou vários registros de foto do
 * MESMO envio (mesma categoria, mesmo minuto) exibidos em grade — auditoria
 * de verdade tem 6, 10 fotos, e uma embaixo da outra a lista fica
 * quilométrica. */
export type RecordGroup = { key: string; items: ReservationRecord[] };

function groupRecords(records: ReservationRecord[]): RecordGroup[] {
  const out: RecordGroup[] = [];
  for (const r of records) {
    const last = out[out.length - 1];
    const lastItem = last?.items[last.items.length - 1];
    const sameBatch =
      !!lastItem &&
      lastItem.kind === "photo" &&
      r.kind === "photo" &&
      lastItem.category === r.category &&
      !lastItem.body &&
      !r.body &&
      Math.abs(new Date(r.createdAt).getTime() - new Date(lastItem.createdAt).getTime()) < 120_000;
    if (sameBatch) last.items.push(r);
    else out.push({ key: r.id, items: [r] });
  }
  return out;
}

export function RecordBlock({
  group,
  onDelete,
}: {
  group: RecordGroup;
  onDelete: (id: string) => void;
}) {
  const head = group.items[0];
  const photos = group.items.length > 1;

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-card ${
        head.category === "damage" ? "border-rose-500/35" : "border-border/60"
      }`}
    >
      <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-2.5">
        <CategoryBadge category={head.category} />
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {fmtClock(head.createdAt)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Opções do registro"
              className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
            >
              <MoreVertical className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            {group.items.map((it, i) => (
              <DropdownMenuItem key={it.id} onClick={() => onDelete(it.id)}>
                <Trash2 className="size-3.5 shrink-0" />
                {photos ? `Excluir foto ${i + 1}` : "Excluir registro"}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="px-2.5 pb-2.5">
        {photos ? (
          <div className="grid grid-cols-2 gap-1">
            {group.items.map((it) =>
              it.url ? (
                <a key={it.id} href={it.url} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={it.url}
                    alt={it.fileName ?? "Foto"}
                    className="aspect-[4/3] w-full rounded-md border border-border/50 object-cover"
                  />
                </a>
              ) : null,
            )}
          </div>
        ) : (
          <>
            {head.kind === "note" && (
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                {head.body}
              </p>
            )}
            {head.kind === "photo" && head.url && (
              <a href={head.url} target="_blank" rel="noreferrer" className="block">
                <img
                  src={head.url}
                  alt={head.fileName ?? "Foto"}
                  className="max-h-56 w-full rounded-md border border-border/50 object-cover"
                />
              </a>
            )}
            {head.kind === "video" && head.url && (
              <video
                src={head.url}
                controls
                className="max-h-56 w-full rounded-md border border-border/50 bg-black"
              />
            )}
            {head.kind === "audio" && head.url && (
              <AudioPlayer url={head.url} durationMs={head.durationMs} />
            )}
            {head.kind === "file" && head.url && (
              <a
                href={head.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border border-border/50 bg-secondary/30 px-2 py-1.5 hover:bg-secondary/50"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {head.fileName ?? "Arquivo"}
                </span>
                <Download className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            )}
            {head.body && head.kind !== "note" && (
              <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/80">
                {head.body}
              </p>
            )}
          </>
        )}
      </div>

      {head.taskId && (
        <div className="mx-2.5 mb-2.5 flex items-center gap-1.5 rounded-lg border border-[#E82DAE]/30 bg-[#E82DAE]/[0.07] px-2 py-1.5 text-[11px] text-foreground/80">
          <ListChecks className="size-3.5 shrink-0 text-[#E82DAE]" />
          <span>
            Virou <b className="font-semibold">pendência</b> no Kanban
          </span>
          <span
            className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${
              head.taskStatus === "done"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : head.taskStatus === "canceled"
                  ? "bg-zinc-500/15 text-muted-foreground"
                  : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
            }`}
          >
            {head.taskStatus === "done"
              ? "Resolvida"
              : head.taskStatus === "canceled"
                ? "Cancelada"
                : "Em aberto"}
          </span>
        </div>
      )}

      <div className="flex items-center gap-1.5 border-t border-border/50 px-2.5 py-1.5 text-[10.5px] text-muted-foreground">
        <span className="truncate">{head.createdByName ?? "Equipe"}</span>
        {head.cardMode && (
          <>
            <span className="opacity-50">·</span>
            <span className="truncate">via {MODE_LABEL[head.cardMode]}</span>
          </>
        )}
        {photos && (
          <>
            <span className="opacity-50">·</span>
            <span className="shrink-0">{group.items.length} fotos</span>
          </>
        )}
        {!photos && head.sizeBytes ? (
          <>
            <span className="opacity-50">·</span>
            <span className="shrink-0">{fmtSize(head.sizeBytes)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** A folha que aparece ANTES da câmera abrir / da gravação começar (pedido
 * explícito, 07/09/2026): sem categoria escolhida, nada é capturado. */
function CategorySheet({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (c: RecordCategory) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] gap-0 rounded-lg border-border/60 p-0 sm:max-w-sm">
        <DialogHeader className="px-4 pb-2 pt-4">
          <DialogTitle className="text-[15px] font-display">O que você vai registrar?</DialogTitle>
          <p className="ds-meta mt-0.5">Escolha a categoria — só depois a captura começa.</p>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 px-3 pb-3.5">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onPick(c.key)}
                className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-2.5 py-2 text-left transition-colors hover:bg-secondary/40"
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-lg border ${c.tone}`}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-foreground">
                    {c.label}
                  </span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {c.hint}
                  </span>
                </span>
                {c.createsTask && (
                  <span className="shrink-0 rounded bg-[#E82DAE]/10 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-[#E82DAE]">
                    pendência
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** O que a pessoa quis fazer antes de escolher a categoria. */
type PendingAction = "photo" | "video" | "file" | "audio" | "note";

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
  const [filter, setFilter] = useState<RecordCategory | "all">("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pickedCategory, setPickedCategory] = useState<RecordCategory | null>(null);
  const [recordingAudio, setRecordingAudio] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey });
    // A pendência criada entra na lista do botão PENDÊNCIAS na hora.
    qc.invalidateQueries({ queryKey: ["dash-tasks"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: invalidate,
    onError: () => toast.error("Não consegui excluir o registro."),
  });

  /** Toque em Foto/Vídeo/Arquivo/Áudio (ou envio de texto): abre a folha de
   * categoria ANTES de qualquer captura. */
  function requestAction(action: PendingAction) {
    if (action === "note" && !text.trim()) return;
    setPendingAction(action);
    setSheetOpen(true);
  }

  /** Categoria escolhida: fecha a folha e só então dispara a ação. */
  function handlePickCategory(category: RecordCategory) {
    setPickedCategory(category);
    setSheetOpen(false);
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action === "photo") photoInputRef.current?.click();
    else if (action === "video") videoInputRef.current?.click();
    else if (action === "file") fileInputRef.current?.click();
    else if (action === "audio") setRecordingAudio(true);
    else if (action === "note") noteMutation.mutate({ body: text.trim(), category });
  }

  async function uploadAndAttach(
    file: Blob,
    category: RecordCategory,
    opts: { name?: string | null; mime?: string; durationMs?: number },
  ) {
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
      const res = await attachFn({
        data: {
          propertyId: row.propertyId,
          logId: target.logId,
          reservationId: target.reservationId,
          cardMode: mode,
          category,
          path,
          kind,
          mime,
          sizeBytes: file.size,
          durationMs: opts.durationMs ?? null,
          fileName: opts.name ?? null,
          caption: null,
        },
      });
      if (res?.taskCreated) toast.success("Registro salvo e pendência aberta no Kanban.");
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
    // A categoria já foi escolhida na folha, antes da câmera abrir.
    const category = pickedCategory ?? FALLBACK_CATEGORY;
    await uploadAndAttach(f, category, { name: f.name, mime: f.type });
  }

  async function onAudioRecorded(audio: RecordedAudio) {
    const category = pickedCategory ?? FALLBACK_CATEGORY;
    const filename = `audio-${Date.now()}.${audio.mime.includes("mp4") ? "m4a" : "webm"}`;
    setRecordingAudio(false);
    await uploadAndAttach(audio.blob, category, {
      name: filename,
      mime: audio.mime,
      durationMs: audio.durationMs,
    });
  }

  const noteMutation = useMutation({
    mutationFn: (v: { body: string; category: RecordCategory }) =>
      noteFn({
        data: {
          propertyId: row.propertyId,
          logId: target.logId,
          reservationId: target.reservationId,
          cardMode: mode,
          category: v.category,
          body: v.body,
        },
      }),
    onSuccess: (res) => {
      setText("");
      if (res?.taskCreated) toast.success("Registro salvo e pendência aberta no Kanban.");
      invalidate();
    },
    onError: () => toast.error("Não consegui salvar a descrição."),
  });

  const records = q.data?.records ?? [];
  const counts = useMemo(() => {
    const m = new Map<RecordCategory, number>();
    for (const r of records) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [records]);
  const openTasks = records.filter((r) => r.taskId && r.taskStatus === "pending").length;
  const visible = filter === "all" ? records : records.filter((r) => r.category === filter);
  const groups = useMemo(() => groupRecords(visible), [visible]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border-border/60 bg-card/95 p-0 shadow-2xl backdrop-blur-xl sm:w-full sm:max-w-md">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <DialogHeader className="border-b border-border/50 px-5 pb-3 pt-5">
            <DialogTitle className="truncate text-base font-display leading-tight">
              {row.guestName && row.guestName !== row.reservationCode
                ? row.guestName
                : "Registros da reserva"}
            </DialogTitle>
            <div className="ds-meta mt-0.5 flex flex-wrap items-center gap-x-1.5 truncate">
              <span className="truncate">{row.propertyName ?? "Imóvel"}</span>
              {records.length > 0 && (
                <>
                  <span className="opacity-50">·</span>
                  <span>
                    {records.length} {records.length === 1 ? "registro" : "registros"}
                  </span>
                </>
              )}
              {openTasks > 0 && (
                <>
                  <span className="opacity-50">·</span>
                  <span className="text-rose-600 dark:text-rose-400">
                    {openTasks} {openTasks === 1 ? "pendência" : "pendências"}
                  </span>
                </>
              )}
            </div>
          </DialogHeader>

          {records.length > 0 && (
            <div className="ds-scroll-x flex gap-1.5 border-b border-border/50 bg-secondary/20 px-3 py-2">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  filter === "all"
                    ? "border-transparent bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
                    : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                Tudo <span className="tabular-nums opacity-80">{records.length}</span>
              </button>
              {CATEGORIES.filter((c) => (counts.get(c.key) ?? 0) > 0).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setFilter(c.key)}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    filter === c.key
                      ? "border-transparent bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
                      : `bg-card ${c.tone}`
                  }`}
                >
                  {c.short} <span className="tabular-nums opacity-80">{counts.get(c.key)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="sg-elegant-scroll max-h-[44vh] overflow-y-auto bg-secondary/10 px-3 py-3">
            {q.isLoading ? (
              <div className="grid place-items-center py-10 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : visible.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                {records.length === 0
                  ? "Nenhum registro ainda — fotos, vídeos, áudios, arquivos ou descrições ficam aqui, juntos, não importa em qual etapa forem adicionados."
                  : "Nenhum registro nesta categoria."}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {groups.map((g, i) => {
                  const prev = groups[i - 1];
                  const showDay =
                    !prev || dayKey(prev.items[0].createdAt) !== dayKey(g.items[0].createdAt);
                  return (
                    <div key={g.key} className="flex flex-col gap-2.5">
                      {showDay && (
                        <div className="flex items-center gap-2 pt-0.5">
                          <span className="h-px flex-1 bg-border/70" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {fmtDayLabel(g.items[0].createdAt)}
                          </span>
                          <span className="h-px flex-1 bg-border/70" />
                        </div>
                      )}
                      <RecordBlock group={g} onDelete={(id) => deleteMutation.mutate(id)} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 px-3 pb-3 pt-2.5">
            {uploading && (
              <div className="inline-flex items-center gap-1 pb-1.5 text-[10.5px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> enviando…
              </div>
            )}
            {errorMsg && <div className="pb-1.5 text-[10.5px] text-destructive">{errorMsg}</div>}

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onFilePicked}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              onChange={onFilePicked}
            />
            <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} />

            {recordingAudio ? (
              <div className="mb-2 flex items-center gap-2">
                <AudioRecorderButton
                  autoStart
                  maxSeconds={120}
                  onRecorded={onAudioRecorded}
                  onCancel={() => setRecordingAudio(false)}
                  compact
                />
              </div>
            ) : (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => requestAction("photo")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-50"
                >
                  <Camera className="size-3.5" /> Foto
                </button>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => requestAction("video")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-50"
                >
                  <Video className="size-3.5" /> Vídeo
                </button>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => requestAction("file")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-50"
                >
                  <Paperclip className="size-3.5" /> Arquivo
                </button>
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => requestAction("audio")}
                  aria-label="Gravar áudio"
                  title="Gravar áudio"
                  className="grid size-8 place-items-center rounded-lg border border-border/60 bg-secondary/30 text-foreground/80 hover:bg-secondary/50 disabled:opacity-50"
                >
                  <Mic className="size-3.5" />
                </button>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim() || noteMutation.isPending) return;
                requestAction("note");
              }}
              className="flex items-center gap-2"
            >
              <div className="flex h-9 min-w-0 flex-1 items-center rounded-full border border-border bg-background px-3">
                <StickyNote className="mr-1.5 size-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Descrever situação, problema ou auditoria…"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
              <button
                type="submit"
                disabled={!text.trim() || noteMutation.isPending}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
                aria-label="Salvar descrição"
              >
                {noteMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      <CategorySheet
        open={sheetOpen}
        onOpenChange={(v) => {
          setSheetOpen(v);
          if (!v) setPendingAction(null);
        }}
        onPick={handlePickCategory}
      />
    </>
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
        /* MESMO botão do Maps e do "⋮" ao lado (pedido explícito, 09/09/2026):
           `rounded-lg` e `size-6` eram os únicos do trio fora do padrão — a
           curva de 0.3rem é a do Design System e o compacto dos vizinhos é
           `size-7`. Com três botões colados, um pixel de diferença aparece. */
        className={`grid place-items-center rounded-[0.3rem] border border-border/50 bg-background/60 hover:bg-primary/[0.08] ${compact ? "size-7" : "size-9"}`}
      >
        <Paperclip className={compact ? "size-3.5" : "size-4"} />
      </button>
      {open && (
        <ReservationRecordsDialog open={open} onOpenChange={setOpen} row={row} mode={mode} />
      )}
    </>
  );
}
