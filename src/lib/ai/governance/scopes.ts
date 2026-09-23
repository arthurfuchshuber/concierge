/**
 * Knowledge Governance — hierarquia oficial de conhecimento do ConciergeIA.
 *
 * Regra de ouro: dados do imóvel NÃO são duplicados. `PROPERTY_DATA` continua
 * sendo lido da tabela `properties` e suas filhas; as demais camadas apenas
 * complementam com regras, memória e inteligência acumulada.
 */

export type KnowledgeScopeType =
  | "PROPERTY_DATA"
  | "TENANT_KNOWLEDGE"
  | "PORTFOLIO_KNOWLEDGE"
  | "OPERATIONAL_MEMORY"
  | "GLOBAL_INTELLIGENCE";

export const KNOWLEDGE_SCOPES: KnowledgeScopeType[] = [
  "PROPERTY_DATA",
  "TENANT_KNOWLEDGE",
  "PORTFOLIO_KNOWLEDGE",
  "OPERATIONAL_MEMORY",
  "GLOBAL_INTELLIGENCE",
];

export const KNOWLEDGE_SCOPE_META: Record<
  KnowledgeScopeType,
  { label: string; description: string; storage: string; editable: boolean }
> = {
  PROPERTY_DATA: {
    label: "Dados do Imóvel",
    description: "Fonte oficial e única das informações da residência. Editada no guia.",
    storage: "properties (+ tabelas filhas)",
    editable: false,
  },
  TENANT_KNOWLEDGE: {
    label: "Conhecimento da Operação",
    description: "Políticas, procedimentos e regras internas da empresa.",
    storage: "ai_tenant_knowledge",
    editable: true,
  },
  PORTFOLIO_KNOWLEDGE: {
    label: "Conhecimento da Carteira",
    description: "Regras que valem para todos os imóveis do mesmo proprietário.",
    storage: "ai_tenant_knowledge (sem imóvel) + ai_memories (owner)",
    editable: true,
  },
  OPERATIONAL_MEMORY: {
    label: "Memória Operacional",
    description: "Padrões, recorrências e aprendizados extraídos das conversas.",
    storage: "ai_memories / ai_operational_memory / ai_knowledge_gaps",
    editable: false,
  },
  GLOBAL_INTELLIGENCE: {
    label: "Inteligência Global",
    description: "Melhores práticas acumuladas de toda a plataforma (equipe SaaS).",
    storage: "ai_global_intelligence",
    editable: false,
  },
};

/** Ordem de precedência ao montar contexto: o mais específico vence. */
export const SCOPE_PRECEDENCE: KnowledgeScopeType[] = [
  "PROPERTY_DATA",
  "OPERATIONAL_MEMORY",
  "TENANT_KNOWLEDGE",
  "PORTFOLIO_KNOWLEDGE",
  "GLOBAL_INTELLIGENCE",
];
