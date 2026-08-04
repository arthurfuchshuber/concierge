/**
 * Permission Features — declaração das funcionalidades comercializáveis.
 *
 * Mapeia Plano → Funcionalidade usando exatamente os mesmos planos do SaaS.
 * Serve para o gating automático da árvore de permissões (FASE 3).
 * NÃO altera o `plan-guard.server.ts`, que continua sendo a fonte em uso
 * para autorização real.
 */
import { featureAccess, type FeatureDefinition } from "./feature.access";

export const PERMISSION_FEATURES: FeatureDefinition[] = [
  {
    key: "guestChat",
    name: "Chat com IA para hóspedes",
    plans: ["pro", "business", "enterprise"],
  },
  {
    key: "autoImport",
    name: "Importação automática (Airbnb + Maps)",
    plans: ["pro", "business", "enterprise"],
  },
  {
    key: "advancedIntake",
    name: "Captação avançada + validação por IA",
    plans: ["pro", "business", "enterprise"],
  },
  {
    key: "ai",
    name: "Ensinar a IA (base de conhecimento própria)",
    plans: ["business", "enterprise"],
  },
  {
    key: "humanHandoff",
    name: "Atendimento humano ao vivo",
    plans: ["business", "enterprise"],
  },
  {
    key: "team",
    name: "Gestão de equipe + edição em massa",
    plans: ["business", "enterprise"],
  },
  {
    key: "customBrand",
    name: "Marca própria",
    plans: ["enterprise"],
  },
  {
    key: "externalIntegration",
    name: "Integração com sistemas externos",
    plans: ["enterprise"],
  },
];

let registered = false;

/** Registra as funcionalidades no Feature Access (idempotente). */
export function registerPermissionFeatures(): void {
  if (registered) return;
  featureAccess.registerMany(PERMISSION_FEATURES);
  registered = true;
}
