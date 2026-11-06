import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { siteUrl } from "@/lib/site-url";
import { Sparkles, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { metaPixelTrack, metaPixelTrackCustomOnce } from "@/lib/meta-pixel";
import { IncludedList, PriceBands, PriceSimulator } from "@/components/pricing/ListingPricing";

export const Route = createFileRoute("/precos")({
  head: () => ({
    meta: [
      { title: "Preços — ConciergeIA" },
      {
        name: "description",
        content:
          "Um único plano com tudo incluso, cobrado por anúncio conectado: R$ 119 por anúncio, com desconto a partir de 30 anúncios.",
      },
      { property: "og:title", content: "Preços ConciergeIA" },
      { property: "og:description", content: "Tudo incluso, cobrado por anúncio conectado. A partir de R$ 89 por anúncio." },
      { property: "og:url", content: siteUrl("/precos") },
    ],
    links: [{ rel: "canonical", href: siteUrl("/precos") }],
  }),
  component: PricingPage,
});

function PricingPage() {
  const navigate = useNavigate();
  const [logged, setLogged] = useState(false);
  const plansRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setLogged(!!data.user));
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

  const start = () => {
    metaPixelTrack("InitiateCheckout", { content_name: "conciergeia_por_anuncio", currency: "BRL" });
    if (logged) navigate({ to: "/admin" });
    else navigate({ to: "/auth", search: { next: "/admin" } as never });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-7xl mx-auto px-5 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-foreground grid place-items-center">
              <Sparkles className="size-3.5 text-background" strokeWidth={2} />
            </div>
            <span className="font-display text-lg">ConciergeIA</span>
          </Link>
          <Link to="/auth" search={{ next: undefined }} className="text-sm px-4 py-2 rounded-full hover:bg-secondary">
            Entrar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-16 md:py-24">
        <div className="mb-12 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Preços</p>
          <h1 className="mt-3 font-display text-4xl md:text-5xl">Um plano, tudo incluso</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Você paga por anúncio conectado. Quanto mais anúncios, menor o valor de cada um.
          </p>
        </div>

        <div id="planos" ref={plansRef} className="flex flex-col gap-5">
          <PriceBands />
          <PriceSimulator />
          <div className="rounded-[14px] bg-card px-5 py-5 shadow-[inset_0_0_0_1px_var(--border)]">
            <h2 className="mb-4 font-display text-[18px] font-bold">Tudo incluso em qualquer quantidade</h2>
            <IncludedList />
          </div>
          <button
            type="button"
            onClick={start}
            className="mx-auto inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-foreground px-7 text-sm font-semibold text-background transition-opacity hover:opacity-90"
          >
            Começar agora
            <ArrowRight className="size-3.5" strokeWidth={2} />
          </button>
          <p className="mx-auto max-w-2xl text-center text-[12.5px] leading-[1.5] text-muted-foreground">
            O cadastro pede um cartão de crédito válido. A cobrança acompanha seus anúncios ativos: anúncio
            desativado deixa de ser cobrado no ciclo seguinte. Valores com impostos inclusos.
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-10">
          Ao assinar, você concorda com nossos{" "}
          <Link to="/termos" className="underline">
            Termos
          </Link>
          ,{" "}
          <Link to="/privacidade" className="underline">
            Privacidade
          </Link>{" "}
          e{" "}
          <Link to="/reembolso" className="underline">
            Política de Reembolso
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
