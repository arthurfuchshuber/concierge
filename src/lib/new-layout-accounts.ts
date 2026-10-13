/**
 * CONTAS COM O NOVO LAYOUT (etapa 1 — pedido de 13/10/2026: "isso deve ser
 * aplicado SOMENTE à conta do Anfitrião Sigma nesta primeira etapa").
 *
 * Vale para: Editar guia só com "Curadoria & Dicas locais", e Proprietários
 * redesenhado (lista, ficha, imóveis com abas Públicas/Confidenciais,
 * formulário). Todas as outras contas continuam EXATAMENTE como estão.
 *
 * Mesma conta e mesmo padrão do piloto do anúncio nativo do Airbnb
 * (`NATIVE_AIRBNB_OWNERS` em `admin.properties.$id.tsx`). Quando a etapa 2
 * começar, é só acrescentar ids aqui — ou trocar por uma coluna na conta.
 */
export const NEW_LAYOUT_ACCOUNT_IDS: ReadonlySet<string> = new Set([
  "25239e5b-1a66-46f1-b9a2-829c499cc366",
]);

export function isNewLayoutAccount(accountId: string | null | undefined): boolean {
  return !!accountId && NEW_LAYOUT_ACCOUNT_IDS.has(accountId);
}
