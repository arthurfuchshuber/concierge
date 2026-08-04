/**
 * Feature Access — gating por plano do SaaS.
 *
 * FASE 1: estrutura apenas. NÃO integra com billing e NÃO altera nenhuma
 * regra atual de plano (`plan-guard.server.ts` continua sendo a fonte em uso).
 */

export type PlanKey = string;

/** Uma funcionalidade comercializável do SaaS. */
export type FeatureDefinition = {
  key: string;
  name: string;
  description?: string | null;
  /** Planos que liberam a feature. Vazio = ainda não definido. */
  plans: PlanKey[];
};

export type FeatureDecision = {
  allowed: boolean;
  reason: string;
  feature: string;
  plan: PlanKey | null;
};

class FeatureAccessRegistry {
  private features = new Map<string, FeatureDefinition>();

  register(def: FeatureDefinition): FeatureDefinition {
    const normalized: FeatureDefinition = { description: null, ...def };
    this.features.set(normalized.key, normalized);
    return normalized;
  }

  registerMany(defs: FeatureDefinition[]): void {
    for (const d of defs) this.register(d);
  }

  get(key: string): FeatureDefinition | null {
    return this.features.get(key) ?? null;
  }

  list(): FeatureDefinition[] {
    return [...this.features.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  has(key: string): boolean {
    return this.features.has(key);
  }

  clear(): void {
    this.features.clear();
  }

  /**
   * Valida Plano → Funcionalidade disponível.
   *
   * Enquanto a feature não estiver declarada no registry, a decisão é
   * permissiva por design: esta fase não pode restringir nada.
   */
  check(feature: string | null | undefined, plan: PlanKey | null | undefined): FeatureDecision {
    if (!feature) {
      return { allowed: true, reason: "Nó sem exigência de plano.", feature: "", plan: plan ?? null };
    }
    const def = this.get(feature);
    if (!def) {
      return {
        allowed: true,
        reason: `Funcionalidade "${feature}" ainda não declarada — gating inativo nesta fase.`,
        feature,
        plan: plan ?? null,
      };
    }
    if (!def.plans.length) {
      return {
        allowed: true,
        reason: `Funcionalidade "${feature}" sem planos configurados.`,
        feature,
        plan: plan ?? null,
      };
    }
    const allowed = !!plan && def.plans.includes(plan);
    return {
      allowed,
      reason: allowed
        ? `Plano "${plan}" libera "${feature}".`
        : `Plano "${plan ?? "desconhecido"}" não libera "${feature}".`,
      feature,
      plan: plan ?? null,
    };
  }
}

export const featureAccess = new FeatureAccessRegistry();

export type { FeatureAccessRegistry };
