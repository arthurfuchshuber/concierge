import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";

/**
 * Primeiro acesso com senha provisória: obriga a criação de uma nova senha.
 * Mesmo layout "Glass Editorial" dos popups do guia.
 */
export function ForcePasswordChangeDialog() {
  const [required, setRequired] = useState(false);
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (pwd.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
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

  return (
    <Dialog open modal>
      <DialogPortal>
        <DialogOverlay className="bg-black/75 backdrop-blur-md data-[state=open]:duration-300" />
        <DialogPrimitive.Content
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-1.25rem)] max-w-[440px]",
            "-translate-x-1/2 -translate-y-1/2 max-h-[92vh] overflow-y-auto",
            "rounded-[26px] border border-border bg-card/95 text-card-foreground",
            "backdrop-blur-2xl backdrop-saturate-150",
            "shadow-[0_28px_70px_-18px_rgba(0,0,0,0.65)] p-6 sm:p-7",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:duration-300",
            "focus:outline-none",
          )}
        >
          <div className="mb-5 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-accent">
              Primeiro acesso
            </p>
            <DialogPrimitive.Title className="font-serif text-[24px] leading-[1.1] tracking-tight text-foreground">
              Crie a sua senha
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[13px] leading-relaxed text-muted-foreground">
              Você entrou com uma senha provisória. Defina agora uma senha pessoal para continuar.
            </DialogPrimitive.Description>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="relative">
              <Label htmlFor="new-pwd" className="sr-only">Nova senha</Label>
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
              <Input
                id="new-pwd"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Nova senha (mín. 8 caracteres)"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                className="h-[48px] rounded-[12px] pl-10 pr-10 text-[14.5px]"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={show ? "Ocultar senha" : "Mostrar senha"}
              >
                {show ? <EyeOff className="size-[17px]" /> : <Eye className="size-[17px]" />}
              </button>
            </div>

            <div className="relative">
              <Label htmlFor="confirm-pwd" className="sr-only">Confirmar senha</Label>
              <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
              <Input
                id="confirm-pwd"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repita a nova senha"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-[48px] rounded-[12px] pl-10 pr-3 text-[14.5px]"
              />
            </div>

            {error && (
              <p className="text-[12px] text-destructive leading-relaxed">{error}</p>
            )}

            <div className="flex items-center gap-1.5 pt-0.5 text-[11.5px] text-muted-foreground/85">
              <Lock className="size-3 text-primary/70" />
              Sua senha é pessoal e não fica visível para o titular da conta.
            </div>

            <Button type="submit" disabled={saving} className="group h-[48px] w-full rounded-[12px] text-[14.5px]">
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Salvar e continuar"}
              {!saving && <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />}
            </Button>
          </form>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
