import { AlertTriangle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const VINCULO: Record<string, string> = {
  owner: "Proprietário",
  provider: "Prestador",
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export type ClicksignContractStartConflict = {
  kind: "owner" | "provider";
  id: string;
  name: string | null;
  current: string | null;
  suggested: string | null;
};

/**
 * Quando a sincronização do ClickSign encontra cadastros cuja "Início do
 * contrato" já foi preenchida manualmente com uma data diferente da
 * assinatura mais antiga do ClickSign, mostramos essa lista e deixamos a
 * decisão (manter ou sobrescrever) sempre com quem acionou a sincronização —
 * a integração nunca decide isso sozinha.
 */
export function ClicksignContractStartConflictDialog({
  open,
  onOpenChange,
  conflicts,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: ClicksignContractStartConflict[];
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-amber-500" /> Datas de início divergentes
          </DialogTitle>
          <DialogDescription className="text-xs">
            {conflicts.length} cadastro(s) já têm uma "Início do contrato" definida manualmente, diferente da data do
            primeiro documento assinado no ClickSign. O que deseja fazer?
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 space-y-1.5 overflow-y-auto sg-elegant-scroll">
          {conflicts.map((c) => (
            <div key={`${c.kind}:${c.id}`} className="rounded-lg bg-muted/50 px-3 py-2 text-[11px]">
              <p className="font-medium text-foreground">
                {c.name ?? "Cadastro"} <span className="text-muted-foreground">· {VINCULO[c.kind]}</span>
              </p>
              <p className="text-muted-foreground">
                Atual: {fmtDate(c.current)} → ClickSign sugere: {fmtDate(c.suggested)}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-full text-xs"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Manter as datas atuais
          </Button>
          <Button size="sm" className="h-9 w-full text-xs" disabled={pending} onClick={onConfirm}>
            {pending && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Usar a data do ClickSign nesses
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
