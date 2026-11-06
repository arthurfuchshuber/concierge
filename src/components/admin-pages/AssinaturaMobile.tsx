import { useState } from "react";
import { ChevronRight, CreditCard, FileText, Lock, ShieldCheck } from "lucide-react";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
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

type Payment = {
  id: string;
  createdAt: string | Date;
  amount: number | string;
  currency?: string | null;
  status: string;
  invoiceUrl?: string | null;
};

const HAIR = "border-foreground/[0.07]";
type Aba = "plano" | "cartao" | "extrato";

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
  const [aba, setAba] = useState<Aba>("plano");
  const [janela, setJanela] = useState(false);

  const qtd = inv.data?.totalCount ?? 0;
  const tierIdx = Math.max(
    0,
    TIERS.findIndex((t) => qtd >= t.from && (t.to == null || qtd <= t.to)),
  );
  const total = qtd < 30 ? Math.max(qtd, 3) * TIERS[tierIdx].price : qtd * TIERS[tierIdx].price;
  const cap = TIERS[tierIdx].to ?? Math.max(qtd, TIERS[tierIdx].from);
  const proxima = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : "—";

  const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString("pt-BR");
  const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const monthLabel = (d: string | Date) =>
    cap1(new Date(d).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "").replace(" de ", " "));

  const faturas: { id: string; titulo: string; sub: string; valor: string; cor: string; url: string | null }[] = [];
  if (isActive && currentPeriodEnd) {
    faturas.push({
      id: "previsto",
      titulo: `Fatura ${monthLabel(currentPeriodEnd)}`,
      sub: `Previsto para ${fmtDate(currentPeriodEnd)}`,
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
      titulo: `Fatura ${monthLabel(p.createdAt)}`,
      sub: `${paid ? "Pago em" : failed ? "Falhou em" : "Emitida em"} ${fmtDate(p.createdAt)}`,
      // O valor vem em centavos.
      valor: (Number(p.amount) / 100).toLocaleString("pt-BR", { style: "currency", currency: p.currency || "BRL" }),
      cor: paid ? SAGE : failed ? ROSE : AMBER,
      url: p.invoiceUrl ?? null,
    });
  }

  const brand = (paymentMethod?.brand ?? "").toUpperCase();
  const abas: { key: Aba; label: string }[] = [
    { key: "plano", label: "Plano" },
    { key: "cartao", label: "Cartão" },
    { key: "extrato", label: "Extrato" },
  ];

  return (
    <div className="flex flex-col gap-3 lg:hidden">
      {/* Um cartão só: valor, abas em texto e o conteúdo da aba */}
      <section className={`${PANEL_SHELL} px-4 pb-3.5 pt-[18px]`}>
        <div className="pb-[18px] pt-1.5 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Valor do Mês</div>
          <div className="mt-2.5 font-display text-[30px] font-bold leading-none tracking-[-0.035em] tabular-nums">{brl(total)}</div>
          <div className="mt-2.5 text-[12.5px] text-[var(--faint)]">
            Próxima cobrança em <span className="font-semibold text-muted-foreground tabular-nums">{proxima}</span>
          </div>
        </div>

        <div role="tablist" className={`flex border-b ${HAIR}`}>
          {abas.map((a) => {
            const on = aba === a.key;
            return (
              <button
                key={a.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setAba(a.key)}
                className={`relative flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center whitespace-nowrap text-[13px] ${
                  on ? "font-bold text-foreground" : "font-semibold text-[var(--faint)]"
                }`}
              >
                {a.label}
                {on ? <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-sm bg-foreground" /> : null}
              </button>
            );
          })}
        </div>

        <div className="pt-0.5">
      {aba === "plano" && (
        <div>
          {TIERS.map((t, i) => {
            const cur = i === tierIdx;
            return (
              <div key={t.label} className={`flex min-w-0 items-center gap-2.5 py-[13px] ${i === 0 ? "" : `border-t ${HAIR}`}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 truncate text-[13.5px] font-bold leading-[1.3]">{t.label}</div>
                    {cur ? <Tag>Plano Atual</Tag> : null}
                  </div>
                  {cur ? (
                    <button
                      type="button"
                      onClick={() => setJanela(true)}
                      aria-label="Ver imóveis cobrados"
                      className="flex cursor-pointer items-center gap-0.5 text-[11.5px] font-medium leading-[1.45] tabular-nums text-[var(--faint)]"
                    >
                      {qtd} de {cap} imóveis
                      <ChevronRight className="size-3" strokeWidth={2} />
                    </button>
                  ) : t.note ? (
                    <p className="text-[11.5px] font-medium leading-[1.45] text-[var(--faint)]">{t.note.replace("Desconto de ", "")} de desconto</p>
                  ) : null}
                </div>
                <span className="whitespace-nowrap font-display text-[14px] font-bold tabular-nums">{brl(t.price)}</span>
              </div>
            );
          })}
        </div>
      )}

      {aba === "cartao" && (
        <div className="py-4">
          {paymentMethod ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex h-7 shrink-0 items-center rounded-[7px] bg-foreground px-[9px] text-[10.5px] font-extrabold tracking-[0.06em] text-background">
                {brand || "CARTÃO"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold leading-[1.3] tabular-nums">
                  {brand ? brand.charAt(0) + brand.slice(1).toLowerCase() : "Cartão"} •••• {paymentMethod.last4 ?? "----"}
                </div>
                {paymentMethod.expiryMonth && paymentMethod.expiryYear ? (
                  <p className="text-[12px] font-medium leading-[1.45] text-muted-foreground">
                    Expira em {String(paymentMethod.expiryMonth).padStart(2, "0")}/{paymentMethod.expiryYear}
                  </p>
                ) : null}
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Segurança do Cartão"
                    title="Segurança do Cartão"
                    className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-md text-[var(--faint)] data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground"
                  >
                    <Lock className="size-[14px]" strokeWidth={2} />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[352px] max-w-[calc(100vw-24px)] p-0">
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
              <button
                type="button"
                aria-label="Trocar Cartão"
                title="Trocar Cartão"
                onClick={onOpenPortal}
                className="flex shrink-0 cursor-pointer items-center text-muted-foreground"
              >
                <CreditCard className="size-4" strokeWidth={2} />
              </button>
            </div>
          ) : (
            <p className="text-center text-[12px] text-[var(--faint)]">Nenhum cartão cadastrado.</p>
          )}
        </div>
      )}

      {aba === "extrato" && (
        <div>
          {faturas.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-[var(--faint)]">Nenhum pagamento registrado ainda.</p>
          ) : (
            faturas.map((f, i) => (
              <div key={f.id} className={`flex min-w-0 items-center gap-2.5 py-3 ${i === 0 ? "" : `border-t ${HAIR}`}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold leading-[1.3]">{f.titulo}</div>
                  <div className="mt-[3px] flex items-center gap-1.5">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: f.cor }} />
                    <p className="text-[11.5px] font-medium leading-[1.45] tabular-nums text-[var(--faint)]">{f.sub}</p>
                  </div>
                </div>
                <span className="whitespace-nowrap font-display text-[14px] font-bold tabular-nums">{f.valor}</span>
                {f.url ? (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Ver Recibo"
                    title="Ver Recibo"
                    className="flex shrink-0 cursor-pointer items-center text-[var(--faint)]"
                  >
                    <FileText className="size-4" strokeWidth={2} />
                  </a>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
        </div>
      </section>

      <ImoveisCobradosDialog open={janela} onOpenChange={setJanela} />
    </div>
  );
}
