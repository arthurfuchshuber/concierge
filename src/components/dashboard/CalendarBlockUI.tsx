import { useEffect, useMemo, useState } from "react";
import { ptBR } from "date-fns/locale";
import { CalendarCheck2, CalendarX2, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ResponsiveDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  addDaysISO,
  blockNights,
  canPickBlockFrom,
  canPickBlockTo,
  canPickReleaseFrom,
  canPickReleaseTo,
  ddmmISO,
  maxBlockEnd,
  normalizeBlockRange,
  occupiedNightSet,
  releaseFirstNight,
  type StayRange,
} from "@/lib/manual-block-conflict";

const isoToDate = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const dateToIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import { ClampName } from "@/components/ui/clamp-name";

/**
 * BLOQUEIO POR SELEÇÃO NO CALENDÁRIO (17/10/2026, mockups "Calendário" e
 * "Janela"). As duas peças usam SÓ o que já existe no sistema: `Button`
 * (36px, raio do tema), a casca de janela do Dashboard (`--win-radius`,
 * `--panel`, fio de luz) e `ownerLabel` ("Proprietário: Arthur").
 */

export type BlockSelection = { propertyId: string; from: string; to: string };

type Ctx = {
  propertyName: string;
  ownerName: string | null;
  ownerPhone?: string | null;
  ownerPhoneCountry?: string | null;
  city: string | null;
};

/* BOTÕES DAS JANELAS DO DASHBOARD — mesmos do rodapé de "Criar pendência"
   (OperationWorkspace): `ds-surface` (12px), h-9, Cancelar fantasma e o
   primário no gradiente da marca. Não usam o `Button` do shadcn de propósito. */
const BTN_CANCEL =
  "ds-surface inline-flex h-9 items-center justify-center px-3 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60";
const BTN_PRIMARY =
  "ds-surface inline-flex h-9 items-center justify-center gap-2 px-4 text-[13px] font-semibold bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white transition-opacity hover:opacity-90 disabled:opacity-60";

/** Barra flutuante: aparece quando há intervalo escolhido. */
export function CalendarBlockBar({
  ctx,
  from,
  to,
  onCancel,
  onConfirm,
  onEditDates,
  mode = "block",
}: {
  ctx: Ctx;
  from: string;
  to: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** Tocar nas datas abre a janela com o calendário para escolher início e fim. */
  onEditDates?: () => void;
  /** "release" = tocou num bloqueio existente (mockup 6): "Bloqueado · dd/mm a dd/mm" + Fechar / Liberar datas. */
  mode?: "block" | "release";
}) {
  const n = blockNights(from, to);
  const release = mode === "release";
  const label = (
    <>
      {release ? <span className="mr-1.5 text-[12px] font-semibold text-muted-foreground">Bloqueado</span> : null}
      {ddmmISO(from)} <span aria-hidden>→</span> {ddmmISO(to)}
      <span className="ml-1.5 font-semibold text-muted-foreground">
        · {n} {n === 1 ? "noite" : "noites"}
      </span>
    </>
  );
  return (
    <div
      role="region"
      data-block-ui
      aria-label={release ? "Bloqueio selecionado" : "Bloquear datas selecionadas"}
      /* OPÇÃO "A · PÍLULA" (mockup "Barra leve" aprovado, 17/10/2026): uma linha só —
         datas + noites, ✕ e botão. Sem nome do imóvel/proprietário (já estão na linha
         selecionada). Celular: acima da navegação inferior (104px + área segura). */
      className="fixed inset-x-4 bottom-[calc(104px+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-[460px] items-center gap-2 rounded-full border border-white/10 bg-[var(--panel)]/95 py-1.5 pl-5 pr-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur-md sm:bottom-8"
    >
      {onEditDates && !release ? (
        <button type="button" aria-label="Editar datas" onClick={onEditDates} className="min-w-0 flex-1 truncate text-left text-[14px] font-bold underline decoration-dotted underline-offset-4">
          {label}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{label}</span>
      )}
      <button
        type="button"
        aria-label={release ? "Fechar" : "Cancelar seleção"}
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
        onClick={onCancel}
      >
        <X className="size-4" aria-hidden />
      </button>
      <button type="button" className={`${BTN_PRIMARY} !rounded-full px-5`} onClick={onConfirm}>
        {release ? "Liberar datas" : "Bloquear"}
      </button>
    </div>
  );
}

/** Quantos dias à frente o sistema trabalha com disponibilidade (mesmo horizonte do full sync da Channex). */
const HORIZON_DAYS = 500;
const monthStartOf = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 1);

type Picking = "from" | "to";

/**
 * CALENDÁRIO EM JANELA PRÓPRIA (29/10/2026, mockups aprovados "Calendário em janela por cima").
 * Tocar em Entrada/Libera em NÃO estica mais a janela Bloquear/Liberar: o calendário abre numa janela
 * pequena POR CIMA dela (mesmo casco do sistema: `--panel`, fio de luz, "X" de canto), numa cor só, com
 * os campos Início/Fim embaixo para ficar claro o que está sendo escolhido. Dias que não dão para usar
 * (passado, ocupados, fora do bloqueio manual) ficam esmaecidos, sem toque — os ocupados também riscados.
 */
function CalendarPickWindow({
  open,
  picking,
  from,
  to,
  title,
  min,
  max,
  occupied,
  canPick,
  onPickingChange,
  onPick,
  onClose,
}: {
  open: boolean;
  picking: Picking;
  from: string;
  to: string;
  title: string;
  min: Date;
  max: Date;
  occupied: ReadonlySet<string>;
  canPick: (iso: string) => boolean;
  onPickingChange: (p: Picking) => void;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const shownIso = picking === "from" ? from : to;
  const [month, setMonth] = useState<Date>(() => monthStartOf(shownIso));
  useEffect(() => {
    if (open) setMonth(monthStartOf(picking === "from" ? from : to));
    // só ao abrir ou ao trocar entre Início/Fim; mudar a data escolhida não pode "pular" o mês na mão da pessoa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, picking]);
  const selected = picking === "from" ? [isoToDate(from)] : [isoToDate(from), isoToDate(to)];
  const field = (which: Picking, label: string, value: string) => (
    <button type="button" className="text-left" aria-pressed={picking === which} onClick={() => onPickingChange(which)}>
      <div className={cn("rounded-[10px] border bg-muted/20 px-3 py-2.5", picking === which ? "border-accent" : "border-border")}>
        <div className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
        <div className="mt-0.5 font-display text-[15px] font-bold tabular-nums">{ddmmISO(value)}</div>
      </div>
    </button>
  );
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()} overlayClassName="bg-background/45 backdrop-blur-[1.5px]" className="w-[280px] max-w-[280px] gap-0 p-4 sm:p-4">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">Toque num dia para escolher.</DialogDescription>
        <Calendar
          mode="multiple"
          locale={ptBR}
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          startMonth={min}
          endMonth={max}
          disabled={(d) => !canPick(dateToIso(d))}
          modifiers={{ occupied: (d) => occupied.has(dateToIso(d)) }}
          modifiersClassNames={{ occupied: "[&_button]:line-through" }}
          onDayClick={(d, mods) => {
            if (mods.disabled) return;
            onPick(dateToIso(d));
          }}
          classNames={{ disabled: "text-foreground opacity-35" }}
          className="mt-4 bg-transparent p-3 pointer-events-auto"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          {field("from", "Início", from)}
          {field("to", "Fim", to)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Janela "Bloquear datas": confirma, pede o motivo (opcional) e salva. */
export function CalendarBlockDialog({
  open,
  ctx,
  from,
  to,
  busy,
  onClose,
  onSave,
  mode = "block",
  onRangeChange,
  initialPicking = false,
  todayISO,
  occupiedStays,
  releaseBlock,
}: {
  /** "release" = janela "Liberar datas" (mockup 7): sem motivo, botão "Liberar N noites". */
  mode?: "block" | "release";
  open: boolean;
  ctx: Ctx;
  from: string;
  to: string;
  busy: boolean;
  onClose: () => void;
  onSave: (note: string | null) => void;
  /** Quando presente, Entrada/Libera em ficam editáveis pelo calendário em janela por cima. */
  onRangeChange?: (from: string, to: string) => void;
  /** Abre já com o calendário da Entrada aberto (tocou nas datas da barra). */
  initialPicking?: boolean;
  /** Hoje (YYYY-MM-DD, fuso de São Paulo): nada antes dele pode ser bloqueado nem liberado. */
  todayISO: string;
  /** Bloquear: reservas e bloqueios que já ocupam noites do imóvel — esses dias ficam esmaecidos e riscados. */
  occupiedStays?: readonly StayRange[];
  /** Liberar: o bloqueio MANUAL tocado inteiro — só as noites dele podem ser escolhidas (reserva nunca se libera). */
  releaseBlock?: { from: string; to: string };
}) {
  const isMobile = useIsMobile();
  const [note, setNote] = useState("");
  const release = mode === "release";
  const editable = !!onRangeChange && (!release || !!releaseBlock);
  const [picking, setPicking] = useState<Picking | null>(null);
  useEffect(() => {
    if (open) setPicking(initialPicking && editable ? "from" : null);
  }, [open, initialPicking, editable]);
  /* A janela do calendário só monta DEPOIS que a janela de baixo já está de pé: a pilha de janelas do sistema
     ordena pela ordem em que cada uma abre, e abrir as duas no mesmo instante (toque nas datas da barra)
     deixava a de baixo por cima. */
  const [baseReady, setBaseReady] = useState(false);
  useEffect(() => {
    if (!open) {
      setBaseReady(false);
      return;
    }
    const t = window.setTimeout(() => setBaseReady(true), 250);
    return () => window.clearTimeout(t);
  }, [open]);
  const occupied = useMemo(() => occupiedNightSet(occupiedStays ?? []), [occupiedStays]);
  const n = blockNights(from, to);
  const HeadIcon = release ? CalendarCheck2 : CalendarX2;
  const nights = `${n} ${n === 1 ? "noite" : "noites"}`;

  const canPick = (iso: string, which: Picking) => {
    if (release) {
      if (!releaseBlock) return false;
      return which === "from" ? canPickReleaseFrom(releaseBlock, todayISO, iso) : canPickReleaseTo(releaseBlock, from, iso);
    }
    return which === "from" ? canPickBlockFrom(occupied, todayISO, iso) : canPickBlockTo(occupied, from, iso);
  };
  /** Primeiro e último mês que têm algum dia utilizável — é o que o seletor de mês/ano oferece. */
  const bounds = (which: Picking): { min: Date; max: Date } => {
    let lo: string;
    let hi: string;
    if (release && releaseBlock) {
      lo = which === "from" ? releaseFirstNight(releaseBlock, todayISO) : addDaysISO(from, 1);
      hi = which === "from" ? addDaysISO(releaseBlock.to, -1) : releaseBlock.to;
    } else if (which === "from") {
      lo = todayISO;
      hi = addDaysISO(todayISO, HORIZON_DAYS);
    } else {
      lo = addDaysISO(from, 1);
      hi = maxBlockEnd(occupied, from);
    }
    if (hi < lo) hi = lo;
    return { min: isoToDate(lo), max: isoToDate(hi) };
  };
  const handlePick = (iso: string) => {
    if (!picking || !onRangeChange) return;
    if (picking === "from") {
      if (release) onRangeChange(iso, to > iso ? to : addDaysISO(iso, 1));
      else {
        const r = normalizeBlockRange(occupied, iso, to);
        onRangeChange(r.from, r.to);
      }
      setPicking("to");
    } else {
      onRangeChange(from, iso);
      setPicking(null);
    }
  };

  const tile = (label: string, value: string, active = false) => (
    <div className={cn("rounded-[10px] border bg-muted/20 px-3 py-2.5", active ? "border-accent" : "border-border")}>
      <div className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-[15px] font-bold tabular-nums">{value}</div>
    </div>
  );
  return (
    <>
    <ResponsiveDialog open={open} onOpenChange={(v) => (!v && !busy ? onClose() : undefined)}>
      <ResponsiveDialogContent
        scrollable={false}
        className={cn(
          !isMobile &&
            "w-[calc(100vw-2rem)] sm:w-full sm:max-w-md p-0 overflow-hidden rounded-[var(--win-radius)] border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)] before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:content-[''] before:bg-[image:var(--panel-hair)]",
        )}
      >
        <ResponsiveDialogHeader className={cn(!isMobile && "px-5 pt-5 pb-0")}>
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent">
              <HeadIcon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <ResponsiveDialogTitle className="text-base font-display leading-tight truncate">{release ? "Liberar datas" : "Bloquear datas"}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="ds-meta mt-0.5">
                {ddmmISO(from)} a {ddmmISO(to)} · {n} {n === 1 ? "noite" : "noites"}
                {release ? " · volta a abrir também nos anúncios conectados" : " · fecha também nos anúncios conectados"}
              </ResponsiveDialogDescription>
            </div>
          </div>
        </ResponsiveDialogHeader>
        <div className={cn("space-y-3 pt-3", isMobile ? "pb-1" : "px-5")}>
          <div className="rounded-[14px] border border-border bg-muted/20 px-3.5 py-3">
            {/* Regra global (18/10/2026): proprietário + chat acima, título em 1 linha. */}
            <OwnerLine
              name={ctx.ownerName}
              phone={ctx.ownerPhone ?? null}
              country={ctx.ownerPhoneCountry ?? null}
              phonePosition="adjacent"
            />
            <ClampName text={ctx.propertyName} className="text-[13px] font-bold leading-snug" />
            {ctx.city ? <p className="text-[11.5px] text-muted-foreground">{ctx.city}</p> : null}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {editable ? (
              <>
                <button type="button" className="text-left" onClick={() => setPicking(picking === "from" ? null : "from")} aria-haspopup="dialog" aria-expanded={picking === "from"}>
                  {tile("Entrada", ddmmISO(from), picking === "from")}
                </button>
                <button type="button" className="text-left" onClick={() => setPicking(picking === "to" ? null : "to")} aria-haspopup="dialog" aria-expanded={picking === "to"}>
                  {tile("Libera em", ddmmISO(to), picking === "to")}
                </button>
              </>
            ) : (
              <>
                {tile("Entrada", ddmmISO(from))}
                {tile("Libera em", ddmmISO(to))}
              </>
            )}
            {tile("Noites", String(n))}
          </div>
          {!release && (
          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">Motivo (opcional)</span>
            <Input
              value={note}
              maxLength={200}
              placeholder="Ex.: manutenção, uso do proprietário"
              onChange={(e) => setNote(e.target.value)}
              className="rounded-[8px] bg-foreground/[0.04] text-[13px]"
            />
          </label>
          )}
        </div>
        <ResponsiveDialogFooter
          className={cn(
            "gap-2 border-t border-border/60 pt-3",
            isMobile ? "flex-col-reverse [&>button]:w-full" : "mx-5 mb-5 mt-4 flex-row items-center justify-end sm:space-x-0",
          )}
        >
          <button type="button" className={cn(BTN_CANCEL, isMobile && "w-full")} disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={cn(BTN_PRIMARY, isMobile && "w-full")} disabled={busy} onClick={() => onSave(release ? null : note.trim() || null)}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {release ? "Liberar" : "Bloquear"} {nights}
          </button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
    {editable && picking && baseReady ? (
      <CalendarPickWindow
        open
        picking={picking}
        from={from}
        to={to}
        title={release ? "Escolher datas a liberar" : picking === "from" ? "Escolher data de entrada" : "Escolher data de saída"}
        min={bounds(picking).min}
        max={bounds(picking).max}
        occupied={occupied}
        canPick={(iso) => canPick(iso, picking)}
        onPickingChange={setPicking}
        onPick={handlePick}
        onClose={() => setPicking(null)}
      />
    ) : null}
    </>
  );
}
