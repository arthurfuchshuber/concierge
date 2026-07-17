// Client-safe shared payment helpers extracted from payments.functions.ts.
// Kept out of the .functions.ts module so the tss-serverfn-split transform
// doesn't leave handler-referenced siblings undefined at runtime.

export const PLANS = {
  starter: {
    id: "starter_plan",
    priceId: "starter_monthly",
    name: "Starter",
    priceLabel: "R$ 99",
    priceNumeric: 99,
    maxGuides: 3,
    tier: 1,
    description: "Para começar a criar guias manualmente.",
    features: { autoImport: false, ai: false, customBrand: false },
    featureList: [
      "Até 3 guias",
      "Edição manual completa",
      "Acesso público ou por PIN",
      "Bilíngue (PT / EN)",
    ],
  },
  pro: {
    id: "pro_plan",
    priceId: "pro_monthly",
    name: "Pro",
    priceLabel: "R$ 199",
    priceNumeric: 199,
    maxGuides: 20,
    tier: 2,
    description: "Para anfitriões que querem ganhar tempo com automação.",
    features: { autoImport: true, ai: false, customBrand: false },
    featureList: [
      "Até 20 guias",
      "Importação automática (Airbnb)",
      "Recomendações automáticas via Google Maps",
      "Tudo do Starter",
    ],
  },
  business: {
    id: "business_plan",
    priceId: "business_monthly",
    name: "Business",
    priceLabel: "R$ 399",
    priceNumeric: 399,
    maxGuides: 50,
    tier: 3,
    description: "Para gestores profissionais que querem IA atendendo os hóspedes.",
    features: { autoImport: true, ai: true, customBrand: false },
    featureList: [
      "Até 50 guias",
      "Concierge IA (chat 24h nos guias)",
      "Base de conhecimento e comportamento da IA",
      "Tudo do Pro",
      "Suporte prioritário",
    ],
  },
  enterprise: {
    id: "enterprise_plan",
    priceId: "enterprise_custom",
    name: "Enterprise",
    priceLabel: "Sob consulta",
    priceNumeric: 0,
    maxGuides: 9999,
    tier: 4,
    description: "Volume alto, marca própria, integrações sob medida e SLA.",
    features: { autoImport: true, ai: true, customBrand: true },
    featureList: [
      "Guias ilimitados",
      "Marca personalizada (logo e nome)",
      "Tudo do Business",
      "Onboarding dedicado",
      "Integrações personalizadas",
      "SLA e suporte 24/7",
    ],
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export function planFromProductId(productId: string | null | undefined): PlanKey | null {
  if (!productId) return null;
  if (productId === "starter_plan") return "starter";
  if (productId === "pro_plan") return "pro";
  if (productId === "business_plan") return "business";
  if (productId === "enterprise_plan") return "enterprise";
  return null;
}

export function planFromPriceId(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  for (const key of Object.keys(PLANS) as PlanKey[]) {
    if (PLANS[key].priceId === priceId) return key;
  }
  return null;
}
