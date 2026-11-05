import { useState, type ReactNode } from "react";
import { Calendar, ChevronDown, ChevronUp, CreditCard, FileText, House, Info, Lock, ShieldCheck } from "lucide-react";
import { SectionLabel } from "@/components/dashboard/panel-chrome";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getConnectedListingsInventory } from "@/lib/channex.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import type { PaymentMethodSummary } from "@/lib/payments.functions";
import { Tag, SAGE, AMBER, ROSE } from "@/components/admin-pages/admin-mobile-ui";
import { ImoveisCobradosDialog } from "./ImoveisCobradosDialog";

/**
 * Assinatura no celular (mockups aprovados, 05/11/2026). A cobrança é por anúncio: as faixas abaixo
 * são a tabela oficial e o total é calculado na tela (a cobrança real ainda segue o plano).
 */
const TIERS = [
  { from: 1, to: 29, label: "1 a 29 Imóveis", price: 119, note: null as string | null },
  { from: 30, to: 39, label: "30 a 39 Imóveis", price: 99, note: "Desconto de ~17%" },
  { from: 40, to: 49, label: "40 a 49 Imóveis", price: 96, note: "Desconto de ~19%" },
  { from: 50, to: null as number | null, label: "50 Imóveis ou Mais", price: 89, note: "Desconto de ~25%" },
];

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");

const CARD_ROW =
  "relative overflow-hidden min-w-0 rounded-[12px] bg-[var(--card-surface)] shadow-[inset_0_0_0_1px_rgba(246,243,239,0.07)]";

type Payment = {
  id: string;
  createdAt: string | Date;
  amount: number | string;
  currency?: string | null;
  status: string;
  invoiceUrl?: string | null;
};

export function AssinaturaMobile({
  currentPeriodEnd,
  isActive,
  payments,
  paymentMethod,
  onOpenPortal,
}: {
  currentPeriodEnd: string | null;
  isActive: boolean;
  payments: Payment[];
  paymentMethod: PaymentMethodSummary | null;
  onOpenPortal: () => void;
}) {
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const invFn = useServerFn(getConnectedListingsInventory);
  const inv = useQuery({
    queryKey: ["connected-listings-inventory", accountOwnerId ?? "self"],
    queryFn: () => invFn({ data: { accountOwnerId } }),
    retry: false,
  });
  const [faixas, setFaixas] = useState(false);
  const [janela, setJanela] = useState(false);

  const qtd = inv.data?.totalCount ?? 0;
  const tierIdx = Math.max(
    0,
    TIERS.findIndex((t) => qtd >= t.from && (t.to == null || qtd <= t.to)),
  );
  const tier = TIERS[tierIdx];
  const next = TIERS[tierIdx + 1] ?? null;
  const total = qtd < 30 ? Math.max(qtd, 3) * tier.price : qtd * tier.price;
  const cap = tier.to ?? Math.max(qtd, tier.from);
  const proxima = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : "—";

  const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString("pt-BR");
  const monthLabel = (d: string | Date) =>
    new Date(d).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "").replace(" de ", " ");
  const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const faturas: { id: string; titulo: string; sub: string; valor: string; cor: string; url: string | null }[] = [];
  if (isActive && currentPeriodEnd) {
    faturas.push({
      id: "previsto",
      titulo: `Fatura ${cap1(monthLabel(currentPeriodEnd))}`,
      sub: `Previsto para ${fmtDate(currentPeriodEnd)} · ${qtd} imóveis`,
      valor: brl(total),
      cor: AMBER,
      url: null,
    });
  }
  for (const p of payments) {
    const paid = p.status === "completed" || p.status === "paid";
    const failed = p.status === "past_due" || p.status === "failed" || p.status === "canceled";
    faturas.push({
      id: p.id,
      titulo: `Fatura ${cap1(monthLabel(p.createdAt))}`,
      sub: `${paid ? "Pago em" : failed ? "Falhou em" : "Emitida em"} ${fmtDate(p.createdAt)}`,
      // O valor vem em centavos.
      valor: (Number(p.amount) / 100).toLocaleString("pt-BR", { style: "currency", currency: p.currency || "BRL" }),
      cor: paid ? SAGE : failed ? ROSE : AMBER,
      url: p.invoiceUrl ?? null,
    });
  }

  const brand = (paymentMethod?.brand ?? "").toUpperCase();

  return (
    <div className="ds-stack lg:hidden">
      {/* Quadrante único: Valor do Mês em destaque */}
      <section className="ds-3d relative flex min-w-0 flex-col gap-[14px] overflow-hidden rounded-[14px] border-0 bg-card px-[14px] pb-3 pt-4">
        <div className="text-center">
          <div className="text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Valor do Mês</div>
          <div className="mt-2 font-display text-[24px] font-bold leading-none tracking-[-0.03em] tabular-nums">{brl(total)}</div>
        </div>
        <div className="flex items-stretch gap-3 border-t border-foreground/[0.08] pt-3">
          <button type="button" aria-label="Ver imóveis cobrados" onClick={() => setJanela(true)} className="block min-w-0 flex-1 cursor-pointer">
            <SecLabel icon={<House className="size-3.5" />}>Imóveis cobrados</SecLabel>
            <div className="mt-2.5 text-center font-display text-[15px] font-semibold tabular-nums">{qtd}</div>
          </button>
          <span aria-hidden className="w-px shrink-0 self-stretch bg-foreground/[0.08]" />
          <div className="block min-w-0 flex-1">
            <SecLabel icon={<Calendar className="size-3.5" />}>Próxima cobrança</SecLabel>
            <div className="mt-2.5 text-center font-display text-[15px] font-semibold tabular-nums">{proxima}</div>
          </div>
        </div>
      </section>

      {/* Plano atual */}
      <div className={`${CARD_ROW} px-[14px] py-3`}>
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex h-[22px] items-center gap-2">
              <div className="min-w-0 truncate text-[13.5px] font-bold leading-[1.3]">{tier.label}</div>
              <Tag>Plano Atual</Tag>
            </div>
            <p className="text-[11.5px] font-medium leading-[1.45] tabular-nums text-[var(--faint)]">
              {brl(tier.price)} por imóvel · {qtd} de {cap}
            </p>
          </div>
          <div className="flex h-[22px] shrink-0 items-center">
            <button
              type="button"
              aria-label={faixas ? "Recolher" : "Ver todas as faixas"}
              title={faixas ? "Recolher" : "Ver todas as faixas"}
              onClick={() => setFaixas((v) => !v)}
              className={`grid size-5 cursor-pointer place-items-center rounded-md ${faixas ? "text-foreground" : "text-[var(--faint)]"}`}
            >
              {faixas ? <ChevronUp className="size-[15px]" strokeWidth={2} /> : <ChevronDown className="size-[15px]" strokeWidth={2} />}
            </button>
          </div>
        </div>
        <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-foreground/[0.07]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#7c1ad8] to-[#e82dae]"
            style={{ width: `${Math.min(100, (qtd / Math.max(cap, 1)) * 100)}%` }}
          />
        </div>
        {faixas &&
          TIERS.filter((_, i) => i !== tierIdx).map((t, i) => (
            <div key={t.label} className="min-w-0 border-t border-border py-2.5 first:mt-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 truncate text-[13px] font-bold leading-[1.3]">{t.label}</div>
                {next && t.label === next.label ? <Tag>Próxima</Tag> : null}
              </div>
              <p className="text-[11.5px] font-medium leading-[1.45] tabular-nums text-[var(--faint)]">
                {brl(t.price)} por imóvel{t.note ? ` · ${t.note}` : ""}
              </p>
            </div>
          ))}
        {next && (
          <div className="mt-2.5 flex items-start gap-2 text-[12px] leading-[1.45]">
            <Info className="mt-0.5 size-[13px] shrink-0 text-[var(--faint)]" strokeWidth={2} />
            <span>
              Faltam <b>{next.from - qtd} imóveis</b> para garantir <b>{next.note?.replace("Desconto de ", "")} de desconto</b>.
            </span>
          </div>
        )}
      </div>

      {/* Cartão */}
      {paymentMethod && (
        <div className={`${CARD_ROW} px-[14px] py-3`}>
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex self-center">
              <span className="inline-flex h-7 shrink-0 items-center rounded-[7px] bg-foreground px-[9px] text-[10.5px] font-extrabold tracking-[0.06em] text-background">
                {brand || "CARTÃO"}
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="min-w-0 truncate text-[13.5px] font-bold leading-[1.3] tabular-nums">
                  {brand ? brand.charAt(0) + brand.slice(1).toLowerCase() : "Cartão"} •••• {paymentMethod.last4 ?? "----"}
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="Segurança do Cartão"
                      title="Segurança do Cartão"
                      className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-md text-[var(--faint)] data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground"
                    >
                      <Lock className="size-[13px]" strokeWidth={2} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[352px] max-w-[calc(100vw-24px)] p-0">
                    <div className="flex h-12 items-center px-4 font-display text-[14px] font-bold">Dados do Cartão Protegidos</div>
                    <div className="flex flex-col gap-2.5 px-4 pb-4">
                      <p className="text-[12.5px] font-medium leading-[1.45] text-muted-foreground">
                        Os dados do cartão ficam armazenados com segurança no provedor de pagamento — nunca passam pelos servidores da ConciergeIA.
                      </p>
                      <div className="flex items-center gap-2 text-[11.5px] font-medium text-[var(--faint)]">
                        <ShieldCheck className="size-3.5 shrink-0" style={{ color: SAGE }} strokeWidth={2} />
                        Conexão criptografada · Visa, Mastercard e Amex
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              {paymentMethod.expiryMonth && paymentMethod.expiryYear ? (
                <p className="text-[12px] font-medium leading-[1.45] text-muted-foreground">
                  Expira em {String(paymentMethod.expiryMonth).padStart(2, "0")}/{paymentMethod.expiryYear}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Trocar Cartão"
              title="Trocar Cartão"
              onClick={onOpenPortal}
              className="flex h-[18px] shrink-0 cursor-pointer items-center justify-end self-start text-muted-foreground"
            >
              <CreditCard className="size-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {/* Extrato */}
      <SectionLabel count={faturas.length}>Extrato da Conta</SectionLabel>
      {faturas.length === 0 ? (
        <p className="text-center text-[12px] text-[var(--faint)]">Nenhum pagamento registrado ainda.</p>
      ) : (
        faturas.map((f) => (
          <div key={f.id} className={`${CARD_ROW} py-3 pl-[17px] pr-[14px]`}>
            <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: f.cor }} />
            <div className="flex h-[18px] min-w-0 items-center justify-between gap-2.5">
              <div className="min-w-0 truncate text-[13.5px] font-bold leading-[1.3]">{f.titulo}</div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="whitespace-nowrap font-display text-[14px] font-bold tabular-nums">{f.valor}</span>
                {f.url ? (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Ver Recibo"
                    title="Ver Recibo"
                    className="flex size-[18px] cursor-pointer items-center justify-center text-muted-foreground"
                  >
                    <FileText className="size-4" strokeWidth={2} />
                  </a>
                ) : null}
              </div>
            </div>
            <p className="mt-1 text-[11.5px] font-medium leading-[1.45] tabular-nums text-[var(--faint)]">{f.sub}</p>
          </div>
        ))
      )}

      <ImoveisCobradosDialog open={janela} onOpenChange={setJanela} />
    </div>
  );
}

function SecLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-center gap-1.5">
      <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-foreground/[0.05] text-muted-foreground/50">{icon}</span>
      <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--faint)]">{children}</span>
    </div>
  );
}
