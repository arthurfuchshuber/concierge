import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, LayoutDashboard, Settings2, Menu, Users, Shield, ShieldCheck, Activity, Star, Headphones, Home, Contact, BrainCircuit, Sparkles } from "lucide-react";
import conciergeLogo from "@/assets/concierge-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useSubscription } from "@/hooks/useSubscription";
import { OnboardingCheckout } from "@/components/OnboardingCheckout";
import { ClientSwitcher } from "@/components/admin/ClientSwitcher";
import { AccountSwitcher } from "@/components/admin/AccountSwitcher";
import { FloatingHandoffDock } from "@/components/handoff/FloatingHandoffDock";
import { PushNotificationBanner } from "@/components/PushNotificationBanner";
import { getAtendimentoAccess, countPendingHandoffs } from "@/lib/handoff.functions";
import { listMyAccounts } from "@/lib/active-account.functions";
import { PendingInviteDialog } from "@/components/admin/PendingInviteDialog";
import { CompleteProfileDialog } from "@/components/admin/CompleteProfileDialog";
import { listMyPendingInvites } from "@/lib/pending-invites.functions";


export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

const baseNav = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: false },
  { to: "/admin/guias", label: "Guias", icon: Home, exact: false },
  { to: "/admin/stakeholders", label: "Stakeholders", icon: Contact, exact: false },
  { to: "/admin/ia", label: "IA Concierge", icon: BrainCircuit, exact: false },
  
] as const;
const adminOnlyNav = [
  { to: "/admin/engajamento", label: "Engajamento", icon: Activity, exact: false },
  { to: "/admin/clientes", label: "Clientes", icon: Users, exact: false },
  { to: "/admin/recomendacoes-sigma", label: "Recomendações", icon: Star, exact: false },
  { to: "/admin/inteligencia", label: "Inteligência", icon: Sparkles, exact: false },

  { to: "/admin/admins", label: "Administradores", icon: ShieldCheck, exact: false },
] as const;

function AdminLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [email, setEmail] = useState<string>("");
  const [open, setOpen] = useState(false);
  const accessFn = useServerFn(getAtendimentoAccess);
  const pendingFn = useServerFn(countPendingHandoffs);
  const access = useQuery({
    queryKey: ["handoff-access"],
    queryFn: async () => {
      try { return await accessFn(); } catch { return { allowed: false as const, as: null, plan: null }; }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const pending = useQuery({
    queryKey: ["handoff-pending-count"],
    queryFn: async () => {
      try { return await pendingFn(); } catch { return { count: 0 }; }
    },
    enabled: access.data?.allowed === true,
    refetchInterval: 15_000,
    retry: false,
  });

  const handoffEnabled = access.data?.allowed === true;
  const nav = handoffEnabled
    ? ([
        ...baseNav,
        { to: "/admin/atendimento", label: "Atendimento", icon: Headphones, exact: false, badge: pending.data?.count ?? 0 },
        { to: "/admin/administrativo", label: "Administrativo", icon: Settings2, exact: false },
      ] as const)
    : ([
        ...baseNav,
        { to: "/admin/administrativo", label: "Administrativo", icon: Settings2, exact: false },
      ] as const);

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

  // Team members of another owner's account don't need their own plan — they
  // ride on the owner's subscription. Skip the OnboardingCheckout gate for them.
  const accountsFn = useServerFn(listMyAccounts);
  const myAccounts = useQuery({
    queryKey: ["my-accounts"],
    queryFn: async () => {
      try { return await accountsFn(); } catch { return { accounts: [], ownsProperties: false }; }
    },
    staleTime: 60_000,
    retry: false,
  });
  const isTeamMember = (myAccounts.data?.accounts?.length ?? 0) > 0;

  // Pending invites addressed to this user's e-mail — popup blocks the UI
  // until they accept or decline.
  const invitesFn = useServerFn(listMyPendingInvites);
  const pendingInvites = useQuery({
    queryKey: ["my-pending-invites"],
    queryFn: async () => {
      try { return await invitesFn(); } catch { return []; }
    },
    staleTime: 30_000,
    retry: false,
  });
  const hasPendingInvite = (pendingInvites.data?.length ?? 0) > 0;

  const allowedWithoutPlan =
    pathname.startsWith("/admin/engajamento") ||
    pathname.startsWith("/admin/hospedes") ||
    pathname.startsWith("/admin/stakeholders") ||
    pathname.startsWith("/admin/clientes") ||
    pathname.startsWith("/admin/taxonomia") ||
    pathname.startsWith("/admin/recomendacoes-sigma") ||
    pathname.startsWith("/admin/inteligencia") ||

    pathname.startsWith("/admin/admins");
  // Rule: without an invite in play AND without being a team member, the user
  // can only see the panel after completing the account creation + validation
  // (CPF/CNPJ + plan) flow inside OnboardingCheckout.
  const needsPlan =
    !subLoading && !adminLoading && !myAccounts.isLoading &&
    !sub.plan && !allowedWithoutPlan && !isAdmin && !isTeamMember && !hasPendingInvite;


  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-72 shrink-0 border-r border-border bg-surface flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="px-6 py-6 border-b border-border">
          <Link to="/admin" className="inline-flex items-center gap-2.5">
            <img src={conciergeLogo} alt="ConciergeIA" className="size-10 rounded-xl object-contain" />
            <div className="font-display text-xl leading-none">ConciergeIA</div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 pb-8 space-y-1 overflow-y-auto min-h-0">
          {isAdmin ? (
            <div className="px-1 pb-3 mb-2 border-b border-border/60">
              <ClientSwitcher />
            </div>
          ) : (
            <div className="px-1 pb-3 mb-2 border-b border-border/60">
              <AccountSwitcher />
            </div>
          )}
          {nav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            const badge = ("badge" in item ? item.badge : 0) ?? 0;
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
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold grid place-items-center">
                    {badge}
                  </span>
                )}
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
          <Link to="/admin" className="inline-flex items-center gap-2.5">
            <img src={conciergeLogo} alt="ConciergeIA" className="size-10 rounded-lg object-contain shrink-0" />
            <span className="font-display text-xl leading-none">ConciergeIA</span>
          </Link>
          <div className="size-9" />
        </header>

        <main className="flex-1">
          <PushNotificationBanner />
          {needsPlan ? (
            <OnboardingCheckout onSignOut={signOut} />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
      {handoffEnabled && !pathname.startsWith("/admin/atendimento") && <FloatingHandoffDock />}
      <PendingInviteDialog />
      <CompleteProfileDialog />
    </div>

  );
}
