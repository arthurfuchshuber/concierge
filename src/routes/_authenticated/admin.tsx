import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Sparkles, LogOut, LayoutDashboard, CreditCard, Menu, Users, Shield, Library, ShieldCheck, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useSubscription } from "@/hooks/useSubscription";
import { OnboardingCheckout } from "@/components/OnboardingCheckout";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

const baseNav = [
  { to: "/admin", label: "Painel", icon: LayoutDashboard, exact: true },
  { to: "/admin/biblioteca", label: "Biblioteca", icon: Library, exact: false },
  { to: "/admin/assinatura", label: "Assinatura", icon: CreditCard, exact: false },
] as const;
const adminOnlyNav = [
  { to: "/admin/engajamento", label: "Engajamento", icon: Activity, exact: false },
  { to: "/admin/clientes", label: "Clientes", icon: Users, exact: false },
  { to: "/admin/admins", label: "Administradores", icon: ShieldCheck, exact: false },
] as const;

function AdminLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isAdmin } = useIsAdmin();
  const [email, setEmail] = useState<string>("");
  const [open, setOpen] = useState(false);
  const nav = baseNav;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const initials = (email || "?").slice(0, 2).toUpperCase();

  const { info: sub, isLoading: subLoading } = useSubscription();
  const allowedWithoutPlan =
    pathname.startsWith("/admin/assinatura") ||
    pathname.startsWith("/admin/engajamento") ||
    pathname.startsWith("/admin/clientes") ||
    pathname.startsWith("/admin/admins");
  const needsPlan = !subLoading && !sub.plan && !allowedWithoutPlan && !isAdmin;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-72 shrink-0 border-r border-border bg-surface flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="px-6 py-6 border-b border-border">
          <Link to="/admin" className="inline-flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-primary grid place-items-center shadow-sm">
              <Sparkles className="size-4 text-primary-foreground" strokeWidth={2} />
            </div>
            <div className="leading-tight">
              <div className="font-serif text-xl">SigmaGuide</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mt-0.5">Painel</div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "text-foreground/70 hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className="size-4" strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}

          {isAdmin && (
            <div className="pt-6 mt-2 border-t border-border/60">
              <div className="px-3 pb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
                <Shield className="size-3" /> Admin SaaS
              </div>
              {adminOnlyNav.map((item) => {
                const active = pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground font-medium shadow-sm"
                        : "text-foreground/70 hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-4" strokeWidth={2} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        <div className="border-t border-border p-3 space-y-2 shrink-0">
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="size-9 rounded-full bg-accent text-accent-foreground grid place-items-center text-xs font-semibold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{email ? "Conectado como" : "Anfitrião"}</div>
              <div className="text-[11px] text-muted-foreground truncate">{email || "—"}</div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium border border-border bg-secondary/40 hover:bg-secondary transition-colors"
          >
            <LogOut className="size-4" strokeWidth={2} />
            Sair / Trocar usuário
          </button>
        </div>
      </aside>

      {/* Backdrop mobile */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-30 bg-black/40" onClick={() => setOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile topbar */}
        <header className="lg:hidden sticky top-0 z-20 glass border-b border-border px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setOpen(true)}
            className="size-9 grid place-items-center rounded-lg hover:bg-secondary"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </button>
          <Link to="/admin" className="inline-flex items-center gap-2">
            <div className="size-7 rounded-lg bg-primary grid place-items-center">
              <Sparkles className="size-3.5 text-primary-foreground" />
            </div>
            <span className="font-serif text-lg">SigmaGuide</span>
          </Link>
          <div className="size-9" />
        </header>

        <main className="flex-1">
          {needsPlan ? (
            <OnboardingCheckout onSignOut={signOut} />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
