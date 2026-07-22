import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles, ArrowRight, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { PLAN_COMPARISON_GROUPS, type PlanKey } from "@/lib/payments.shared";
import { metaPixelTrack, metaPixelTrackCustomOnce } from "@/lib/meta-pixel";
import { toast } from "sonner";

export const Route = createFileRoute("/precos")({
  head: () => ({
    meta: [
      { title: "Planos e preços — ConciergeIA" },
      {
        name: "description",
        content:
          "Escolha o plano ideal para criar guias digitais para seus hóspedes. 7 dias grátis em todos os planos pagos.",
      },
      { property: "og:title", content: "Planos ConciergeIA" },
      { property: "og:description", content: "Starter, Pro, Business e Enterprise. 7 dias grátis." },
      { property: "og:url", content: "/precos" },
    ],
    links: [{ rel: "canonical", href: "/precos" }],
  }),
  component: PricingPage,
});

type Plan = {
  key: PlanKey;
  name: string;
  price: string;
  priceSuffix: string;
  priceId?: string;
  description: string;
  features: string[];
  lockedNext?: string;
  cta: string;
  featured?: boolean;
  dark?: boolean;
};

const PLANS_UI: Plan[] = [
  {
    key: "starter",
    name: "Starter",
    price: "R$ 99",
    priceSuffix: "/mês",
    priceId: "starter_monthly",
    description: "Pra começar a encantar hóspedes com um guia digital profissional.",
    features: [
      "Até 3 guias digitais",
      "Edição manual completa",
      "Bilíngue (PT + EN)",
      "Acesso por link ou PIN",
      "QR Code por imóvel",
    ],
    lockedNext: "Chat com IA para hóspedes",
    cta: "Testar 7 dias grátis",
  },
  {
    key: "pro",
    name: "Pro",
    price: "R$ 199",
    priceSuffix: "/mês",
    priceId: "pro_monthly",
    description: "Automatize a rotina e deixe a IA responder seus hóspedes.",
    features: [
      "Tudo do Starter, mais:",
      "Até 20 guias",
      "Importação automática (Airbnb)",
      "Chat com IA para hóspedes",
      "Formulário de captação + validação de documentos por IA",
    ],
    lockedNext: "Atendimento humano ao vivo",
    cta: "Começar agora",
    featured: true,
  },
  {
    key: "business",
    name: "Business",
    price: "R$ 399",
    priceSuffix: "/mês",
    priceId: "business_monthly",
    description: "Pra gestores com equipe e atendimento ao vivo.",
    features: [
      "Tudo do Pro, mais:",
      "Até 50 guias",
      "Atendimento humano ao vivo",
      "Ensinar a IA com sua base de conhecimento",
      "Gestão de equipe + edição em massa",
    ],
    lockedNext: "Marca própria (white label)",
    cta: "Começar agora",
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "Sob consulta",
    priceSuffix: "",
    description: "Volume alto, marca própria e integrações sob medida.",
    features: [
      "Tudo do Business, mais:",
      "Guias ilimitados",
      "Marca própria (logo e nome)",
      "Integração com sistemas externos",
      "Onboarding dedicado e SLA 24/7",
    ],
    cta: "Falar com vendas",
    dark: true,
  },
];

function PricingPage() {
  const { openCheckout, loading } = usePaddleCheckout();
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const plansRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id, email: data.user.email ?? null });
    });
  }, []);

  // ViewPlans: fire once per page-session when the plans grid enters the viewport.
  useEffect(() => {
    const el = plansRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      metaPixelTrackCustomOnce("ViewPlans", { location: "precos" });
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            metaPixelTrackCustomOnce("ViewPlans", { location: "precos" });
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  async function handleSubscribe(plan: Plan) {
    // Meta Pixel: standard InitiateCheckout event on any plan CTA click.
    metaPixelTrack("InitiateCheckout", { plan: plan.name });
    if (plan.key === "enterprise") {
      window.open(
        "https://wa.me/5547996759381?text=" +
          encodeURIComponent("Olá! Tenho interesse no plano Enterprise do ConciergeIA."),
        "_blank",
        "noopener,noreferrer",
      );
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
        <div className="max-w-7xl mx-auto px-5 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-foreground grid place-items-center">
              <Sparkles className="size-3.5 text-background" strokeWidth={2} />
            </div>
            <span className="font-display text-lg">ConciergeIA</span>
          </Link>
          <Link to="/auth" className="text-sm px-4 py-2 rounded-full hover:bg-secondary">
            Entrar
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 py-16 md:py-24">
        <div className="text-center mb-12">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Planos</p>
          <h1 className="font-display text-4xl md:text-5xl mt-3">Escolha o plano ideal</h1>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            7 dias grátis em todos os planos pagos. Cancele quando quiser.
          </p>
        </div>

        {/* Cards */}
        <div id="planos" ref={plansRef} className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLANS_UI.map((plan) => {
            const isDark = plan.dark;
            const isHi = plan.featured;
            return (
              <div
                key={plan.key}
                className={`relative rounded-2xl p-6 flex flex-col ${
                  isDark
                    ? "bg-foreground text-background border border-foreground"
                    : isHi
                      ? "border-2 border-foreground bg-card shadow-elevated"
                      : "border border-border bg-card"
                }`}
              >
                {isHi && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wider font-semibold bg-foreground text-background px-3 py-0.5 rounded-full">
                    Mais popular
                  </span>
                )}
                <h2 className="font-display text-2xl">{plan.name}</h2>
                <p className={`text-sm mt-1 min-h-[40px] ${isDark ? "text-background/70" : "text-muted-foreground"}`}>
                  {plan.description}
                </p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold">{plan.price}</span>
                  {plan.priceSuffix && (
                    <span className={`text-sm ${isDark ? "text-background/60" : "text-muted-foreground"}`}>
                      {plan.priceSuffix}
                    </span>
                  )}
                </div>
                <ul className="mt-5 space-y-2 flex-1">
                  {plan.features.map((f, idx) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check
                        className={`size-4 shrink-0 mt-0.5 ${
                          isDark ? "text-background" : "text-accent"
                        }`}
                        strokeWidth={2.5}
                      />
                      <span
                        className={
                          idx === 0 && f.startsWith("Tudo do")
                            ? `font-semibold ${isDark ? "text-background" : "text-foreground"}`
                            : isDark
                              ? "text-background/90"
                              : ""
                        }
                      >
                        {f}
                      </span>
                    </li>
                  ))}
                  {plan.lockedNext && (
                    <li className="flex items-start gap-2 text-sm text-muted-foreground/60 line-through">
                      <X className="size-4 shrink-0 mt-0.5" strokeWidth={2} />
                      <span>{plan.lockedNext}</span>
                    </li>
                  )}
                </ul>
                <button
                  onClick={() => handleSubscribe(plan)}
                  disabled={loading}
                  className={`mt-6 w-full inline-flex items-center justify-center gap-1 rounded-full py-2.5 text-sm font-medium transition-colors ${
                    isDark
                      ? "bg-background text-foreground hover:opacity-90"
                      : "bg-foreground text-background hover:opacity-90"
                  } disabled:opacity-50`}
                >
                  {plan.cta}
                  <ArrowRight className="size-3.5" strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Comparison table */}
        <div className="mt-16 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-6 border-b border-border bg-muted/30">
            <h3 className="font-display text-xl">Comparativo detalhado</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Tudo em linguagem simples. Sem termos técnicos.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="p-4 text-xs uppercase tracking-wider font-semibold text-muted-foreground w-[38%]">
                    Recurso
                  </th>
                  <th className="p-4 text-sm font-semibold text-center">Starter</th>
                  <th className="p-4 text-sm font-semibold text-center bg-muted/40">Pro</th>
                  <th className="p-4 text-sm font-semibold text-center">Business</th>
                  <th className="p-4 text-sm font-semibold text-center">Enterprise</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {PLAN_COMPARISON_GROUPS.map((group) => (
                  <Fragment key={group.group}>
                    <tr className="bg-muted/20">
                      <td colSpan={5} className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {group.group}
                      </td>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.label}>
                        <td className="p-4 text-sm font-medium">{row.label}</td>
                        {(["starter", "pro", "business", "enterprise"] as PlanKey[]).map((k) => {
                          const v = row.values[k];
                          return (
                            <td
                              key={k}
                              className={`p-4 text-sm text-center ${k === "pro" ? "bg-muted/20" : ""} ${
                                v === "—"
                                  ? "text-muted-foreground/40"
                                  : v === "✓"
                                    ? "text-accent font-semibold"
                                    : "text-foreground/80"
                              }`}
                            >
                              {v}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
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
