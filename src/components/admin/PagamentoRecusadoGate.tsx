import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createPortalSession } from "@/lib/billing/billing.functions";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { useSubscription } from "@/hooks/useSubscription";
import { useMyPermissions } from "@/hooks/useMyPermissions";
import { useImpersonation } from "@/hooks/useImpersonation";

/**
 * Pagamento recusado (regra de 10/11/2026): verificação de cartão com problema só gera aviso, mas
 * quando o pagamento da assinatura FALHA ou é RECUSADO o painel é bloqueado por uma janela no meio
 * da tela até o cartão ser atualizado. Sem "X", sem Esc, sem clique fora. Só o titular vê (é quem
 * pode trocar o cartão); admin SaaS que visita uma conta não é bloqueado.
 */
export function PagamentoRecusadoGate() {
  const { info } = useSubscription();
  const { isOwner } = useMyPermissions();
  const { impersonation } = useImpersonation();
  const portalFn = useServerFn(createPortalSession);
  const [busy, setBusy] = useState(false);

  const open = info.isPastDue && info.hasStripeBilling && isOwner && !impersonation;

  async function updateCard() {
    setBusy(true);
    try {
      const res = await portalFn({ data: { returnPath: "/admin/administrativo?tab=perfil" } });
      window.location.href = res.url;
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Não foi possível abrir a troca do cartão"));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent
        hideClose
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-w-[380px] gap-3 p-[18px] pt-[22px]"
      >
        <DialogTitle className="flex items-center gap-2.5 font-display text-[19px] font-extrabold leading-[1.2] tracking-[-0.01em]">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
            <CreditCard className="size-4" />
          </span>
          <span className="min-w-0">Pagamento recusado</span>
        </DialogTitle>
        <DialogDescription className="text-[12.5px] leading-[1.55]">
          O pagamento da sua assinatura não foi aprovado. Atualize o cartão para liberar o painel; a cobrança é tentada de novo em seguida.
        </DialogDescription>
        <button
          type="button"
          onClick={updateCard}
          disabled={busy}
          className="flex h-[46px] items-center justify-center gap-2 rounded-md bg-gradient-to-br from-brand-purple to-brand-magenta text-[13.5px] font-extrabold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Atualizar cartão
        </button>
      </DialogContent>
    </Dialog>
  );
}
