import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { activateFullMode, answerTwinPrompt, getOperationMode, getTwinSuggestions, validatePricingFn } from "@/lib/channex-mode.functions";
import { useImpersonation } from "@/hooks/useImpersonation";

export function useOperationMode() {
  const { impersonation } = useImpersonation();
  const ownerId = impersonation?.userId ?? null;
  const fn = useServerFn(getOperationMode);
  const q = useQuery({ queryKey: ["operation-mode", ownerId], queryFn: () => fn({ data: { ownerId } }), retry: false });
  return { ownerId, data: q.data ?? null };
}

/** Card do modo de operação da conta (Leve x Full) — piloto restrito. */
export function ChannexModeCard() {
  const { ownerId, data } = useOperationMode();
  const qc = useQueryClient();
  const twinsFn = useServerFn(getTwinSuggestions);
  const validateFn = useServerFn(validatePricingFn);
  const activateFn = useServerFn(activateFullMode);
  const answerFn = useServerFn(answerTwinPrompt);
  const [wizard, setWizard] = useState(false);
  const twins = useQuery({
    queryKey: ["twin-suggestions", ownerId],
    queryFn: () => twinsFn({ data: { ownerId } }),
    enabled: !!data,
    retry: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["operation-mode", ownerId] });
  const validate = useMutation({
    mutationFn: () => validateFn({ data: { ownerId } }),
    onSuccess: (r) => {
      refresh();
      r.ok ? toast.success("Preços recebidos para todos os anúncios.") : toast.error(`Ainda faltam preços em ${r.missing} anúncio(s). Faça o "Sync Now" na ferramenta de pricing e valide de novo.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível validar."),
  });
  const activate = useMutation({
    mutationFn: () => activateFn({ data: { ownerId } }),
    onSuccess: () => { refresh(); setWizard(false); toast.success("Modo Full ativado para toda a conta."); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível ativar."),
  });
  const dismiss = useMutation({ mutationFn: () => answerFn({ data: { ownerId } }), onSuccess: refresh });

  if (!data) return null;
  const full = data.mode === "full";
  const suggestions = twins.data ?? [];

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-foreground">Modo de operação da conta</p>
        <Badge variant={full ? "default" : "secondary"}>{full ? "Full (calendário pelo ConciergeIA)" : "Leve (calendário na plataforma)"}</Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {full
          ? "O ConciergeIA cuida só da disponibilidade (reservas, bloqueios e anúncios gêmeos). Os preços continuam com a sua ferramenta de pricing. Faça os bloqueios pelo botão \"Bloquear datas\" do Painel."
          : "Você gerencia calendário e preços direto na plataforma de hospedagem. O ConciergeIA recebe reservas, financeiro e mensagens na hora, sem mexer em datas nem preços."}
      </p>
      <p className="text-[11px] text-muted-foreground">O modo vale para a conta inteira — nunca para só alguns imóveis.</p>

      {suggestions.length > 0 && !data.twinPromptAnsweredAt && (
        <div className="space-y-2 rounded-md bg-muted/50 p-2">
          <p className="text-xs font-medium text-foreground">Possíveis anúncios do mesmo imóvel</p>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li key={s.a.listingId + s.b.listingId} className="break-words text-[11px] text-muted-foreground">
                {s.a.title} + {s.b.title} <span className="text-foreground">({s.reason})</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            {full ? "Una esses pares em \"Anúncios do mesmo imóvel\" abaixo para fecharem as datas juntos." : "Para sincronizar os calendários desses pares, a conta precisa do Modo Full."}
          </p>
          <div className="flex flex-wrap gap-2">
            {!full && <Button size="sm" className="h-8 rounded-full text-xs" onClick={() => setWizard(true)}>Sim, sincronizar calendários</Button>}
            <Button size="sm" variant="outline" className="h-8 rounded-full text-xs" onClick={() => dismiss.mutate()}>Não, gerenciar separado</Button>
          </div>
        </div>
      )}

      {!full && (
        <Button size="sm" variant="outline" className="h-8 rounded-full text-xs" onClick={() => setWizard(true)}>Mudar para o Modo Full…</Button>
      )}

      <Dialog open={wizard} onOpenChange={setWizard}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ativar o Modo Full para toda a conta</DialogTitle>
            <DialogDescription>
              O ConciergeIA passa a controlar a disponibilidade de todos os imóveis conectados. Ele não define preços: por isso é obrigatório ter uma ferramenta de pricing (ex.: PriceLabs) enviando as diárias antes de ativar.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
            <li>Na ferramenta de pricing, adicione a integração e importe seus anúncios.</li>
            <li>Clique em "Sync Now" para enviar as diárias.</li>
            <li>Volte aqui e valide. Só depois disso a ativação é liberada, para nenhum dia ficar com preço errado.</li>
          </ol>
          <Button variant="outline" disabled={validate.isPending} onClick={() => validate.mutate()}>
            {validate.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : data.pricingValidatedAt ? <CheckCircle2 className="mr-1 size-4" /> : null}
            {data.pricingValidatedAt ? "Preços validados — validar de novo" : "Validar envio de preços"}
          </Button>
          <Button disabled={!data.pricingValidatedAt || activate.isPending} onClick={() => activate.mutate()}>
            {activate.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}Confirmar e ativar Modo Full
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
