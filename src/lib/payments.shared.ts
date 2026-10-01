// Client-safe shared payment helpers extracted from payments.functions.ts.
// Kept out of the .functions.ts module so the tss-serverfn-split transform
// doesn't leave handler-referenced siblings undefined at runtime.

export type PlanFeatures = {
  /** Chat com IA para hóspedes dentro do guia. */
  guestChat: boolean;
  /** Importação automática de guias (Airbnb + Google Maps). */
  autoImport: boolean;
  /** Formulário avançado de captação + validação de documentos por IA. */
  advancedIntake: boolean;
  /** Ensinar a IA (base de conhecimento treinável do anfitrião). */
  ai: boolean;
  /** Atendimento humano ao vivo (handoff, inbox, takeover). */
  humanHandoff: boolean;
  /** Gestão de equipe + edição em massa. */
  team: boolean;
  /** Marca própria (white label). */
  customBrand: boolean;
  /** Integração com sistemas externos (MCP / API). */
  externalIntegration: boolean;
};

const FEATURES_NONE: PlanFeatures = {
  guestChat: false,
  autoImport: false,
  advancedIntake: false,
  ai: false,
  humanHandoff: false,
  team: false,
  customBrand: false,
  externalIntegration: false,
};

const FEATURES_PRO: PlanFeatures = {
  ...FEATURES_NONE,
  guestChat: true,
  autoImport: true,
  advancedIntake: true,
};

const FEATURES_BUSINESS: PlanFeatures = {
  ...FEATURES_PRO,
  ai: true,
  humanHandoff: true,
  team: true,
};

const FEATURES_ENTERPRISE: PlanFeatures = {
  ...FEATURES_BUSINESS,
  customBrand: true,
  externalIntegration: true,
};

export const PLANS = {
  // O plano Starter foi EXCLUÍDO em 01/10/2026 (pedido explícito: "EXCLUIR o
  // plano start — não trabalharemos mais com esse"). Nenhuma assinatura ativa
  // usava ele (conferido no banco). Motivo: o anúncio do Airbnb virou
  // obrigatório para publicar, e a importação nunca fez parte do Starter.
  // O Pro passa a ser o plano de entrada.
  pro: {
    id: "pro_plan",
    priceId: "pro_monthly",
    name: "Pro",
    priceLabel: "R$ 199",
    priceNumeric: 199,
    maxGuides: 20,
    tier: 2,
    description: "Para anfitriões que querem ganhar tempo com automação e IA.",
    features: FEATURES_PRO,
    featureList: [
      "Até 20 guias",
      "Importação automática (Airbnb)",
      "Chat com IA para hóspedes",
      "Formulário de captação + validação de documentos por IA",
      "Recomendações automáticas pelo Google Maps",
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
    description: "Para gestores profissionais com equipe e atendimento ao vivo.",
    features: FEATURES_BUSINESS,
    featureList: [
      "Até 50 guias",
      "Atendimento humano ao vivo",
      "Ensinar a IA com sua base de conhecimento",
      "Gestão de equipe + edição em massa",
      "Prestadores, proprietários e usuários ilimitados",
      "Insights e relatórios avançados",
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
    description: "Volume alto, marca própria e integrações sob medida.",
    features: FEATURES_ENTERPRISE,
    featureList: [
      "Guias ilimitados",
      "Marca própria (logo e nome)",
      "Integração com sistemas externos",
      "Onboarding dedicado",
      "SLA e suporte 24/7",
    ],
  },
} as const;

export type PlanKey = keyof typeof PLANS;

/** Human-friendly label for a feature — used in comparison tables and locked-feature dialogs. */
export const FEATURE_LABELS: Record<keyof PlanFeatures, string> = {
  guestChat: "Chat com IA para hóspedes",
  autoImport: "Importação automática (Airbnb + Maps)",
  advancedIntake: "Formulário de captação + validação de documentos por IA",
  ai: "Ensinar a IA (base de conhecimento própria)",
  humanHandoff: "Atendimento humano ao vivo",
  team: "Gestão de equipe + edição em massa",
  customBrand: "Marca própria (logo e nome)",
  externalIntegration: "Integração com sistemas externos",
};

/** Rows for the comparison table on landing/precos. Order matters. */
export const PLAN_COMPARISON_GROUPS: Array<{
  group: string;
  rows: Array<{
    label: string;
    values: Record<PlanKey, string>;
  }>;
}> = [
  {
    group: "Estrutura e conteúdo",
    rows: [
      {
        label: "Quantidade de guias",
        values: { pro: "20", business: "50", enterprise: "Ilimitados" },
      },
      {
        label: "Edição manual completa",
        values: { pro: "✓", business: "✓", enterprise: "✓" },
      },
      {
        label: "Bilíngue (PT / EN)",
        values: { pro: "✓", business: "✓", enterprise: "✓ + ES" },
      },
      {
        label: "Importação automática (Airbnb)",
        values: { pro: "✓", business: "✓", enterprise: "✓" },
      },
      {
        label: "Recomendações pelo Google Maps",
        values: { pro: "✓", business: "✓", enterprise: "✓ + curadoria" },
      },
    ],
  },
  {
    group: "Inteligência para o hóspede",
    rows: [
      {
        label: "Chat com IA no guia",
        values: { pro: "✓", business: "✓", enterprise: "✓" },
      },
      {
        label: "Ensinar a IA com sua base própria",
        values: { pro: "—", business: "✓", enterprise: "✓" },
      },
      {
        label: "Formulário de captação de hóspedes",
        values: { pro: "Avançado", business: "Avançado", enterprise: "Avançado" },
      },
      {
        label: "Validação de documentos por IA",
        values: { pro: "✓", business: "✓", enterprise: "✓" },
      },
    ],
  },
  {
    group: "Atendimento",
    rows: [
      {
        label: "Atendimento humano ao vivo",
        values: { pro: "—", business: "✓", enterprise: "✓" },
      },
      {
        label: "Relatório de hóspedes com envio por email",
        values: { pro: "✓", business: "✓", enterprise: "✓" },
      },
      {
        label: "Suporte",
        values: {
          pro: "Prioritário",
          business: "Prioritário",
          enterprise: "SLA 24/7",
        },
      },
    ],
  },
  {
    group: "Equipe e escala",
    rows: [
      {
        label: "Gestão de equipe (multi-usuário)",
        values: { pro: "—", business: "✓", enterprise: "✓" },
      },
      {
        label: "Edição em massa",
        values: { pro: "—", business: "✓", enterprise: "✓" },
      },
      {
        label: "Insights e relatórios avançados",
        values: { pro: "Básico", business: "Completo", enterprise: "Completo" },
      },
    ],
  },
  {
    group: "Marca e integrações",
    rows: [
      {
        label: "Marca própria (logo e nome)",
        values: { pro: "—", business: "—", enterprise: "✓" },
      },
      {
        label: "Integração com sistemas externos",
        values: { pro: "—", business: "—", enterprise: "✓" },
      },
      {
        label: "Onboarding dedicado",
        values: { pro: "—", business: "—", enterprise: "✓" },
      },
    ],
  },
];

export function planFromProductId(productId: string | null | undefined): PlanKey | null {
  if (!productId) return null;
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

/**
 * Given a source plan (or none) and a target plan, returns the list of
 * feature labels the user will lose by switching. Used on downgrade dialog.
 */
export function featuresLostOnDowngrade(
  current: PlanKey | null,
  target: PlanKey | null,
): string[] {
  if (!current) return [];
  const currFeatures = PLANS[current].features;
  const nextFeatures = target ? PLANS[target].features : FEATURES_NONE;
  const lost: string[] = [];
  (Object.keys(FEATURE_LABELS) as Array<keyof PlanFeatures>).forEach((k) => {
    if (currFeatures[k] && !nextFeatures[k]) lost.push(FEATURE_LABELS[k]);
  });
  return lost;
}
