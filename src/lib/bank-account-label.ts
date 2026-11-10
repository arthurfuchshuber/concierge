// Rótulos das contas bancárias nos cards de Integrações ("Ag. 0050 · 00877408-7").
// Função pura, sem dependências, para poder ser testada isoladamente.

export type BankAccountLike = {
  malvo_item_id: string;
  type?: string | null;
  subtype?: string | null;
  number?: string | null;
  bank_data?: unknown;
};

/** Item sintético do Asaas PJ (ver `asaas.server.ts`): não é banco do Open Finance. */
export const ASAAS_ITEM_ID = "asaas";

function transferNumberOf(a: BankAccountLike): string | null {
  const bd = a.bank_data;
  if (bd && typeof bd === "object" && !Array.isArray(bd)) {
    const t = (bd as Record<string, unknown>).transferNumber;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return a.number?.trim() || null;
}

/** "0050/00877408-7" → "Ag. 0050 · 00877408-7"; sem barra, devolve só a conta. */
export function formatBankAccount(a: BankAccountLike): string | null {
  const raw = transferNumberOf(a);
  if (!raw) return null;
  const parts = raw.split("/").map((p) => p.trim());
  if (parts.length === 2 && parts[0] && parts[1]) return `Ag. ${parts[0]} · ${parts[1]}`;
  return raw;
}

const isChecking = (a: BankAccountLike) =>
  (a.subtype ?? "").toUpperCase() === "CHECKING_ACCOUNT" || (a.type ?? "").toUpperCase() === "BANK";

/** Conta que representa a instituição no card: a conta corrente, senão a primeira. */
export function pickMainAccount<T extends BankAccountLike>(accounts: T[], itemId: string): T | null {
  const mine = accounts.filter((a) => a.malvo_item_id === itemId);
  return mine.find(isChecking) ?? mine[0] ?? null;
}

export type BankItemLike = { malvo_item_id: string; connector_name?: string | null };

/** Só bancos do Open Finance (exclui o item do Asaas). */
export const onlyBanks = <T extends BankItemLike>(items: T[]): T[] =>
  items.filter((i) => i.malvo_item_id !== ASAAS_ITEM_ID);

export const asaasItem = <T extends BankItemLike>(items: T[]): T | null =>
  items.find((i) => i.malvo_item_id === ASAAS_ITEM_ID) ?? null;
