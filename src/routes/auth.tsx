import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//") ? s.next : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Entrar — SigmaConcierge" },
      { name: "description", content: "Acesse sua conta SigmaConcierge para criar e gerenciar guias digitais editoriais para hóspedes." },
      { property: "og:title", content: "Entrar — SigmaConcierge" },
      { property: "og:description", content: "Login do SigmaConcierge para anfitriões." },
      { property: "og:url", content: "/auth" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "/auth" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/admin" });
    });
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: `${window.location.origin}/admin`,
          },
        });
        if (error) throw error;
        toast.success("Conta criada! Verifique seu email para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/admin" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao autenticar");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/admin`,
        extraParams: { prompt: "select_account" },
      });
      if (result.error) {
        toast.error("Erro com Google. Tente novamente.");
        return;
      }
      if (result.redirected) return;
      navigate({ to: "/admin" });
    } finally {
      setLoading(false);
    }
  }

  async function handleApple() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("apple", {
        redirect_uri: `${window.location.origin}/admin`,
      });
      if (result.error) {
        toast.error("Erro com Apple. Tente novamente.");
        return;
      }
      if (result.redirected) return;
      navigate({ to: "/admin" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-6 py-5 max-w-6xl mx-auto w-full">
        <Link to="/" className="inline-flex items-center gap-2">
          <div className="size-8 rounded-xl bg-primary grid place-items-center">
            <Sparkles className="size-4 text-primary-foreground" strokeWidth={2} />
          </div>
          <span className="font-display text-xl">SigmaConcierge</span>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-4xl text-balance">
            {mode === "signin" ? "Bem-vindo de volta" : "Crie sua conta"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 mb-8">
            {mode === "signin" ? "Acesse seus guias" : "Comece a criar guias para seus hóspedes"}
          </p>

          <Button onClick={handleGoogle} disabled={loading} variant="outline" className="w-full rounded-full h-11">
            <svg className="size-4 mr-2" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continuar com Google
          </Button>

          <Button onClick={handleApple} disabled={loading} variant="outline" className="w-full rounded-full h-11 mt-3">
            <svg className="size-4 mr-2" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.04c-.03-2.92 2.39-4.33 2.5-4.4-1.36-1.99-3.48-2.26-4.24-2.29-1.81-.18-3.53 1.06-4.45 1.06-.92 0-2.34-1.04-3.85-1.01-1.98.03-3.81 1.15-4.83 2.92-2.06 3.57-.53 8.85 1.48 11.75.98 1.42 2.15 3.02 3.69 2.96 1.48-.06 2.04-.96 3.83-.96 1.79 0 2.29.96 3.86.93 1.59-.03 2.6-1.45 3.57-2.88 1.13-1.65 1.59-3.25 1.62-3.33-.04-.02-3.11-1.19-3.14-4.75zM14.13 3.5c.82-.99 1.37-2.37 1.22-3.74-1.18.05-2.6.78-3.45 1.77-.76.87-1.42 2.27-1.24 3.62 1.31.1 2.65-.66 3.47-1.65z"/></svg>
            Continuar com Apple
          </Button>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">ou</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={handleEmail} className="space-y-3">
            {mode === "signup" && (
              <div>
                <Label htmlFor="name">Nome</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} />
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} maxLength={72} />
            </div>
            <Button type="submit" disabled={loading} className="w-full rounded-full h-11">
              {mode === "signin" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <p className="text-xs text-center text-muted-foreground mt-6">
            {mode === "signin" ? "Novo por aqui?" : "Já tem conta?"}{" "}
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="underline font-medium text-foreground"
            >
              {mode === "signin" ? "Crie uma conta" : "Entre"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
