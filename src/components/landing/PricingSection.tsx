import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { metaPixelTrack } from "@/lib/meta-pixel";
import { INCLUDED_FEATURES, PRICE_BANDS } from "@/components/pricing/ListingPricing";
import { BILLING_ANCHOR_DAY } from "@/lib/billing/listing-billing";
import { Reveal, Section, SectionHeading } from "./primitives";

/*
 * Preço por anúncio (06/11/2026): um único plano com tudo incluso. A tabela vem de
 * `ListingPricing` (a mesma da cobrança na Stripe), então a landing nunca promete outro valor.
 */
export function PricingSection() {
  const track = () => metaPixelTrack("InitiateCheckout", { content_name: "conciergeia_por_anuncio" });
  return (
    <Section id="planos">
      <Reveal>
        <SectionHeading
          eyebrow="Preços"
          title={
            <>
              <span className="lg:hidden">Um plano, tudo incluso.</span>
              <span className="hidden lg:inline">
                Um plano, tudo incluso.
                <br />
                Você paga por anúncio.
              </span>
            </>
          }
          description="Quanto mais anúncios, menor o valor de cada um."
        />
      </Reveal>

      <div className="mt-10 grid gap-7 lg:mt-16 lg:grid-cols-[1.05fr_1fr] lg:items-stretch lg:gap-6">
        <Reveal className="h-full">
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
            <div className="relative flex flex-1 flex-col rounded-[22.5px] bg-[linear-gradient(180deg,#221327,#140f11_45%)] px-[22.5px] py-[30.5px] lg:px-[30.5px] lg:py-[38.5px]">
              <p className="text-[12px] font-bold uppercase tracking-[0.22em] text-[#e97bd6]">ConciergeIA</p>
              <p className="mt-3 flex items-baseline gap-1.5 lg:mt-4">
                <span className="text-[15px] text-[#a9a39b]">a partir de</span>
                <span className="font-display text-[40px] font-bold tracking-[-0.02em] lg:text-[44px]">R$ 89</span>
                <span className="text-[15px] text-[#a9a39b]">/anúncio</span>
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-[#a9a39b] lg:mt-3 lg:text-[15px]">
                Tudo incluso, em qualquer quantidade de anúncios.
              </p>
              <div className="my-5 h-px bg-white/[0.08] lg:my-7" />
              <ul className="flex flex-1 flex-col gap-3 text-[14.5px] text-[#d9d4ce] lg:gap-3.5 lg:text-[15px]">
                {INCLUDED_FEATURES.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check className="mt-0.5 size-[18px] shrink-0 text-[#e97bd6]" strokeWidth={2.4} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/auth"
                search={{ next: "/admin" } as never}
                onClick={track}
                className="mt-7 flex h-[52px] items-center justify-center rounded-[14px] bg-[#f6f3ef] text-[15px] font-bold text-[#0e0b09] transition-transform duration-200 hover:-translate-y-0.5 lg:mt-9"
              >
                Começar agora
              </Link>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.05} className="h-full">
          <div className="flex h-full flex-col rounded-[24px] border border-white/[0.09] bg-white/[0.03] px-6 py-8 lg:px-8 lg:py-10">
            <p className="text-[12px] font-bold uppercase tracking-[0.22em] text-[#a9a39b]">Valor por anúncio</p>
            <ul className="mt-5 flex flex-1 flex-col">
              {PRICE_BANDS.map((b, i) => (
                <li
                  key={b.label}
                  className={`flex min-w-0 items-center gap-3 py-4 ${i === 0 ? "" : "border-t border-white/[0.08]"}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold text-[#f6f3ef]">{b.label}</div>
                    <div className="mt-0.5 text-[13px] text-[#a9a39b]">{b.note}</div>
                  </div>
                  <span className="whitespace-nowrap font-display text-[22px] font-bold tabular-nums">R$ {b.unit}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[13px] leading-relaxed text-[#a9a39b]">
              Vencimento todo dia {BILLING_ANCHOR_DAY}. Na contratação você paga só os dias até o dia {BILLING_ANCHOR_DAY}.
              Cartão de crédito obrigatório no cadastro. Impostos inclusos.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
