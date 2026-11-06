import { Check } from "lucide-react";
import { MIN_BILLABLE_LISTINGS } from "@/lib/billing/listing-billing";

/**
 * Tabela oficial por anúncio conectado ativo (06/11/2026) — a mesma usada pela Stripe
 * (`listing-billing.ts`). Usada na landing, no onboarding e na Assinatura: nunca divergem.
 */
export const PRICE_BANDS = [
  { label: "1 a 29 anúncios", unit: 119, note: `Mínimo de ${MIN_BILLABLE_LISTINGS} anúncios · R$ 357/mês` },
  { label: "30 a 39 anúncios", unit: 99, note: "~17% de desconto" },
  { label: "40 a 49 anúncios", unit: 96, note: "~19% de desconto" },
  { label: "50 anúncios ou mais", unit: 89, note: "~25% de desconto" },
] as const;

/** Tudo o que a assinatura inclui (plano único: todos os recursos). */
export const INCLUDED_FEATURES = [
  "Guias digitais ilimitados em português e inglês",
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
