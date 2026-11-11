import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import type {
  Stripe,
  StripeCardCvcElement,
  StripeCardExpiryElement,
  StripeCardNumberElement,
} from "@stripe/stripe-js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createCardSetupIntent, finishCardSetup } from "@/lib/billing/billing.functions";
import { friendlyErrorMessage } from "@/lib/friendly-error";

/**
 * Janela "Cadastrar/Atualizar cartão" (mockup aprovado, 10/11/2026): o formulário da Stripe (Elements)
 * dentro de uma janela do sistema, nas cores do tema. Os dados do cartão vão direto para a Stripe e
 * nunca passam pelos servidores da ConciergeIA. Sem a chave pública configurada, quem chama usa o
 * caminho antigo (página da Stripe).
 */
export const STRIPE_PUBLISHABLE_KEY: string | undefined =
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || undefined;

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!STRIPE_PUBLISHABLE_KEY) return Promise.resolve(null);
  stripePromise ??= import("@stripe/stripe-js").then((m) => m.loadStripe(STRIPE_PUBLISHABLE_KEY));
  return stripePromise;
}

const FIELD =
  "box-border flex h-[42px] items-center rounded-[7px] border border-[var(--input)] bg-foreground/[0.03] px-3 transition-colors focus-within:border-foreground/40";

export function CardSetupDialog({
  open,
  onOpenChange,
  ownerId = null,
  hasCard,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ownerId?: string | null;
  hasCard: boolean;
  onDone?: () => void;
}) {
  const intentFn = useServerFn(createCardSetupIntent);
  const finishFn = useServerFn(finishCardSetup);
  const qc = useQueryClient();
  // Os campos da Stripe são criados uma vez por abertura e "montados" nos contêineres por ref de
  // callback: se a janela refizer o corpo (rolagem/anti-corte) e o contêiner trocar, o campo é
  // montado de novo no contêiner novo em vez de ficar preso num elemento descartado.
  const [numberNode, setNumberNode] = useState<HTMLDivElement | null>(null);
  const [expiryNode, setExpiryNode] = useState<HTMLDivElement | null>(null);
  const [cvcNode, setCvcNode] = useState<HTMLDivElement | null>(null);
  const [session, setSession] = useState<{
    stripe: Stripe;
    clientSecret: string;
    setupIntentId: string;
    number: StripeCardNumberElement;
    expiry: StripeCardExpiryElement;
    cvc: StripeCardCvcElement;
  } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let created: { destroy: () => void }[] = [];
    setError(null);
    setName("");
    (async () => {
      try {
        const [stripe, intent] = await Promise.all([getStripe(), intentFn({ data: { ownerId } })]);
        if (!alive) return;
        if (!stripe) throw new Error("Stripe indisponível.");
        const fontFamily = getComputedStyle(document.body).fontFamily;
        const style = {
          base: {
            fontSize: "13.5px",
            fontFamily,
            color: getComputedStyle(document.body).color,
            "::placeholder": { color: "#8a8a93" },
          },
          invalid: { color: "#e5484d" },
        };
        const elements = stripe.elements({ locale: "pt-BR" });
        const number = elements.create("cardNumber", {
          style,
          showIcon: true,
          placeholder: "1234 1234 1234 1234",
        });
        const expiry = elements.create("cardExpiry", { style, placeholder: "MM / AA" });
        const cvc = elements.create("cardCvc", { style, placeholder: "CVC" });
        created = [number, expiry, cvc];
        setSession({
          stripe,
          clientSecret: intent.clientSecret,
          setupIntentId: intent.setupIntentId,
          number,
          expiry,
          cvc,
        });
      } catch (e) {
        if (alive)
          setError(friendlyErrorMessage(e, "Não foi possível abrir o cadastro do cartão."));
      }
    })();
    return () => {
      alive = false;
      setSession(null);
      for (const el of created) {
        try {
          el.destroy();
        } catch {
          /* já destruído */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ownerId]);

  useMountField(session?.number, numberNode);
  useMountField(session?.expiry, expiryNode);
  useMountField(session?.cvc, cvcNode);
  const ready = !!session;

  async function save() {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await session.stripe.confirmCardSetup(session.clientSecret, {
        payment_method: {
          card: session.number,
          billing_details: { name: name.trim() || undefined },
        },
      });
      if (res.error) {
        setError(res.error.message ?? "Cartão recusado. Tente outro cartão.");
        return;
      }
      await finishFn({ data: { ownerId, setupIntentId: session.setupIntentId } });
      toast.success("Cartão verificado!");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["my-subscription"] }),
        qc.invalidateQueries({ queryKey: ["account-payment-method"] }),
        qc.invalidateQueries({ queryKey: ["my-payments"] }),
      ]);
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      setError(friendlyErrorMessage(e, "Não foi possível salvar o cartão."));
    } finally {
      setBusy(false);
    }
  }

  const title = hasCard ? "Atualizar cartão" : "Cadastrar cartão";
  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent className="max-w-[432px] gap-3.5 p-[18px] pt-[22px]">
        <DialogTitle className="flex items-center gap-2.5 pr-11 font-display text-[19px] font-extrabold leading-[1.2] tracking-[-0.01em]">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]">
            <CreditCard className="size-4" />
          </span>
          {title}
        </DialogTitle>
        <DialogDescription className="text-[12.5px] leading-[1.55]">
          Cadastre um cartão de crédito válido. Ele é verificado na hora, sem nenhuma cobrança.
        </DialogDescription>
        <div className="grid gap-2.5">
          <Label text="Número do cartão">
            <div ref={setNumberNode} className={`${FIELD} [&>*]:w-full`} />
          </Label>
          <div className="grid grid-cols-2 gap-2.5">
            <Label text="Validade">
              <div ref={setExpiryNode} className={`${FIELD} [&>*]:w-full`} />
            </Label>
            <Label text="Código (CVC)">
              <div ref={setCvcNode} className={`${FIELD} [&>*]:w-full`} />
            </Label>
          </div>
          <Label text="Nome no cartão">
            <div className={FIELD}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como está impresso no cartão"
                autoComplete="cc-name"
                className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-[var(--faint)]"
              />
            </div>
          </Label>
        </div>
        {error ? (
          <p role="alert" className="text-[12px] font-medium leading-[1.45] text-[#e5484d]">
            {error}
          </p>
        ) : null}
        <div className="flex items-start gap-[7px] text-[11.5px] leading-[1.45] text-[var(--faint)]">
          <Lock className="mt-px size-[13px] shrink-0 text-[#7fb79a]" />
          <span>Dados protegidos pela Stripe — nunca passam pelos servidores da ConciergeIA.</span>
        </div>
        <div className="grid gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!ready || busy}
            className="flex h-[46px] items-center justify-center gap-2 rounded-md bg-gradient-to-br from-brand-purple to-brand-magenta text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            {busy || !ready ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar cartão
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="flex h-10 items-center justify-center rounded-md bg-foreground/[0.04] text-[12.5px] font-bold text-foreground/85 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)]"
          >
            Cancelar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-[5px] text-[11.5px] font-semibold text-muted-foreground">{text}</div>
      {children}
    </div>
  );
}

/** Monta um campo da Stripe no contêiner e o solta (sem destruir) se o contêiner sair da tela. */
function useMountField(
  el: { mount: (n: HTMLElement) => void; unmount: () => void } | undefined,
  node: HTMLElement | null,
) {
  useEffect(() => {
    if (!el || !node) return;
    el.mount(node);
    return () => {
      try {
        el.unmount();
      } catch {
        /* já solto */
      }
    };
  }, [el, node]);
}
