import { useEffect, useMemo, useState } from "react";
import { Check, CreditCard, Loader2, ShieldCheck, Sparkles, ArrowLeft, BadgeCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { PLANS, type PlanKey } from "@/lib/payments.functions";
import { formatCPF, formatCNPJ, onlyDigits } from "@/lib/masks";
import { validateTaxId, type TaxIdCheck } from "@/lib/tax-id.functions";

const PLAN_ORDER: PlanKey[] = ["starter", "pro", "business"];

type DocKind = "cpf" | "cnpj";

export function OnboardingCheckout({ onSignOut }: { onSignOut?: () => void }) {
  const { openCheckout } = usePaddleCheckout();
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [selected, setSelected] = useState<PlanKey>("pro");
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);

  // Etapa 1 (documento) → Etapa 2 (cartão + plano).
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

  const plan = useMemo(() => PLANS[selected], [selected]);

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
      setDocError(e instanceof Error ? e.message : "Não foi possível validar agora.");
    } finally {
      setValidating(false);
    }
  }

  async function openInlineCheckout(target: PlanKey) {
    if (!user || !docCheck?.ok) return;
    setSelected(target);
    setOpening(true);
    setOpened(true);
    try {
      await openCheckout({
        priceId: PLANS[target].priceId,
        customerEmail: user.email ?? undefined,
        customData: {
          userId: user.id,
          taxId: docCheck.digits,
          taxIdKind: docCheck.kind,
        },
        successUrl: `${window.location.origin}/admin?checkout=success`,
        frameTarget: "sigma-onboarding-checkout",
      });
    } catch (e) {
      setOpened(false);
      const { toast } = await import("sonner");
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o checkout");
    } finally {
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
            {step === 1 ? "Confirme seu documento" : "Escolha seu plano"}
          </h1>
          <p className="ds-body text-muted-foreground mt-2 max-w-lg mx-auto">
            {step === 1
              ? "Usamos isso pra identificar sua conta com segurança. Cada CPF/CNPJ só pode ter uma conta."
              : "Pode trocar de plano quando quiser depois."}
          </p>
          {step === 2 && (
            <p className="ds-body mt-1 max-w-lg mx-auto">
              <strong className="text-foreground">Você não será cobrado nos primeiros 7 dias</strong> — cancele
              antes do fim do teste sem nenhum custo.
            </p>
          )}
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
            {/* Plans column */}
            <div className="space-y-1.5">
              <button
                onClick={() => setStep(1)}
                className="ds-eyebrow text-accent hover:opacity-80 inline-flex items-center gap-1 mb-1"
              >
                <ArrowLeft className="size-3" /> Voltar
              </button>
              {PLAN_ORDER.map((key) => {
                const p = PLANS[key];
                const isSel = selected === key;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setSelected(key);
                      if (opened) {
                        // Trocar de plano reabre o checkout com o novo priceId.
                        setOpened(false);
                      }
                    }}
                    className={`relative w-full text-left ds-surface border p-4 transition-all ${
                      isSel
                        ? "border-primary bg-primary/[0.06] shadow-elevated"
                        : "border-border bg-card hover:border-foreground/40"
                    }`}
                  >
                    {key === "pro" && (
                      <span className="absolute -top-2.5 right-4 text-[10px] uppercase tracking-wider font-bold bg-gradient-to-br from-brand-purple to-brand-magenta text-white px-2.5 py-1 rounded-full">
                        Recomendado
                      </span>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="ds-card-title">{p.name}</div>
                      </div>
                    </div>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="text-2xl font-display font-bold">{p.priceLabel}</span>
                      <span className="text-xs text-muted-foreground">/mês</span>
                    </div>
                    <p className="ds-meta mt-1">
                      {p.featureList.slice(0, 3).join(" · ")}
                    </p>
                  </button>
                );
              })}
              <div className="ds-meta flex items-center gap-1.5 px-1 pt-1.5">
                <ShieldCheck className="size-3.5" /> Pagamento seguro · você pode trocar de plano depois
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

            {/* Checkout column */}
            <div className="ds-surface border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="size-4 text-muted-foreground" />
                  <span className="ds-card-title">Pagamento — {plan.name}</span>
                </div>
                <span className="text-sm font-semibold">{plan.priceLabel}/mês</span>
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

              <div className="ds-surface bg-emerald-500/5 border border-emerald-500/20 p-3 mb-3 text-xs flex items-start gap-2">
                <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Sem cobrança nos próximos 7 dias</p>
                  <p className="text-muted-foreground mt-0.5">
                    O cartão é necessário para garantir continuidade, mas só será cobrado depois do período de teste. Cancele antes e nada é debitado.
                  </p>
                </div>
              </div>

              {!opened && (
                <button
                  onClick={() => openInlineCheckout(selected)}
                  disabled={!user || opening}
                  className="w-full h-11 rounded-full bg-gradient-to-br from-brand-purple to-brand-magenta text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-opacity"
                >
                  {opening ? (
                    <><Loader2 className="size-4 animate-spin" /> Abrindo checkout…</>
                  ) : (
                    <><CreditCard className="size-4" /> Continuar para pagamento</>
                  )}
                </button>
              )}

              <div
                id="sigma-onboarding-checkout"
                className={`sigma-onboarding-checkout mt-3 ds-surface ${opened ? "min-h-[500px]" : "hidden"}`}
              />
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-3.5 py-1.5 border border-emerald-500/20">
            <Sparkles className="size-3.5" />
            <span className="text-xs font-semibold uppercase tracking-wider">7 dias grátis · sem cobrança no cadastro</span>
          </div>
        </div>
      </div>
    </div>
  );
}
