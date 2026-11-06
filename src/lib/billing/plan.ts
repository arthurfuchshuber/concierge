/**
 * Plano do ConciergeIA (06/11/2026): um único plano, cobrado por anúncio conectado ativo.
 * Os antigos Pro/Business/Enterprise foram extintos: quem tem assinatura ativa (Stripe ou
 * liberação manual do admin) recebe TODOS os recursos e guias ilimitados. Seguro para o navegador.
 */

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

/** Identificador do plano único (usado pelo registro de permissões). */
export const PLAN_KEY = "conciergeia" as const;
export type PlanKey = typeof PLAN_KEY;
export const PLAN_NAME = "ConciergeIA";

export const ALL_FEATURES: PlanFeatures = {
  guestChat: true,
  autoImport: true,
  advancedIntake: true,
  ai: true,
  humanHandoff: true,
  team: true,
  customBrand: true,
  externalIntegration: true,
};

export const NO_FEATURES: PlanFeatures = {
  guestChat: false,
  autoImport: false,
  advancedIntake: false,
  ai: false,
  humanHandoff: false,
  team: false,
  customBrand: false,
  externalIntegration: false,
};

/** Sem limite de guias no plano único (o preço é por anúncio). */
export const UNLIMITED_GUIDES = 9999;
