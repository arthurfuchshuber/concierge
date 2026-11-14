import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronRight, CircleAlert, Loader2, Pause, Play, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CoverImage } from "@/components/ui/cover-image";
import { Switch } from "@/components/ui/switch";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import {
  listRecurrences,
  skipRecurrenceOccurrence,
  updateRecurrence,
  type RecurrenceOccurrence,
  type RecurrenceSummary,
} from "@/lib/recurrences.functions";
import { describeFrequency, fmtBR, fmtBRShort, type RecurrenceUnit } from "@/lib/recurrence-dates";
import { cn } from "@/lib/utils";

/**
 * RECORRÊNCIAS NA PÁGINA REGISTROS (mockups b, d, m, c, j — 13/11/2026).
 * O chip ↻ do cartão do imóvel e o chip "Pendências" abrem a MESMA janela, "Pendências do imóvel", com o
 * seletor Pendências | Recorrências; "Detalhes" de uma série abre o detalhe na mesma janela (canto "‹ Voltar").
 */

export function useRecurrences(propertyIds: string[] | null) {
  const fn = useServerFn(listRecurrences);
  const key = (propertyIds ?? []).slice().sort().join(",");
  return useQuery({
    queryKey: ["recurrences", key],
    queryFn: () => fn({ data: { propertyIds: propertyIds ?? undefined } }),
    enabled: propertyIds === null || propertyIds.length > 0,
    staleTime: 15_000,
  });
}

/** Chip ↻ N (magenta) do cartão do imóvel. */
export function RecurrenceChip({
  count,
  open,
  ...rest
}: { count: number; open?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-full border border-[#E82DAE]/40 bg-[#E82DAE]/[0.12] px-2 text-[11px] font-bold tabular-nums text-[#E82DAE] transition-colors hover:bg-[#E82DAE]/[0.2]",
        open && "ring-1 ring-foreground/25",
      )}
    >
      <Repeat className="size-3" />
      {count}
    </button>
  );
}

const CAT_LABEL = { maintenance: "Manutenção", cleaning: "Limpeza" } as const;

function money(cents: number | null) {
  if (cents == null) return null;
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type WindowPending = {
  id: string;
  title: string;
  categoryLabel: string;
  /** "registrado há 2 dias" */
  when: string;
  onDetails: () => void;
};

type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "edit"; id: string };

export function PropertyPendingWindow({
  open,
  onClose,
  initialTab,
  propertyId,
  name,
  covers,
  owner,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  initialTab: "pend" | "rec";
  propertyId: string;
  name: string;
  covers: Array<string | null | undefined>;
  owner: { name: string | null; phone: string | null; country: string | null } | null;
  pending: WindowPending[];
}) {
  const [tab, setTab] = useState<"pend" | "rec">(initialTab);
  const [view, setView] = useState<View>({ kind: "list" });
  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setView({ kind: "list" });
    }
  }, [open, initialTab]);

  const rq = useRecurrences(open ? [propertyId] : []);
  const series = rq.data?.series ?? [];
  const active = series.filter((s) => s.status === "active");
  const paused = series.filter((s) => s.status === "paused");
  const detail = view.kind !== "list" ? series.find((s) => s.id === view.id) : undefined;

  // Série encerrada/apagada por outra pessoa com o detalhe aberto: volta à lista.
  useEffect(() => {
    if (view.kind !== "list" && rq.data && !detail) setView({ kind: "list" });
  }, [view, rq.data, detail]);

  const eyebrow =
    view.kind === "list"
      ? "Pendências do imóvel"
      : view.kind === "edit"
        ? "Editar série"
        : `Recorrência · ${detail ? CAT_LABEL[detail.category] : ""}`;
  const title = view.kind === "list" || !detail ? name : detail.title;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        cover
        aria-describedby={undefined}
        className="flex max-h-[min(90dvh,calc(100dvh_-_var(--kb-inset,0px)_-_3rem))] w-[min(372px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
        onBack={
          view.kind === "detail"
            ? () => setView({ kind: "list" })
            : view.kind === "edit"
              ? () => setView({ kind: "detail", id: view.id })
              : undefined
        }
      >
        <div className="relative h-[140px] shrink-0 overflow-hidden bg-secondary/60">
          <div className="absolute inset-0 origin-center scale-[1.04] [filter:blur(1.5px)_brightness(.9)]">
            <CoverImage urls={covers} empty={false} />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/60 to-[var(--panel)]" />
          <div className="absolute inset-x-4 bottom-2.5 min-w-0 pr-12">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80">{eyebrow}</div>
            <DialogTitle className="mt-1 block truncate text-sm font-bold leading-tight text-white" title={title}>
              {title}
            </DialogTitle>
            {owner?.name ? (
              <OwnerLine
                name={owner.name}
                phone={owner.phone}
                country={owner.country}
                phonePosition="adjacent"
                className="mt-0.5 [&>span:first-child]:text-white"
              />
            ) : null}
          </div>
        </div>

        {view.kind === "list" && (
          <ListView
            tab={tab}
            setTab={setTab}
            pending={pending}
            active={active}
            paused={paused}
            loading={rq.isLoading}
            onDetail={(id) => setView({ kind: "detail", id })}
          />
        )}
        {view.kind === "detail" && detail && (
          <DetailView
            s={detail}
            onEdit={() => setView({ kind: "edit", id: detail.id })}
            onClosed={() => setView({ kind: "list" })}
          />
        )}
        {view.kind === "edit" && detail && <EditView s={detail} onDone={() => setView({ kind: "detail", id: detail.id })} />}
      </DialogContent>
    </Dialog>
  );
}

const SECTION =
  "flex items-center gap-2 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";
const Hair = () => <i className="h-px flex-1 bg-foreground/[0.08]" />;

function ListView({
  tab,
  setTab,
  pending,
  active,
  paused,
  loading,
  onDetail,
}: {
  tab: "pend" | "rec";
  setTab: (t: "pend" | "rec") => void;
  pending: WindowPending[];
  active: RecurrenceSummary[];
  paused: RecurrenceSummary[];
  loading: boolean;
  onDetail: (id: string) => void;
}) {
  const recCount = active.length + paused.length;
  const tabBtn = (k: "pend" | "rec", label: string, n: number) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      aria-pressed={tab === k}
      className={cn(
        "flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[0.55rem] border text-[13px] font-bold transition-colors",
        tab === k
          ? "border-[#c43fb0] bg-[#E82DAE]/[0.14] text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular-nums">{n}</span>
    </button>
  );
  return (
    <>
      <div className="flex shrink-0 gap-1 border-b border-[var(--panel-div)] px-4 py-2.5">
        {tabBtn("pend", "Pendências", pending.length)}
        {tabBtn("rec", "Recorrências", recCount)}
      </div>
      <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
        {tab === "pend" ? (
          <>
            <div className={SECTION}>
              <Hair />
              <span>Abertas · {pending.length}</span>
              <Hair />
            </div>
            {pending.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma pendência em aberto.</p>
            )}
            {pending.map((p, i) => (
              <div
                key={p.id}
                data-clip-row
                className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-[var(--panel-div)]")}
              >
                <CircleAlert className="size-[22px] shrink-0 text-[#d29a9a]" strokeWidth={1.8} />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-[15px] font-bold leading-tight">{p.title}</span>
                  <span className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                    {p.categoryLabel} · {p.when}
                  </span>
                </span>
                <button type="button" onClick={p.onDetails} className="shrink-0 text-[13px] font-bold text-muted-foreground hover:text-foreground">
                  Detalhes
                </button>
              </div>
            ))}
          </>
        ) : loading ? (
          <div className="grid place-items-center py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <>
            {recCount === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhuma recorrência neste imóvel. Crie em “+ Registro” → Repetir.
              </p>
            )}
            {active.length > 0 && (
              <>
                <div className={SECTION}>
                  <Hair />
                  <span>Ativas · {active.length}</span>
                  <Hair />
                </div>
                {active.map((s, i) => (
                  <SeriesRow key={s.id} s={s} first={i === 0} onDetail={() => onDetail(s.id)} />
                ))}
              </>
            )}
            {paused.length > 0 && (
              <>
                <div className={SECTION}>
                  <Hair />
                  <span>Pausadas · {paused.length}</span>
                  <Hair />
                </div>
                {paused.map((s, i) => (
                  <SeriesRow key={s.id} s={s} first={i === 0} muted onDetail={() => onDetail(s.id)} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function SeriesRow({
  s,
  first,
  muted,
  onDetail,
}: {
  s: RecurrenceSummary;
  first: boolean;
  muted?: boolean;
  onDetail: () => void;
}) {
  return (
    <div
      data-clip-row
      className={cn("flex items-start gap-3 px-4 py-3", !first && "border-t border-[var(--panel-div)]", muted && "opacity-60")}
    >
      <Repeat className="mt-0.5 size-[22px] shrink-0 text-[#E82DAE]" strokeWidth={1.8} />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="truncate text-[15px] font-bold leading-tight">{s.title}</span>
        <span className="truncate text-[12.5px] text-muted-foreground">
          {CAT_LABEL[s.category]} · {s.frequencyShort}
          {s.nextDate ? ` · próxima ${fmtBRShort(s.nextDate)}` : ""}
        </span>
        {s.inCleaningChecklist && (
          <span className="inline-flex h-5 w-fit items-center rounded-full bg-[#6fae8a]/[0.14] px-2 text-[10.5px] font-bold text-[#6fae8a]">
            No checklist de limpeza
          </span>
        )}
      </span>
      <button type="button" onClick={onDetail} className="shrink-0 self-center text-[13px] font-bold text-muted-foreground hover:text-foreground">
        Detalhes
      </button>
    </div>
  );
}

function occText(s: RecurrenceSummary, o: RecurrenceOccurrence, todayIso: string) {
  if (o.state === "done") {
    const parts = [`Feita${o.by ? ` por ${o.by}` : ""}`, money(o.amountCents)].filter(Boolean);
    return parts.join(" · ");
  }
  if (o.state === "skipped") return o.note?.startsWith("Pulada") ? o.note : `Pulada${o.note ? ` · ${o.note}` : ""}`;
  const lead = o.date <= todayIso ? "Aberta" : "Prevista";
  if (!s.inCleaningChecklist) return `${lead} · vira pendência no dia`;
  if (o.cleaningDate) {
    return o.cleaningDate === o.date
      ? `${lead} · checkout do dia`
      : `${lead} · vai no checkout de ${fmtBRShort(o.cleaningDate)}`;
  }
  return `${lead} · aguardando uma limpeza na agenda`;
}

function DetailView({ s, onEdit, onClosed }: { s: RecurrenceSummary; onEdit: () => void; onClosed: () => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateRecurrence);
  const skipFn = useServerFn(skipRecurrenceOccurrence);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const refresh = () => {
    for (const k of ["recurrences", "account-records", "dash-tasks", "reservation-records"]) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };
  async function run(label: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(label);
    try {
      await fn();
      refresh();
      after?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(null);
    }
  }
  const paused = s.status === "paused";
  const line = "flex items-center justify-between gap-3 py-[5px] text-[14px]";
  return (
    <>
      <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3.5">
        <div className="rounded-[0.9rem] border border-border/50 bg-secondary/30 px-3.5 py-2.5">
          <div className={line}>
            <span className="text-muted-foreground">Repete</span>
            <span className="font-bold">{describeFrequency(s.unit, s.interval, Number((s.nextDate ?? s.startDate).slice(8, 10)))}</span>
          </div>
          <div className={line}>
            <span className="text-muted-foreground">Próxima</span>
            <span className="font-bold tabular-nums">{paused ? "Pausada" : s.nextDate ? fmtBR(s.nextDate) : "—"}</span>
          </div>
          <div className={line}>
            <span className="text-muted-foreground">Termina</span>
            <span className="font-bold tabular-nums">{s.endsOn ? fmtBR(s.endsOn) : "Nunca"}</span>
          </div>
          <div className={line}>
            <span className="text-muted-foreground">Entra no checklist de limpeza</span>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[12px] font-bold",
                s.inCleaningChecklist ? "bg-[#6fae8a]/[0.16] text-[#6fae8a]" : "bg-foreground/[0.08] text-muted-foreground",
              )}
            >
              {s.inCleaningChecklist ? "Sim" : "Não"}
            </span>
          </div>
        </div>

        <div className="ds-eyebrow mb-2 mt-5 text-muted-foreground">Ocorrências</div>
        <ol className="relative grid gap-3.5">
          <span aria-hidden className="absolute bottom-3 left-[8px] top-3 w-px bg-foreground/[0.12]" />
          {s.occurrences.map((o) => (
            <li key={`${o.taskId ?? "n"}:${o.date}`} data-clip-row className="relative flex items-start gap-3">
              <span
                aria-hidden
                className={cn(
                  "relative z-10 mt-[5px] size-[17px] shrink-0 rounded-full",
                  o.state === "next" && "border-2 border-[#E82DAE] bg-[var(--panel)]",
                  o.state === "done" && "bg-[#7fb79a]",
                  o.state === "skipped" && "bg-foreground/40",
                )}
              />
              <span className="grid min-w-0 flex-1">
                <span className="text-[15px] font-bold tabular-nums leading-tight">{fmtBR(o.date)}</span>
                <span className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{occText(s, o, todayIso)}</span>
                {o.state === "next" && o.taskId && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void run("skip", () => skipFn({ data: { taskId: o.taskId! } }))}
                    className="mt-1 w-fit text-[12px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {busy === "skip" ? "Pulando…" : "Pular esta"}
                  </button>
                )}
              </span>
              {o.state === "next" ? (
                <span className="inline-flex h-[26px] shrink-0 items-center gap-1 rounded-md bg-[#E82DAE]/[0.16] px-2 text-[12px] font-bold text-[#E82DAE]">
                  <Repeat className="size-3.5" /> Próxima
                </span>
              ) : o.state === "done" ? (
                <span className="inline-flex h-[26px] shrink-0 items-center gap-1 rounded-md bg-[#7fb79a]/[0.16] px-2 text-[12px] font-bold text-[#7fb79a]">
                  <Check className="size-3.5" /> Feita
                </span>
              ) : (
                <span className="inline-flex h-[26px] shrink-0 items-center rounded-md bg-foreground/[0.08] px-2 text-[12px] font-bold text-muted-foreground">
                  Pulada
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--panel-div)] bg-secondary/20 px-4 py-3">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run("pause", () => updateFn({ data: { action: paused ? "resume" : "pause", id: s.id } }))}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[0.5rem] border border-border/60 px-3.5 text-[13px] font-bold disabled:opacity-50"
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {paused ? "Retomar" : "Pausar"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => {
            if (!confirmEnd) {
              setConfirmEnd(true);
              return;
            }
            void run("end", () => updateFn({ data: { action: "end", id: s.id } }), onClosed);
          }}
          onBlur={() => setConfirmEnd(false)}
          className={cn(
            "inline-flex h-10 shrink-0 items-center rounded-[0.5rem] border px-3.5 text-[13px] font-bold disabled:opacity-50",
            confirmEnd ? "border-[#c98c8c] text-[#c98c8c]" : "border-border/60",
          )}
        >
          {confirmEnd ? "Confirmar?" : "Encerrar"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-[0.5rem] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-[13px] font-bold text-white"
        >
          Editar série
        </button>
      </div>
    </>
  );
}

/** Editar série — não consta nos mockups; mesmos componentes da tela Repetir (título, frequência, próxima data, término, checklist). */
function EditView({ s, onDone }: { s: RecurrenceSummary; onDone: () => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateRecurrence);
  const [title, setTitle] = useState(s.title);
  const [unit, setUnit] = useState<RecurrenceUnit>(s.unit);
  const [interval, setInterval_] = useState(s.interval);
  const [next, setNext] = useState(s.nextDate ?? s.startDate);
  const [ends, setEnds] = useState(s.endsOn ?? "");
  const [checklist, setChecklist] = useState(s.inCleaningChecklist);
  const [saving, setSaving] = useState(false);
  const field = "h-9 rounded-[0.3rem] border border-border/60 bg-background/60 px-2.5 text-[13px] font-semibold outline-none";
  async function save() {
    if (!title.trim()) {
      toast.error("O título é obrigatório.");
      return;
    }
    setSaving(true);
    try {
      await updateFn({
        data: {
          action: "edit",
          id: s.id,
          title: title.trim().slice(0, 50),
          description: s.description,
          frequency: { unit, interval },
          nextDate: next,
          endsOn: ends || null,
          inCleaningChecklist: checklist,
        },
      });
      for (const k of ["recurrences", "account-records", "dash-tasks"]) void qc.invalidateQueries({ queryKey: [k] });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="sg-elegant-scroll min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3.5">
        <label className="grid gap-1.5">
          <span className="ds-eyebrow text-muted-foreground">Título · {title.length}/50</span>
          <input value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} className={field} />
        </label>
        <div className="grid gap-1.5">
          <span className="ds-eyebrow text-muted-foreground">Frequência</span>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">A cada</span>
            <input
              type="number"
              min={1}
              max={365}
              value={interval}
              onChange={(e) => setInterval_(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
              className={cn(field, "w-16 text-center")}
            />
            <select value={unit} onChange={(e) => setUnit(e.target.value as RecurrenceUnit)} className={field}>
              <option value="day">dias</option>
              <option value="week">semanas</option>
              <option value="month">meses</option>
              <option value="year">anos</option>
            </select>
          </div>
        </div>
        <label className="grid gap-1.5">
          <span className="ds-eyebrow text-muted-foreground">Próxima</span>
          <input type="date" value={next} onChange={(e) => e.target.value && setNext(e.target.value)} className={field} />
        </label>
        <label className="grid gap-1.5">
          <span className="ds-eyebrow text-muted-foreground">Termina em (opcional)</span>
          <input type="date" value={ends} min={next} onChange={(e) => setEnds(e.target.value)} className={field} />
        </label>
        <div className="flex items-center gap-3 rounded-[0.6rem] border border-border/50 bg-secondary/30 px-3.5 py-3">
          <span className="min-w-0 flex-1 text-[13px] font-semibold">Entra no checklist de limpeza</span>
          <Switch checked={checklist} onCheckedChange={setChecklist} />
        </div>
      </div>
      <div className="shrink-0 border-t border-[var(--panel-div)] bg-secondary/20 px-4 py-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[0.5rem] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-[13px] font-bold text-white disabled:opacity-60"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          Salvar
        </button>
      </div>
    </>
  );
}
