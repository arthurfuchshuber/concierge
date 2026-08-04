/**
 * Mapa de operações protegidas (FASE 3.7).
 *
 * Cada operação sensível do backend aponta para o nó do Permission Registry e
 * o nível exigido. Este mapa é a referência única usada pelos wrappers de
 * `permission.enforce.server.ts` — nenhuma permissão nova é criada aqui.
 */
import type { AccessLevel } from "./permission.types";

export type ProtectedOperation = {
  /** Slug canônico já existente no Registry. */
  permission: string;
  required: AccessLevel;
  /** Domínio funcional, usado apenas no diagnóstico. */
  domain:
    | "imoveis"
    | "stakeholders"
    | "hospedes"
    | "equipe"
    | "administrativo"
    | "integracoes"
    | "financeiro";
};

export const PROTECTED_OPERATIONS = {
  /* ------------------------------------------------------------- imóveis */
  "imoveis.read": { permission: "tenant.imoveis", required: "READ", domain: "imoveis" },
  "imoveis.editor.read": { permission: "tenant.imoveis.editor", required: "READ", domain: "imoveis" },
  "imoveis.editor.write": { permission: "tenant.imoveis.editor", required: "WRITE", domain: "imoveis" },
  "imoveis.delete": { permission: "tenant.imoveis.editor", required: "WRITE", domain: "imoveis" },
  "imoveis.bulk-edit": { permission: "tenant.imoveis.edicao-massa", required: "WRITE", domain: "imoveis" },

  /* -------------------------------------------------------- stakeholders */
  "stakeholders.read": { permission: "tenant.stakeholders", required: "READ", domain: "stakeholders" },
  "stakeholders.write": { permission: "tenant.stakeholders", required: "WRITE", domain: "stakeholders" },
  "stakeholders.delete": { permission: "tenant.stakeholders", required: "WRITE", domain: "stakeholders" },
  "stakeholders.vinculo-imovel": {
    permission: "tenant.stakeholders.proprietarios.imoveis",
    required: "WRITE",
    domain: "stakeholders",
  },
  "prestadores.write": {
    permission: "tenant.stakeholders.prestadores.cadastro",
    required: "WRITE",
    domain: "stakeholders",
  },

  /* ------------------------------------------------------------ hóspedes */
  "hospedes.read": { permission: "tenant.stakeholders.hospedes", required: "READ", domain: "hospedes" },
  "hospedes.ficha.read": {
    permission: "tenant.stakeholders.hospedes.ficha",
    required: "READ",
    domain: "hospedes",
  },

  /* -------------------------------------------------------------- equipe */
  "equipe.read": { permission: "tenant.administrativo.equipe", required: "READ", domain: "equipe" },
  "equipe.write": { permission: "tenant.administrativo.equipe", required: "WRITE", domain: "equipe" },
  "equipe.permissoes": {
    permission: "tenant.administrativo.equipe",
    required: "WRITE",
    domain: "equipe",
  },

  /* ----------------------------------------------------- administrativo */
  "administrativo.read": { permission: "tenant.administrativo", required: "READ", domain: "administrativo" },
  "administrativo.write": {
    permission: "tenant.administrativo",
    required: "WRITE",
    domain: "administrativo",
  },

  /* --------------------------------------------------------- integrações */
  "integracoes.read": {
    permission: "tenant.administrativo.integracoes",
    required: "READ",
    domain: "integracoes",
  },
  "integracoes.write": {
    permission: "tenant.administrativo.integracoes",
    required: "WRITE",
    domain: "integracoes",
  },

  /* ---------------------------------------------------------- financeiro */
  "financeiro.read": {
    permission: "tenant.stakeholders.proprietarios.financeiro",
    required: "READ",
    domain: "financeiro",
  },
  "financeiro.write": {
    permission: "tenant.stakeholders.proprietarios.financeiro",
    required: "WRITE",
    domain: "financeiro",
  },
} as const satisfies Record<string, ProtectedOperation>;

export type ProtectedOperationKey = keyof typeof PROTECTED_OPERATIONS;

export function protectedOperation(key: ProtectedOperationKey): ProtectedOperation {
  return PROTECTED_OPERATIONS[key];
}
