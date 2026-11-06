import type { PaymentRow } from "@/lib/billing/billing.functions";
import type { SubscriptionInfo } from "@/hooks/useSubscription";
import { PRICE_BANDS } from "@/components/pricing/ListingPricing";
import { SAGE, AMBER, ROSE } from "@/components/admin-pages/admin-mobile-ui";

/**
 * Números da tela Assinatura (celular e desktop), todos vindos do servidor (`getAccountBilling`):
 * valor do mês, faixa, próxima cobrança (sempre um dia 25) e extrato. A tela só formata.
 */
export const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");

const pad = (n: number) => String(n).padStart(2, "0");
/** Datas sempre em Brasília (o vencimento é dia 25 às 00:00 de Brasília). */
function brt(iso: string | Date): Date {
  return new Date(new Date(iso).getTime() - 3 * 3600_000);
}
export const fmtDate = (iso: string | Date) => {
  const d = brt(iso);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};
export const fmtDayMonth = (iso: string | Date) => {
  const d = brt(iso);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
};
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const monthLabel = (iso: string | Date) => {
  const d = brt(iso);
  return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export type Fatura = { id: string; titulo: string; sub: string; valor: string; cor: string; url: string | null };

export function buildAssinatura(info: SubscriptionInfo, payments: PaymentRow[]) {
  const b = info.billing;
  const qtd = b?.activeListings ?? 0;
  const monthly = b?.monthlyCents ?? 0;
  const unit = b?.unitCents ?? 11_900;
  const custom = !!b?.custom;
  const courtesy = !!b?.courtesy;
  const courtesyUntil = b?.courtesyUntil ?? null;
  const nextChargeAt = b?.nextChargeAt ?? null;

  // Faixa atual (tabela oficial) ou a condição negociada.
  const bandIdx = qtd <= 29 ? 0 : qtd <= 39 ? 1 : qtd <= 49 ? 2 : 3;
  const band = PRICE_BANDS[bandIdx];
  const bandCap = [29, 39, 49, null][bandIdx];
  const nextBand = bandIdx < 3 ? PRICE_BANDS[bandIdx + 1] : null;
  const toNext = bandCap != null ? bandCap + 1 - qtd : 0;

  const faturas: Fatura[] = [];
  if (nextChargeAt && !info.billingPaused) {
    faturas.push({
      id: "previsto",
      titulo: `Fatura ${monthLabel(nextChargeAt)}`,
      sub: `Prevista para ${fmtDate(nextChargeAt)} · ${qtd} ${qtd === 1 ? "anúncio" : "anúncios"}`,
      valor: courtesy ? "Cortesia" : brl(monthly),
      cor: AMBER,
      url: null,
    });
  }
  for (const p of payments) {
    const paid = p.status === "paid";
    const failed = p.status === "failed" || p.status === "uncollectible";
    faturas.push({
      id: p.id,
      titulo: `Fatura ${monthLabel(p.createdAt)}`,
      sub: `${paid ? "Paga em" : failed ? "Falhou em" : "Emitida em"} ${fmtDate(p.createdAt)}`,
      valor: brl(p.amount),
      cor: paid ? SAGE : failed ? ROSE : AMBER,
      url: p.invoiceUrl ?? null,
    });
  }

  return {
    qtd,
    monthly,
    unit,
    custom,
    courtesy,
    courtesyUntil,
    nextChargeAt,
    paused: info.billingPaused,
    minUnits: b?.minUnits ?? 3,
    anchorDay: b?.anchorDay ?? 25,
    band,
    bandIdx,
    bandCap,
    nextBand,
    toNext,
    faturas,
    /** Linha curta da próxima cobrança. */
    nextLabel: courtesyUntil
      ? fmtDayMonth(courtesyUntil)
      : info.billingPaused
        ? "Pausada"
        : nextChargeAt
          ? fmtDayMonth(nextChargeAt)
          : "—",
  };
}
