import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { LandingNav } from "@/components/landing/LandingNav";
import { LeadForm } from "@/components/landing/LeadForm";
import { PricingSection } from "@/components/landing/PricingSection";
import {
  AiSection,
  BeforeAfter,
  BentoSection,
  DifferentiatorSection,
  FinalCTA,
  GuideSection,
  Hero,
  LandingFooter,
  MultiPropertySection,
  ProblemSection,
  ScatterToUnified,
} from "@/components/landing/sections";
import { metaPixelTrackCustomOnce } from "@/lib/meta-pixel";
import { siteUrl } from "@/lib/site-url";

const TITLE = "ConciergeIA | O sistema operacional inteligente da sua hospedagem";
const DESCRIPTION =
  "Centralize imóveis, proprietários, fornecedores, rotinas e o atendimento ao hóspede em um só lugar. Operação organizada, padronizada e inteligente para quem gere hospedagem com equipe.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: siteUrl("/") },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: siteUrl("/") }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "ConciergeIA",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description: DESCRIPTION,
          url: siteUrl("/"),
          offers: {
            "@type": "Offer",
            price: "99",
            priceCurrency: "BRL",
            availability: "https://schema.org/InStock",
          },
        }),
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  useEffect(() => {
    metaPixelTrackCustomOnce("LandingView", { page: "home" });
  }, []);

  return (
    // Tema escuro local: a landing tem identidade própria, sem alterar o tema
    // do painel. `overflow-x-hidden` garante que nenhum brilho ou mockup
    // ultrapasse a margem direita em telas estreitas.
    <div className="dark min-h-dvh w-full overflow-x-hidden bg-background text-foreground antialiased">
      <LandingNav />
      <main>
        <Hero />
        <ScatterToUnified />
        <ProblemSection />
        <EcosystemSection />
        <ModulesSection />
        <AiSection />
        <GuideSection />
        <BeforeAfter />
        <MultiPropertySection />
        <DifferentiatorSection />
        <PricingSection />
        
        <FinalCTA />
        <LeadForm />
      </main>
      <LandingFooter />
    </div>
  );
}
