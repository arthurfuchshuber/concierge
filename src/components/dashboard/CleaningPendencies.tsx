import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Camera, Check, Clock, Repeat, TriangleAlert } from "lucide-react";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CoverImage } from "@/components/ui/cover-image";
import { TaskResolveDialog, settlementToServer, type ResolveValues } from "@/components/dashboard/TaskResolveDialog";
import { uploadPendingAttachments } from "@/components/dashboard/TaskAttachments";
import { supabase } from "@/integrations/supabase/client";
import { attachTaskRecord } from "@/lib/reservation-records.functions";
import { listTaskLinkOptions, listTasks, reportTaskAsProvider, returnTaskToProvider, setTaskStatus } from "@/lib/tasks.functions";
import { ProviderConcludeDialog } from "@/components/dashboard/ProviderConcludeDialog";
import type { ArrivalRow } from "@/lib/dashboard-arrival-types";
import type { TaskCategory, TaskRow } from "@/lib/tasks-types";
import { fmtBRShort } from "@/lib/recurrence-dates";
import { cn } from "@/lib/utils";

/**
 * "PENDÊNCIAS DE LIMPEZA!" — faixa âmbar no topo do card da Fila de Limpeza + a janela que ela abre
 * (mockups "Kanban REAL · Fila Limpeza com faixa de pendências", pend, pend-concluir, pend-detalhe e
 * recorrência h — 13/11/2026).
 *
 *   · A faixa só existe no card de Limpeza e só quando há pendência ABERTA ligada àquela reserva
 *     (`tasks.show_in_cleaning` + `reservation_id`/`log_id`); a pílula conta as abertas.
 *   · Toque na faixa → janela (capa desfocada do imóvel, "Abertas · N", "Concluídas · N", "Total em aberto").
 *   · Toque na caixinha → "Concluir pendência" (a mesma janela de prestação de contas das Pendências).
 *   · "Detalhes" abre o detalhe NA MESMA janela, com "‹ Voltar" no canto.
 *   · Ocorrência de recorrência mostra "prevista dd/mm" e, quando a data não é a do checkout,
 *     "Movida para o checkout de dd/mm" (ou "· checkout do dia").
 */

const CAT_LABEL: Record<TaskCategory, string> = {
  maintenance: "Manutenção",
  financial: "Financeiro",
  guest_request: "Pedido do hóspede",
  purchase: "Compra",
  inspection: "Inspeção",
  cleaning: "Limpeza",
  other: "Tarefa do anfitrião",
};
const CAT_COLOR: Partial<Record<TaskCategory, string>> = { maintenance: "#c98c8c", cleaning: "#7fb5a4" };

/**
 * Mockup real-limpeza-pend: a linha mostra o título SEM o prefixo automático ("Dano: …") e o tipo na
 * linha de baixo ("Dano · 12/11", "Objeto esquecido · 12/11"). Sem prefixo, vale o rótulo da categoria.
 */
const AUTO_PREFIXES = ["Objeto esquecido", "Dano", "Incidente", "Manutenção", "Limpeza", "Auditoria de Limpeza"];
export function splitTaskTitle(t: Pick<TaskRow, "title" | "category">): { title: string; label: string } {
  for (const p of AUTO_PREFIXES) {
    if (t.title.startsWith(`${p}: `)) return { title: t.title.slice(p.length + 2), label: p };
  }
  return { title: t.title, label: CAT_LABEL[t.category] };
}

/** "Detalhe da Manutenção", "Detalhe do Dano"… — eyebrow do detalhe (mockup real-limpeza-pend-detalhe). */
function detailEyebrow(label: string): string {
  const fem = /^(Manutenção|Limpeza|Auditoria|Tarefa|Inspeção|Compra)/.test(label);
  return `Detalhe ${fem ? "da" : "do"} ${label}`;
}

function money(cents: number | null | undefined) {
  if (cents == null) return null;
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Todas as pendências "que aparecem na limpeza" da conta — uma consulta compartilhada por todos os cards. */
export function useCleaningTasks(enabled = true) {
  const fn = useServerFn(listTasks);
  return useQuery({
    queryKey: ["cleaning-pendencies"],
    queryFn: () => fn({ data: { onlyCleaning: true } }),
    enabled,
    staleTime: 15_000,
  });
}

function useCardTasks(row: ArrivalRow, enabled: boolean) {
  const q = useCleaningTasks(enabled);
  const all = q.data?.tasks ?? [];
  return useMemo(() => {
    const logId = /^[0-9a-f-]{36}$/i.test(row.logId) ? row.logId : null;
    const mine = all.filter(
      (t) =>
        t.showInCleaning &&
        ((row.reservationId && t.reservationId === row.reservationId) || (logId && t.logId === logId)),
    );
    return {
      open: mine.filter((t) => t.status === "pending"),
      done: mine.filter((t) => t.status === "done"),
      loading: q.isLoading,
    };
  }, [all, row.reservationId, row.logId, q.isLoading]);
}

/** A faixa âmbar. `margin: -14px -14px 0` = encosta nas bordas do card (p-3.5). */
export function CleaningPendencyStrip({ row }: { row: ArrivalRow }) {
  const { open, done } = useCardTasks(row, true);
  const [win, setWin] = useState(false);
  if (open.length === 0) return null;
  return (
    <>
      {/* Mockup real-limpeza-lista: ícone de alerta, texto e contador; escuro âmbar-400, claro âmbar-500 com texto âmbar-800. */}
      <button
        type="button"
        onClick={() => setWin(true)}
        className="-mx-3.5 -mt-3.5 flex items-center gap-[7px] rounded-t-[11px] border-b border-[#f59e0b]/[0.34] bg-[#f59e0b]/[0.16] py-[7px] pl-[17px] pr-3.5 text-left text-[11.5px] font-bold leading-[1.2] tracking-[0.01em] text-[#92400e] transition-colors hover:bg-[#f59e0b]/[0.22] dark:border-[#fbbf24]/[0.26] dark:bg-[#fbbf24]/[0.14] dark:text-[#fcd34d] dark:hover:bg-[#fbbf24]/[0.2]"
      >
        <TriangleAlert className="size-3.5 flex-none" strokeWidth={2.2} />
        <span className="min-w-0 flex-1 truncate">Pendências de Limpeza!</span>
        <span className="inline-grid h-[18px] min-w-[18px] flex-none place-items-center rounded-full bg-[#f59e0b]/[0.26] px-1.5 text-[11px] font-extrabold tabular-nums dark:bg-[#fbbf24]/[0.24]">
          {open.length}
        </span>
      </button>
      {win && <CleaningPendenciesWindow row={row} open={open} done={done} onClose={() => setWin(false)} />}
    </>
  );
}

type View = { kind: "list" } | { kind: "detail"; id: string };

function CleaningPendenciesWindow({
  row,
  open,
  done,
  onClose,
}: {
  row: ArrivalRow;
  open: TaskRow[];
  done: TaskRow[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<View>({ kind: "list" });
  const [resolving, setResolving] = useState<TaskRow | null>(null);

  const covers = useQuery({
    queryKey: ["property-covers", row.propertyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("properties")
        .select("hero_image_url, gallery_images")
        .eq("id", row.propertyId)
        .maybeSingle();
      const p = data as { hero_image_url: string | null; gallery_images: string[] | null } | null;
      return [p?.hero_image_url, ...(p?.gallery_images ?? [])].filter((u): u is string => !!u);
    },
    staleTime: 5 * 60_000,
  });

  const reportMedia = useQuery({
    queryKey: ["task-report-media", resolving?.id ?? null],
    enabled: !!resolving?.providerReport && true,
    queryFn: async () => {
      const { data } = await supabase
        .from("reservation_records")
        .select("storage_path, mime, created_at")
        .eq("task_id", resolving!.id)
        .order("created_at", { ascending: true })
        .limit(20);
      const rows = ((data ?? []) as Array<{ storage_path: string | null; mime: string | null }>).filter(
        (r) => r.storage_path && ((r.mime ?? "").startsWith("image/") || (r.mime ?? "").startsWith("video/")),
      );
      const out: Array<{ url: string; video: boolean }> = [];
      for (const r of rows) {
        const { data: signed } = await supabase.storage.from("reservation-records").createSignedUrl(r.storage_path!, 3600);
        if (signed?.signedUrl) out.push({ url: signed.signedUrl, video: (r.mime ?? "").startsWith("video/") });
      }
      return out;
    },
    staleTime: 60_000,
  });

  const optionsFn = useServerFn(listTaskLinkOptions);
  const options = useQuery({ queryKey: ["task-link-options"], queryFn: () => optionsFn({ data: {} }), staleTime: 60_000 });
  const setStatusFn = useServerFn(setTaskStatus);
  const attachFn = useServerFn(attachTaskRecord);

  const viewerIsProvider = useCleaningTasks(true).data?.viewerIsProvider ?? false;
  const reportFn = useServerFn(reportTaskAsProvider);
  const returnFn = useServerFn(returnTaskToProvider);
  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["cleaning-pendencies"] });
    void qc.invalidateQueries({ queryKey: ["dash-tasks"] });
    void qc.invalidateQueries({ queryKey: ["account-records"] });
    void qc.invalidateQueries({ queryKey: ["reservation-records"] });
  };
  const report = useMutation({
    mutationFn: async ({ task, v }: { task: TaskRow; v: import("@/components/dashboard/ProviderConcludeDialog").ProviderReportValues }) => {
      await reportFn({ data: { taskId: task.id, outcome: v.outcome, amountCents: v.amountCents, note: v.note } });
      if (v.files.length > 0 && task.propertyId) {
        await uploadPendingAttachments(attachFn as never, v.files, {
          propertyId: task.propertyId,
          taskId: task.id,
          logId: task.logId ?? undefined,
          reservationId: task.reservationId ?? undefined,
          isResolution: true,
        });
      }
    },
    onSuccess: (_d, { v }) => {
      invalidateAll();
      toast.success(v.outcome === "resolved" ? "Enviado para aprovação." : "Registrado. A pendência continua aberta.");
    },
  });
  const giveBack = useMutation({
    mutationFn: async (task: TaskRow) => returnFn({ data: { taskId: task.id } }),
    onSuccess: () => {
      invalidateAll();
      toast.success("Devolvida ao prestador.");
    },
  });

  const resolve = useMutation({
    mutationFn: async ({ task, v }: { task: TaskRow; v: ResolveValues }) => {
      await setStatusFn({ data: { taskId: task.id, status: "done", ...settlementToServer(v) } });
      if (v.files.length > 0 && task.propertyId) {
        await uploadPendingAttachments(attachFn as never, v.files, {
          propertyId: task.propertyId,
          taskId: task.id,
          logId: task.logId ?? undefined,
          reservationId: task.reservationId ?? undefined,
          isResolution: true,
        });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cleaning-pendencies"] });
      void qc.invalidateQueries({ queryKey: ["dash-tasks"] });
      void qc.invalidateQueries({ queryKey: ["account-records"] });
      void qc.invalidateQueries({ queryKey: ["reservation-records"] });
      toast.success("Pendência concluída.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível concluir."),
  });

  const all = [...open, ...done];
  const detail = view.kind === "detail" ? all.find((t) => t.id === view.id) : undefined;
  const total = open.reduce((n, t) => n + (t.amountSpentCents ?? 0), 0);
  const checkoutIso = row.guestCheckout ?? null;

  const guestLine = (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-white">
      <span className="truncate">{row.ownerName ?? row.guestName}</span>
      <span className="-my-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <PhoneActionButton phone={row.ownerPhone} country={row.ownerPhoneCountry} size={14} alwaysShow />
      </span>
    </div>
  );

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent
          aria-describedby={undefined}
          className="flex max-h-[min(90dvh,calc(100dvh_-_var(--kb-inset,0px)_-_3rem))] w-[min(372px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
          cover
          /* Mockup real-limpeza-pend: a lista também mostra "‹ Voltar" (volta ao quadro); no detalhe, volta à lista. */
          onBack={detail ? () => setView({ kind: "list" }) : onClose}
        >
          <div className="relative h-[140px] shrink-0 overflow-hidden bg-secondary/60">
            <div className="absolute inset-0 origin-center scale-[1.04] [filter:blur(1.5px)_brightness(.9)]">
              <CoverImage urls={covers.data ?? []} empty={false} />
            </div>
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(34,30,27,0)_25%,rgba(34,30,27,.82)_100%)]" />
            <div className="absolute inset-x-4 bottom-2.5 min-w-0 pr-8">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/90">
                {detail ? detailEyebrow(splitTaskTitle(detail).label) : "Pendências de Limpeza!"}
              </div>
              <DialogTitle className="mt-1 block truncate text-sm font-bold leading-[18px] text-white" title={row.propertyName ?? ""}>
                {row.propertyName ?? "Imóvel"}
              </DialogTitle>
              {guestLine}
            </div>
          </div>

          {!detail ? (
            <>
              <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2.5">
                <Divider>Abertas · {open.length}</Divider>
                {open.map((t, i) => (
                  <Item
                    key={t.id}
                    t={t}
                    first={i === 0}
                    checkoutIso={checkoutIso}
                    onCheck={() => setResolving(t)}
                    onDetails={() => setView({ kind: "detail", id: t.id })}
                  />
                ))}
                {done.length > 0 && (
                  <>
                    <Divider>Concluídas · {done.length}</Divider>
                    {done.map((t, i) => (
                      <Item
                        key={t.id}
                        t={t}
                        first={i === 0}
                        checkoutIso={checkoutIso}
                        isDone
                        onDetails={() => setView({ kind: "detail", id: t.id })}
                      />
                    ))}
                  </>
                )}
              </div>
              {total > 0 && (
                <div className="flex shrink-0 items-center justify-between border-t border-foreground/[0.08] bg-foreground/[0.04] px-[18px] py-3.5">
                  <span className="text-[13px] text-muted-foreground">Total em aberto</span>
                  <span className="text-base font-extrabold tabular-nums">{money(total)}</span>
                </div>
              )}
            </>
          ) : (
            <TaskDetail
              t={detail}
              row={row}
              onResolve={detail.status === "pending" ? () => setResolving(detail) : undefined}
            />
          )}
        </DialogContent>
      </Dialog>

      <ProviderConcludeDialog
        task={resolving && viewerIsProvider ? resolving : null}
        covers={covers.data ?? []}
        onOpenChange={(v) => !v && setResolving(null)}
        onConfirm={async (v) => {
          if (!resolving) return;
          await report.mutateAsync({ task: resolving, v });
          setResolving(null);
          if (view.kind === "detail") setView({ kind: "list" });
        }}
      />

      <TaskResolveDialog
        covers={covers.data ?? []}
        reportMedia={reportMedia.data ?? []}
        onReturn={
          resolving?.providerReport?.status === "resolved"
            ? async () => {
                await giveBack.mutateAsync(resolving);
                setResolving(null);
              }
            : undefined
        }
        state={resolving && !viewerIsProvider ? { kind: "cleaning", task: resolving } : null}
        onOpenChange={(v) => !v && setResolving(null)}
        providers={options.data?.providers ?? []}
        companyName={options.data?.companyName ?? null}
        guestName={row.guestName}
        onConfirm={async (v) => {
          if (!resolving) return;
          await resolve.mutateAsync({ task: resolving, v });
          setResolving(null);
          if (view.kind === "detail") setView({ kind: "list" });
        }}
      />
    </>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-[18px] pb-2 pt-3.5">
      <span aria-hidden className="h-px flex-1 bg-gradient-to-l from-foreground/[0.14] to-transparent" />
      <span className="flex-none text-[10px] font-bold uppercase leading-[1.2] tracking-[0.18em] text-[var(--faint,var(--muted-foreground))]">
        {children}
      </span>
      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-foreground/[0.14] to-transparent" />
    </div>
  );
}

function Item({
  t,
  first,
  checkoutIso,
  isDone,
  onCheck,
  onDetails,
}: {
  t: TaskRow;
  first: boolean;
  checkoutIso: string | null;
  isDone?: boolean;
  onCheck?: () => void;
  onDetails: () => void;
}) {
  const due = t.dueDate;
  const isSeries = !!t.recurrenceId;
  const co = checkoutIso ? checkoutIso.slice(0, 10) : null;
  const moved = isSeries && !!co && !!due && due !== co;
  const sameDay = isSeries && !!co && !!due && due === co;
  const created = t.createdAt ? t.createdAt.slice(0, 10) : null;
  const price = money(t.amountSpentCents);
  const shown = splitTaskTitle(t);
  return (
    <div
      data-clip-row
      className={cn("flex items-start gap-3 px-[18px] py-3", !first && "border-t border-foreground/[0.08]", isDone && "opacity-55")}
    >
      {isDone ? (
        <span className="mt-1.5 grid size-[22px] flex-none place-items-center rounded-[7px] bg-[#f59e0b] text-[#1c1917]">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      ) : (
        <button
          type="button"
          aria-label="Concluir pendência"
          onClick={onCheck}
          className="mt-1.5 size-[22px] flex-none rounded-[7px] shadow-[inset_0_0_0_1.6px_color-mix(in_oklab,var(--foreground)_38%,transparent)] transition-shadow hover:shadow-[inset_0_0_0_1.6px_#f59e0b]"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm font-bold leading-[1.3]", isDone && "line-through")}>{shown.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center text-xs text-muted-foreground">
          <span>{shown.label}</span>
          {isSeries && due ? (
            <>
              <span className="mx-1">·</span>
              <Repeat className="mr-1 size-3 text-[var(--accent)]" />
              <span>prevista {fmtBRShort(due)}</span>
              {sameDay && <span className="ml-1">· checkout do dia</span>}
            </>
          ) : created && t.category !== "other" ? (
            /* Mockup: "Tarefa do anfitrião" vem sem data; as demais, "Dano · 12/11". */
            <span className="ml-1">· {fmtBRShort(created)}</span>
          ) : null}
        </div>
        {!isDone && t.providerReport?.status === "resolved" && (
          /* Mockup DECIDIR · C1 (proposta 1): o prestador concluiu; falta o anfitrião aprovar. */
          <div className="mt-1.5 inline-flex items-center gap-[5px] whitespace-nowrap rounded-md bg-[#e2b45a]/[0.14] px-2 py-[3px] text-[10.5px] font-bold text-[#e2b45a]">
            <Clock className="size-[11px]" strokeWidth={2.2} />
            Aguardando aprovação
          </div>
        )}
        {moved && co && (
          <div className="mt-1.5 inline-flex items-center gap-[5px] rounded-md bg-[var(--accent)]/[0.12] px-2 py-[3px] text-[10.5px] font-bold text-[var(--accent)]">
            <ArrowRight className="size-[11px]" strokeWidth={2.4} />
            Movida para o checkout de {fmtBRShort(co)}
          </div>
        )}
      </div>
      <div className="flex flex-none flex-col items-end gap-[5px] self-stretch">
        {price && <div className="text-sm font-extrabold leading-[18px] tabular-nums">{price}</div>}
        <button
          type="button"
          onClick={onDetails}
          className="mt-auto inline-flex items-center text-xs font-bold leading-4 text-muted-foreground hover:text-foreground"
        >
          Detalhes
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[21px] items-center justify-between gap-3 text-[12.5px]">
      <span className="flex-none text-muted-foreground">{label}</span>
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-right font-semibold">{children}</span>
    </div>
  );
}

/** Registro (situação) de onde a pendência nasceu: quem registrou e a primeira foto — mockup real-limpeza-pend-detalhe. */
function useTaskOrigin(taskId: string) {
  return useQuery({
    queryKey: ["task-origin", taskId],
    queryFn: async () => {
      const { data } = await supabase
        .from("reservation_records")
        .select("created_by_name, storage_path, mime, kind, created_at")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true })
        .limit(20);
      const rows = (data ?? []) as Array<{ created_by_name: string | null; storage_path: string | null; mime: string | null; kind: string | null }>;
      const author = rows.find((r) => r.created_by_name)?.created_by_name ?? null;
      const img = rows.find((r) => r.storage_path && (r.mime ?? "").startsWith("image/"));
      let photo: string | null = null;
      if (img?.storage_path) {
        const { data: signed } = await supabase.storage.from("reservation-records").createSignedUrl(img.storage_path, 3600);
        photo = signed?.signedUrl ?? null;
      }
      return { author, photo };
    },
    staleTime: 5 * 60_000,
  });
}

function TaskDetail({ t, row, onResolve }: { t: TaskRow; row: ArrivalRow; onResolve?: () => void }) {
  const color = CAT_COLOR[t.category] ?? "#9a9a9a";
  const when = t.createdAt ? new Date(t.createdAt) : null;
  const whenTxt = when
    ? `${String(when.getDate()).padStart(2, "0")}/${String(when.getMonth() + 1).padStart(2, "0")} · ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`
    : "";
  const price = money(t.amountSpentCents);
  const shown = splitTaskTitle(t);
  const origin = useTaskOrigin(t.id).data;
  const rule = "border-t border-foreground/[0.08]";
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        <div className="relative overflow-hidden rounded-xl bg-foreground/[0.04] py-3.5 pl-[17px] pr-3.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
          <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
          <div className="flex items-start gap-3">
            <div className="relative grid size-14 flex-none place-items-center overflow-hidden rounded-[10px] bg-[linear-gradient(135deg,#8a7a68,#4a4038)] text-white/85">
              {origin?.photo ? (
                <img src={origin.photo} alt="" className="absolute inset-0 size-full object-cover" />
              ) : (
                <Camera className="size-[18px]" strokeWidth={2} />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold leading-[1.3]">{shown.title}</div>
              {t.description && <div className="mt-1 text-[12.5px] leading-[1.4] text-muted-foreground">{t.description}</div>}
            </div>
          </div>
          <div className={rule} style={{ margin: "14px 0 10px" }} />
          {price && (
            <DetailRow label="Valor">
              <b className="font-extrabold">{price}</b>
            </DetailRow>
          )}
          {origin?.author && <DetailRow label="Registrado por">{origin.author}</DetailRow>}
          {t.resolvedByProviderName && <DetailRow label="Resolvido por">{t.resolvedByProviderName}</DetailRow>}
          {t.resolutionNote && <DetailRow label="Observação">{t.resolutionNote}</DetailRow>}
          <div className={rule} style={{ margin: "10px 0 12px" }} />
          <div className="flex items-center justify-between">
            <span
              className="rounded-[5px] px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[0.06em]"
              style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}
            >
              {shown.label}
            </span>
            <span className="text-[11.5px] tabular-nums text-muted-foreground">{whenTxt}</span>
          </div>
        </div>
      </div>
      {onResolve && (
        <div className="flex shrink-0 gap-2 border-t border-foreground/[0.08] px-4 py-3">
          <button
            type="button"
            onClick={onResolve}
            className="h-9 flex-1 rounded-[5px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-xs font-bold text-white"
          >
            Concluir pendência
          </button>
        </div>
      )}
    </>
  );
}
