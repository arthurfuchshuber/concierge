import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, PauseCircle } from "lucide-react";
import { getMyWhatsappConfig } from "@/lib/whatsapp.functions";
import { WHATSAPP_STANDBY_MESSAGE } from "@/lib/whatsapp-standby";

/**
 * WhatsApp Business — EM STANDBY desde 10/11/2026: a integração Sinch foi removida e o canal volta só pela Cloud
 * API oficial da Meta, em etapa futura. A tela só informa o estado (sem formulário de credenciais).
 */
export function WhatsappBusinessPage({ accountOwnerId = null }: { accountOwnerId?: string | null; readOnly?: boolean }) {
  const getFn = useServerFn(getMyWhatsappConfig);
  const q = useQuery({
    queryKey: ["whatsapp-config", accountOwnerId],
    queryFn: () => getFn({ data: { ownerId: accountOwnerId } }),
  });

  if (q.isLoading)
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );

  return (
    <div className="space-y-3" data-testid="whatsapp-standby">
      <div className="flex min-w-0 items-start gap-3 rounded-[14px] bg-card px-4 py-4 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)]">
        <PauseCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="ds-card-title break-words">{q.data?.message ?? WHATSAPP_STANDBY_MESSAGE}</p>
          <p className="ds-body break-words text-muted-foreground">
            Nenhuma mensagem é enviada ou recebida pelo WhatsApp enquanto a integração oficial não for ativada. As
            conversas antigas continuam no histórico.
          </p>
        </div>
      </div>
    </div>
  );
}
