// Detalhe de UM lançamento, na MESMA janela da lista: o canto superior direito vira "‹ Voltar"
// (DialogContent `onBack`), nunca uma segunda janela. Serve a Financeiro, Serviços e Limpeza.
//
// LAYOUT DOS MOCKUPS Fin-05 / Fin-06 (aprovados em 18/11/2026): cabeçalho sem filete, quadrantes
// separados por 20px na cor do fundo da janela (tom de card do sistema + sombra leve) e a faixa
// "VALOR" no rodapé. Sem o botão "Abrir registro completo": esta janela JÁ é o registro completo.
// Todo campo alterável abre a janela de edição daquele campo (Fin-14 a Fin-21).
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WINDOW_SUBTITLE_CLASS, WINDOW_TITLE_CLASS } from "./window-header";
import { getFinanceEntryDetail, type FinanceReservation } from "@/lib/finance-entry.functions";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { setCleaningPriceOverride, setCleaningType } from "@/lib/cleaning-price.functions";
import { attachCleaningRecord, setCleaningConcludedAt, updateExtraService } from "@/lib/finance-edit.functions";
import { attachTaskRecord, deleteReservationRecord } from "@/lib/reservation-records.functions";
import { supabase } from "@/integrations/supabase/client";
import { uploadPendingAttachments, type PendingAttachment } from "@/components/dashboard/TaskAttachments";
import { useAreaAccess } from "@/lib/permissions/useAreaAccess";
import { useCleaningBoard, useCleaningProviderControl } from "@/components/dashboard/CleaningProviderAvatar";
import { MediaLightbox } from "@/components/dashboard/MediaLightbox";
import {
  EditDateTimeWindow,
  EditMediaWindow,
  EditProviderWindow,
  EditSituationWindow,
  EditTypeWindow,
  EditValueWindow,
  FIN_BODY,
  FIN_CAP,
  FIN_CARD,
  FIN_FOOT,
  PropertyContextCard,
} from "@/components/dashboard/FinanceEditWindows";

export type FinanceEntry =
  | { kind: "extra"; item: import("@/lib/service-situations").ExtraServiceItem }
  | { kind: "cleaning"; item: import("@/lib/dashboard.functions").CleaningDayItem };

/** Namespace que decide quem pode alterar os lançamentos de limpeza e serviços. */
const EDIT_PERMISSION = "tenant.dashboard.chegadas.limpeza";

function brl(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function fmtShort(iso: string | null | undefined): string | null {
  const f = fmtDay(iso);
  return f ? f.slice(0, 5) : null;
}

function fmtWhenFull(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const time = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

/** Valor dos quadrantes (mockups Fin-05/06/22): 14px, semibold. */
const VAL = "mt-[3px] truncate text-[14px] font-semibold leading-5 text-foreground";

/** Quadrante que abre a edição quando a pessoa pode alterar; sem permissão é só leitura. */
function Tap({
  onClick,
  className,
  children,
  label,
}: {
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  if (!onClick) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn("block w-full cursor-pointer text-left transition-[filter] active:brightness-95", className)}
    >
      {children}
    </button>
  );
}

/** Limpeza completa aguardando aprovação: mesmo detalhe, com os botões de decisão no rodapé. */
export type ApprovalExtra = { normalPriceCents: number | null; footer: ReactNode };

type EditKind = "value" | "provider" | "type" | "date" | "situation" | "media" | null;

export function FinanceEntryDetail({
  entry,
  approval,
  onSubBack,
}: {
  entry: FinanceEntry;
  /** A janela que hospeda o detalhe troca o "‹ Voltar" para sair da subtela (Detalhes da Reserva). */
  onSubBack?: (back: (() => void) | null) => void;
  /** Mantido por compatibilidade com quem chama (o botão de registro completo saiu). */
  onNavigate?: () => void;
  approval?: ApprovalExtra;
}) {
  const fetchDetail = useServerFn(getFinanceEntryDetail);
  const qc = useQueryClient();
  const ext = entry.kind === "extra";
  const base = entry.item;
  // Valores alterados nesta janela aparecem na hora (a lista se atualiza por trás).
  const [patch, setPatch] = useState<{
    priceCents?: number;
    cleaningType?: "normal" | "completa";
    concludedAt?: string;
    title?: string;
    description?: string | null;
    providerName?: string | null;
  }>({});
  const [edit, setEdit] = useState<EditKind>(null);
  /** Subtela dentro da mesma janela: os detalhes da reserva (Fin-22). */
  const [sub, setSubState] = useState<"reserva" | null>(null);
  const setSub = (v: "reserva" | null) => {
    setSubState(v);
    onSubBack?.(v ? () => setSub(null) : null);
  };
  /** Índice da mídia aberta no visualizador (null = fechado). */
  const [viewer, setViewer] = useState<number | null>(null);
  const it = { ...base, ...(patch.priceCents !== undefined ? { priceCents: patch.priceCents } : {}) };
  const concludedAt = patch.concludedAt ?? it.concludedAt;
  const cleaningType = patch.cleaningType ?? (ext ? null : entry.item.cleaningType);

  const q = useQuery({
    queryKey: ["finance-entry-detail", entry.kind, it.id],
    queryFn: () =>
      fetchDetail({ data: { kind: entry.kind, id: it.id, logId: it.logId ?? null, reservationId: it.reservationId ?? null } }),
    staleTime: 60_000,
  });
  const d = q.data;

  const access = useAreaAccess([EDIT_PERMISSION], "WRITE");
  const canEdit = !approval && access.ready && access.can(EDIT_PERMISSION);

  // Prestador: na limpeza, o atribuído (ou o padrão do imóvel); no extra, quem resolveu a pendência.
  const cleaningProv = useCleaningProviderControl(it.propertyId, it.logId ?? "", it.reservationId ?? null);
  const board = useCleaningBoard();
  const extraProviderName =
    patch.providerName !== undefined ? patch.providerName : (it.doneByName ?? null);
  const providerName = ext
    ? extraProviderName
    : (patch.providerName !== undefined ? patch.providerName : cleaningProv.currentName) ?? it.doneByName ?? null;

  const savePrice = useServerFn(setCleaningPriceOverride);
  const saveType = useServerFn(setCleaningType);
  const saveConcluded = useServerFn(setCleaningConcludedAt);
  const saveExtra = useServerFn(updateExtraService);
  const attachClean = useServerFn(attachCleaningRecord);
  const attachTask = useServerFn(attachTaskRecord);
  const removeRecord = useServerFn(deleteReservationRecord);

  const refresh = () => {
    void qc.invalidateQueries();
  };
  /** Grava, avisa e atualiza; erro vira aviso e a janela fica aberta. */
  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
      throw e;
    }
  }

  const title = ext
    ? (entry.item as import("@/lib/service-situations").ExtraServiceItem).situationName
    : cleaningType === "completa"
      ? "Limpeza Completa"
      : "Limpeza Normal";
  const subtitle = approval ? "Aguardando aprovação" : ext ? "Serviço extra · concluído" : "Limpeza · concluída";
  const stay = d?.reservation
    ? [fmtShort(d.reservation.checkin), fmtShort(d.reservation.checkout)].filter(Boolean).join(" → ")
    : null;
  const reservaTxt = d?.reservation ? [d.reservation.guestName, stay].filter(Boolean).join(" · ") : "";
  const media = d?.media.filter((m) => m.kind === "photo" || m.kind === "video") ?? [];
  const situationTitle = ext ? (patch.title ?? (entry.item as { title: string }).title) : "";
  const situationDesc = patch.description !== undefined ? patch.description : (d?.description ?? null);
  const ctx = { property: it.propertyName, owner: it.ownerName ?? null };
  const open = (k: EditKind) => (canEdit ? () => setEdit(k) : undefined);
  const providerEditable = ext ? true : cleaningProv.editable;

  const imovel = (
    <div className={FIN_CARD}>
      <div className="ds-card-title leading-5 text-foreground" title={it.propertyName}>
        {it.propertyName}
      </div>
      {it.ownerName ? (
        <div className="mt-0.5 truncate text-[12.5px] font-medium leading-4 text-muted-foreground" title={it.ownerName}>
          {it.ownerName}
        </div>
      ) : null}
    </div>
  );
  /* Tocar no quadrante "Reserva" abre os detalhes da reserva na MESMA janela (Fin-22, ‹ Voltar). */
  const reserva = reservaTxt ? (
    <Tap onClick={() => setSub("reserva")} label="Ver detalhes da reserva" className={FIN_CARD}>
      <div className={FIN_CAP}>{ext ? "Reserva" : "Reserva (saída)"}</div>
      <div className={VAL} title={reservaTxt}>
        {reservaTxt}
      </div>
    </Tap>
  ) : null;
  const quem = (
    <div className={cn(FIN_CARD, "grid grid-cols-2 p-0")}>
      <Tap
        onClick={providerEditable ? open("provider") : undefined}
        label="Alterar prestador"
        className="min-w-0 rounded-l-[12px] py-2.5 pl-3 pr-2.5"
      >
        <div className={FIN_CAP}>{ext ? "Executado por" : "Executada por"}</div>
        <div className={cn(VAL, !providerName && "font-semibold text-[var(--faint)]")}>
          <span className={cn(providerEditable && canEdit && "ds-editable")}>{providerName ?? "Não definido"}</span>
        </div>
      </Tap>
      <Tap
        onClick={concludedAt ? open("date") : undefined}
        label="Alterar data e hora"
        className="min-w-0 rounded-r-[12px] border-l border-foreground/[0.08] py-2.5 pl-3 pr-3 text-right"
      >
        <div className={FIN_CAP}>{ext ? "Concluído em" : "Concluída em"}</div>
        <div className={VAL}>
          <span className={cn(concludedAt && canEdit && "ds-editable")}>{fmtWhenFull(concludedAt) ?? "—"}</span>
        </div>
      </Tap>
    </div>
  );
  const detalhe = ext ? (
    <Tap onClick={open("situation")} label="Editar situação" className={FIN_CARD}>
      <div className={FIN_CAP}>Detalhamento da situação</div>
      <div className={cn(VAL, "whitespace-normal break-words")}>
        <span className={cn(canEdit && "ds-editable")}>{situationTitle}</span>
      </div>
      {situationDesc ? (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-muted-foreground">{situationDesc}</p>
      ) : null}
    </Tap>
  ) : null;
  const fotosTitulo = ext ? "Fotos e Vídeos" : "Fotos da Conferência";
  const editarFotos = open("media");
  /* Tocar na MINIATURA abre direto a mídia no visualizador (regra do sistema, mockup Fin-23);
     tocar no RESTO do quadrante abre a edição. */
  const fotos =
    media.length > 0 || canEdit ? (
      <div
        role={editarFotos ? "button" : undefined}
        tabIndex={editarFotos ? 0 : undefined}
        aria-label={editarFotos ? "Editar fotos e vídeos" : undefined}
        onClick={editarFotos}
        onKeyDown={(e) => {
          if (editarFotos && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            editarFotos();
          }
        }}
        className={cn(FIN_CARD, editarFotos && "cursor-pointer transition-[filter] active:brightness-95")}
      >
        <div className={cn(FIN_CAP, "mb-2")}>
          <span className={cn(editarFotos && "ds-editable")}>
            {ext ? "Fotos e vídeos" : "Fotos da conferência"} · {media.length}
          </span>
        </div>
        {media.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto">
            {media.map((m, i) => (
              <button
                key={m.id}
                type="button"
                aria-label={`Ver ${m.kind === "video" ? "vídeo" : "foto"} ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (m.url) setViewer(i);
                }}
                className="relative grid h-[72px] w-[88px] flex-none place-items-center overflow-hidden rounded-[10px] bg-foreground/[0.08] text-foreground/45"
              >
                {m.kind === "photo" && m.url ? (
                  <img src={m.url} alt={m.fileName ?? "Foto"} loading="lazy" className="size-full object-cover" />
                ) : (
                  <Play className="size-4" />
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">Nenhum arquivo. Toque para adicionar.</p>
        )}
      </div>
    ) : null;
  const viewerMedia = media.filter((m) => !!m.url);

  if (sub === "reserva" && d?.reservation) {
    return <ReservationDetailView r={d.reservation} property={it.propertyName} owner={it.ownerName ?? null} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={`Detalhe de ${title}`}>
      {/* Cabeçalho sem filete; o tipo da limpeza é alterável tocando no título. */}
      <DialogHeader className="shrink-0 space-y-0 py-3 pl-4 pr-24 text-left">
        {!ext && canEdit && cleaningType ? (
          <button type="button" onClick={() => setEdit("type")} className="block max-w-full text-left" aria-label="Alterar tipo">
            <DialogTitle className={WINDOW_TITLE_CLASS} title={title}>
              <span className="ds-editable">{title}</span>
            </DialogTitle>
          </button>
        ) : (
          <DialogTitle className={WINDOW_TITLE_CLASS} title={title}>
            {title}
          </DialogTitle>
        )}
        <p className={WINDOW_SUBTITLE_CLASS}>{subtitle}</p>
      </DialogHeader>
      <div data-entry-detail className={cn("sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain sm:mx-6", FIN_BODY)}>
        {imovel}
        {ext ? (
          <>
            {detalhe}
            {quem}
            {reserva}
          </>
        ) : (
          <>
            {reserva}
            {quem}
          </>
        )}
        {approval?.normalPriceCents != null ? (
          <div className={cn(FIN_CARD, "flex items-baseline justify-between gap-3")}>
            <span className={FIN_CAP}>Se foi normal</span>
            <span className="text-[13.5px] font-bold tabular-nums text-muted-foreground">{brl(approval.normalPriceCents)}</span>
          </div>
        ) : null}
        {!ext && d?.description ? (
          <div className={FIN_CARD}>
            <div className={FIN_CAP}>O que aconteceu</div>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-[1.45] text-muted-foreground">{d.description}</p>
          </div>
        ) : null}
        {q.isLoading ? <p className="px-1 text-xs text-muted-foreground">Carregando…</p> : null}
        {q.isError ? <p className="px-1 text-xs text-muted-foreground">Não foi possível carregar os detalhes.</p> : null}
        {fotos}
      </div>
      <Tap
        onClick={open("value")}
        label="Editar valor"
        className={cn(FIN_FOOT, "flex items-baseline justify-between gap-3 px-4 py-3.5 sm:px-10")}
      >
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          {approval ? "Valor pedido" : "Valor"}
        </span>
        <span className={cn("font-display text-[15px] font-bold tabular-nums text-foreground", canEdit && "ds-editable")}>{brl(it.priceCents)}</span>
      </Tap>
      {approval ? <div className="shrink-0 border-t border-border/60 px-4 py-3 sm:mx-6">{approval.footer}</div> : null}

      {/* Janelas de edição (Fin-14 a Fin-21). */}
      <EditValueWindow
        open={edit === "value"}
        onOpenChange={(v) => !v && setEdit(null)}
        ctx={ctx}
        subtitle={ext ? "Informe o novo valor do serviço" : "Informe o novo valor da limpeza"}
        cents={it.priceCents ?? null}
        onSave={(cents) =>
          run(
            () =>
              ext
                ? saveExtra({ data: { id: it.id, priceCents: cents } })
                : savePrice({ data: { statusId: it.id, cents, reason: null } }),
            "Valor alterado.",
          ).then(() => setPatch((p) => ({ ...p, priceCents: cents })))
        }
      />
      <EditProviderWindow
        open={edit === "provider"}
        onOpenChange={(v) => !v && setEdit(null)}
        ctx={ctx}
        subtitle={ext ? "Escolha quem executou o serviço" : "Escolha quem executou a limpeza"}
        providers={ext ? (board.data?.providers ?? []) : cleaningProv.providers}
        currentId={ext ? (d?.providerId ?? null) : cleaningProv.currentId}
        onSave={(providerId) => {
          const name = (board.data?.providers ?? []).find((p) => p.id === providerId)?.name ?? null;
          return run(
            () => (ext ? saveExtra({ data: { id: it.id, providerId } }) : cleaningProv.set(providerId)),
            "Prestador alterado.",
          ).then(() => setPatch((p) => ({ ...p, providerName: name })));
        }}
      />
      {!ext && cleaningType ? (
        <EditTypeWindow
          open={edit === "type"}
          onOpenChange={(v) => !v && setEdit(null)}
          ctx={ctx}
          type={cleaningType}
          onSave={(type) =>
            run(() => saveType({ data: { statusId: it.id, type } }), "Tipo da limpeza alterado.").then(() =>
              setPatch((p) => ({ ...p, cleaningType: type })),
            )
          }
        />
      ) : null}
      <EditDateTimeWindow
        open={edit === "date"}
        onOpenChange={(v) => !v && setEdit(null)}
        ctx={ctx}
        subtitle={ext ? "Quando o serviço foi concluído" : "Quando a limpeza foi concluída"}
        iso={concludedAt ?? null}
        onSave={(iso) =>
          run(
            () =>
              ext
                ? saveExtra({ data: { id: it.id, completedAt: iso } })
                : saveConcluded({ data: { statusId: it.id, concludedAt: iso } }),
            "Data e hora alteradas.",
          ).then(() => setPatch((p) => ({ ...p, concludedAt: new Date(iso).toISOString() })))
        }
      />
      {ext ? (
        <EditSituationWindow
          open={edit === "situation"}
          onOpenChange={(v) => !v && setEdit(null)}
          title={situationTitle}
          description={situationDesc}
          onSave={(v) =>
            run(() => saveExtra({ data: { id: it.id, title: v.title, description: v.description } }), "Situação alterada.").then(
              () => setPatch((p) => ({ ...p, title: v.title, description: v.description })),
            )
          }
        />
      ) : null}
      {viewer !== null && viewerMedia.length > 0 && (
        <MediaLightbox
          media={viewerMedia.map((m) => ({ id: m.id, kind: m.kind, url: m.url, mime: m.mime, author: m.author, createdAt: m.createdAt }))}
          startIndex={Math.max(0, viewerMedia.findIndex((m) => m.id === media[viewer]?.id))}
          title={fotosTitulo}
          subtitle={it.propertyName}
          onClose={() => setViewer(null)}
        />
      )}
      <EditMediaWindow
        open={edit === "media"}
        onOpenChange={(v) => !v && setEdit(null)}
        media={media.map((m) => ({ id: m.id, kind: m.kind, url: m.url }))}
        onRemove={(id) => run(() => removeRecord({ data: { id } }), "Arquivo removido.")}
        onAdd={async (files) => {
          const pending: PendingAttachment[] = files.map((f) => ({
            key: crypto.randomUUID(),
            blob: f,
            name: f.name,
            mime: f.type || "application/octet-stream",
            kind: f.type.startsWith("video/") ? "video" : "photo",
          }));
          if (ext) {
            if (!d?.taskId) throw new Error("Não foi possível anexar.");
            const res = await uploadPendingAttachments(attachTask as never, pending, {
              propertyId: it.propertyId,
              taskId: d.taskId,
              logId: it.logId ?? undefined,
              reservationId: it.reservationId ?? undefined,
              isResolution: true,
            });
            if (res.failed > 0) toast.error(`${res.failed} arquivo(s) não foram enviados.`);
          } else {
            let failed = 0;
            for (const f of pending) {
              try {
                const ext_ = (f.mime.split("/")[1] ?? "bin").replace("jpeg", "jpg").split(";")[0];
                const path = `${it.propertyId}/cleaning-${it.id}/${crypto.randomUUID()}.${ext_}`;
                const { error } = await supabase.storage
                  .from("reservation-records")
                  .upload(path, f.blob, { contentType: f.mime, upsert: false });
                if (error) throw new Error(error.message);
                await attachClean({
                  data: {
                    statusId: it.id,
                    path,
                    kind: f.kind === "video" ? "video" : "photo",
                    mime: f.mime,
                    sizeBytes: f.blob.size,
                    fileName: f.name,
                  },
                });
              } catch {
                failed++;
              }
            }
            if (failed > 0) toast.error(`${failed} arquivo(s) não foram enviados.`);
          }
          toast.success("Arquivos adicionados.");
          refresh();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* DETALHES DA RESERVA (mockup Fin-22, 18/11/2026): toque no quadrante "Reserva" do lançamento.      */
/* ------------------------------------------------------------------------------------------------ */
function nightsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d1 = Date.parse(`${a.slice(0, 10)}T12:00:00Z`);
  const d2 = Date.parse(`${b.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return null;
  const n = Math.round((d2 - d1) / 86_400_000);
  return n > 0 ? n : null;
}

function guestsLabel(r: FinanceReservation): string | null {
  const parts: string[] = [];
  if (r.adults) parts.push(`${r.adults} ${r.adults === 1 ? "adulto" : "adultos"}`);
  if (r.children) parts.push(`${r.children} ${r.children === 1 ? "criança" : "crianças"}`);
  if (r.infants) parts.push(`${r.infants} ${r.infants === 1 ? "bebê" : "bebês"}`);
  return parts.length ? parts.join(", ") : null;
}

function DetailPair({ a, b }: { a: [string, string | null]; b: [string, string | null] }) {
  return (
    <div className={cn(FIN_CARD, "grid grid-cols-2")}>
      <div className="min-w-0 pr-2.5">
        <div className={FIN_CAP}>{a[0]}</div>
        <div className={cn(VAL, !a[1] && "font-medium text-[var(--faint)]")}>{a[1] ?? "—"}</div>
      </div>
      <div className="min-w-0 border-l border-foreground/[0.08] pl-3">
        <div className={FIN_CAP}>{b[0]}</div>
        <div className={cn(VAL, !b[1] && "font-medium text-[var(--faint)]")}>{b[1] ?? "—"}</div>
      </div>
    </div>
  );
}

function ReservationDetailView({ r, property, owner }: { r: FinanceReservation; property: string; owner: string | null }) {
  const nights = nightsBetween(r.checkin, r.checkout);
  const when = (date: string | null, time: string | null) => {
    const d = fmtDay(date);
    return d ? [d, time].filter(Boolean).join(" · ") : null;
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Detalhes da Reserva">
      <DialogHeader className="shrink-0 space-y-0 py-3 pl-4 pr-24 text-left">
        <DialogTitle className={WINDOW_TITLE_CLASS}>Detalhes da Reserva</DialogTitle>
        <p className={WINDOW_SUBTITLE_CLASS}>
          {nights ? `Reserva · ${nights} ${nights === 1 ? "noite" : "noites"}` : "Reserva"}
        </p>
      </DialogHeader>
      <div data-entry-detail className={cn("sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain sm:mx-6", FIN_BODY)}>
        <PropertyContextCard name={property} owner={owner} />
        <div className={FIN_CARD}>
          <div className={FIN_CAP}>Hóspede</div>
          <div className="mt-[3px] flex min-w-0 items-center gap-[5px]">
            <span className="truncate text-[14px] font-semibold leading-5 text-foreground">{r.guestName ?? "Não informado"}</span>
            <PhoneActionButton
              phone={r.guestPhone}
              country={r.guestPhoneCountry}
              className="p-0 text-[#7a746a] hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground"
            />
          </div>
        </div>
        <DetailPair a={["Check-in", when(r.checkin, r.checkinTime)]} b={["Check-out", when(r.checkout, r.checkoutTime)]} />
        <DetailPair a={["Hóspedes", guestsLabel(r)]} b={["Noites", nights ? String(nights) : null]} />
        <DetailPair a={["Código", r.code]} b={["Canal", r.channel]} />
      </div>
    </div>
  );
}
