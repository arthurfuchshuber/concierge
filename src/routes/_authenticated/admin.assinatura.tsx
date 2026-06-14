import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useSubscription } from "@/hooks/useSubscription";
import { createPortalSession, PLANS } from "@/lib/payments.functions";
import { getPaddleEnvironment } from "@/lib/paddle";
import { Button } from "@/components/ui/button";
import { CreditCard, ExternalLink, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/assinatura")({
  validateSearch: (s: Record<string, unknown>) => ({
    checkout: typeof s.checkout === "string" ? s.checkout : undefined,
  }),
  component: AssinaturaPage,
});

function AssinaturaPage() {
  const { info, isLoading, refetch } = useSubscription();
  const portal = useServerFn(createPortalSession);
  const env = getPaddleEnvironment();
  const search = useSearch({ from: "/_authenticated/admin/assinatura" });
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (search.checkout === "success") {
      toast.success("Pagamento recebido! Sua assinatura será ativada em instantes.");
      const t = setInterval(() => refetch(), 2000);
      const stop = setTimeout(() => clearInterval(t), 30000);
      return () => { clearInterval(t); clearTimeout(stop); };
    }
  }, [search.checkout, refetch]);

  async function openPortal() {
    setOpening(true);
    try {
      const res = await portal({ data: { environment: env } });
      window.open(res.overviewUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao abrir o portal");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-4xl mx-auto w-full">
      <h1 className="font-serif text-3xl md:text-4xl">Sua assinatura</h1>
      <p className="text-sm text-muted-foreground mt-1.5">Gerencie seu plano, pagamentos e cancelamento.</p>

      {isLoading ? (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 h-40 animate-pulse" />
      ) : !info.isActive ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
          <div className="size-12 rounded-2xl bg-accent/10 grid place-items-center mx-auto mb-4">
            <CreditCard className="size-5 text-accent" />
          </div>
          <h2 className="font-serif text-2xl">Você ainda não tem um plano ativo</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            Escolha um plano para começar a criar seus guias. 7 dias grátis em todos.
          </p>
          <Link to="/precos" className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-medium">
            Ver planos
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {info.isPastDue && (
            <div className="rounded-xl border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 p-4 flex items-start gap-3">
              <AlertTriangle className="size-5 text-yellow-700 dark:text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Pagamento pendente</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Não conseguimos processar sua última cobrança. Atualize seu método de pagamento para evitar o cancelamento.
                </p>
              </div>
            </div>
          )}

          {info.cancelAtPeriodEnd && (
            <div className="rounded-xl border border-border bg-secondary/40 p-4 flex items-start gap-3">
              <CheckCircle2 className="size-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Assinatura cancelada</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Você continuará com acesso completo até{" "}
                  {info.currentPeriodEnd ? new Date(info.currentPeriodEnd).toLocaleDateString("pt-BR") : "o fim do período pago"}.
                </p>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Plano atual</p>
                <h2 className="font-serif text-3xl mt-1">{info.plan ? PLANS[info.plan].name : "—"}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {info.plan ? `${PLANS[info.plan].priceLabel} /mês` : ""}
                  {info.isTrialing && " · em período de teste"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={openPortal} disabled={opening} variant="outline" className="rounded-full">
                  <ExternalLink className="size-4 mr-1.5" /> Gerenciar pagamento
                </Button>
                <Link to="/precos" className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium">
                  Mudar de plano
                </Link>
              </div>
            </div>

            <dl className="mt-6 grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Guias incluídos</dt>
                <dd className="font-medium mt-0.5">Até {info.maxGuides}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Próxima cobrança</dt>
                <dd className="font-medium mt-0.5">
                  {info.currentPeriodEnd ? new Date(info.currentPeriodEnd).toLocaleDateString("pt-BR") : "—"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
