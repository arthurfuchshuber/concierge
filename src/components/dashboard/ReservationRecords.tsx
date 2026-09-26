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
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { useUndoableRecordDelete } from "@/hooks/useUndoableRecordDelete";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";
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
  appendSituationMedia,
  deleteReservationRecord,
  listReservationRecords,
  updateRecordText,
  type ReservationRecord,
  type RecordCategory,
} from "@/lib/reservation-records.functions";
import { RecordSituationSheet } from "@/components/dashboard/RecordSituationSheet";
import {
  draftItemFrom,
  extFor,
  inferKind,
  type DraftItem,
} from "@/components/dashboard/record-draft";
import { chamarServidor, enviarMidia, garantirToken } from "@/lib/media-upload";
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
export function AudioPlayer({ url, durationMs }: { url: string; durationMs: number | null }) {
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
    // MESMA SITUAÇÃO: desde 10/09/2026 as mídias registradas juntas
    // compartilham `groupId`, então o bloco é exato, sem adivinhação.
    const sameSituation = !!lastItem && !!r.groupId && lastItem.groupId === r.groupId;
    // Registros ANTIGOS não têm grupo — segue valendo a heurística de lote
    // (mesmas fotos, mesma categoria, mesmo minuto, sem texto).
    const sameBatch =
      !!lastItem &&
      lastItem.kind === "photo" &&
      r.kind === "photo" &&
      lastItem.category === r.category &&
      !lastItem.body &&
      !r.body &&
      Math.abs(new Date(r.createdAt).getTime() - new Date(lastItem.createdAt).getTime()) < 120_000;
    if (sameSituation || sameBatch) last.items.push(r);
    else out.push({ key: r.id, items: [r] });
  }
  return out;
}

const KIND_LABEL: Record<string, string> = {
  photo: "foto",
  video: "vídeo",
  audio: "áudio",
  file: "arquivo",
};

const KIND_PLURAL: Record<string, string> = {
  photo: "fotos",
  video: "vídeos",
  audio: "áudios",
  file: "arquivos",
};

/** Resumo honesto do que a situação tem: "1 vídeo", "2 fotos · 1 vídeo".
 * A NOTA DE TEXTO NUNCA conta como mídia (bug 20/09/2026: uma situação com
 * 1 vídeo + o texto "Limpeza" aparecia como "2 mídias" e o menu oferecia
 * "Excluir foto 1 / Excluir foto 2" — nem foto era). */
function mediaSummary(items: ReservationRecord[]): string {
  const order = ["photo", "video", "audio", "file"] as const;
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
  return order
    .filter((k) => (counts.get(k) ?? 0) > 0)
    .map((k) => {
      const n = counts.get(k)!;
      return `${n} ${n === 1 ? KIND_LABEL[k] : KIND_PLURAL[k]}`;
    })
    .join(" · ");
}

function fmtDuration(ms: number | null): string | null {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Miniatura quadrada pequena (pedido 20/09/2026): o card deixa de ser
 * dominado pelo player — toca para abrir a mídia em tela cheia. */
function MediaThumb({
  item,
  onOpen,
}: {
  item: ReservationRecord;
  onOpen: (it: ReservationRecord) => void;
}) {
  const dur = fmtDuration(item.durationMs);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`Abrir ${KIND_LABEL[item.kind] ?? "registro"}`}
      className="relative size-[68px] shrink-0 overflow-hidden rounded-lg border border-border/50 bg-secondary/40"
    >
      {item.kind === "photo" && item.url ? (
        <img
          src={item.url}
          alt={item.fileName ?? "Foto"}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : item.kind === "video" && item.url ? (
        <>
          <video
            src={`${item.url}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            className="size-full bg-black object-cover"
          />
          <span className="absolute inset-0 grid place-items-center bg-black/25">
            <span className="grid size-6 place-items-center rounded-full bg-white/20 backdrop-blur-sm">
              <Play className="size-3 fill-white text-white" />
            </span>
          </span>
        </>
      ) : (
        <span className="grid size-full place-items-center text-muted-foreground">
          {item.kind === "audio" ? <Mic className="size-4" /> : <FileText className="size-4" />}
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/55 px-1 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-white">
        <span className="truncate">{KIND_LABEL[item.kind] ?? "item"}</span>
        {dur && <span className="shrink-0 tabular-nums">{dur}</span>}
      </span>
    </button>
  );
}

/** Editar a situação (decisão 20/09/2026): o menu não fatia mais o registro
 * — ou se EDITA (texto + mídias: apagar as que já estão lá e acrescentar
 * novas), ou se EXCLUI o registro inteiro. */
function RecordEditDialog({
  group,
  propertyId,
  target,
  open,
  onOpenChange,
  onChanged,
}: {
  group: RecordGroup;
  propertyId: string | null;
  target: { logId?: string; reservationId?: string };
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const head = group.items[0];
  const updateFn = useServerFn(updateRecordText);
  const appendFn = useServerFn(appendSituationMedia);
  const deleteFn = useServerFn(deleteReservationRecord);
  const qc = useQueryClient();
  const [first, ...rest] = (head.body ?? "").split("\n");
  const [title, setTitle] = useState(first ?? "");
  const [description, setDescription] = useState(rest.join("\n"));
  const [saving, setSaving] = useState(false);
  const [busyMedia, setBusyMedia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const requiresTitle = !!CATEGORY_BY_KEY.get(head.category)?.createsTask;
  const media = group.items.filter((it) => it.kind !== "note");
  const addRef = useRef<HTMLInputElement>(null);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["reservation-records"] });
    void qc.invalidateQueries({ queryKey: ["account-records"] });
    onChanged();
  }

  async function removeMedia(it: ReservationRecord) {
    if (busyMedia) return;
    setBusyMedia(it.id);
    try {
      await deleteFn({ data: { id: it.id } });
      toast.success(`${KIND_LABEL[it.kind] ?? "Item"} excluído.`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message || "Não consegui excluir.");
    } finally {
      setBusyMedia(null);
    }
  }

  async function addMedia(file: File) {
    const groupId = head.groupId ?? head.id;
    if (!propertyId) {
      toast.error("Não consegui identificar o imóvel deste registro.");
      return;
    }
    setEnviando(true);
    try {
      const token = await garantirToken();
      if (!token) {
        toast.error("Sua sessão expirou. Entre de novo e tente outra vez.");
        return;
      }
      const mime = file.type || "application/octet-stream";
      const kind = inferKind(mime);
      const folder = target.logId ?? target.reservationId ?? "avulso";
      const path = `${propertyId}/${folder}/${crypto.randomUUID()}.${extFor(kind, mime)}`;
      const r = await enviarMidia({
        bucket: "reservation-records",
        path,
        blob: file,
        contentType: mime,
      });
      if (!r.ok) {
        toast.error(r.mensagem);
        return;
      }
      await chamarServidor(() =>
        appendFn({
          data: {
            groupId,
            propertyId,
            path,
            kind,
            mime,
            sizeBytes: file.size,
            durationMs: null,
          },
        }),
      );
      toast.success("Adicionado ao registro.");
      refresh();
    } catch (e) {
      toast.error((e as Error).message || "Não consegui adicionar.");
    } finally {
      setEnviando(false);
    }
  }

  async function save() {
    if (saving || (requiresTitle && !title.trim())) return;
    setSaving(true);
    try {
      await updateFn({
        data: { id: head.id, title: title.trim(), description: description.trim() || null },
      });
      refresh();
      toast.success("Registro atualizado.");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || "Não consegui salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] gap-0 p-0 sm:max-w-sm">
        <DialogHeader className="px-4 pb-2 pt-4">
          <DialogTitle className="text-[15px] font-display">Editar registro</DialogTitle>
        </DialogHeader>
        <div className="space-y-2.5 px-4 pb-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={50}
            placeholder="Em poucas palavras, o que houve"
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs outline-none placeholder:text-muted-foreground"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Onde, desde quando, o que precisa ser feito"
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none placeholder:text-muted-foreground"
          />

          {/* Fotos, vídeos, áudios e arquivos deste registro: dá para tirar os
              que não servem e juntar novos, sem abrir outro registro. */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Fotos, vídeos e arquivos
            </p>
            {media.length === 0 ? (
              <p className="text-[11px] italic text-muted-foreground">Nenhuma mídia neste registro.</p>
            ) : (
              <div className="ds-scroll-x flex gap-1.5">
                {media.map((it) => (
                  <div key={it.id} className="relative shrink-0">
                    <MediaThumb item={it} onOpen={() => {}} />
                    <button
                      type="button"
                      onClick={() => void removeMedia(it)}
                      disabled={!!busyMedia}
                      aria-label={`Excluir ${KIND_LABEL[it.kind] ?? "item"}`}
                      className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow hover:text-rose-500"
                    >
                      {busyMedia === it.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Trash2 className="size-3" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={addRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void addMedia(f);
              }}
            />
            <button
              type="button"
              onClick={() => addRef.current?.click()}
              disabled={enviando}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-60"
            >
              {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
              {enviando ? "Enviando…" : "Adicionar mídia"}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-[0.3rem] px-2.5 py-1.5 text-[10.5px] font-bold text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={save}
              disabled={saving || (requiresTitle && !title.trim())}
              className="rounded-[0.3rem] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-3 py-1.5 text-[10.5px] font-bold text-white disabled:from-muted disabled:to-muted disabled:text-muted-foreground"
            >
              Salvar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


export function RecordBlock({
  group,
  onDelete,
  propertyId = null,
  target = {},
  onChanged = () => {},
}: {
  group: RecordGroup;
  onDelete: (ids: string[]) => void;
  propertyId?: string | null;
  target?: { logId?: string; reservationId?: string };
  onChanged?: () => void;
}) {
  const head = group.items[0];
  const [viewing, setViewing] = useState<ReservationRecord | null>(null);
  const [editing, setEditing] = useState(false);

  const mediaItems = group.items.filter((it) => it.kind !== "note" && it.url);
  const body = group.items.find((it) => it.body)?.body ?? null;
  const audioOnly = mediaItems.length === 1 && mediaItems[0].kind === "audio";

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-card ${
        head.category === "damage" ? "border-rose-500/35" : "border-border/60"
      }`}
    >
      <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-2.5">
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
          <DropdownMenuContent align="end" className="min-w-[11rem]">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil className="size-3.5 shrink-0" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete(group.items.map((it) => it.id))}>
              <Trash2 className="size-3.5 shrink-0" />
              Excluir registro
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {editing && (
        <RecordEditDialog
          group={group}
          propertyId={propertyId}
          target={target}
          open
          onOpenChange={setEditing}
          onChanged={onChanged}
        />
      )}

      <div className="flex items-start gap-2.5 px-2.5 pb-2.5">
        {mediaItems.length > 0 && !audioOnly && (
          /* Mais de uma mídia: fileira rolável (`ds-scroll-x`, sem degradê de
             fade — regra do projeto), nunca estourando a margem direita. */
          <div
            className={
              mediaItems.length > 1
                ? "ds-scroll-x flex max-w-[150px] gap-1.5"
                : "flex shrink-0 gap-1.5"
            }
          >
            {mediaItems.map((it) => (
              <MediaThumb key={it.id} item={it} onOpen={setViewing} />
            ))}
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-1">
          {body && (
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
              {body}
            </p>
          )}
          {audioOnly && mediaItems[0].url && (
            <AudioPlayer url={mediaItems[0].url!} durationMs={mediaItems[0].durationMs} />
          )}
          {!body && mediaItems.length === 0 && (
            <p className="text-[11px] italic text-muted-foreground">Registro sem conteúdo.</p>
          )}
          {/* Cada pedaço carrega o "·" junto dele (nunca solto no fim da
              linha) e quebra linha inteiro. */}
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            {[
              head.createdByName ?? "Equipe",
              head.cardMode ? `via ${MODE_LABEL[head.cardMode]}` : null,
              mediaItems.length > 0 ? mediaSummary(mediaItems) : null,
              mediaItems.length === 1 && head.sizeBytes ? fmtSize(head.sizeBytes) : null,
            ]
              .filter(Boolean)
              .map((t, i) => (
                <span key={i} className="inline-block whitespace-nowrap">
                  {i > 0 && <span className="px-1 opacity-50">·</span>}
                  {t}
                </span>
              ))}
          </p>
        </div>
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

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="px-4 pb-2 pt-4">
            <DialogTitle className="truncate text-[14px] font-display">
              {viewing?.fileName ?? KIND_LABEL[viewing?.kind ?? "file"]}
            </DialogTitle>
          </DialogHeader>
          <div className="px-3 pb-3">
            {viewing?.kind === "photo" && viewing.url && (
              <img
                src={viewing.url}
                alt={viewing.fileName ?? "Foto"}
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
            )}
            {viewing?.kind === "video" && viewing.url && (
              <video
                src={viewing.url}
                controls
                autoPlay
                playsInline
                className="max-h-[70vh] w-full rounded-md bg-black"
              />
            )}
            {viewing?.kind === "audio" && viewing.url && (
              <AudioPlayer url={viewing.url} durationMs={viewing.durationMs} />
            )}
            {viewing?.kind === "file" && viewing.url && (
              <a
                href={viewing.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border border-border/50 bg-secondary/30 px-2 py-2 hover:bg-secondary/50"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {viewing.fileName ?? "Arquivo"}
                </span>
                <Download className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
      <DialogContent className="w-[calc(100vw-2rem)] gap-0 p-0 sm:max-w-sm">
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

export function ReservationRecordsDialog({
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
  const qc = useQueryClient();
  const queryKey = ["reservation-records", target.logId ?? "", target.reservationId ?? ""];

  const q = useQuery({
    queryKey,
    queryFn: () => listFn({ data: target }),
    enabled: open,
    staleTime: 10_000,
  });

  const [text, setText] = useState("");
  const [filter, setFilter] = useState<RecordCategory | "all">("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pickedCategory, setPickedCategory] = useState<RecordCategory | null>(null);
  const [recordingAudio, setRecordingAudio] = useState(false);

  /* A FOLHA DA SITUAÇÃO (10/09/2026). A captura não envia mais nada sozinha:
   * ela monta um rascunho e abre a folha, onde a pessoa junta mais arquivos
   * da MESMA situação, escreve título e descrição (falando, se quiser) e só
   * então toca em "Registrar situação". Fechou, a próxima captura abre uma
   * folha nova — "e assim por diante". */
  const [situation, setSituation] = useState<{
    category: RecordCategory;
    item: DraftItem | null;
    title: string;
  } | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey });
    // A pendência criada entra na lista do botão PENDÊNCIAS na hora.
    qc.invalidateQueries({ queryKey: ["dash-tasks"] });
  };

  // Excluir com "Desfazer" e resposta instantânea (17/09/2026).
  const deleteRecord = useUndoableRecordDelete();
  // Ao vivo para todos (17/09/2026): o que outra pessoa registra nesta
  // reserva aparece aqui na hora, com o clipe aberto.
  useRealtimeInvalidate(
    "reservation-records-live",
    [{ table: "reservation_records" }],
    [["reservation-records"]],
    { enabled: open },
  );

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
    else if (action === "note") {
      // Texto digitado também abre a folha: vira o título, e a pessoa
      // completa a descrição (ou dita) antes de registrar.
      setSituation({ category, item: null, title: text.trim().slice(0, 50) });
      setText("");
    }
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    // A categoria já foi escolhida na folha, antes da câmera abrir.
    const category = pickedCategory ?? FALLBACK_CATEGORY;
    setSituation({
      category,
      item: draftItemFrom(f, { name: f.name, mime: f.type }),
      title: "",
    });
  }

  function onAudioRecorded(audio: RecordedAudio) {
    const category = pickedCategory ?? FALLBACK_CATEGORY;
    const filename = `audio-${Date.now()}.${audio.mime.includes("mp4") ? "m4a" : "webm"}`;
    setRecordingAudio(false);
    setSituation({
      category,
      item: draftItemFrom(audio.blob, {
        name: filename,
        mime: audio.mime,
        durationMs: audio.durationMs,
      }),
      title: "",
    });
  }

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
        <DialogContent className="w-[calc(100vw-2rem)] overflow-hidden p-0 sm:w-full sm:max-w-md">
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
                      <RecordBlock
                        group={g}
                        onDelete={deleteRecord}
                        propertyId={row.propertyId}
                        target={target}
                        onChanged={invalidate}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 px-3 pb-3 pt-2.5">
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
                  onClick={() => requestAction("photo")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 "
                >
                  <Camera className="size-3.5" /> Foto
                </button>
                <button
                  type="button"
                  onClick={() => requestAction("video")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-50"
                >
                  <Video className="size-3.5" /> Vídeo
                </button>
                <button
                  type="button"
                  onClick={() => requestAction("file")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/30 px-2.5 py-1.5 text-[11px] font-medium text-foreground/80 hover:bg-secondary/50 disabled:opacity-50"
                >
                  <Paperclip className="size-3.5" /> Arquivo
                </button>
                <button
                  type="button"
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
                if (!text.trim()) return;
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
                disabled={!text.trim()}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
                aria-label="Descrever situação"
              >
                <Send className="size-4" />
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

      {situation && (
        <RecordSituationSheet
          open
          onOpenChange={(v) => !v && setSituation(null)}
          propertyId={row.propertyId}
          propertyLabel={row.propertyName ?? "Imóvel"}
          target={target}
          cardMode={mode}
          category={situation.category}
          initial={situation.item}
          initialTitle={situation.title}
          onSaved={invalidate}
        />
      )}
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
