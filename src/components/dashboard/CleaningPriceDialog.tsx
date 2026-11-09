import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
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
      <DialogContent className="w-[calc(100vw-2rem)] gap-0 p-0 sm:w-full sm:max-w-sm">
        <DialogHeader className="border-b border-border/40 px-4 pb-2.5 pt-3 pr-12 text-left">
          <DialogTitle className="truncate text-sm font-bold leading-5 text-foreground">Ajustar valor da limpeza</DialogTitle>
          <p className="truncate text-xs leading-4 text-muted-foreground" title={title}>{title}</p>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-4 pb-4 pt-2.5">
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
      </div>
      </DialogContent>
    </Dialog>
  );
}

/** Bloco "Limpeza" dentro da janela de detalhes do card.
 *  09/11/2026 (mockup aprovado): só aparece o que já está confirmado — Prestador e o botão verde "Finalizar Limpeza"
 *  (largura toda). Tipo e Valor ainda não foram confirmados (só se definem ao finalizar) e o quadrado "Limpeza não
 *  será realizada" saiu daqui; os dois continuam no menu do card (Ajustar valor / Limpeza não será realizada). */
export function CleaningInlineEditor({ row, onConclude }: { row: ArrivalRow; onConclude?: () => void }) {
  const rowCls = "flex min-h-[21px] items-center justify-between gap-4 text-xs leading-[15px]";
  return (
    <>
      <div className={rowCls}>
        <span className="shrink-0 text-[#8f8781]">Prestador</span>
        <CleaningProviderAvatar propertyId={row.propertyId} logId={row.logId} reservationId={row.reservationId} rowStyle />
      </div>
      {onConclude && (
        <div className="mt-3.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onConclude}
            className="box-border inline-flex h-7 min-h-7 min-w-0 flex-1 items-center justify-center gap-2 rounded-[7px] bg-emerald-600 px-2.5 text-[11px] font-semibold leading-none tracking-tight text-white transition-all hover:bg-emerald-700 active:scale-[0.99]"
          >
            <Check className="size-3 shrink-0" />
            <span className="truncate">Finalizar Limpeza</span>
          </button>
        </div>
      )}
    </>
  );
}
