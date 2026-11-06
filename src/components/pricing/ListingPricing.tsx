import { Check, RefreshCw } from "lucide-react";
import { BILLING_ANCHOR_DAY, MIN_BILLABLE_LISTINGS } from "@/lib/billing/listing-billing";

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

/**
 * O que o sistema oferece, em detalhe (06/11/2026). Plano único: não existe comparativo
 * entre planos, então a /precos só descreve o que vem incluso para todo cliente.
 */
export const SYSTEM_FEATURES = [
  {
    title: "Guias digitais ilimitados",
    desc: "Guia de cada imóvel em português e inglês, com regras da casa, check-in, Wi-Fi e dicas da região.",
  },
  {
    title: "Conexão com o Airbnb",
    desc: "Os anúncios entram sozinhos e ficam sincronizados: dados, calendário e reservas sem digitar nada.",
  },
  {
    title: "IA no atendimento ao hóspede",
    desc: "Responde no chat a qualquer hora com base no que você cadastrou, e aprende com a sua revisão.",
  },
  {
    title: "Atendimento humano ao vivo",
    desc: "Central de atendimento para assumir a conversa quando precisar, com equipe e permissões por área.",
  },
  {
    title: "Captação e documentos de hóspedes",
    desc: "Coleta dos dados de quem vai se hospedar e validação de documentos antes do check-in.",
  },
  {
    title: "Operação do dia a dia",
    desc: "Limpezas, Kanban, registros, calendário de ocupação e painel gerencial com os números da operação.",
  },
  {
    title: "Marca própria e integrações",
    desc: "Guias com a sua marca e conexão com outros sistemas, como o WhatsApp Business.",
  },
] as const;

export function SystemFeatures() {
  return (
    <ul className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
      {SYSTEM_FEATURES.map((f) => (
        <li key={f.title} className="flex min-w-0 items-start gap-2.5">
          <Check className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={2.5} aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[14px] font-bold leading-[1.35]">{f.title}</div>
            <p className="mt-0.5 text-[12.5px] leading-[1.5] text-muted-foreground">{f.desc}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Como a quantidade é apurada. Não há campo para o cliente escolher quantos anúncios:
 * a cobrança conta sozinha os anúncios conectados e sincronizados (pedido de 06/11/2026).
 */
export function AutomaticCountNote() {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-[14px] bg-card px-4 py-4 shadow-[inset_0_0_0_1px_var(--border)]">
      <div className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-secondary">
        <RefreshCw className="size-4" strokeWidth={2} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="text-[13.5px] font-bold">Você não escolhe quantidade</div>
        <p className="mt-0.5 text-[12.5px] leading-[1.5] text-muted-foreground">
          O sistema conta sozinho os anúncios conectados e sincronizados. Anúncio novo entra na cobrança
          no mesmo dia, proporcional até o{" "}
          <span className="whitespace-nowrap">dia {BILLING_ANCHOR_DAY}.</span> Anúncio desativado sai no ciclo seguinte.
        </p>
      </div>
    </div>
  );
}
