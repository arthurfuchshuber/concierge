import { useState } from "react";
import { CalendarX2, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { blockNights, ddmmISO } from "@/lib/manual-block-conflict";
import { ownerLabel } from "@/components/dashboard/card-colors";

/**
 * BLOQUEIO POR SELEÇÃO NO CALENDÁRIO (17/10/2026, mockups "Calendário" e
 * "Janela"). As duas peças usam SÓ o que já existe no sistema: `Button`
 * (36px, raio do tema), a casca de janela do Dashboard (`--win-radius`,
 * `--panel`, fio de luz) e `ownerLabel` ("Proprietário: Arthur").
 */

export type BlockSelection = { propertyId: string; from: string; to: string };

type Ctx = { propertyName: string; ownerName: string | null; city: string | null };

function OwnerLine({ ownerName }: { ownerName: string | null }) {
  const label = ownerLabel(ownerName);
  if (!label) return null;
  return (
    <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
      {label}
      <MessageSquare className="size-3" aria-hidden />
    </span>
  );
}

/** Barra flutuante: aparece quando há intervalo escolhido. */
export function CalendarBlockBar({
  ctx,
  from,
  to,
  onCancel,
  onConfirm,
}: {
  ctx: Ctx;
  from: string;
  to: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const n = blockNights(from, to);
  return (
    <div
      role="region"
      aria-label="Bloquear datas selecionadas"
      className="fixed inset-x-4 bottom-4 z-50 flex flex-col gap-3 rounded-[var(--win-radius)] border border-[var(--panel-border)] bg-[var(--panel)] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)] sm:inset-x-auto sm:bottom-8 sm:left-1/2 sm:w-[560px] sm:-translate-x-1/2 sm:flex-row sm:items-center sm:gap-4 sm:py-3 sm:pl-4 sm:pr-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">
          {n} {n === 1 ? "noite" : "noites"} · {ddmmISO(from)} a {ddmmISO(to)}
        </span>
        <span className="truncate text-[12px] text-muted-foreground">{ctx.propertyName}</span>
        <OwnerLine ownerName={ctx.ownerName} />
      </div>
      <div className="flex gap-2 sm:shrink-0">
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onCancel}>
          Cancelar
        </Button>
        <Button className="flex-1 sm:flex-none" onClick={onConfirm}>
          Bloquear
        </Button>
      </div>
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
  lightMode,
  onClose,
  onSave,
}: {
  open: boolean;
  ctx: Ctx;
  from: string;
  to: string;
  busy: boolean;
  lightMode: boolean;
  onClose: () => void;
  onSave: (note: string | null) => void;
}) {
  const isMobile = useIsMobile();
  const [note, setNote] = useState("");
  const n = blockNights(from, to);
  const tile = (label: string, value: string) => (
    <div className="rounded-[10px] border border-border bg-muted/20 px-3 py-2.5">
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
              <CalendarX2 className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <ResponsiveDialogTitle className="text-base font-display leading-tight truncate">Bloquear datas</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="ds-meta mt-0.5">
                {ddmmISO(from)} a {ddmmISO(to)} · {n} {n === 1 ? "noite" : "noites"}
                {lightMode ? " · fica só no ConciergeIA" : " · fecha também nos anúncios conectados"}
              </ResponsiveDialogDescription>
            </div>
          </div>
        </ResponsiveDialogHeader>
        <div className={cn("space-y-3 pt-3", isMobile ? "pb-1" : "px-5")}>
          <div className="rounded-[14px] border border-border bg-muted/20 px-3.5 py-3">
            <p className="break-words text-[13px] font-bold leading-snug">{ctx.propertyName}</p>
            <div className="mt-0.5">
              <OwnerLine ownerName={ctx.ownerName} />
            </div>
            {ctx.city ? <p className="text-[11.5px] text-muted-foreground">{ctx.city}</p> : null}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {tile("Entrada", ddmmISO(from))}
            {tile("Libera em", ddmmISO(to))}
            {tile("Noites", String(n))}
          </div>
          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">Motivo (opcional)</span>
            <Input
              value={note}
              maxLength={200}
              placeholder="Ex.: manutenção, uso do proprietário"
              onChange={(e) => setNote(e.target.value)}
              className="rounded-[8px]"
            />
          </label>
        </div>
        <ResponsiveDialogFooter
          className={cn(
            "gap-2 border-t border-border/40 pt-4",
            isMobile ? "flex-col-reverse [&>button]:w-full" : "mx-5 mb-5 mt-4 flex-row justify-end sm:space-x-0",
          )}
        >
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy} onClick={() => onSave(note.trim() || null)}>
            {busy && <Loader2 className="animate-spin" />}
            Bloquear {n} {n === 1 ? "noite" : "noites"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
