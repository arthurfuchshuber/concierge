import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { MessageCircle, Sparkles, Zap, ShieldCheck } from "lucide-react";
import conciergeLogo from "@/assets/concierge-logo.png";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//") ? s.next : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Entrar — ConciergeIA" },
      { name: "description", content: "Acesse o ConciergeIA e automatize o atendimento aos seus hóspedes com IA." },
      { property: "og:title", content: "Entrar — ConciergeIA" },
      { property: "og:description", content: "Acesse o ConciergeIA e automatize o atendimento aos seus hóspedes com IA." },
      { property: "og:url", content: "/auth" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "canonical", href: "/auth" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const postAuthTo = next ?? "/admin";
  const postAuthAbsolute = () =>
    typeof window !== "undefined" ? `${window.location.origin}${postAuthTo}` : postAuthTo;
  const goPostAuth = () => {
    if (next) window.location.href = postAuthTo;
    else navigate({ to: "/admin" });
  };
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) goPostAuth();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: postAuthAbsolute() },
        });
        if (error) throw error;
        toast.success("Conta criada! Verifique seu email para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        try {
          const { recordClientEvent } = await import("@/lib/audit.functions");
          await recordClientEvent({
            data: {
              eventType: "login_success",
              eventCategory: "AUTHENTICATION",
              description: "Login por e-mail e senha.",
            },
          });
        } catch { /* auditoria nunca bloqueia o login */ }
        goPostAuth();

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
        redirect_uri: postAuthAbsolute(),
        extraParams: { prompt: "select_account" },
      });
      if (result.error) { toast.error("Erro com Google. Tente novamente."); return; }
      if (result.redirected) return;
      goPostAuth();
    } finally { setLoading(false); }
  }

  async function handleApple() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("apple", { redirect_uri: postAuthAbsolute() });
      if (result.error) { toast.error("Erro com Apple. Tente novamente."); return; }
      if (result.redirected) return;
      goPostAuth();
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#FDF9F2" }}>
      <header className="px-6 py-5 max-w-6xl mx-auto w-full">
        <Link to="/" className="inline-flex items-center gap-2.5">
          <img src={conciergeLogo} alt="ConciergeIA" className="size-9 object-contain" />
          <span className="font-display text-xl text-black">ConciergeIA</span>
        </Link>
      </header>

      <main className="flex-1 grid lg:grid-cols-2 gap-10 items-center max-w-6xl mx-auto w-full px-6 pb-16">
        {/* Ilustração / side visual — só desktop */}
        <aside className="hidden lg:flex flex-col gap-6 pr-8">
          <div
            className="rounded-3xl p-8 text-white shadow-xl"
            style={{ background: "linear-gradient(135deg, #7C1AD8 0%, #E82DAE 100%)" }}
          >
            <div className="flex items-center gap-2 text-white/90 text-xs uppercase tracking-[0.2em] font-semibold">
              <Sparkles className="size-4" /> IA que atende por você
            </div>
            <h2 className="mt-4 font-display text-3xl leading-tight">
              Seus hóspedes tirando dúvidas às 3h da manhã?
            </h2>
            <p className="mt-3 text-white/90 text-sm leading-relaxed">
              O ConciergeIA responde em segundos, no idioma do hóspede, com o tom da sua marca.
            </p>

            {/* Mini mockup de chat */}
            <div className="mt-6 rounded-2xl bg-white/10 backdrop-blur p-4 border border-white/20 space-y-2.5">
              <div className="flex justify-end">
                <div className="bg-white text-black text-[13px] rounded-2xl rounded-br-sm px-3 py-2 max-w-[80%] shadow">
                  Qual o wifi da casa?
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="size-7 rounded-full bg-white/95 grid place-items-center shrink-0">
                  <img src={conciergeLogo} alt="" className="size-5 object-contain" />
                </div>
                <div className="bg-black/40 text-white text-[13px] rounded-2xl rounded-bl-sm px-3 py-2 max-w-[85%]">
                  Claro! O wifi é <b>CasaVerão-2G</b> e a senha <b>bemvindo2026</b>. Precisa de mais alguma coisa? 🌊
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Zap, label: "Respostas em 3s" },
              { icon: MessageCircle, label: "PT · EN · ES" },
              { icon: ShieldCheck, label: "LGPD" },
            ].map((f) => (
              <div key={f.label} className="rounded-2xl bg-white p-4 border border-black/5 shadow-sm">
                <f.icon className="size-5 text-[#7C1AD8]" />
                <div className="mt-2 text-xs font-semibold text-black">{f.label}</div>
              </div>
            ))}
          </div>
        </aside>

        {/* Card de login */}
        <div className="w-full max-w-md mx-auto lg:mx-0 lg:ml-auto bg-white rounded-3xl shadow-xl border border-black/5 p-8 sm:p-10">
          <div className="flex flex-col items-center text-center mb-6 lg:hidden">
            <img src={conciergeLogo} alt="ConciergeIA" className="size-14 object-contain" />
          </div>

          <h1 className="font-display text-[26px] sm:text-3xl text-black text-balance whitespace-nowrap">
            {mode === "signin" ? "Bem-vindo de volta" : "Crie sua conta"}
          </h1>

          <p className="text-sm text-black/60 mt-2 mb-7">
            {mode === "signin" ? "Acesse seu ConciergeIA" : "Comece grátis por 7 dias"}
          </p>

          <Button
            onClick={handleGoogle}
            disabled={loading}
            variant="outline"
            className="w-full rounded-full h-11 border-black/10 bg-white text-black hover:bg-black/5"
          >
            <svg className="size-4 mr-2" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continuar com Google
          </Button>

          <Button
            onClick={handleApple}
            disabled={loading}
            variant="outline"
            className="w-full rounded-full h-11 mt-3 border-black/10 bg-white text-black hover:bg-black/5"
          >
            <svg className="size-4 mr-2" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 12.04c-.03-2.92 2.39-4.33 2.5-4.4-1.36-1.99-3.48-2.26-4.24-2.29-1.81-.18-3.53 1.06-4.45 1.06-.92 0-2.34-1.04-3.85-1.01-1.98.03-3.81 1.15-4.83 2.92-2.06 3.57-.53 8.85 1.48 11.75.98 1.42 2.15 3.02 3.69 2.96 1.48-.06 2.04-.96 3.83-.96 1.79 0 2.29.96 3.86.93 1.59-.03 2.6-1.45 3.57-2.88 1.13-1.65 1.59-3.25 1.62-3.33-.04-.02-3.11-1.19-3.14-4.75zM14.13 3.5c.82-.99 1.37-2.37 1.22-3.74-1.18.05-2.6.78-3.45 1.77-.76.87-1.42 2.27-1.24 3.62 1.31.1 2.65-.66 3.47-1.65z"/></svg>
            Continuar com Apple
          </Button>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-black/10" />
            <span className="text-[10px] uppercase tracking-widest text-black/40">ou</span>
            <div className="flex-1 h-px bg-black/10" />
          </div>

          <form onSubmit={handleEmail} className="space-y-3">
            {mode === "signup" && (
              <div>
                <Label htmlFor="name" className="text-black">Nome</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} className="bg-white border-black/10 text-black" />
              </div>
            )}
            <div>
              <Label htmlFor="email" className="text-black">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} className="bg-white border-black/10 text-black" />
            </div>
            <div>
              <Label htmlFor="password" className="text-black">Senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} maxLength={72} className="bg-white border-black/10 text-black" />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full rounded-full h-11 text-white border-0 shadow-lg hover:opacity-95 transition"
              style={{ background: "linear-gradient(135deg, #7C1AD8 0%, #E82DAE 100%)" }}
            >
              {mode === "signin" ? "Entrar" : "Criar conta grátis"}
            </Button>
          </form>

          <p className="text-xs text-center text-black/60 mt-6">
            {mode === "signin" ? "Novo por aqui?" : "Já tem conta?"}{" "}
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="underline font-semibold text-black"
            >
              {mode === "signin" ? "Crie uma conta" : "Entre"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
