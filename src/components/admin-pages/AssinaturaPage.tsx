import { Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSubscription } from "@/hooks/useSubscription";
import {
  createPortalSession,
  PLANS,
  listMyPayments,
  changePlan,
  type PlanKey,
} from "@/lib/payments.functions";
import { getPaddleEnvironment } from "@/lib/paddle";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DowngradeExcessDialog } from "@/components/DowngradeExcessDialog";
import {
  CreditCard,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Check,
  Crown,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Receipt,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { metaPixelTrack, metaPixelTrackOnce } from "@/lib/meta-pixel";

export { AssinaturaPage };

const PLAN_ORDER: PlanKey[] = ["starter", "pro", "business", "enterprise"];

function AssinaturaPage() {
  const { info, isLoading, refetch } = useSubscription();
  const portal = useServerFn(createPortalSession);
  const fetchPayments = useServerFn(listMyPayments);
  const doChangePlan = useServerFn(changePlan);
  const { openCheckout } = usePaddleCheckout();
  const env = getPaddleEnvironment();
  const search = useSearch({ strict: false }) as { checkout?: string };
  const [opening, setOpening] = useState(false);
  const [changing, setChanging] = useState<PlanKey | null>(null);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [excessTarget, setExcessTarget] = useState<PlanKey | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id, email: data.user.email ?? null });
    });
  }, []);

  useEffect(() => {
    if (search.checkout === "success") {
      toast.success("Pagamento recebido! Sua assinatura será ativada em instantes.");
      const t = setInterval(() => refetch(), 2000);
      const stop = setTimeout(() => clearInterval(t), 30000);
      return () => {
        clearInterval(t);
        clearTimeout(stop);
      };
    }
  }, [search.checkout, refetch]);

  // Meta Pixel Purchase — fire once after payment is confirmed and plan is active.
  useEffect(() => {
    if (search.checkout !== "success") return;
    if (!info.isActive || !info.plan) return;
    const plan = PLANS[info.plan as PlanKey];
    if (!plan) return;
    metaPixelTrackOnce(`Purchase:${info.plan}`, "Purchase", {
      value: plan.priceNumeric,
      currency: "BRL",
      plan: plan.name,
    });
  }, [search.checkout, info.isActive, info.plan]);

  const paymentsQuery = useQuery({
    queryKey: ["my-payments", env],
    queryFn: () => fetchPayments({ data: { environment: env } }),
    enabled: info.isActive,
  });

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

  async function handleChangePlan(target: PlanKey) {
    const targetPlan = PLANS[target];
    if (target === "enterprise") {
      window.location.href = "mailto:contato@sigmaguide.com?subject=Plano Enterprise";
      return;
    }
    // No active sub or enterprise downgrade with manual sub → open checkout flow
    if (!info.isActive || info.plan === "enterprise") {
      if (!user) {
        window.location.href = `/auth?next=${encodeURIComponent("/admin/assinatura")}`;
        return;
      }
      try {
        setChanging(target);
        await openCheckout({
          priceId: targetPlan.priceId,
          customerEmail: user.email ?? undefined,
          customData: { userId: user.id },
          successUrl: `${window.location.origin}/admin/assinatura?checkout=success`,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao abrir checkout");
      } finally {
        setChanging(null);
      }
      return;
    }
    // Active paid sub → update via Paddle
    setChanging(target);
    try {
      await doChangePlan({
        data: { environment: env, targetPriceExternalId: targetPlan.priceId },
      });
      toast.success(`Plano alterado para ${targetPlan.name}. As mudanças serão refletidas em instantes.`);
      const t = setInterval(() => refetch(), 2000);
      setTimeout(() => clearInterval(t), 20000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não foi possível mudar de plano";
      if (msg.startsWith("EXCESS_GUIDES:")) {
        setExcessTarget(target);
      } else {
        toast.error(msg);
      }
    } finally {
      setChanging(null);
    }
  }

  const currentPlan = info.plan;
  const currentTier = currentPlan ? PLANS[currentPlan].tier : 0;
  const currentPlanConfig = currentPlan ? PLANS[currentPlan] : null;

  return (
    <div className="px-5 lg:px-10 py-8 lg:py-10 max-w-6xl mx-auto w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl md:text-4xl">Assinatura</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Gerencie seu plano, pagamentos e faturas.
          </p>
        </div>
        {info.isActive && (
          <Button
            onClick={openPortal}
            disabled={opening}
            variant="outline"
            className="rounded-full"
          >
            <ExternalLink className="size-4 mr-1.5" /> Portal de pagamento
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 h-40 animate-pulse" />
      ) : (
        <>
          {/* Status banners */}
          {info.isPastDue && (
            <div className="mt-6 rounded-xl border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 p-4 flex items-start gap-3">
              <AlertTriangle className="size-5 text-yellow-700 dark:text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Pagamento pendente</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Não conseguimos processar sua última cobrança. Atualize seu método de pagamento.
                </p>
              </div>
            </div>
          )}
          {info.cancelAtPeriodEnd && (
            <div className="mt-6 rounded-xl border border-border bg-secondary/40 p-4 flex items-start gap-3">
              <CheckCircle2 className="size-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Assinatura cancelada</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Você continuará com acesso até{" "}
                  {info.currentPeriodEnd
                    ? new Date(info.currentPeriodEnd).toLocaleDateString("pt-BR")
                    : "o fim do período pago"}
                  .
                </p>
              </div>
            </div>
          )}

          <Tabs defaultValue="plano" className="mt-6">
            <TabsList>
              <TabsTrigger value="plano">Plano</TabsTrigger>
              <TabsTrigger value="cartao">Cartão de crédito</TabsTrigger>
              <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
            </TabsList>

            <TabsContent value="plano" className="mt-6">
              {/* Macro overview */}
              <section className="grid md:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-border bg-card p-5 md:col-span-2 relative overflow-hidden">
              {currentPlan === "enterprise" && (
                <div className="absolute top-0 right-0 size-32 bg-gradient-to-br from-accent/20 to-transparent rounded-full -mr-10 -mt-10 pointer-events-none" />
              )}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                    {currentPlan === "enterprise" && <Crown className="size-3.5 text-accent" />}
                    Plano atual
                  </p>
                  <h2 className="font-display text-3xl mt-1">
                    {currentPlanConfig ? currentPlanConfig.name : "Sem plano"}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {currentPlanConfig
                      ? `${currentPlanConfig.priceLabel}${currentPlanConfig.priceNumeric ? " /mês" : ""}`
                      : "Escolha um plano para começar"}
                    {info.isTrialing && " · em período de teste"}
                  </p>
                </div>
                <span
                  className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full ${
                    info.isActive
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {info.isActive ? "Ativo" : "Inativo"}
                </span>
              </div>
              <dl className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Guias incluídos</dt>
                  <dd className="font-medium mt-0.5">
                    {info.maxGuides >= 9999 ? "Ilimitados" : `Até ${info.maxGuides}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {info.cancelAtPeriodEnd ? "Acesso até" : "Próxima cobrança"}
                  </dt>
                  <dd className="font-medium mt-0.5">
                    {info.currentPeriodEnd
                      ? new Date(info.currentPeriodEnd).toLocaleDateString("pt-BR")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Status</dt>
                  <dd className="font-medium mt-0.5 capitalize">{info.status ?? "—"}</dd>
                </div>
              </dl>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Recursos
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                <FeatureRow on={info.features.autoImport} label="Importação automática" />
                <FeatureRow on={info.features.ai} label="Sugestões com IA" />
                <FeatureRow on={info.features.customBrand} label="Marca personalizada" />
              </ul>
            </div>
          </section>

          {/* Plans grid */}
          <section className="mt-10">
            <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
              <div>
                <h2 className="font-display text-2xl">Todos os planos</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Faça upgrade ou downgrade a qualquer momento.
                </p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {PLAN_ORDER.map((key) => {
                const p = PLANS[key];
                const isCurrent = currentPlan === key;
                const isUpgrade = p.tier > currentTier;
                const isDowngrade = currentTier > 0 && p.tier < currentTier;
                const isLoadingThis = changing === key;
                return (
                  <div
                    key={key}
                    className={`rounded-2xl border p-5 flex flex-col relative ${
                      isCurrent
                        ? "border-foreground bg-card shadow-elevated"
                        : "border-border bg-card"
                    }`}
                  >
                    {isCurrent && (
                      <span className="absolute -top-2 left-5 text-[10px] uppercase tracking-wider font-semibold bg-foreground text-background px-2 py-0.5 rounded-full">
                        Seu plano
                      </span>
                    )}
                    {key === "enterprise" && (
                      <span className="self-start text-[10px] uppercase tracking-wider font-semibold bg-accent/10 text-accent px-2 py-0.5 rounded-full mb-2 inline-flex items-center gap-1">
                        <Sparkles className="size-3" /> Premium
                      </span>
                    )}
                    <h3 className="font-display text-xl">{p.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1 min-h-[32px]">
                      {p.description}
                    </p>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="text-2xl font-semibold">{p.priceLabel}</span>
                      {p.priceNumeric > 0 && (
                        <span className="text-xs text-muted-foreground">/mês</span>
                      )}
                    </div>
                    <ul className="mt-4 space-y-1.5 flex-1">
                      {p.featureList.map((f) => (
                        <li key={f} className="flex items-start gap-1.5 text-xs">
                          <Check
                            className="size-3.5 text-accent shrink-0 mt-0.5"
                            strokeWidth={2.5}
                          />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => handleChangePlan(key)}
                      disabled={isCurrent || changing !== null}
                      className={`mt-5 w-full inline-flex items-center justify-center gap-1 rounded-full py-2 text-xs font-medium transition-colors ${
                        isCurrent
                          ? "bg-secondary text-muted-foreground cursor-default"
                          : isUpgrade
                            ? "bg-foreground text-background hover:opacity-90"
                            : "bg-secondary hover:bg-secondary/70"
                      } disabled:opacity-50`}
                    >
                      {isLoadingThis ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : isCurrent ? (
                        "Plano atual"
                      ) : key === "enterprise" ? (
                        <>Falar com vendas <ArrowUpRight className="size-3.5" /></>
                      ) : isUpgrade ? (
                        <>Fazer upgrade <ArrowUpRight className="size-3.5" /></>
                      ) : isDowngrade ? (
                        <>Fazer downgrade <ArrowDownRight className="size-3.5" /></>
                      ) : (
                        <>Assinar <ArrowUpRight className="size-3.5" /></>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
            </TabsContent>

            <TabsContent value="cartao" className="mt-6">
              <CardTab
                isActive={info.isActive}
                isManual={info.isManual}
                onOpenPortal={openPortal}
                opening={opening}
                user={user}
              />
            </TabsContent>

            <TabsContent value="pagamentos" className="mt-6">
              {/* Payment history */}
              <section>
            <div className="flex items-center gap-2 mb-4">
              <Receipt className="size-4 text-muted-foreground" />
              <h2 className="font-display text-2xl">Extrato de pagamentos</h2>
            </div>
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              {paymentsQuery.isLoading ? (
                <div className="p-6 h-32 animate-pulse" />
              ) : !paymentsQuery.data?.payments?.length ? (
                <div className="p-8 text-center">
                  <div className="size-10 rounded-xl bg-secondary grid place-items-center mx-auto mb-3">
                    <CreditCard className="size-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Nenhum pagamento registrado ainda.
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-4 py-2.5">Data</th>
                      <th className="text-left font-medium px-4 py-2.5">Valor</th>
                      <th className="text-left font-medium px-4 py-2.5">Status</th>
                      <th className="text-right font-medium px-4 py-2.5">Fatura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentsQuery.data.payments.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-4 py-3">
                          {new Date(p.createdAt).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {(Number(p.amount) / 100).toLocaleString("pt-BR", {
                            style: "currency",
                            currency: p.currency || "BRL",
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${
                              p.status === "completed" || p.status === "paid"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : p.status === "past_due"
                                  ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                                  : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {p.invoiceUrl ? (
                            <a
                              href={p.invoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-accent hover:underline inline-flex items-center gap-1"
                            >
                              Ver <ExternalLink className="size-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
            </TabsContent>
          </Tabs>

          {!info.isActive && (
            <div className="mt-8 text-center text-xs text-muted-foreground">
              Veja todos os detalhes na{" "}
              <Link to="/precos" className="underline">
                página pública de planos
              </Link>
              .
            </div>
          )}
        </>
      )}

      {excessTarget && (
        <DowngradeExcessDialog
          open={!!excessTarget}
          targetPlan={excessTarget}
          onClose={() => setExcessTarget(null)}
          onResolved={() => {
            const t = excessTarget;
            setExcessTarget(null);
            if (t) handleChangePlan(t);
          }}
        />
      )}
    </div>
  );
}

function CardTab({
  isActive,
  isManual,
  onOpenPortal,
  opening,
  user,
}: {
  isActive: boolean;
  isManual: boolean;
  onOpenPortal: () => void;
  opening: boolean;
  user: { id: string; email: string | null } | null;
}) {
  const { openCheckout } = usePaddleCheckout();
  const [openingInline, setOpeningInline] = useState(false);
  const [openedInline, setOpenedInline] = useState(false);

  async function startCardValidation(opts?: { forceOverlay?: boolean }) {
    if (!user) return;
    const useInline = !opts?.forceOverlay;
    setOpeningInline(true);
    if (useInline) {
      // Revela o container ANTES de chamar o Paddle.
      setOpenedInline(true);
      await new Promise((r) => setTimeout(r, 50));
    }
    try {
      await openCheckout({
        priceId: PLANS.starter.priceId,
        customerEmail: user.email ?? undefined,
        customData: { userId: user.id },
        frameTarget: useInline ? "sigma-card-validation-checkout" : undefined,
      });
    } catch (e) {
      console.error("[CardValidation] failed to open Paddle checkout", e);
      const msg = e instanceof Error ? e.message : "erro desconhecido";
      toast.error(`Não consegui abrir o checkout: ${msg}`);
      setOpenedInline(false);
    } finally {
      setOpeningInline(false);
    }
  }

  if (!isActive) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <div className="size-10 rounded-xl bg-secondary grid place-items-center mx-auto mb-3">
          <CreditCard className="size-4 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          Ative um plano para cadastrar e gerenciar seu cartão de crédito.
        </p>
      </div>
    );
  }
  if (isManual) {
    return (
      <div className="mx-auto w-full max-w-[640px]">
        <div className="rounded-3xl border border-border bg-card overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.35)]">
          {/* Header */}
          <div className="p-6 sm:p-8 pb-6 border-b border-border bg-gradient-to-b from-secondary/30 to-transparent">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 size-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 grid place-items-center text-emerald-500">
                <ShieldCheck className="size-6" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-xl tracking-tight text-foreground mb-2">
                  Validação de cartão obrigatória
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Exigimos um cartão válido para fins de validação e segurança.{" "}
                  <span className="text-emerald-500 font-medium">Você tem 7 dias para usar sem ser cobrado.</span>{" "}
                  Após esse período, a assinatura será iniciada normalmente.
                </p>
              </div>
            </div>
          </div>

          {/* Process Steps */}
          <div className="px-6 sm:px-8 py-6 bg-secondary/10 border-b border-border">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <ProcessStep n="01" title="Formulário seguro" desc="Abre nesta mesma tela" />
              <ProcessStep n="02" title="7 dias grátis" desc="Acesso premium total" highlight />
              <ProcessStep n="03" title="Flexibilidade" desc="Cancele quando quiser" last />
            </div>
          </div>

          {/* Paddle Container */}
          <div className="p-4 sm:p-6">
            {!openedInline ? (
              <div className="min-h-[420px] w-full rounded-2xl bg-secondary/20 border border-dashed border-border grid place-items-center p-6 text-center">
                <div className="max-w-xs space-y-4">
                  <div className="mx-auto size-12 rounded-2xl bg-secondary grid place-items-center">
                    <CreditCard className="size-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Clique abaixo para abrir o formulário seguro de validação de cartão.
                  </p>
                  <Button
                    onClick={() => startCardValidation()}
                    disabled={!user || openingInline}
                    className="rounded-full bg-emerald-500 hover:bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/20"
                  >
                    {openingInline ? (
                      <Loader2 className="size-4 mr-1.5 animate-spin" />
                    ) : (
                      <CreditCard className="size-4 mr-1.5" />
                    )}
                    Validar cartão agora
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div
                  id="sigma-card-validation-checkout"
                  className="sigma-card-validation-checkout min-h-[520px] w-full rounded-2xl bg-secondary/10 border border-border overflow-hidden"
                />
                <p className="mt-3 text-[11px] text-muted-foreground text-center">
                  Se o formulário não carregar em alguns segundos, recarregue a página e tente novamente.
                </p>
              </>
            )}
          </div>

          {/* Security Footer */}
          <div className="px-6 sm:px-8 py-4 bg-background/40 flex items-center justify-between gap-3 border-t border-border flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-secondary border border-border">
                <ShieldCheck className="size-3 text-emerald-500" strokeWidth={2.5} />
                <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">SSL Secure</span>
              </div>
              <span className="text-[10px] text-muted-foreground truncate">
                Processamento via Paddle · dados nunca passam pelos nossos servidores
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              Visa · Mastercard · Amex
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="size-11 rounded-xl bg-secondary grid place-items-center shrink-0">
          <CreditCard className="size-5 text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-base">Método de pagamento</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Cadastre ou atualize o cartão usado nas próximas cobranças pelo portal seguro de pagamentos.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={onOpenPortal} disabled={opening} className="rounded-full">
              {opening ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <CreditCard className="size-4 mr-1.5" />
              )}
              Gerenciar cartão
            </Button>
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" /> Os dados do cartão ficam armazenados com segurança no
            provedor de pagamento — nunca passam pelos servidores da ConciergeIA.
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureRow({ on, label }: { on: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`size-4 rounded-full grid place-items-center ${
          on ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-secondary text-muted-foreground"
        }`}
      >
        {on ? <Check className="size-3" strokeWidth={3} /> : <span className="text-[10px]">·</span>}
      </span>
      <span className={on ? "" : "text-muted-foreground line-through"}>{label}</span>
    </li>
  );
}

function ProcessStep({
  n,
  title,
  desc,
  highlight,
  last,
}: {
  n: string;
  title: string;
  desc: string;
  highlight?: boolean;
  last?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div
          className={`text-[10px] font-bold rounded px-1.5 py-0.5 border ${
            highlight
              ? "text-emerald-500 border-emerald-500/30"
              : "text-muted-foreground border-border"
          }`}
        >
          {n}
        </div>
        <div className={`h-px flex-1 bg-border ${last ? "opacity-0" : ""}`} />
      </div>
      <p className="text-[11px] font-medium text-foreground">{title}</p>
      <p className="text-[10px] text-muted-foreground">{desc}</p>
    </div>
  );
}
