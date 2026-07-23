import { useEffect, useMemo, useState } from "react";
import { Check, CreditCard, Loader2, ShieldCheck, Sparkles, FileText, ArrowLeft, BadgeCheck } from "lucide-react";
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
      await supabase
        .from("profiles")
        .update({ cpf: result.digits })
        .eq("id", user.id);
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
    <div className="min-h-screen w-full grid place-items-center px-4 sm:px-6 py-8 sm:py-10 bg-background">
      <div className="w-full max-w-5xl">
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-3.5 py-1.5 mb-4 border border-emerald-500/20">
            <Sparkles className="size-3.5" />
            <span className="text-xs font-semibold uppercase tracking-wider">7 dias grátis · sem cobrança no cadastro</span>
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl">Vamos ativar sua conta</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
            {step === 1
              ? "Antes do pagamento, precisamos confirmar seu CPF ou CNPJ para emitir a nota corretamente."
              : "Escolha um plano e cadastre o cartão para liberar o painel."}{" "}
            {step === 2 && (
              <>
                <strong className="text-foreground">Você não será cobrado nos primeiros 7 dias</strong> — cancele
                antes do fim do teste sem nenhum custo.
              </>
            )}
          </p>
        </div>

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-6 text-xs">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border ${step === 1 ? "border-foreground bg-card font-medium" : "border-border text-muted-foreground"}`}>
            <span className="size-4 rounded-full bg-foreground text-background grid place-items-center text-[10px]">1</span>
            Documento
          </span>
          <span className="text-muted-foreground">—</span>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border ${step === 2 ? "border-foreground bg-card font-medium" : "border-border text-muted-foreground"}`}>
            <span className={`size-4 rounded-full grid place-items-center text-[10px] ${step === 2 ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}>2</span>
            Plano e pagamento
          </span>
        </div>

        {step === 1 ? (
          <div className="max-w-md mx-auto rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Confirme seu documento</span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {(["cpf", "cnpj"] as DocKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => switchKind(k)}
                  className={`rounded-xl border px-3 py-2.5 text-sm transition-all ${
                    docKind === k
                      ? "border-foreground bg-background font-medium"
                      : "border-border text-muted-foreground hover:border-foreground/40"
                  }`}
                >
                  {k.toUpperCase()}
                </button>
              ))}
            </div>

            <label className="text-xs text-muted-foreground">
              {docKind === "cpf" ? "CPF" : "CNPJ"}
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
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground"
            />

            {docError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{docError}</p>
            )}
            {docCheck?.ok && docCheck.name && (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                <BadgeCheck className="size-3.5" /> {docCheck.name}
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
              className="mt-4 w-full rounded-xl bg-foreground text-background py-3 text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {validating ? (
                <><Loader2 className="size-4 animate-spin" /> Validando na Receita…</>
              ) : (
                <>Validar e continuar</>
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
            <div className="space-y-3">
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
                    className={`w-full text-left rounded-2xl border p-4 transition-all ${
                      isSel
                        ? "border-foreground bg-card shadow-elevated"
                        : "border-border bg-card hover:border-foreground/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-serif text-lg">{p.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xl font-semibold">{p.priceLabel}</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">/mês</div>
                      </div>
                    </div>
                    <ul className="mt-3 space-y-1">
                      {p.featureList.slice(0, 3).map((f) => (
                        <li key={f} className="flex items-start gap-1.5 text-xs">
                          <Check className="size-3 text-accent shrink-0 mt-0.5" strokeWidth={2.5} />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
              <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 px-1">
                <ShieldCheck className="size-3.5" /> Pagamento seguro · você pode trocar de plano depois
              </div>
              <button
                onClick={() => setStep(1)}
                className="text-[11px] text-muted-foreground hover:text-foreground underline px-1 inline-flex items-center gap-1"
              >
                <ArrowLeft className="size-3" /> Alterar documento
              </button>
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
            <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Pagamento — {plan.name}</span>
                </div>
                <span className="text-sm font-semibold">{plan.priceLabel}/mês</span>
              </div>

              {docCheck?.ok && (
                <div className="rounded-xl bg-background border border-border p-3 mb-3 text-xs flex items-start gap-2">
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

              <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 mb-3 text-xs flex items-start gap-2">
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
                  className="w-full rounded-xl bg-foreground text-background py-3 text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {opening ? (
                    <><Loader2 className="size-4 animate-spin" /> Abrindo checkout…</>
                  ) : (
                    <><CreditCard className="size-4" /> Iniciar 7 dias grátis</>
                  )}
                </button>
              )}

              <div
                id="sigma-onboarding-checkout"
                className={`sigma-onboarding-checkout mt-3 rounded-xl ${opened ? "min-h-[500px]" : "hidden"}`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
