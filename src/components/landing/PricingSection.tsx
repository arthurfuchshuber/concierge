import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
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
  /** Primeira linha em destaque ("Tudo do Pro, e mais:"), quando houver. */
  includes?: string;
  features: string[];
  cta: string;
  ctaHref: string;
  highlight?: boolean;
};

/*
 * Listas do canvas aprovado em 17/09/2026. Antes de mudar um item, confira
 * `PLANS` em `lib/payments.shared.ts`: a landing não pode prometer o que o
 * checkout não vende.
 */
const PLANS: PlanCard[] = [
  {
    key: "pro",
    name: "Pro",
    price: "R$ 199",
    period: "/mês",
    desc: "Automatize a rotina e deixe a IA responder seus hóspedes.",
    features: [
      "Até 20 guias digitais",
      "Chat com IA dentro do guia",
      "Importação automática do Airbnb",
      "Bilíngue (PT + EN)",
      "QR code e PIN por imóvel",
      "Captação e validação de documentos",
    ],
    cta: "Começar 7 dias grátis",
    ctaHref: "/auth",
  },
  {
    key: "business",
    name: "Business",
    price: "R$ 399",
    period: "/mês",
    desc: "Para gestores com equipe e atendimento ao vivo.",
    includes: "Tudo do Pro, e mais:",
    features: [
      "Até 50 guias",
      "Atendimento humano ao vivo",
      "Base de conhecimento própria",
      "Gestão de equipe",
      "Edição em massa",
    ],
    cta: "Começar 7 dias grátis",
    ctaHref: "/auth",
    highlight: true,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "Sob consulta",
    period: "",
    desc: "Volume alto, marca própria e integrações sob medida.",
    includes: "Tudo do Business, e mais:",
    features: [
      "Guias ilimitados",
      "Marca própria (logo e nome)",
      "Integração com sistemas externos",
      "Onboarding dedicado",
      "SLA e suporte 24/7",
    ],
    cta: "Falar com o time",
    ctaHref: "#contato",
  },
];

/** No celular o Business vem primeiro (é o mais escolhido). */
const ORDEM_CELULAR: Record<PlanKey, string> = {
  starter: "order-4",
  pro: "order-2",
  business: "order-1",
  enterprise: "order-3",
};

export function PricingSection() {
  return (
    <Section id="planos">
      <Reveal>
        <SectionHeading
          eyebrow="Planos"
          title={
            <>
              <span className="lg:hidden">O plano certo para sua operação.</span>
              <span className="hidden lg:inline">
                O plano certo para
                <br />o tamanho da sua operação.
              </span>
            </>
          }
          description={
            <>
              <span className="lg:hidden">7 dias grátis. Cancele quando quiser.</span>
              <span className="hidden lg:inline">
                7 dias grátis nos planos pagos. Cancele quando quiser.
              </span>
            </>
          }
        />
      </Reveal>

      <div className="mt-10 grid gap-7 lg:mt-16 lg:grid-cols-3 lg:items-stretch lg:gap-6">
        {PLANS.map((p, i) => (
          <Reveal
            key={p.key}
            delay={Math.min(i * 0.05, 0.2)}
            className={cn("h-full lg:order-none", ORDEM_CELULAR[p.key])}
          >
            {p.highlight ? (
              <div className="relative flex h-full rounded-[24px] p-[1.5px] shadow-[0_30px_80px_-40px_rgba(232,45,174,0.55)]">
                <div aria-hidden className="absolute inset-0 overflow-hidden rounded-[24px]">
                  <div
                    className="lp-ring"
                    style={{
                      background:
                        "conic-gradient(from 90deg, rgba(232,45,174,0.35) 0deg, rgba(232,45,174,0.35) 260deg, #8b2be2 300deg, #ffffff 330deg, #e82dae 345deg, rgba(232,45,174,0.35) 360deg)",
                    }}
                  />
                </div>
                <p className="absolute -top-3.5 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center rounded-full bg-[linear-gradient(100deg,#8b2be2,#e82dae)] px-3.5 text-[11px] font-extrabold tracking-[0.16em] whitespace-nowrap text-white uppercase">
                  Mais escolhido
                </p>
                <div className="relative flex flex-1 flex-col rounded-[22.5px] bg-[linear-gradient(180deg,#221327,#140f11_45%)] px-[22.5px] py-[30.5px] lg:px-[30.5px] lg:py-[38.5px]">
                  <PlanBody p={p} />
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col rounded-[24px] border border-white/[0.09] bg-white/[0.03] px-6 py-8 lg:px-8 lg:py-10">
                <PlanBody p={p} />
              </div>
            )}
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

function PlanBody({ p }: { p: PlanCard }) {
  const ctaClass = cn(
    "mt-7 flex h-[52px] items-center justify-center rounded-[14px] text-[15px] font-bold transition-transform duration-200 hover:-translate-y-0.5 lg:mt-9",
    p.highlight
      ? "bg-[#f6f3ef] text-[#0e0b09]"
      : "border border-white/[0.16] text-[#f6f3ef] hover:border-[#e82dae]/45",
  );
  const track = () => metaPixelTrack("InitiateCheckout", { plan: p.name });

  return (
    <>
      <p
        className={cn(
          "text-[12px] font-bold tracking-[0.22em] uppercase",
          p.highlight ? "text-[#e97bd6]" : "text-[#a9a39b]",
        )}
      >
        {p.name}
      </p>
      {/* Alturas fixas no computador: preço, descrição e divisória alinham nos 3 cartões. */}
      <p className="mt-3 flex items-baseline gap-1.5 lg:mt-4 lg:h-14">
        <span
          className={cn(
            "font-display font-bold tracking-[-0.02em]",
            p.period ? "text-[40px] lg:text-[44px]" : "text-[36px] lg:text-[44px]",
          )}
        >
          {p.price}
        </span>
        {p.period ? <span className="text-[15px] text-[#a9a39b]">{p.period}</span> : null}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-[#a9a39b] lg:mt-3 lg:h-12 lg:text-[15px]">
        {p.desc}
      </p>
      <div
        className={cn(
          "my-5 h-px bg-white/[0.08] lg:my-7 lg:block",
          p.key === "enterprise" && "hidden",
        )}
      />
      {/* No celular o Enterprise fica só com a descrição (canvas aprovado). */}
      <ul
        className={cn(
          "flex-1 flex-col gap-3 text-[14.5px] text-[#d9d4ce] lg:flex lg:gap-3.5 lg:text-[15px]",
          p.key === "enterprise" ? "hidden" : "flex",
        )}
      >
        {p.includes ? (
          <li className="flex gap-2.5 font-bold text-[#f6f3ef]">
            <Check className="mt-0.5 size-[18px] shrink-0" strokeWidth={2.4} />
            {p.includes}
          </li>
        ) : null}
        {p.features.map((f) => (
          <li key={f} className="flex gap-2.5">
            <Check className="mt-0.5 size-[18px] shrink-0 text-[#e97bd6]" strokeWidth={2.4} />
            {f}
          </li>
        ))}
      </ul>
      {p.ctaHref.startsWith("#") ? (
        <a href={p.ctaHref} onClick={track} className={ctaClass}>
          {p.cta}
        </a>
      ) : (
        <Link to={p.ctaHref} search={{ next: undefined }} onClick={track} className={ctaClass}>
          {p.cta}
        </Link>
      )}
    </>
  );
}
