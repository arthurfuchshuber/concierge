import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2, Archive } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getClicksignPurgePreview } from "@/lib/clicksign-import.functions";

/**
 * Ao desativar a integração, pergunta se os dados criados por ela devem ser
 * mantidos ou removidos. Cadastros feitos manualmente nunca são apagados.
 */
export function ClicksignDisconnectDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (purge: boolean) => void;
  pending: boolean;
}) {
  const previewFn = useServerFn(getClicksignPurgePreview);
  const preview = useQuery({
    queryKey: ["clicksign-purge-preview"],
    queryFn: () => previewFn(),
    enabled: open,
    retry: false,
  });

  const p = preview.data;
  const total = (p?.documents ?? 0) + (p?.owners ?? 0) + (p?.providers ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Desativar integração do ClickSign</DialogTitle>
          <DialogDescription className="text-xs">
            O que fazer com os dados que a integração trouxe?
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Verificando…
          </div>
        ) : (
          <div className="space-y-2">
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
              {p?.documents ?? 0} contrato(s) importado(s) · {p?.owners ?? 0} proprietário(s) e {p?.providers ?? 0}{" "}
              prestador(es) criados automaticamente.
            </p>

            <button
              type="button"
              disabled={pending}
              onClick={() => onConfirm(false)}
              className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted/60"
            >
              <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-xs font-medium">Manter tudo</span>
                <span className="block text-[11px] text-muted-foreground">
                  Desconecta a chave, mas preserva contratos e cadastros já criados.
                </span>
              </span>
            </button>

            <button
              type="button"
              disabled={pending || total === 0}
              onClick={() => onConfirm(true)}
              className="flex w-full items-start gap-3 rounded-xl border border-destructive/40 p-3 text-left transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                <span className="block text-xs font-medium text-destructive">Excluir tudo que foi criado</span>
                <span className="block text-[11px] text-muted-foreground">
                  Apaga os contratos importados e os cadastros gerados pela integração. Cadastros feitos à mão
                  permanecem.
                </span>
              </span>
            </button>

            <Button variant="ghost" size="sm" className="h-8 w-full text-xs" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
