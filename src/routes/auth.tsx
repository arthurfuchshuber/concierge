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
    next:
      typeof s.next === "string" &&
      /^\/(?![/\\])[^\\\s]*$/.test(s.next) &&
      !/[\u0000-\u001f]/.test(s.next)
        ? s.next
        : undefined,
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
    if (next) {
      // Só navega se o destino resolver na mesma origem.
      try {
        const u = new URL(postAuthTo, window.location.origin);
        if (u.origin === window.location.origin) {
          window.location.href = u.pathname + u.search + u.hash;
          return;
        }
      } catch {
        /* cai no padrão */
      }
      navigate({ to: "/admin" });
    }
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

  async function handleForgot() {
    const target = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(target)) {
      toast.error("Digite seu e-mail no campo acima e toque de novo em \"Esqueci minha senha\".");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/definir-senha`,
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos.");
      return;
    }
    toast.success("Enviamos um link para criar uma nova senha. Confira seu e-mail (e a caixa de spam).", { duration: 10000 });
  }

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

          {/* Sem whitespace-nowrap: num celular estreito (~360px) com o card
              padded em p-8, "Bem-vindo de volta" em fonte de destaque podia
              ficar maior que o espaço disponível e cortar na margem direita.
              text-balance já deixa a quebra de linha (quando necessária)
              visualmente equilibrada. */}
          <h1 className="font-display text-[26px] sm:text-3xl text-black text-balance">
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
            Continuar com Google
          </Button>

          <Button
            onClick={handleApple}
            disabled={loading}
            variant="outline"
            className="w-full rounded-full h-11 mt-3 border-black/10 bg-white text-black hover:bg-black/5"
          >
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
              {mode === "signin" && (
                <div className="mt-1.5 text-right">
                  <button
                    type="button"
                    onClick={handleForgot}
                    className="text-xs font-semibold text-black/70 underline"
                  >
                    Esqueci minha senha
                  </button>
                </div>
              )}
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
