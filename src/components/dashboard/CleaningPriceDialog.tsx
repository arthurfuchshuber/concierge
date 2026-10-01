import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CheckCircle2, Ban, StickyNote, Pencil } from "lucide-react";
import type { ArrivalRow } from "@/lib/dashboard-arrival-types";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/ui/money-input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CleaningProviderAvatar } from "@/components/dashboard/CleaningProviderAvatar";
import { getCleaningPriceInfo, setCleaningPriceOverride } from "@/lib/cleaning-price.functions";

function brl(c: number | null | undefined) {
  if (c == null) return "—";
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Janela "Ajustar valor desta limpeza". Vale só para aquela limpeza — o preço
 * cadastrado do imóvel não muda. Funciona antes e depois da conclusão.
 */
export function CleaningPriceDialog({
  open,
  onOpenChange,
  logId,
  reservationId,
  title,
  normalCents,
  fullCents,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  logId: string | null;
  reservationId: string | null;
  title: string;
  normalCents: number | null;
  fullCents: number | null;
  onSaved?: () => void;
}) {
  const getInfo = useServerFn(getCleaningPriceInfo);
  const save = useServerFn(setCleaningPriceOverride);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getCleaningPriceInfo>> | null>(null);
  const [cents, setCents] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setInfo(null);
    setReason("");
    getInfo({ data: { logId, reservationId } })
      .then((r) => {
        if (!alive) return;
        setInfo(r);
        setCents(r?.currentCents ?? (r?.cleaningType === "completa" ? fullCents : normalCents) ?? null);
        setReason(r?.reason ?? "");
      })
      .catch(() => alive && setCents(normalCents));
    return () => {
      alive = false;
    };
  }, [open, logId, reservationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const standard = info?.cleaningType === "completa" ? fullCents : normalCents;
  const standardLabel = info?.cleaningType === "completa" ? "completa" : "normal";

  async function submit() {
    if (cents == null) return;
    setBusy(true);
    try {
      await save({ data: { logId, reservationId, cents, reason: reason.trim() || null } });
      toast.success("Valor da limpeza ajustado.");
      qc.invalidateQueries({ queryKey: ["cleaning-price-info"] });
      qc.invalidateQueries({ queryKey: ["reservation-journey"] });
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ajustar o valor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:w-full sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-display">Ajustar valor da limpeza</DialogTitle>
          <p className="text-[12.5px] text-muted-foreground break-words">{title}</p>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-[0.5rem] border border-border/60 bg-muted/30 px-3 py-2 text-[12.5px]">
          <span className="text-muted-foreground">Padrão do imóvel ({standardLabel})</span>
          <span className="font-semibold tabular-nums">{brl(standard)}</span>
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium">Valor desta limpeza</label>
          <MoneyInput cents={cents} onChange={setCents} placeholder="0,00" disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium">
            Motivo <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Ex.: hóspede ficou 1 dia a mais"
            disabled={busy}
          />
        </div>
        {info?.adjusted && (
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Ajustado{info.byName ? ` por ${info.byName}` : ""}
            {info.at ? ` em ${new Date(info.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}
            {info.originalCents != null ? ` · original ${brl(info.originalCents)}` : ""}
          </p>
        )}
        <Button type="button" className="w-full" disabled={busy || cents == null} onClick={() => setConfirm(true)}>
          {busy ? "Salvando…" : "Salvar valor"}
        </Button>
        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar alteração?</AlertDialogTitle>
              <AlertDialogDescription className="break-words">
                O valor desta limpeza vai passar a ser {brl(cents)}. Vale só para esta limpeza.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); setConfirm(false); void submit(); }}>
                Confirmar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/** Bloco "Limpeza" dentro da janela de detalhes do card. */
export function CleaningInlineEditor({
  row,
  logId,
  reservationId,
  onAdjust,
  onConclude,
  onSkip,
  onNote,
}: {
  row: ArrivalRow;
  logId: string | null;
  reservationId: string | null;
  onAdjust: () => void;
  onConclude?: () => void;
  onSkip?: () => void;
  onNote: () => void;
}) {
  const getInfo = useServerFn(getCleaningPriceInfo);
  const { data: info } = useQuery({
    queryKey: ["cleaning-price-info", logId, reservationId],
    queryFn: () => getInfo({ data: { logId, reservationId } }),
    staleTime: 10_000,
  });
  const type = info?.cleaningType as "normal" | "completa" | null | undefined;
  const standard = type === "completa" ? row.cleaningPriceFullCents : row.cleaningPriceNormalCents;
  const value = info?.currentCents ?? standard;
  return (
    <div className="ds-surface divide-y divide-border/60 border border-border/60">
      <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
        <span className="text-[12px] text-muted-foreground">Tipo</span>
        <span className="text-[12.5px] font-semibold">
          {type === "completa" ? "Completa" : type === "normal" ? "Normal" : "A definir na conclusão"}
        </span>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
        <span className="text-[12px] text-muted-foreground">Responsável</span>
        <CleaningProviderAvatar propertyId={row.propertyId} logId={row.logId} reservationId={row.reservationId} showName />
      </div>
      <button
        type="button"
        onClick={onAdjust}
        className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary/40"
      >
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Banknote className="size-3.5 shrink-0" /> Valor desta limpeza
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold tabular-nums">
          {info?.adjusted && (
            <span className="rounded-full border border-border/60 px-1.5 text-[9.5px] font-bold uppercase text-muted-foreground">
              ajustado
            </span>
          )}
          {brl(value)}
          <Pencil className="size-3 text-muted-foreground" />
        </span>
      </button>
      {info?.adjusted && info.reason && (
        <p className="px-3 py-2 text-[11.5px] text-muted-foreground break-words">Motivo: {info.reason}</p>
      )}
      <div className="flex flex-wrap gap-2 px-3 py-2.5">
        {onConclude && (
          <Button type="button" size="sm" onClick={onConclude}>
            <CheckCircle2 className="size-3.5" /> Concluir limpeza
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={onNote}>
          <StickyNote className="size-3.5" /> Nota interna
        </Button>
        {onSkip && (
          <Button type="button" size="sm" variant="outline" onClick={onSkip}>
            <Ban className="size-3.5" /> Não será realizada
          </Button>
        )}
      </div>
    </div>
  );
}
