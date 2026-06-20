import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { toast } from "sonner";

export const Route = createFileRoute("/precos")({
  head: () => ({
    meta: [
      { title: "Planos e preços — SigmaGuide" },
      { name: "description", content: "Escolha o plano ideal para criar guias digitais para seus hóspedes. 7 dias grátis em todos os planos." },
      { property: "og:title", content: "Planos SigmaGuide" },
      { property: "og:description", content: "Starter, Pro, Business e Enterprise. 7 dias grátis." },
      { property: "og:url", content: "/precos" },
    ],
    links: [{ rel: "canonical", href: "/precos" }],
  }),
  component: PricingPage,
});

type Plan = {
  key: "starter" | "pro" | "business" | "enterprise";
  name: string;
  price: string;
  priceSuffix: string;
  priceId?: string;
  description: string;
  features: string[];
  cta: string;
  featured?: boolean;
};

const PLANS: Plan[] = [
  {
    key: "starter",
    name: "Starter",
    price: "R$ 99",
    priceSuffix: "/mês",
    priceId: "starter_monthly",
    description: "Para começar a criar guias manualmente.",
    features: [
      "Até 3 guias",
      "Edição manual completa",
      "Acesso público ou por PIN",
      "Bilíngue (PT / EN)",
    ],
    cta: "Começar grátis",
  },
  {
    key: "pro",
    name: "Pro",
    price: "R$ 199",
    priceSuffix: "/mês",
    priceId: "pro_monthly",
    description: "Recursos completos para anfitriões profissionais.",
    features: [
      "Até 20 guias",
      "Importação automática (Airbnb, Google Maps)",
      "Sugestões com IA",
      "Tudo do Starter",
    ],
    cta: "Começar grátis",
    featured: true,
  },
  {
    key: "business",
    name: "Business",
    price: "R$ 399",
    priceSuffix: "/mês",
    priceId: "business_monthly",
    description: "Para gestores com múltiplos imóveis e marca própria.",
    features: [
      "Até 50 guias",
      "Marca personalizada (logo e nome)",
      "Tudo do Pro",
      "Suporte prioritário",
    ],
    cta: "Começar grátis",
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "Sob consulta",
    priceSuffix: "",
    description: "Volume alto, integrações sob medida e SLA.",
    features: [
      "Guias ilimitados",
      "Onboarding dedicado",
      "Integrações personalizadas",
      "SLA e suporte 24/7",
    ],
    cta: "Falar com vendas",
  },
];

function PricingPage() {
  const { openCheckout, loading } = usePaddleCheckout();
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id, email: data.user.email ?? null });
    });
  }, []);

  async function handleSubscribe(plan: Plan) {
    if (plan.key === "enterprise") {
      window.location.href = "mailto:contato@sigmaguide.com?subject=Plano Enterprise";
      return;
    }
    if (!plan.priceId) return;
    if (!user) {
      window.location.href = `/auth?next=${encodeURIComponent("/precos")}`;
      return;
    }
    try {
      await openCheckout({
        priceId: plan.priceId,
        customerEmail: user.email ?? undefined,
        customData: { userId: user.id },
        successUrl: `${window.location.origin}/admin/assinatura?checkout=success`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o checkout");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PaymentTestModeBanner />
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-5 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-foreground grid place-items-center">
              <Sparkles className="size-3.5 text-background" strokeWidth={2} />
            </div>
            <span className="font-serif text-lg">SigmaGuide</span>
          </Link>
          <Link to="/auth" className="text-sm px-4 py-2 rounded-full hover:bg-secondary">
            Entrar
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-16 md:py-24">
        <div className="text-center mb-12">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Planos</p>
          <h1 className="font-serif text-4xl md:text-5xl mt-3">Escolha o plano ideal</h1>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            7 dias grátis em todos os planos pagos. Cancele a qualquer momento.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLANS.map((plan) => (
            <div
              key={plan.key}
              className={`rounded-2xl border bg-card p-6 flex flex-col ${
                plan.featured ? "border-foreground shadow-elevated" : "border-border"
              }`}
            >
              {plan.featured && (
                <span className="self-start text-[10px] uppercase tracking-wider font-semibold bg-foreground text-background px-2 py-0.5 rounded-full mb-3">
                  Mais popular
                </span>
              )}
              <h2 className="font-serif text-2xl">{plan.name}</h2>
              <p className="text-sm text-muted-foreground mt-1 min-h-[40px]">{plan.description}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-3xl font-semibold">{plan.price}</span>
                {plan.priceSuffix && (
                  <span className="text-sm text-muted-foreground">{plan.priceSuffix}</span>
                )}
              </div>
              <ul className="mt-5 space-y-2 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="size-4 text-accent shrink-0 mt-0.5" strokeWidth={2.5} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleSubscribe(plan)}
                disabled={loading}
                className={`mt-6 w-full inline-flex items-center justify-center gap-1 rounded-full py-2.5 text-sm font-medium transition-colors ${
                  plan.featured
                    ? "bg-foreground text-background hover:opacity-90"
                    : "bg-secondary hover:bg-secondary/70"
                } disabled:opacity-50`}
              >
                {plan.cta}
                <ArrowRight className="size-3.5" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-10">
          Ao assinar, você concorda com nossos{" "}
          <Link to="/termos" className="underline">Termos</Link>,{" "}
          <Link to="/privacidade" className="underline">Privacidade</Link> e{" "}
          <Link to="/reembolso" className="underline">Política de Reembolso</Link>.
        </p>
      </main>
    </div>
  );
}
