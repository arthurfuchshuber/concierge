import { useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { BILLING_ANCHOR_DAY, MIN_BILLABLE_LISTINGS, monthlyTotalCents, displayUnitCents } from "@/lib/billing/listing-billing";

/**
 * Tabela oficial por anúncio conectado ativo (06/11/2026) — a mesma usada pela Stripe
 * (`listing-billing.ts`). Usada na /precos, na landing e no onboarding: os três nunca divergem.
 */
export const PRICE_BANDS = [
  { label: "1 a 29 anúncios", unit: 119, note: `Mínimo de ${MIN_BILLABLE_LISTINGS} anúncios · R$ 357/mês` },
  { label: "30 a 39 anúncios", unit: 99, note: "~17% de desconto" },
  { label: "40 a 49 anúncios", unit: 96, note: "~19% de desconto" },
  { label: "50 anúncios ou mais", unit: 89, note: "~25% de desconto" },
] as const;

/** Tudo o que a assinatura inclui (plano único: todos os recursos). */
export const INCLUDED_FEATURES = [
  "Guias digitais ilimitados, bilíngues (PT + EN)",
  "Importação automática e conexão com o Airbnb",
  "IA no chat do hóspede e base de conhecimento própria",
  "Atendimento humano ao vivo, com equipe e permissões",
  "Captação de hóspedes e validação de documentos",
  "Operação: limpezas, Kanban, registros e calendário",
  "Marca própria e integrações com outros sistemas",
] as const;

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");

export function PriceBands({ highlight }: { highlight?: number }) {
  const idx = highlight == null ? -1 : highlight <= 29 ? 0 : highlight <= 39 ? 1 : highlight <= 49 ? 2 : 3;
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {PRICE_BANDS.map((b, i) => (
        <div
          key={b.label}
          className={`min-w-0 rounded-[14px] bg-card px-4 py-4 shadow-[inset_0_0_0_1px_var(--border)] ${
            i === idx ? "shadow-[inset_0_0_0_1.5px_var(--foreground)]" : ""
          }`}
        >
          <div className="text-[13.5px] font-bold leading-[1.3]">{b.label}</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-display text-[26px] font-bold leading-none tabular-nums tracking-[-0.03em]">R$ {b.unit}</span>
            <span className="text-[12px] text-muted-foreground">/anúncio</span>
          </div>
          <p className="mt-2 text-[11.5px] font-medium leading-[1.45] text-[var(--faint)]">{b.note}</p>
        </div>
      ))}
    </div>
  );
}

export function IncludedList() {
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {INCLUDED_FEATURES.map((f) => (
        <li key={f} className="flex min-w-0 items-start gap-2 text-[13.5px] leading-[1.45]">
          <Check className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={2.5} aria-hidden="true" />
          <span className="min-w-0">{f}</span>
        </li>
      ))}
    </ul>
  );
}

/** Simulador: quantos anúncios → valor do mês (a mesma conta da cobrança real). */
export function PriceSimulator({ initial = 5 }: { initial?: number }) {
  const [n, setN] = useState(initial);
  const total = monthlyTotalCents(n);
  const unit = displayUnitCents(n);
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[14px] bg-card px-4 py-4 shadow-[inset_0_0_0_1px_var(--border)] sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <label htmlFor="sim-anuncios" className="text-[13.5px] font-bold">
          Quantos anúncios você tem?
        </label>
        <p className="mt-0.5 text-[11.5px] font-medium text-[var(--faint)]">
          Vence todo dia {BILLING_ANCHOR_DAY}. Na contratação, você paga só os dias até o dia {BILLING_ANCHOR_DAY}.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Menos um anúncio"
          onClick={() => setN((v) => Math.max(1, v - 1))}
          className="grid size-9 place-items-center rounded-[10px] bg-secondary text-foreground"
        >
          <Minus className="size-4" strokeWidth={2} />
        </button>
        <input
          id="sim-anuncios"
          inputMode="numeric"
          value={n}
          onChange={(e) => setN(Math.max(1, Math.min(999, Number(e.target.value.replace(/\D/g, "")) || 1)))}
          className="h-9 w-16 rounded-[10px] bg-secondary text-center font-display text-[15px] font-bold tabular-nums outline-none"
        />
        <button
          type="button"
          aria-label="Mais um anúncio"
          onClick={() => setN((v) => Math.min(999, v + 1))}
          className="grid size-9 place-items-center rounded-[10px] bg-secondary text-foreground"
        >
          <Plus className="size-4" strokeWidth={2} />
        </button>
      </div>
      <div className="min-w-0 text-left sm:w-[180px] sm:text-right">
        <div className="font-display text-[22px] font-bold leading-none tabular-nums tracking-[-0.03em]">{brl(total)}</div>
        <div className="mt-1 text-[11.5px] font-medium tabular-nums text-[var(--faint)]">
          por mês · {brl(unit)} por anúncio
        </div>
      </div>
    </div>
  );
}
