import { useEffect, useState } from "react";
import { ACTION_BAR, ACTION_SEGMENT } from "@/components/dashboard/panel-chrome";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Check, Eye, EyeOff, Loader2, Lock } from "lucide-react";

const REQUIREMENTS = [
  { key: "len", label: "Mínimo de 8 caracteres", test: (v: string) => v.length >= 8 },
  {
    key: "case",
    label: "Letra maiúscula e minúscula",
    test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v),
  },
  { key: "num", label: "Um número", test: (v: string) => /\d/.test(v) },
  { key: "sym", label: "Um símbolo (!@#$%*?)", test: (v: string) => /[^A-Za-z0-9]/.test(v) },
] as const;

/**
 * Primeiro acesso com senha provisória: obriga a criação de uma nova senha.
 * Tela cheia (mockup "Primeiro acesso nova senha"): sem fechar, sem atalhos.
 */
export function ForcePasswordChangeDialog() {
  const [required, setRequired] = useState(false);
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const met = REQUIREMENTS.filter((r) => r.test(pwd)).length;
  const allOk = met === REQUIREMENTS.length;
  const matches = confirm.length > 0 && pwd === confirm;
  const [showConfirm, setShowConfirm] = useState(false);

  async function leave() {
    await supabase.auth.signOut();
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setRequired(data.user?.user_metadata?.["must_change_password"] === true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") return setRequired(false);
      setRequired(session?.user?.user_metadata?.["must_change_password"] === true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!allOk) return setError("A senha ainda não cumpre todos os requisitos.");
    if (pwd !== confirm) return setError("As senhas não são iguais.");
    setSaving(true);
    try {
      const { error: err } = await supabase.auth.updateUser({
        password: pwd,
        data: { must_change_password: false },
      });
      if (err) throw new Error(err.message);
      toast.success("Senha criada com sucesso. Bem-vindo(a)!");
      setRequired(false);
      setPwd("");
      setConfirm("");
    } catch (err) {
      setError(
        (err as Error).message.includes("different from the old")
          ? "A nova senha precisa ser diferente da senha provisória."
          : `Não foi possível salvar a senha: ${(err as Error).message}`,
      );
    } finally {
      setSaving(false);
    }
  }

  if (!required) return null;

  const FIELD =
    "flex h-9 items-center gap-2 rounded-lg bg-foreground/[0.04] px-[11px] text-[13px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)] focus-within:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_22%,transparent)]";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-access-title"
      className="fixed inset-0 z-[100] overflow-y-auto bg-background text-foreground"
    >
      <form
        onSubmit={submit}
        className="mx-auto flex min-h-[100dvh] w-full max-w-[420px] flex-col justify-center px-6 py-8"
      >
        <span className="mb-5 grid size-12 place-items-center rounded-[14px] bg-foreground/[0.06] text-foreground shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_12%,transparent),inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
          <Lock className="size-5" />
        </span>
        <p className="ds-eyebrow">Primeiro acesso</p>
        <h2
          id="first-access-title"
          className="mt-2 font-display text-[22px] font-bold leading-[1.15] tracking-[-0.01em]"
        >
          Crie sua nova senha
        </h2>
        <p className="mt-2.5 text-[13px] leading-[1.45] text-muted-foreground">
          Por segurança, defina uma senha só sua para entrar no sistema. Sem isso não é possível
          continuar.
        </p>

        <div className="mt-7 grid gap-3.5">
          <div className="grid gap-1.5">
            <label htmlFor="new-pwd" className="text-[11px] font-bold text-muted-foreground">
              Nova senha
            </label>
            <div className={FIELD}>
              <input
                id="new-pwd"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                autoFocus
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="text-[color:var(--faint)] hover:text-foreground"
                aria-label={show ? "Ocultar senha" : "Mostrar senha"}
              >
                {show ? <EyeOff className="size-[13px]" /> : <Eye className="size-[13px]" />}
              </button>
            </div>
          </div>

          <div className="h-[3px] overflow-hidden rounded-[3px] bg-foreground/[0.08]" aria-hidden>
            <div
              className="h-full bg-gradient-to-r from-[#c9a962] to-[#7fb79a] transition-[width] duration-300"
              style={{ width: `${(met / REQUIREMENTS.length) * 100}%` }}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="confirm-pwd" className="text-[11px] font-bold text-muted-foreground">
              Confirmar nova senha
            </label>
            <div className={FIELD}>
              <input
                id="confirm-pwd"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repita a senha"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[color:var(--faint)]"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="text-[color:var(--faint)] hover:text-foreground"
                aria-label={showConfirm ? "Ocultar senha" : "Mostrar senha"}
              >
                {showConfirm ? <EyeOff className="size-[13px]" /> : <Eye className="size-[13px]" />}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-[18px] grid gap-2" aria-live="polite">
          {REQUIREMENTS.map((r) => {
            const ok = r.test(pwd);
            return (
              <div
                key={r.key}
                className={cn(
                  "flex items-center gap-[9px] text-[12px]",
                  ok ? "text-muted-foreground" : "text-[color:var(--faint)]",
                )}
              >
                <i
                  className={cn(
                    "grid size-3.5 shrink-0 place-items-center rounded-full",
                    ok
                      ? "bg-[#7fb79a] text-background"
                      : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_20%,transparent)]",
                  )}
                >
                  {ok && <Check className="size-[9px]" strokeWidth={3.4} />}
                </i>
                {r.label}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-3 text-[12px] leading-relaxed text-destructive">{error}</p>}

        <div className={`${ACTION_BAR} !mt-7 !h-11 !w-full !rounded-[13px]`}>
          <button
            type="submit"
            disabled={saving || !allOk || !matches}
            className={`${ACTION_SEGMENT} !w-auto !flex-1 text-[13px] text-foreground disabled:opacity-50`}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Definir senha e entrar"}
          </button>
        </div>

        <p className="mt-4 text-center text-[11.5px] leading-[1.45] text-[color:var(--faint)]">
          Entrou com outra conta?{" "}
          <button
            type="button"
            onClick={leave}
            className="font-bold text-muted-foreground hover:text-foreground"
          >
            Sair
          </button>
        </p>
      </form>
    </div>
  );
}
