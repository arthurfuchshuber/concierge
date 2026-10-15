import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2, Lock } from "lucide-react";
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

  const apiKey = q.data?.apiKey ?? null;
  const left = items.length;
  const label = "text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground/80";
  const box =
    "rounded-[14px] bg-foreground/[0.03] p-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]";
  const steps = [
    "Na sua ferramenta de precificação, conecte a Channex usando a chave de API abaixo (se já estiver conectada, só atualize a lista de anúncios).",
    "Ative o anúncio listado abaixo na ferramenta, pelo código da unidade, e ligue a sincronização das diárias.",
    "Aguarde as diárias chegarem (geralmente poucos minutos) e toque em \"Já conectei\". Conferimos 30 dias de diárias e só então ligamos o anúncio ao Airbnb, com o calendário aberto.",
  ];

  return (
    <Dialog open={open}>
      <DialogContent
        hideClose
        className="max-h-[90dvh] max-w-[380px] gap-2.5 overflow-y-auto p-[18px] sm:max-w-[560px] sm:gap-3.5"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="grid min-w-0 gap-2.5">
          <DialogTitle className="flex items-center gap-2.5 font-display text-[19px] font-extrabold leading-[1.2] tracking-[-0.01em]">
            <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
              <Lock className="size-4" />
            </span>
            <span className="min-w-0">Finalize a ativação</span>
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-[1.55]">
            <b className="font-bold text-foreground">
              {left} {left === 1 ? "anúncio aguarda" : "anúncios aguardam"}
            </b>{" "}
            a ferramenta de precificação para ficar "Conectado" no Airbnb sem travar o calendário.
          </DialogDescription>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <div className={label}>Como finalizar</div>
          <ol className={`${box} grid gap-2`}>
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[12.5px] leading-[1.5] text-foreground">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <div className={label}>Chave de API</div>
          <div className={`${box} grid gap-1.5`}>
            {apiKey ? (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate text-[13px] font-bold text-foreground">{apiKey.title}</span>
                </div>
                <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted px-2 py-1.5">
                  <code className="min-w-0 flex-1 break-all text-xs text-foreground">{apiKey.prefix}…</code>
                  <CopyButton value={apiKey.prefix} size={14} />
                </div>
                <p className="text-[11.5px] leading-[1.5] text-muted-foreground">
                  Uma única chave serve para todos os anúncios abaixo. Ela começa com estes caracteres; use a
                  chave completa que você já cadastrou na ferramenta.
                </p>
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">Preparando a chave de acesso…</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <div className={label}>Anúncios para ativar</div>
          {items.map((it) => (
            <div key={it.propertyId} className={`${box} grid gap-2`}>
              <p className="min-w-0 text-[13px] font-bold text-foreground">{it.propertyName}</p>
              {it.unitCode ? (
                <div className="grid gap-1">
                  <span className="text-[11px] text-muted-foreground">Código da unidade</span>
                  <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted px-2 py-1.5">
                    <code className="min-w-0 flex-1 break-all text-xs text-foreground">{it.unitCode}</code>
                    <CopyButton value={it.unitCode} size={14} />
                  </div>
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
