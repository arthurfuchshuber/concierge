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

// ---- Janela "Bancos" / "Asaas PJ" (mockup aprovado 10/11/2026) ----

export type BankAccountRow = BankAccountLike & {
  name?: string | null;
  marketing_name?: string | null;
  balance?: number | string | null;
};

export const isCreditCard = (a: BankAccountLike) =>
  (a.type ?? "").toUpperCase() === "CREDIT" || (a.subtype ?? "").toUpperCase() === "CREDIT_CARD";

/** Título da linha: "Cartão PME GOLD", "Conta corrente", "Poupança". */
export function accountTitle(a: BankAccountRow): string {
  if (isCreditCard(a)) return a.marketing_name ?? a.name ?? "Cartão";
  const sub = (a.subtype ?? "").toUpperCase();
  if (sub === "SAVINGS_ACCOUNT") return "Poupança";
  if (sub === "CHECKING_ACCOUNT" || (a.type ?? "").toUpperCase() === "BANK") return "Conta corrente";
  return a.marketing_name ?? a.name ?? "Conta";
}

/** Subtítulo: cartão → "final 9366"; conta → "Ag. 0050 · 00877408-7". */
export function accountDetail(a: BankAccountRow): string | null {
  if (isCreditCard(a)) {
    const last4 = (a.number ?? "").replace(/\D/g, "").slice(-4);
    return last4 ? `final ${last4}` : null;
  }
  return formatBankAccount(a);
}

const num = (v: number | string | null | undefined) => (v == null || v === "" ? 0 : Number(v) || 0);

/** Totais do quadro de destaque: saldo só das contas (cartão de crédito não entra). */
export function summarizeBanks(accounts: BankAccountRow[]) {
  const contas = accounts.filter((a) => !isCreditCard(a));
  return {
    saldo: contas.reduce((s, a) => s + num(a.balance), 0),
    contas: contas.length,
    cartoes: accounts.length - contas.length,
  };
}

/** "Sincronizado hoje" / "Sincronizado em 08/11"; null quando não há data. */
export function syncedLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const same = d.toDateString() === now.toDateString();
  return same
    ? "Sincronizado hoje"
    : `Sincronizado em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
