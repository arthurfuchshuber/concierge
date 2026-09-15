import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { type PlanKey } from "@/lib/payments.shared";
import { metaPixelTrack } from "@/lib/meta-pixel";
import { Reveal, Section, SectionHeading } from "./primitives";
import { cn } from "@/lib/utils";

type PlanCard = {
  key: PlanKey;
  name: string;
  price: string;
  period: string;
  desc: string;
  features: string[];
  lockedNext?: string;
  cta: string;
  ctaHref: string;
  highlight?: boolean;
};

const PLANS: PlanCard[] = [
  {
    key: "pro",
    name: "Pro",
    price: "R$ 199",
    period: "/mês",
    desc: "Automatize a rotina e deixe uma IA responder seus hóspedes por você.",
    features: [
      "Até 20 guias digitais",
      "Edição manual completa (fotos, seções, dicas)",
      "Bilíngue (PT + EN)",
      "Acesso por link ou PIN privado",
      "QR code personalizado por imóvel",
      "Importação automática dos anúncios do Airbnb",
      "Chat com IA para hóspedes dentro do guia",
      "Formulário de captação + validação de documentos por IA",
    ],
    lockedNext: "Atendimento humano ao vivo",
    cta: "Começar agora",
    ctaHref: "/auth",
  },
  {
    key: "business",
    name: "Business",
    price: "R$ 399",
    period: "/mês",
    desc: "Pra gestores profissionais com equipe e atendimento ao vivo.",
    features: [
      "Tudo do Pro, mais:",
      "Até 50 guias",
      "Atendimento humano ao vivo (com sua equipe)",
      "Ensinar a IA com sua base de conhecimento própria",
      "Gestão de equipe + edição em massa",
    ],
    lockedNext: "Marca própria (white label)",
    cta: "Começar agora",
    ctaHref: "/auth",
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "Sob consulta",
    period: "",
    desc: "Volume alto, marca própria e integrações sob medida.",
    features: [
      "Tudo do Business, mais:",
      "Guias ilimitados",
      "Marca própria (logo e nome)",
      "Integração com sistemas externos",
      "Onboarding dedicado e SLA 24/7",
    ],
    cta: "Falar com o time",
    ctaHref: "#contato",
  },
];

export function PricingSection() {
  return (
    <Section id="planos">
      <Reveal>
        <SectionHeading
          eyebrow="Planos"
          title="Escolha o plano ideal para sua operação."
          description="7 dias grátis em todos os planos pagos. Cancele quando quiser."
        />
      </Reveal>

      <div className="mt-14 grid gap-2.5 md:grid-cols-3">
        {PLANS.map((p, i) => {
          const isExternal = p.ctaHref.startsWith("#") || p.ctaHref.startsWith("http");
          return (
            <Reveal key={p.key} delay={Math.min(i * 0.05, 0.2)}>
              <div
                className={cn(
                  "relative flex h-full flex-col rounded-2xl border bg-card/50 p-6",
                  p.highlight ? "border-accent/45 bg-card/80" : "border-border",
                )}
              >
                {p.highlight ? (
                  <span className="absolute -top-2.5 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.18em] text-accent-foreground">
                    Mais escolhido
                  </span>
                ) : null}

                <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                  {p.name}
                </p>
                <p className="mt-3 flex items-baseline gap-1">
                  <span className="font-display text-[26px] tracking-tight">{p.price}</span>
                  {p.period ? <span className="text-[12px] text-muted-foreground">{p.period}</span> : null}
                </p>
                <p className="mt-2 min-h-[52px] text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
                  {p.desc}
                </p>

                <ul className="mt-5 flex-1 space-y-2">
                  {p.features.map((f, idx) => (
                    <li key={f} className="flex items-start gap-2 text-[12.5px]">
                      <Check
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          idx === 0 && f.startsWith("Tudo do") ? "text-foreground" : "text-accent",
                        )}
                      />
                      <span
                        className={cn(
                          "min-w-0",
                          idx === 0 && f.startsWith("Tudo do")
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {f}
                      </span>
                    </li>
                  ))}
                  {p.lockedNext ? (
                    <li className="flex items-start gap-2 text-[12.5px] text-muted-foreground/40 line-through">
                      <span aria-hidden className="mt-0.5 grid size-3.5 shrink-0 place-items-center">
                        ×
                      </span>
                      <span className="min-w-0">{p.lockedNext}</span>
                    </li>
                  ) : null}
                </ul>

                {isExternal ? (
                  <a
                    href={p.ctaHref}
                    onClick={() => metaPixelTrack("InitiateCheckout", { plan: p.name })}
                    className="mt-7 inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border text-[13px] font-semibold transition-colors hover:border-accent/45"
                  >
                    {p.cta} <ArrowRight className="size-3.5" />
                  </a>
                ) : (
                  <Link
                    to={p.ctaHref}
                    search={{ next: undefined }}
                    onClick={() => metaPixelTrack("InitiateCheckout", { plan: p.name })}
                    className={cn(
                      "mt-7 inline-flex h-10 items-center justify-center gap-2 rounded-full text-[13px] font-semibold transition-transform duration-200 hover:-translate-y-0.5",
                      p.highlight
                        ? "bg-foreground text-background"
                        : "border border-border text-foreground hover:border-accent/45",
                    )}
                  >
                    {p.cta} <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            </Reveal>
          );
        })}
      </div>

    </Section>
  );
}
