import { useState } from "react";
import { CreditCard, FileText, Info, Lock } from "lucide-react";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import type { PaymentMethodSummary } from "@/lib/billing/billing.functions";
import { Tag } from "@/components/admin-pages/admin-mobile-ui";
import { PRICE_BANDS } from "@/components/pricing/ListingPricing";
import { ImoveisCobradosDialog } from "./ImoveisCobradosDialog";
import { brl, type buildAssinatura } from "./assinatura-data";
import { CardCheckTag, IsencaoBanner, IsentaPill } from "./AssinaturaIsencao";

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
  busy = false,
  readOnly = false,
}: {
  view: ReturnType<typeof buildAssinatura>;
  paymentMethod: PaymentMethodSummary | null;
  onOpenPortal: () => void;
  busy?: boolean;
  /** Visão do membro (18/11/2026): tudo à mostra, mas só o titular altera plano e cartão. */
  readOnly?: boolean;
}) {
  const [aba, setAba] = useState<Aba>("plano");
  const [janela, setJanela] = useState(false);
  const { qtd, faturas } = view;
  const tierIdx = view.bandIdx;
  const cap = view.bandCap ?? Math.max(qtd, 50);
  const total = view.monthly;
  const pct = view.bandCap ? Math.min(100, (view.qtd / view.bandCap) * 100) : 100;
  const openJanela = () => {
    if (!readOnly) setJanela(true);
  };

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
      {readOnly ? (
        <div className="flex min-w-0 items-center gap-2 rounded-[10px] bg-card px-3 py-2.5 text-[12px] font-medium text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]">
          <Lock className="size-3.5 shrink-0 text-[var(--faint)]" strokeWidth={2} />
          <span className="min-w-0">Somente o titular da conta pode alterar plano e cartão.</span>
        </div>
      ) : null}
      {view.exempt ? <IsencaoBanner view={view} busy={busy} onUpdateCard={onOpenPortal} compact readOnly={readOnly} /> : null}
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
          {/* Mockup de 18/11/2026: a quantidade de anúncios ativos no lugar da próxima cobrança. */}
          <div className="mt-2.5 text-[12.5px] text-[var(--faint)] tabular-nums">
            {qtd === 0
              ? "Nenhum anúncio ativo em sua conta."
              : `${qtd} ${qtd === 1 ? "anúncio ativo" : "anúncios ativos"} em sua conta.`}
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
          onClick={openJanela}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openJanela();
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
                      onClick: openJanela,
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openJanela();
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
          {/* Barra de meta (a mesma do computador), discreta e NUNCA em conta isenta (18/11/2026). */}
          {!view.exempt ? (
            <div className="pb-1 pt-1.5">
              <div className="h-[3px] overflow-hidden rounded-full bg-foreground/[0.07]">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#7c1ad8,#e82dae)]" style={{ width: `${pct}%` }} />
              </div>
              {view.nextBand && view.toNext > 0 ? (
                <div className="mt-2.5 flex items-start gap-2 text-[12px] leading-[1.45]">
                  <Info className="mt-0.5 size-[13px] shrink-0 text-[var(--faint)]" strokeWidth={2} />
                  <span>
                    Faltam <b>{view.toNext} {view.toNext === 1 ? "imóvel" : "imóveis"}</b> para garantir{" "}
                    <b>{view.nextBand.note}</b>.
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {aba === "cartao" && (
        <div className="pb-1 pt-4">
          {paymentMethod ? (
            /* Mockup de 18/11/2026: o cartão num quadrante claro com sombra leve. */
            <div className="rounded-[14px] bg-card px-[18px] py-4 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent),0_1px_2px_rgba(40,25,10,.06),0_4px_10px_rgba(40,25,10,.06)]">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="text-[15px] font-extrabold tracking-[0.08em]">{brand || "CARTÃO"}</span>
                {view.exempt ? <CardCheckTag view={view} /> : null}
              </div>
              <div className="mt-5 text-[12px] font-bold tracking-[0.18em] tabular-nums">
                •••• •••• •••• <span className="text-[13px] tracking-[0.04em]">{paymentMethod.last4 ?? "----"}</span>
              </div>
              <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[12px] font-medium text-muted-foreground tabular-nums">
                  {paymentMethod.expiryMonth && paymentMethod.expiryYear
                    ? `Expira em ${String(paymentMethod.expiryMonth).padStart(2, "0")}/${paymentMethod.expiryYear}`
                    : ""}
                </span>
                {readOnly ? null : (
                  <button
                    type="button"
                    onClick={onOpenPortal}
                    disabled={busy}
                    className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[9px] bg-foreground/[0.05] px-3 text-[11.5px] font-medium text-muted-foreground"
                  >
                    <CreditCard className="size-3.5" strokeWidth={2} />
                    Trocar cartão
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-2">
              <p className="text-center text-[12px] text-[var(--faint)]">Nenhum cartão cadastrado.</p>
              {view.exempt && !readOnly ? (
                <button type="button" onClick={onOpenPortal} disabled={busy} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-foreground/[0.07] px-4 text-[12.5px] font-bold">
                  <CreditCard className="size-3.5" strokeWidth={2} />
                  Cadastrar cartão
                </button>
              ) : null}
            </div>
          )}
          <div className="mt-3.5 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-[var(--faint)]">
            <Lock className="size-3.5 shrink-0" strokeWidth={2} />
            Dados protegidos pelo provedor de pagamento
          </div>
        </div>
      )}

      {aba === "extrato" && (
        /* O quadrante termina numa linha fixa logo acima do menu inferior; mais meses rolam aqui dentro. */
        <div className="sg-elegant-scroll -mr-4 max-h-[max(220px,calc(100dvh-500px))] overflow-y-auto overscroll-contain pr-4">
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
                {/* Recibo e selo "ISENTA" à esquerda do valor; o valor alinhado à direita. */}
                {f.riscada ? <IsentaPill /> : null}
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
                <span
                  className={`min-w-[78px] whitespace-nowrap text-right font-display text-[14px] font-bold tabular-nums ${f.riscada ? "line-through opacity-55" : ""}`}
                >
                  {f.valor}
                </span>
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

