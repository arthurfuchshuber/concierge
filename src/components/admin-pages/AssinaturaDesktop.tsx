import { useState } from "react";
import { Calendar, ChevronDown, CreditCard, FileText, Home, Info, Lock, ShieldCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PaymentMethodSummary } from "@/lib/billing/billing.functions";
import { Tag, SAGE } from "@/components/admin-pages/admin-mobile-ui";
import { PRICE_BANDS } from "@/components/pricing/ListingPricing";
import { ImoveisCobradosDialog } from "./ImoveisCobradosDialog";
import { brl, fmtDate, type buildAssinatura } from "./assinatura-data";
import { CardCheckTag, IsencaoBanner, IsentaPill } from "./AssinaturaIsencao";

/**
 * Assinatura no desktop (mockup aprovado "Proposta-Assinatura-Desktop", 05/11/2026): valor do mês
 * com imóveis cobrados e próxima cobrança, faixa atual (seta única expande as demais), cartão e
 * Extrato da Conta em grade. Números do servidor; vencimento sempre no dia 25.
 */
const CARD =
  "relative min-w-0 overflow-hidden rounded-[12px] bg-[var(--surface-elevated)] px-[14px] py-3 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_9%,transparent)]";
const LABELS = ["1 a 29 Imóveis", "30 a 39 Imóveis", "40 a 49 Imóveis", "50 Imóveis ou Mais"];

export function AssinaturaDesktop({
  view,
  paymentMethod,
  onOpenPortal,
  busy = false,
}: {
  view: ReturnType<typeof buildAssinatura>;
  paymentMethod: PaymentMethodSummary | null;
  onOpenPortal: () => void;
  busy?: boolean;
}) {
  const [janela, setJanela] = useState(false);
  const [faixas, setFaixas] = useState(false);
  const brand = (paymentMethod?.brand ?? "").toUpperCase();
  const pct = view.bandCap ? Math.min(100, (view.qtd / view.bandCap) * 100) : 100;

  const cartao = (
    <>
      <div className={CARD}>
        {paymentMethod ? (
          <div className="flex min-w-0 items-start gap-[10px]">
            <span className="inline-flex h-7 shrink-0 items-center self-center rounded-[7px] bg-foreground px-[9px] text-[10.5px] font-extrabold tracking-[0.06em] text-background">
              {brand || "CARTÃO"}
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
                  <PopoverContent align="end" className="w-[352px] max-w-[calc(100vw-24px)] p-0">
                    <div className="flex h-12 items-center px-4 font-display text-[14px] font-bold">Dados do Cartão Protegidos</div>
                    <div className="flex flex-col gap-2.5 px-4 pb-4">
                      <p className="text-[12.5px] font-medium leading-[1.45] text-muted-foreground">
                        Os dados do cartão ficam armazenados com segurança na Stripe — nunca passam pelos servidores da ConciergeIA.
                      </p>
                      <div className="flex items-center gap-2 text-[11.5px] font-medium text-[var(--faint)]">
                        <ShieldCheck className="size-3.5 shrink-0" style={{ color: SAGE }} strokeWidth={2} />
                        Conexão criptografada · Visa, Mastercard, Elo e Amex
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <CardCheckTag view={view} />
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
              className="flex h-[18px] shrink-0 cursor-pointer items-center self-start text-muted-foreground"
            >
              <CreditCard className="size-4" strokeWidth={2} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 py-1">
            <p className="text-center text-[12px] text-[var(--faint)]">Nenhum cartão cadastrado.</p>
            {view.exempt ? (
              <button type="button" onClick={onOpenPortal} disabled={busy} className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-foreground/[0.07] px-3 text-[11.5px] font-bold">
                <CreditCard className="size-3.5" strokeWidth={2} />
                Cadastrar cartão
              </button>
            ) : null}
          </div>
        )}
      </div>

    </>
  );
  const valor = (
    <>
      <section className="flex min-w-0 flex-col gap-[14px] rounded-[14px] bg-card px-[14px] pb-3 pt-4 shadow-[inset_0_1px_0_rgba(246,243,239,0.07),inset_0_0_0_1px_rgba(255,255,255,0.07),0_10px_24px_-16px_rgba(0,0,0,0.9)]">
        <div className="text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Valor do Mês</div>
          <div className="mt-2 font-display text-[28px] font-bold leading-none tracking-[-0.03em] tabular-nums">
            {view.courtesy ? "Cortesia" : brl(view.monthly)}
          </div>
          {view.custom ? (
            <div className="mt-2 flex justify-center">
              <Tag>Condição Especial Negociada</Tag>
            </div>
          ) : null}
          {view.courtesyUntil ? (
            <p className="mt-2 text-[12px] text-[var(--faint)]">
              Período de carência até <span className="font-semibold text-muted-foreground tabular-nums">{fmtDate(view.courtesyUntil)}</span>
            </p>
          ) : view.paused ? (
            <p className="mt-2 text-[12px] text-[var(--faint)]">Sem anúncios ativos · cobrança pausada até você reativar um anúncio</p>
          ) : null}
        </div>
        <div className="flex items-stretch gap-3 border-t border-foreground/[0.08] pt-3">
          <button type="button" aria-label="Ver imóveis cobrados" onClick={() => setJanela(true)} className="block min-w-0 flex-1 cursor-pointer">
            <Stat icon={<Home className="size-3.5" strokeWidth={2} />} label="Imóveis cobrados" value={String(view.qtd)} />
          </button>
          <span aria-hidden="true" className="w-px self-stretch bg-foreground/[0.08]" />
          <div className="min-w-0 flex-1">
            <Stat icon={<Calendar className="size-3.5" strokeWidth={2} />} label="Próxima cobrança" value={view.nextLabel} />
          </div>
        </div>
      </section>

    </>
  );
  const plano = (
    <>
      <div className={CARD}>
        {view.custom ? (
          <div className="min-w-0">
            <div className="flex h-[22px] items-center gap-2">
              <div className="min-w-0 truncate text-[13.5px] font-bold leading-[1.3]">Valor por Imóvel</div>
              <Tag>Plano Parceiro</Tag>
            </div>
            <p className="text-[11.5px] font-medium leading-[1.45] tabular-nums text-[var(--faint)]">
              {view.courtesy ? "Cortesia total" : `${brl(view.unit)} por imóvel`} · mínimo de {view.minUnits}
            </p>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-start gap-[10px]">
              <div className="min-w-0 flex-1">
                <div className="flex h-[22px] items-center gap-2">
                  <div className="min-w-0 truncate text-[13.5px] font-bold leading-[1.3]">{LABELS[view.bandIdx]}</div>
                  <Tag>Plano Atual</Tag>
                </div>
                <p className="text-[11.5px] font-medium leading-[1.45] tabular-nums text-[var(--faint)]">
                  {brl(view.unit)} por imóvel · {view.qtd}
                  {view.bandCap ? ` de ${view.bandCap}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="Ver todas as faixas"
                title="Ver todas as faixas"
                onClick={() => setFaixas((v) => !v)}
                className={`grid size-5 shrink-0 cursor-pointer place-items-center rounded-md text-[var(--faint)] transition-transform ${faixas ? "rotate-180" : ""}`}
              >
                <ChevronDown className="size-[15px]" strokeWidth={2} />
              </button>
            </div>
            <div className="mt-[10px] h-[3px] overflow-hidden rounded-full bg-foreground/[0.07]">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#7c1ad8,#e82dae)]" style={{ width: `${pct}%` }} />
            </div>
            {view.nextBand && view.toNext > 0 ? (
              <div className="mt-[10px] flex items-start gap-2 text-[12px] leading-[1.45]">
                <Info className="mt-0.5 size-[13px] shrink-0 text-[var(--faint)]" strokeWidth={2} />
                <span>
                  Faltam <b>{view.toNext} {view.toNext === 1 ? "imóvel" : "imóveis"}</b> para garantir <b>{view.nextBand.note}</b>.
                </span>
              </div>
            ) : null}
            {faixas ? (
              <div className="mt-2 border-t border-foreground/[0.07]">
                {PRICE_BANDS.map((t, i) =>
                  i === view.bandIdx ? null : (
                    <div key={t.label} className="flex min-w-0 items-center gap-2.5 border-b border-foreground/[0.07] py-2.5 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-bold">{LABELS[i]}</div>
                        {i > 0 ? <p className="text-[11.5px] font-medium text-[var(--faint)]">{t.note}</p> : null}
                      </div>
                      <span className="whitespace-nowrap font-display text-[13.5px] font-bold tabular-nums">{brl(t.unit * 100)}</span>
                    </div>
                  ),
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

    </>
  );
  const extrato = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-px flex-1 bg-[linear-gradient(270deg,color-mix(in_oklab,var(--foreground)_16%,transparent),transparent)]" />
        <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--faint)]">
          Extrato da Conta · {view.faturas.length}
        </span>
        <span className="h-px flex-1 bg-[linear-gradient(90deg,color-mix(in_oklab,var(--foreground)_16%,transparent),transparent)]" />
      </div>
      {view.faturas.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-[var(--faint)]">Nenhum pagamento registrado ainda.</p>
      ) : (
        <div className="grid grid-cols-1 gap-[10px]">
          {view.faturas.map((f) => (
            <div key={f.id} className={`${CARD} pl-[17px]`}>
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: f.cor }} />
              <div className="flex h-[18px] min-w-0 items-center justify-between gap-[10px]">
                <div className="min-w-0 truncate text-[13.5px] font-bold leading-[1.3]">{f.titulo}</div>
                <div className="flex shrink-0 items-center gap-2">
                  {f.riscada ? <IsentaPill /> : null}
                  <span
                    className={`whitespace-nowrap font-display text-[14px] font-bold tabular-nums ${f.riscada ? "line-through opacity-55" : ""}`}
                  >
                    {f.valor}
                  </span>
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noopener noreferrer" aria-label="Ver Recibo" title="Ver Recibo" className="flex size-[18px] items-center justify-center text-muted-foreground">
                      <FileText className="size-4" strokeWidth={2} />
                    </a>
                  ) : null}
                </div>
              </div>
              <p className="mt-1 text-[11.5px] font-medium leading-[1.45] tabular-nums text-[var(--faint)]">{f.sub}</p>
            </div>
          ))}
        </div>
      )}

    </>
  );

  return (
    <div className="hidden min-w-0 flex-col gap-[10px] lg:flex">
      {/* Conta isenta: faixa no topo, depois Valor do Mês e só então o cartão (mockup aprovado, 10/11/2026). */}
      {view.exempt ? (
        <>
          <IsencaoBanner view={view} busy={busy} onUpdateCard={onOpenPortal} />
          {valor}
          {cartao}
        </>
      ) : (
        <>
          {cartao}
          {valor}
        </>
      )}
      {plano}
      {extrato}
      <ImoveisCobradosDialog open={janela} onOpenChange={setJanela} />
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <>
      <div className="flex min-w-0 justify-center px-5">
        <span className="relative min-w-0 max-w-full">
          <span className="absolute right-full top-1/2 mr-1.5 grid -translate-y-1/2 place-items-center text-muted-foreground/50">{icon}</span>
          <span className="block whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--faint)]">{label}</span>
        </span>
      </div>
      <div className="mt-[10px] whitespace-nowrap text-center font-display text-[15px] font-semibold tabular-nums">{value}</div>
    </>
  );
}
