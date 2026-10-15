import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { getPendingFullConnections, confirmFullConnectionFn } from "@/lib/channex-full-connect.functions";
import { useUnsyncedProperties } from "./useUnsyncedProperties";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/CopyButton";

/**
 * AVISO FIXO DO MODO FULL: anúncio vinculado que ainda não está "Conectado" no Airbnb.
 * Mostra o código da unidade para importar na ferramenta de preços e só sai quando o
 * "Já conectei" confirma as diárias e o anúncio é ligado (calendário nunca travado).
 * Não tem "X" nem fecha com Esc/clique fora. Só aparece depois do aviso de sincronização.
 */
export function FullConnectGate() {
  const { perm, q: unsynced } = useUnsyncedProperties();
  const listFn = useServerFn(getPendingFullConnections);
  const confirmFn = useServerFn(confirmFullConnectionFn);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});

  // Prioridade: o aviso de conexão aparece por cima da janela de sincronização (montado depois dela).
  void unsynced;
  const force = true;
  const syncBlocking = false;
  const q = useQuery({
    queryKey: ["full-connect-pending"],
    queryFn: () => listFn(),
    enabled: perm.allowed && (force || !unsynced.isLoading) && !syncBlocking,
    staleTime: 30_000,
    retry: 1,
  });
  const items = q.data?.items ?? [];
  const open = perm.allowed && !syncBlocking && items.length > 0;

  async function confirm(propertyId: string) {
    setBusy(propertyId);
    setNotice((n) => ({ ...n, [propertyId]: "" }));
    try {
      const r = await confirmFn({ data: { propertyId } });
      if (r.ok) {
        toast.success("Anúncio conectado ao Airbnb com o calendário aberto.");
        await qc.invalidateQueries({ queryKey: ["full-connect-pending"] });
      } else {
        setNotice((n) => ({
          ...n,
          [propertyId]:
            "Ainda não recebemos as diárias desta unidade. Confira se a importação na sua ferramenta de precificação terminou e clique de novo.",
        }));
      }
    } catch {
      setNotice((n) => ({ ...n, [propertyId]: "Não foi possível confirmar agora. Tente novamente em 1 minuto." }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent
        hideClose
        className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 text-primary">
          <Lock className="size-4" />
          <span className="text-xs font-medium">Etapa obrigatória do Modo Full</span>
        </div>
        <DialogTitle>Conecte sua ferramenta de precificação</DialogTitle>
        <DialogDescription>
          Para o anúncio ficar "Conectado" no Airbnb sem travar o calendário, importe o código abaixo na sua
          ferramenta de precificação. Depois que ela enviar as diárias, clique em "Já conectei".
        </DialogDescription>
        <div className="mt-2 space-y-3">
          {items.map((it) => (
            <div key={it.propertyId} className="space-y-2 rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-medium text-foreground">{it.propertyName}</p>
              {it.unitCode ? (
                <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted px-2 py-1.5">
                  <code className="min-w-0 flex-1 break-all text-xs text-foreground">{it.unitCode}</code>
                  <CopyButton value={it.unitCode} size={14} />
                </div>
              ) : (
                <p className="text-xs text-destructive">{it.error}</p>
              )}
              {notice[it.propertyId] ? (
                <p className="text-xs text-muted-foreground">{notice[it.propertyId]}</p>
              ) : null}
              <Button
                className="w-full"
                disabled={!it.unitCode || busy !== null}
                onClick={() => confirm(it.propertyId)}
              >
                {busy === it.propertyId ? <Loader2 className="size-4 animate-spin" /> : null}
                {busy === it.propertyId ? "Conferindo diárias…" : "Já conectei"}
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
