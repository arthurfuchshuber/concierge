import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { KeyRound, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/definir-senha")({
  ssr: false,
  component: DefinirSenhaPage,
  head: () => ({
    meta: [
      { title: "Criar senha de acesso | ConciergeIA" },
      {
        name: "description",
        content:
          "Defina a sua senha de acesso ao painel do ConciergeIA e comece a gerenciar check-ins, check-outs e o atendimento aos hóspedes.",
      },
      { property: "og:title", content: "Criar senha de acesso | ConciergeIA" },
      {
        property: "og:description",
        content: "Defina a sua senha de acesso ao painel do ConciergeIA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function DefinirSenhaPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setHasSession(!!data.session);
      setReady(true);
    };
    // O Supabase processa o token do link (hash) de forma assíncrona.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) {
        setHasSession(true);
        setReady(true);
      }
    });
    const t = setTimeout(check, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use uma senha com pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As duas senhas não são iguais.");
      return;
    }
    setSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (err) {
      setError(
        err.message.includes("session")
          ? "O link expirou. Peça um novo convite ao titular da conta."
          : err.message,
      );
      return;
    }
    setDone(true);
    setTimeout(() => navigate({ to: "/painel" }), 1400);
  };

  return (
    <main className="min-h-screen grid place-items-center px-4 py-12 bg-background">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
        <div className="px-7 pt-7 pb-5 border-b border-border">
          <div className="size-11 rounded-xl bg-accent/15 text-accent grid place-items-center mb-3">
            <KeyRound className="size-5" strokeWidth={2} />
          </div>
          <h1 className="font-display text-2xl leading-tight">
            Crie a sua senha
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Escolha uma senha para acessar o painel sempre que quiser.
          </p>
        </div>

        <div className="px-7 py-6">
          {!ready && (
            <p className="text-sm text-muted-foreground">Verificando o link…</p>
          )}

          {ready && !hasSession && !done && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Este link de convite expirou ou já foi utilizado. Peça ao
                titular da conta para reenviar o convite.
              </p>
              <a
                href="/auth"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-secondary/60 transition-colors"
              >
                Ir para o login
              </a>
            </div>
          )}

          {ready && hasSession && !done && (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="senha">
                  Nova senha
                </label>
                <input
                  id="senha"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Mínimo de 8 caracteres"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="confirmar">
                  Confirmar senha
                </label>
                <input
                  id="confirmar"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Repita a senha"
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-95 transition-opacity disabled:opacity-50"
              >
                {saving ? "Salvando…" : "Salvar senha e entrar"}
              </button>
            </form>
          )}

          {done && (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="size-5 text-emerald-500 mt-0.5" />
              <p className="text-sm">
                Senha criada! Estamos abrindo o seu painel…
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
