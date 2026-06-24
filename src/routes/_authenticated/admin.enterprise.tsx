import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { checkIsAdmin } from "@/lib/admin-subs.functions";
import {
  adminCreateEnterpriseSubscription,
  adminListEnterpriseSubscriptions,
  adminAnchorSubscriptionToDay1,
  adminCancelEnterpriseSubscription,
} from "@/lib/admin-enterprise.functions";
import { getPaddleEnvironment } from "@/lib/paddle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Crown, Plus, Loader2, Calendar, Ban, Anchor } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/enterprise")({
  beforeLoad: async () => {
    try {
      const res = await checkIsAdmin();
      if (!res.isAdmin) throw redirect({ to: "/admin" });
    } catch {
      throw redirect({ to: "/admin" });
    }
  },
  component: EnterprisePage,
});

function formatBRL(cents: number | null | undefined) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function EnterprisePage() {
  const env = getPaddleEnvironment();
  const qc = useQueryClient();
  const list = useServerFn(adminListEnterpriseSubscriptions);
  const create = useServerFn(adminCreateEnterpriseSubscription);
  const anchor = useServerFn(adminAnchorSubscriptionToDay1);
  const cancelFn = useServerFn(adminCancelEnterpriseSubscription);

  const [openCreate, setOpenCreate] = useState(false);
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [trial, setTrial] = useState("7");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin-enterprise", env],
    queryFn: () => list({ data: { environment: env } }),
  });

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const cents = Math.round(parseFloat(amount.replace(",", ".")) * 100);
      const trialDays = parseInt(trial, 10);
      if (!cents || cents < 70) throw new Error("Valor inválido (mínimo R$ 0,70)");
      if (Number.isNaN(trialDays)) throw new Error("Dias de trial inválido");
      const res = await create({
        data: { email: email.trim(), monthlyAmountBRLCents: cents, trialDays, environment: env },
      });
      toast.success(`Assinatura criada. Transaction ${res.transactionId}.`);
      setOpenCreate(false);
      setEmail("");
      setAmount("");
      setTrial("7");
      setTimeout(() => qc.invalidateQueries({ queryKey: ["admin-enterprise"] }), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar");
    } finally {
      setCreating(false);
    }
  }

  async function handleAnchor(subId: string) {
    setBusyId(subId);
    try {
      const r = await anchor({ data: { paddleSubscriptionId: subId, environment: env } });
      toast.success(`Cobrança ancorada para ${new Date(r.anchoredTo).toLocaleDateString("pt-BR")}`);
      qc.invalidateQueries({ queryKey: ["admin-enterprise"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(subId: string, immediate: boolean) {
    if (!confirm(immediate ? "Cancelar imediatamente?" : "Cancelar no fim do período atual?")) return;
    setBusyId(subId);
    try {
      await cancelFn({ data: { paddleSubscriptionId: subId, environment: env, immediate } });
      toast.success("Cancelamento solicitado");
      qc.invalidateQueries({ queryKey: ["admin-enterprise"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusyId(null);
    }
  }

  const items = query.data?.items ?? [];

  return (
    <div className="px-5 lg:px-10 py-8 lg:py-10 max-w-7xl mx-auto w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-accent font-semibold mb-2">
            <Crown className="size-3.5" /> Enterprise
          </div>
          <h1 className="font-display text-3xl md:text-4xl">Assinaturas Enterprise</h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            Crie assinaturas com valor personalizado em BRL. Trial padrão de 7 dias, cobrança recorrente ancorada no dia 1 do mês (com proração no primeiro período).
          </p>
        </div>
        <Button onClick={() => setOpenCreate(true)} className="rounded-full">
          <Plus className="size-4 mr-1.5" /> Nova assinatura
        </Button>
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card overflow-hidden">
        {query.isLoading ? (
          <div className="p-10 h-40 animate-pulse" />
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Nenhuma assinatura Enterprise ativa neste ambiente.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-3">Cliente</th>
                <th className="text-left font-medium px-4 py-3">Valor/mês</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Próxima cobrança</th>
                <th className="text-left font-medium px-4 py-3">Âncora</th>
                <th className="text-right font-medium px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.paddleSubscriptionId} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.customerEmail ?? "—"}</div>
                    <div className="text-xs text-muted-foreground font-mono">{s.paddleSubscriptionId.slice(0, 18)}…</div>
                  </td>
                  <td className="px-4 py-3 font-medium">{formatBRL(s.customPriceCents)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary capitalize">{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {s.nextBilledAt ? new Date(s.nextBilledAt).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {s.billingAnchorDay ? `Dia ${s.billingAnchorDay}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === s.paddleSubscriptionId}
                        onClick={() => handleAnchor(s.paddleSubscriptionId)}
                        title="Forçar próxima cobrança para o dia 1"
                      >
                        {busyId === s.paddleSubscriptionId ? <Loader2 className="size-3 animate-spin" /> : <Anchor className="size-3" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === s.paddleSubscriptionId || s.status === "canceled"}
                        onClick={() => handleCancel(s.paddleSubscriptionId, false)}
                      >
                        <Calendar className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === s.paddleSubscriptionId || s.status === "canceled"}
                        onClick={() => handleCancel(s.paddleSubscriptionId, true)}
                      >
                        <Ban className="size-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <form onSubmit={submitCreate}>
            <DialogHeader>
              <DialogTitle>Nova assinatura Enterprise</DialogTitle>
              <DialogDescription>
                O cliente já deve ter cartão cadastrado no Paddle. A cobrança será debitada automaticamente ao fim do trial.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="email">Email do cliente</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="amount">Valor mensal (R$)</Label>
                  <Input id="amount" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="23000" inputMode="decimal" />
                </div>
                <div>
                  <Label htmlFor="trial">Trial (dias)</Label>
                  <Input id="trial" required value={trial} onChange={(e) => setTrial(e.target.value)} type="number" min="0" max="90" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Cobrança recorrente todo dia 1 do mês. Primeira cobrança após o trial será proporcional aos dias até o próximo dia 1.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpenCreate(false)}>Cancelar</Button>
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                Criar assinatura
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
