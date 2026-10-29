import { useEffect, useState } from "react";
import { ptBR } from "date-fns/locale";
import { CalendarCheck2, CalendarX2, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
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
import { addDaysISO, blockNights, ddmmISO } from "@/lib/manual-block-conflict";

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
  /** Quando presente, Entrada/Libera em ficam editáveis por calendário. */
  onRangeChange?: (from: string, to: string) => void;
  /** Abre já com o calendário da Entrada aberto (tocou nas datas da barra). */
  initialPicking?: boolean;
}) {
  const isMobile = useIsMobile();
  const [note, setNote] = useState("");
  const editable = !!onRangeChange && mode === "block";
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  useEffect(() => {
    if (open) setPicking(initialPicking && editable ? "from" : null);
  }, [open, initialPicking, editable]);
  const n = blockNights(from, to);
  const release = mode === "release";
  const HeadIcon = release ? CalendarCheck2 : CalendarX2;
  const nights = `${n} ${n === 1 ? "noite" : "noites"}`;
  const tile = (label: string, value: string, active = false) => (
    <div className={cn("rounded-[10px] border bg-muted/20 px-3 py-2.5", active ? "border-accent" : "border-border")}>
      <div className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-[15px] font-bold tabular-nums">{value}</div>
    </div>
  );
  return (
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
                <button type="button" className="text-left" onClick={() => setPicking(picking === "from" ? null : "from")} aria-expanded={picking === "from"}>
                  {tile("Entrada", ddmmISO(from), picking === "from")}
                </button>
                <button type="button" className="text-left" onClick={() => setPicking(picking === "to" ? null : "to")} aria-expanded={picking === "to"}>
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
          {editable && picking && (
            <div className="flex justify-center rounded-[14px] border border-border bg-muted/20">
              <Calendar
                mode="single"
                locale={ptBR}
                selected={isoToDate(picking === "from" ? from : to)}
                defaultMonth={isoToDate(picking === "from" ? from : to)}
                disabled={picking === "to" ? { before: isoToDate(addDaysISO(from, 1)) } : undefined}
                onSelect={(d) => {
                  if (!d) return;
                  const iso = dateToIso(d);
                  if (picking === "from") {
                    const nextTo = iso >= to ? addDaysISO(iso, 1) : to;
                    onRangeChange!(iso, nextTo);
                    setPicking("to");
                  } else {
                    onRangeChange!(from, iso);
                    setPicking(null);
                  }
                }}
                className="p-3 pointer-events-auto"
              />
            </div>
          )}
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
  );
}
