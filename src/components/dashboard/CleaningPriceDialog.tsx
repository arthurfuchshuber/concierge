import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/ui/money-input";
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
        <Button type="button" className="w-full" disabled={busy || cents == null} onClick={submit}>
          {busy ? "Salvando…" : "Salvar valor"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
