import { friendlyErrorMessage } from "@/lib/friendly-error";
import { useEffect, useState } from "react";
import { CreditCard, Loader2, ShieldCheck, ArrowLeft, BadgeCheck, AlertTriangle, Lock } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatCPF, formatCNPJ, onlyDigits } from "@/lib/masks";
import { validateTaxId, type TaxIdCheck } from "@/lib/tax-id.functions";
import { createCheckoutSession, getAccountBilling } from "@/lib/billing/billing.functions";
import { BILLING_ANCHOR_DAY, monthlyTotalCents, nextBillingAnchor, proratedCents } from "@/lib/billing/listing-billing";
import { PRICE_BANDS } from "@/components/pricing/ListingPricing";

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
const ddmm = (sec: number) => {
  const d = new Date((sec - 3 * 3600) * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

type DocKind = "cpf" | "cnpj";

export function OnboardingCheckout({ onSignOut }: { onSignOut?: () => void }) {
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [opening, setOpening] = useState(false);
  const [checkoutFailed, setCheckoutFailed] = useState(false);
  const checkoutFn = useServerFn(createCheckoutSession);
  const billingFn = useServerFn(getAccountBilling);

  // Etapa 1 (documento) → Etapa 2 (cartão).
  const [step, setStep] = useState<1 | 2>(1);
  const [docKind, setDocKind] = useState<DocKind>("cpf");
  const [docValue, setDocValue] = useState("");
  const [validating, setValidating] = useState(false);
  const [docCheck, setDocCheck] = useState<TaxIdCheck | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ id: data.user.id, email: data.user.email ?? null });
        // Prefill se já houver documento salvo no profile.
        supabase
          .from("profiles")
          .select("cpf")
          .eq("id", data.user.id)
          .maybeSingle()
          .then(({ data: p }) => {
            const d = onlyDigits(p?.cpf ?? "");
            if (d.length === 11) {
              setDocKind("cpf");
              setDocValue(formatCPF(d));
            } else if (d.length === 14) {
              setDocKind("cnpj");
              setDocValue(formatCNPJ(d));
            }
          });
      }
    });
  }, []);

  // Condição comercial já combinada com o admin (carência/cortesia), se houver.
  const billing = useQuery({
    queryKey: ["onboarding-billing", user?.id],
    enabled: !!user && step === 2,
    queryFn: () => billingFn({ data: {} }),
    retry: false,
  });
  const b = billing.data?.billing;
  const nowSec = Math.floor(Date.now() / 1000);
  const anchor = nextBillingAnchor(nowSec);
  const prevAnchor = Math.floor(Date.UTC(new Date(anchor * 1000).getUTCFullYear(), new Date(anchor * 1000).getUTCMonth() - 1, 25, 3) / 1000);
  const todayCents = b?.courtesy || b?.courtesyUntil ? 0 : proratedCents(b?.monthlyCents || monthlyTotalCents(1), nowSec, prevAnchor, anchor);

  const maskedDoc = docKind === "cpf" ? formatCPF(docValue) : formatCNPJ(docValue);
  const requiredLen = docKind === "cpf" ? 11 : 14;
  const canValidate = onlyDigits(docValue).length === requiredLen && !!user;

  function switchKind(kind: DocKind) {
    setDocKind(kind);
    setDocValue("");
    setDocCheck(null);
    setDocError(null);
  }

  async function validateAndContinue() {
    if (!user || !canValidate) return;
    setValidating(true);
    setDocError(null);
    setDocCheck(null);
    try {
      const result = await validateTaxId({ data: { value: onlyDigits(docValue) } });
      setDocCheck(result);
      if (!result.ok) {
        setDocError(result.error ?? "Documento inválido.");
        return;
      }
      // Persiste no profile antes de avançar.
      const { error: upErr } = await supabase
        .from("profiles")
        .update({ cpf: result.digits })
        .eq("id", user.id);
      if (upErr) {
        if ((upErr as { code?: string }).code === "23505") {
          setDocError(
            `Este ${result.kind === "cnpj" ? "CNPJ" : "CPF"} já está cadastrado em outra conta. Cada painel precisa ter um documento único.`,
          );
        } else {
          setDocError(upErr.message);
        }
        return;
      }
      setStep(2);
    } catch (e) {
      setDocError(friendlyErrorMessage(e, "Não foi possível validar agora."));
    } finally {
      setValidating(false);
    }
  }

  async function goToCheckout() {
    if (!user || !docCheck?.ok) return;
    setCheckoutFailed(false);
    setOpening(true);
    try {
      const { url } = await checkoutFn({ data: { returnPath: "/admin" } });
      window.location.href = url;
    } catch (e) {
      setCheckoutFailed(true);
      const { toast } = await import("sonner");
      toast.error(friendlyErrorMessage(e, "Não foi possível abrir o pagamento"));
      setOpening(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex justify-center px-4 sm:px-6 py-8 sm:py-12 bg-background">
      <div className="w-full max-w-5xl">
        <div className="flex flex-col items-center text-center mb-6 sm:mb-8">
          <div className="size-16 rounded-2xl bg-gradient-to-br from-brand-purple to-brand-magenta grid place-items-center text-white font-display text-2xl font-bold shadow-lg mb-5">
            C
          </div>

          <p className="ds-eyebrow text-accent">
            Etapa {step} de 2
          </p>
          <h1 className="ds-page-title mt-1">
            {step === 1 ? "Confirme seu documento" : "Cadastre seu cartão"}
          </h1>
          <p className="ds-body text-muted-foreground mt-2 max-w-lg mx-auto">
            {step === 1
              ? "Usamos isso pra identificar sua conta com segurança. Cada CPF/CNPJ só pode ter uma conta."
              : `Um plano com tudo incluso, cobrado por anúncio conectado. Vencimento todo dia ${BILLING_ANCHOR_DAY}.`}
          </p>
        </div>

        {step === 1 ? (
          <div className="max-w-md mx-auto ds-surface border border-border bg-card p-5 sm:p-6">
            <div className="grid grid-cols-2 gap-2 mb-4">
              {(["cpf", "cnpj"] as DocKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => switchKind(k)}
                  className={`h-11 rounded-full text-sm font-semibold transition-all ${
                    docKind === k
                      ? "bg-gradient-to-br from-brand-purple to-brand-magenta text-white shadow-sm"
                      : "border border-border text-muted-foreground hover:border-foreground/40"
                  }`}
                >
                  {k.toUpperCase()}
                </button>
              ))}
            </div>

            <label className="ds-meta">
              Número do {docKind === "cpf" ? "CPF" : "CNPJ"}
            </label>
            <input
              inputMode="numeric"
              autoComplete="off"
              value={maskedDoc}
              onChange={(e) => {
                setDocValue(e.target.value);
                setDocCheck(null);
                setDocError(null);
              }}
              placeholder={docKind === "cpf" ? "000.000.000-00" : "00.000.000/0000-00"}
              className="mt-1 w-full ds-surface border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground"
            />

            {docError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{docError}</p>
            )}
            {docCheck?.ok && (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                <BadgeCheck className="size-3.5" /> Documento válido
                {docCheck.name ? ` · ${docCheck.name}` : ""}
                {docCheck.status ? ` · ${docCheck.status}` : ""}
              </p>
            )}

            <p className="mt-3 text-[11px] text-muted-foreground">
              {docKind === "cnpj"
                ? "Validamos direto na Receita Federal (situação cadastral)."
                : "Validamos os dígitos verificadores oficiais da Receita Federal."}
            </p>

            <button
              onClick={validateAndContinue}
              disabled={!canValidate || validating}
              className="mt-4 w-full h-11 rounded-full bg-gradient-to-br from-brand-purple to-brand-magenta text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-opacity"
            >
              {validating ? (
                <><Loader2 className="size-4 animate-spin" /> Validando na Receita…</>
              ) : (
                <>Continuar</>
              )}
            </button>

            {onSignOut && (
              <button
                onClick={onSignOut}
                className="mt-3 w-full text-[11px] text-muted-foreground hover:text-foreground underline"
              >
                Sair / trocar de conta
              </button>
            )}
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-5 lg:gap-6">
            {/* Tabela por anúncio */}
            <div className="space-y-1.5">
              <button
                onClick={() => setStep(1)}
                className="ds-eyebrow text-accent hover:opacity-80 inline-flex items-center gap-1 mb-1"
              >
                <ArrowLeft className="size-3" /> Voltar
              </button>
              <div className="ds-surface border border-border bg-card px-4">
                {PRICE_BANDS.map((band, i) => (
                  <div key={band.label} className={`flex min-w-0 items-center gap-3 py-3 ${i ? "border-t border-border" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="ds-card-title truncate">{band.label}</div>
                      <p className="ds-meta">{band.note}</p>
                    </div>
                    <span className="whitespace-nowrap font-display text-[15px] font-bold tabular-nums">R$ {band.unit}</span>
                  </div>
                ))}
              </div>
              <div className="ds-meta flex items-center gap-1.5 px-1 pt-1.5">
                <ShieldCheck className="size-3.5" /> Tudo incluso · anúncio desativado deixa de ser cobrado
              </div>
              {onSignOut && (
                <button
                  onClick={onSignOut}
                  className="block text-[11px] text-muted-foreground hover:text-foreground underline px-1"
                >
                  Sair / trocar de conta
                </button>
              )}
            </div>

            {/* Pagamento */}
            <div className="ds-surface border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="size-4 text-muted-foreground" />
                  <span className="ds-card-title">Pagamento</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">{b?.courtesy ? "Cortesia" : "R$ 119/anúncio"}</span>
              </div>

              {docCheck?.ok && (
                <div className="ds-surface bg-background border border-border p-3 mb-3 text-xs flex items-start gap-2">
                  <BadgeCheck className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {docCheck.kind === "cpf" ? "CPF" : "CNPJ"} confirmado: {docCheck.formatted}
                    </p>
                    {docCheck.name && (
                      <p className="text-muted-foreground truncate">
                        {docCheck.name}{docCheck.status ? ` · ${docCheck.status}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="ds-surface bg-background border border-border p-3 mb-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-foreground">Cobrança de hoje</span>
                  <span className="font-display text-[15px] font-bold tabular-nums">{brl(todayCents)}</span>
                </div>
                <p className="text-muted-foreground mt-1">
                  {b?.courtesy
                    ? "Sua conta tem cortesia total combinada com a ConciergeIA. O cartão fica salvo e nada é cobrado."
                    : b?.courtesyUntil
                      ? `Carência combinada até ${new Date(b.courtesyUntil).toLocaleDateString("pt-BR")}. O cartão fica salvo e a primeira cobrança é nessa data.`
                      : `Proporcional de hoje até ${ddmm(anchor)}. Depois, todo dia ${BILLING_ANCHOR_DAY}, o valor dos seus anúncios ativos (mínimo R$ 357).`}
                </p>
              </div>

              <button
                onClick={goToCheckout}
                disabled={!user || opening}
                className="w-full h-11 rounded-full bg-gradient-to-br from-brand-purple to-brand-magenta text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-opacity"
              >
                {opening ? (
                  <><Loader2 className="size-4 animate-spin" /> Abrindo pagamento…</>
                ) : (
                  <><Lock className="size-4" /> Cadastrar cartão e assinar</>
                )}
              </button>
              <p className="ds-meta mt-2 text-center">
                Você vai para a página segura da Stripe. O cartão de crédito é obrigatório.
              </p>

              {checkoutFailed && (
                <div className="ds-surface border border-amber-500/40 bg-amber-500/[0.06] p-3.5 mt-3 text-xs">
                  <p className="font-medium text-foreground inline-flex items-center gap-1.5">
                    <AlertTriangle className="size-4 text-amber-500 shrink-0" />
                    O pagamento está indisponível no momento
                  </p>
                  <p className="text-muted-foreground mt-1">
                    Sua conta e seus dados já estão salvos. Tente de novo em alguns minutos.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={goToCheckout}
                      className="h-9 rounded-full border border-border px-4 text-xs font-semibold hover:border-foreground/40"
                    >
                      Tentar de novo
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            <span className="text-xs font-semibold uppercase tracking-wider">Pagamento seguro · vencimento todo dia {BILLING_ANCHOR_DAY}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
