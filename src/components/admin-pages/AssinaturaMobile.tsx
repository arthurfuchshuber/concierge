import { useState } from "react";
import { CreditCard, FileText, Lock, ShieldCheck } from "lucide-react";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PaymentMethodSummary } from "@/lib/billing/billing.functions";
import { Tag, SAGE } from "@/components/admin-pages/admin-mobile-ui";
import { PRICE_BANDS } from "@/components/pricing/ListingPricing";
import { ImoveisCobradosDialog } from "./ImoveisCobradosDialog";
import { brl, fmtDate, type buildAssinatura } from "./assinatura-data";

/**
 * Assinatura no celular (mockups aprovados, 05/11/2026). Cobrança por anúncio na Stripe: todos os
 * números vêm do servidor (`buildAssinatura`); vencimento sempre no dia 25.
 */
const HAIR = "border-foreground/[0.07]";
type Aba = "plano" | "cartao" | "extrato";

export function AssinaturaMobile({
  view,
  paymentMethod,
  onOpenPortal,
}: {
  view: ReturnType<typeof buildAssinatura>;
  paymentMethod: PaymentMethodSummary | null;
  onOpenPortal: () => void;
}) {
  const [aba, setAba] = useState<Aba>("plano");
  const [janela, setJanela] = useState(false);
  const { qtd, faturas } = view;
  const tierIdx = view.bandIdx;
  const cap = view.bandCap ?? Math.max(qtd, 50);
  const total = view.monthly;
  const proxima = view.nextLabel;

  const brand = (paymentMethod?.brand ?? "").toUpperCase();
  const abas: { key: Aba; label: string }[] = [
    { key: "plano", label: "Plano" },
    { key: "cartao", label: "Cartão" },
    { key: "extrato", label: "Extrato" },
  ];
  // Rótulos exatos do mockup aprovado (05/11/2026); valores da tabela oficial.
  const LABELS = ["1 a 29 Imóveis", "30 a 39 Imóveis", "40 a 49 Imóveis", "50 Imóveis ou Mais"];
  const TIERS = PRICE_BANDS.map((t, i) => ({ label: LABELS[i], price: t.unit * 100, note: i === 0 ? null : t.note }));

  return (
    <div className="flex flex-col gap-3 lg:hidden">
      {/* Um cartão só: valor, abas em texto e o conteúdo da aba */}
      <section className={`${PANEL_SHELL} px-4 pb-3.5 pt-[18px]`}>
        <div className="pb-[18px] pt-1.5 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Valor do Mês</div>
          <div className="mt-2.5 font-display text-[30px] font-bold leading-none tracking-[-0.035em] tabular-nums">
            {view.courtesy ? "Cortesia" : brl(total)}
          </div>
          {view.custom ? (
            <div className="mt-2.5 flex justify-center">
              <Tag>Condição Especial Negociada</Tag>
            </div>
          ) : null}
          <div className="mt-2.5 text-[12.5px] text-[var(--faint)]">
            {view.courtesyUntil ? (
              <>
                <span className="whitespace-nowrap">
                  Carência até <span className="font-semibold text-muted-foreground tabular-nums">{fmtDate(view.courtesyUntil)}</span> ·
                </span>{" "}
                <span className="whitespace-nowrap">
                  Próxima cobrança em <span className="font-semibold text-muted-foreground tabular-nums">{proxima}</span>
                </span>
              </>
            ) : view.paused ? (
              <>Sem anúncios ativos · cobrança pausada</>
            ) : (
              <>
                Próxima cobrança em <span className="font-semibold text-muted-foreground tabular-nums">{proxima}</span>
              </>
            )}
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
      {aba === "plano" && view.custom && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Ver imóveis cobrados"
          onClick={() => setJanela(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setJanela(true);
            }
          }}
          className="flex min-w-0 cursor-pointer items-center gap-2.5 py-[13px] transition-colors active:bg-foreground/[0.04]"
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 truncate text-[13.5px] font-bold leading-[1.3]">Valor por Imóvel</div>
              <Tag>Plano Parceiro</Tag>
            </div>
            <p className="text-[11.5px] font-medium leading-[1.45] tabular-nums text-[var(--faint)]">
              {qtd} {qtd === 1 ? "imóvel" : "imóveis"} · mínimo de {view.minUnits}
            </p>
          </div>
          <span className="whitespace-nowrap font-display text-[14px] font-bold tabular-nums">
            {view.courtesy ? "Cortesia" : brl(view.unit)}
          </span>
        </div>
      )}
      {aba === "plano" && !view.custom && (
        <div>
          {TIERS.map((t, i) => {
            const cur = i === tierIdx;
            return (
              <div
                key={t.label}
                {...(cur
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-label": "Ver imóveis cobrados",
                      onClick: () => setJanela(true),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setJanela(true);
                        }
                      },
                    }
                  : {})}
                className={`flex min-w-0 items-center gap-2.5 py-[13px] ${i === 0 ? "" : `border-t ${HAIR}`} ${
                  cur ? "cursor-pointer transition-colors active:bg-foreground/[0.04]" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 truncate text-[13.5px] font-bold leading-[1.3]">{t.label}</div>
                    {cur ? <Tag>Plano Atual</Tag> : null}
                  </div>
                  {cur ? (
                    <p className="text-[11.5px] font-medium leading-[1.45] tabular-nums text-[var(--faint)]">
                      {qtd} de {cap} imóveis
                    </p>
                  ) : t.note ? (
                    <p className="text-[11.5px] font-medium leading-[1.45] text-[var(--faint)]">{t.note}</p>
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

