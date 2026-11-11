import { useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { useSubscription } from "@/hooks/useSubscription";
import { useImpersonation } from "@/hooks/useImpersonation";
import {
  createCheckoutSession,
  createPortalSession,
  getAccountPaymentMethod,
  listMyPayments,
  refreshCardCheck,
  startCardSetup,
} from "@/lib/billing/billing.functions";
import { metaPixelTrack, metaPixelTrackOnce } from "@/lib/meta-pixel";
import { Skeleton } from "@/components/ui/skeleton";
import { CardSetupDialog, STRIPE_PUBLISHABLE_KEY } from "@/components/billing/CardSetupDialog";
import { PageHeader } from "@/components/ds/PageHeader";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import { PriceBands } from "@/components/pricing/ListingPricing";
import { BILLING_ANCHOR_DAY } from "@/lib/billing/listing-billing";
import { AssinaturaMobile } from "./AssinaturaMobile";
import { AssinaturaDesktop } from "./AssinaturaDesktop";
import { buildAssinatura } from "./assinatura-data";

export { AssinaturaPage };

/**
 * Administrativo › Assinatura (Stripe, cobrança por anúncio conectado ativo).
 * Celular e desktop seguem os mockups aprovados; os números vêm de `getAccountBilling`.
 */
function AssinaturaPage({ embedded = false }: { embedded?: boolean } = {}) {
  // `isPending` (e não `isLoading`) também cobre o intervalo em que a consulta espera a sessão: até lá `info` não é real.
  const { info, refetch, isPending, isError } = useSubscription();
  const { impersonation } = useImpersonation();
  const ownerId = impersonation?.userId ?? null;
  const portalFn = useServerFn(createPortalSession);
  const checkoutFn = useServerFn(createCheckoutSession);
  const paymentsFn = useServerFn(listMyPayments);
  const pmFn = useServerFn(getAccountPaymentMethod);
  const cardSetupFn = useServerFn(startCardSetup);
  const refreshCardFn = useServerFn(refreshCardCheck);
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { checkout?: string; card?: string };
  const [busy, setBusy] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  useEffect(() => {
    if (search.checkout !== "success") return;
    toast.success("Cartão cadastrado! Sua assinatura será ativada em instantes.");
    const t = setInterval(() => refetch(), 2000);
    const stop = setTimeout(() => clearInterval(t), 30000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [search.checkout, refetch]);

  useEffect(() => {
    if (search.checkout !== "success" || !info.isActive) return;
    metaPixelTrackOnce("Purchase", {
      value: (info.billing?.monthlyCents ?? 0) / 100,
      currency: "BRL",
    });
  }, [search.checkout, info.isActive, info.billing?.monthlyCents]);

  // Volta do cadastro do cartão (conta isenta): confere o cartão e atualiza a tela.
  useEffect(() => {
    if (search.card !== "ok") return;
    let alive = true;
    refreshCardFn({ data: { ownerId } })
      .then((r) => {
        if (!alive) return;
        if (r.status === "ok") toast.success("Cartão verificado!");
        else toast.error("O cartão foi recusado. Tente outro cartão.");
      })
      .catch(() => undefined)
      .finally(() => {
        void qc.invalidateQueries({ queryKey: ["my-subscription"] });
        void qc.invalidateQueries({ queryKey: ["account-payment-method"] });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.card]);

  const hasStripe = info.hasStripeBilling;
  // Conta isenta tem a mesma tela da paga; só o cartão é guardado fora de uma assinatura.
  const showFull = hasStripe || info.isExempt;
  const payments = useQuery({
    queryKey: ["my-payments", ownerId],
    // Reabrir a aba reaproveita o cache: sem quadro vazio antes do cartão/pagamentos reais.
    staleTime: 5 * 60 * 1000,
    queryFn: () => paymentsFn({ data: { ownerId } }),
    enabled: showFull,
  });
  const paymentMethod = useQuery({
    queryKey: ["account-payment-method", ownerId],
    // Reabrir a aba reaproveita o cache: sem quadro vazio antes do cartão/pagamentos reais.
    staleTime: 5 * 60 * 1000,
    queryFn: () => pmFn({ data: { ownerId } }),
    enabled: showFull,
  });

  async function openPortal() {
    setBusy(true);
    try {
      const res = await portalFn({ data: { ownerId, returnPath: "/admin/assinatura" } });
      window.location.href = res.url;
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Erro ao abrir o gerenciamento do cartão"));
      setBusy(false);
    }
  }

  async function openCardSetup() {
    setBusy(true);
    try {
      const res = await cardSetupFn({
        data: { ownerId, returnPath: "/admin/administrativo?tab=perfil" },
      });
      window.location.href = res.url;
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Não foi possível abrir o cadastro do cartão"));
      setBusy(false);
    }
  }

  /** Janela do sistema (Stripe Elements) quando há chave pública; senão, o caminho antigo pela página da Stripe. */
  function openCard() {
    if (STRIPE_PUBLISHABLE_KEY) setCardOpen(true);
    else if (info.isExempt) void openCardSetup();
    else void openPortal();
  }

  async function subscribe() {
    setBusy(true);
    try {
      metaPixelTrack("InitiateCheckout", {
        content_name: "conciergeia_por_anuncio",
        currency: "BRL",
      });
      const res = await checkoutFn({ data: { ownerId, returnPath: "/admin/assinatura" } });
      window.location.href = res.url;
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Não foi possível abrir o pagamento"));
      setBusy(false);
    }
  }

  const view = buildAssinatura(info, payments.data?.payments ?? []);
  const pm = paymentMethod.data?.paymentMethod ?? null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-[10px]">
      {/* Dentro do Administrativo o cabeçalho da página já diz "Assinatura" (sem título repetido, 08/11/2026). */}
      {!embedded && (
        <div className="hidden lg:block">
          <PageHeader title="Assinatura" subtitle="Cobrança por imóvel, cartão e pagamentos." />
        </div>
      )}

      {isPending ? (
        <AssinaturaSkeleton />
      ) : isError ? (
        <section
          className={`${PANEL_SHELL} flex flex-col items-center gap-3 px-4 py-5 text-center`}
        >
          <p className="text-[13px] text-muted-foreground">
            Não foi possível carregar sua assinatura.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex h-9 items-center rounded-full border border-border/70 bg-card px-4 text-xs font-semibold"
          >
            Tentar novamente
          </button>
        </section>
      ) : showFull ? (
        <>
          <AssinaturaMobile view={view} paymentMethod={pm} onOpenPortal={openCard} busy={busy} />
          <AssinaturaDesktop view={view} paymentMethod={pm} onOpenPortal={openCard} busy={busy} />
          <CardSetupDialog
            open={cardOpen}
            onOpenChange={setCardOpen}
            ownerId={ownerId}
            hasCard={!!pm}
          />
        </>
      ) : (
        <section className={`${PANEL_SHELL} flex flex-col gap-4 px-4 pb-4 pt-5`}>
          <div className="text-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Sem Assinatura Ativa
            </div>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-[1.5] text-muted-foreground">
              Um plano com tudo incluso, cobrado por anúncio conectado. Vencimento todo dia{" "}
              {BILLING_ANCHOR_DAY}; na contratação você paga só os dias até o dia{" "}
              {BILLING_ANCHOR_DAY}.
            </p>
          </div>
          <PriceBands highlight={view.qtd || undefined} />
          <button
            type="button"
            onClick={subscribe}
            disabled={busy}
            className="mx-auto inline-flex h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-br from-brand-purple to-brand-magenta px-6 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            Cadastrar cartão e assinar
          </button>
        </section>
      )}
    </div>
  );
}

/** Casca do card de assinatura enquanto a primeira resposta não chega (sem flash do "Sem Assinatura Ativa"). */
function AssinaturaSkeleton() {
  return (
    <section
      aria-busy
      aria-label="Carregando assinatura"
      className={`${PANEL_SHELL} flex flex-col gap-4 px-4 pb-4 pt-5`}
    >
      <div className="flex flex-col items-center gap-2">
        <Skeleton className="h-[10px] w-28 rounded-[3px]" />
        <Skeleton className="h-[13px] w-full max-w-md rounded-[4px]" />
        <Skeleton className="h-[13px] w-2/3 max-w-sm rounded-[4px]" />
      </div>
      <Skeleton className="h-28 w-full rounded-[12px]" />
      <Skeleton className="mx-auto h-11 w-56 max-w-full rounded-full" />
    </section>
  );
}
