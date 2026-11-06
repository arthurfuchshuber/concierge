/**
 * Permission Features — declaração das funcionalidades comercializáveis.
 *
 * Plano único (06/11/2026): toda funcionalidade é liberada pela assinatura ativa do
 * ConciergeIA (cobrança por anúncio). Serve para o gating automático da árvore de permissões;
 * a autorização real continua no `plan-guard.server.ts`.
 */
import { PLAN_KEY } from "@/lib/billing/plan";
import { featureAccess, type FeatureDefinition } from "./feature.access";

const PERMISSION_FEATURES: FeatureDefinition[] = [
  {
    key: "guestChat",
    name: "Chat com IA para hóspedes",
    plans: [PLAN_KEY],
  },
  {
    key: "autoImport",
    name: "Importação automática (Airbnb + Maps)",
    plans: [PLAN_KEY],
  },
  {
    key: "advancedIntake",
    name: "Captação avançada + validação por IA",
    plans: [PLAN_KEY],
  },
  {
    key: "ai",
    name: "Ensinar a IA (base de conhecimento própria)",
    plans: [PLAN_KEY],
  },
  {
    key: "humanHandoff",
    name: "Atendimento humano ao vivo",
    plans: [PLAN_KEY],
  },
  {
    key: "team",
    name: "Gestão de equipe + edição em massa",
    plans: [PLAN_KEY],
  },
  {
    key: "customBrand",
    name: "Marca própria",
    plans: [PLAN_KEY],
  },
  {
    key: "externalIntegration",
    name: "Integração com sistemas externos",
    plans: [PLAN_KEY],
  },
];

let registered = false;

/** Registra as funcionalidades no Feature Access (idempotente). */
export function registerPermissionFeatures(): void {
  if (registered) return;
  featureAccess.registerMany(PERMISSION_FEATURES);
  registered = true;
}
