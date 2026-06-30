import { useEffect, useMemo, useState } from "react";
import { Check, CreditCard, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { PLANS, type PlanKey } from "@/lib/payments.functions";

const PLAN_ORDER: PlanKey[] = ["starter", "pro", "business"];

export function OnboardingCheckout({ onSignOut }: { onSignOut?: () => void }) {
  const { openCheckout } = usePaddleCheckout();
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [selected, setSelected] = useState<PlanKey>("pro");
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id, email: data.user.email ?? null });
    });
  }, []);

  const plan = useMemo(() => PLANS[selected], [selected]);

  async function openInlineCheckout(target: PlanKey) {
    if (!user) return;
    setSelected(target);
    setOpening(true);
    setOpened(true);
    try {
      await openCheckout({
        priceId: PLANS[target].priceId,
        customerEmail: user.email ?? undefined,
        customData: { userId: user.id },
        successUrl: `${window.location.origin}/admin?checkout=success`,
        frameTarget: "sigma-onboarding-checkout",
      });
    } catch (e) {
      setOpened(false);
      const { toast } = await import("sonner");
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o checkout");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="min-h-screen w-full grid place-items-center px-4 sm:px-6 py-8 sm:py-10 bg-background">
      <div className="w-full max-w-5xl">
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-3.5 py-1.5 mb-4 border border-emerald-500/20">
            <Sparkles className="size-3.5" />
            <span className="text-xs font-semibold uppercase tracking-wider">7 dias grátis · sem cobrança no cadastro</span>
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl">Vamos ativar sua conta</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
            Escolha um plano e cadastre o cartão para liberar o painel. <strong className="text-foreground">Você não será cobrado nos primeiros 7 dias</strong> — cancele a qualquer momento antes do fim do período de teste sem nenhum custo.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-5 lg:gap-6">
          {/* Plans column */}
          <div className="space-y-3">
            {PLAN_ORDER.map((key) => {
              const p = PLANS[key];
              const isSel = selected === key;
              return (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={`w-full text-left rounded-2xl border p-4 transition-all ${
                    isSel
                      ? "border-foreground bg-card shadow-elevated"
                      : "border-border bg-card hover:border-foreground/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-serif text-lg">{p.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xl font-semibold">{p.priceLabel}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">/mês</div>
                    </div>
                  </div>
                  <ul className="mt-3 space-y-1">
                    {p.featureList.slice(0, 3).map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-xs">
                        <Check className="size-3 text-accent shrink-0 mt-0.5" strokeWidth={2.5} />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 px-1">
              <ShieldCheck className="size-3.5" /> Pagamento seguro · você pode trocar de plano depois
            </div>
            {onSignOut && (
              <button
                onClick={onSignOut}
                className="text-[11px] text-muted-foreground hover:text-foreground underline px-1"
              >
                Sair / trocar de conta
              </button>
            )}
          </div>

          {/* Checkout column */}
          <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Pagamento — {plan.name}</span>
              </div>
              <span className="text-sm font-semibold">{plan.priceLabel}/mês</span>
            </div>

            <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 mb-3 text-xs flex items-start gap-2">
              <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">Sem cobrança nos próximos 7 dias</p>
                <p className="text-muted-foreground mt-0.5">
                  O cartão é necessário para garantir continuidade, mas só será cobrado depois do período de teste. Cancele antes e nada é debitado.
                </p>
              </div>
            </div>

            {!opened && (
              <button
                onClick={() => openInlineCheckout(selected)}
                disabled={!user || opening}
                className="w-full rounded-xl bg-foreground text-background py-3 text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {opening ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Abrindo checkout…
                  </>
                ) : (
                  <>
                    <CreditCard className="size-4" /> Iniciar 7 dias grátis
                  </>
                )}
              </button>
            )}

            <div
              id="sigma-onboarding-checkout"
              className={`sigma-onboarding-checkout mt-3 rounded-xl ${opened ? "min-h-[500px]" : "hidden"}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
