import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, LayoutDashboard, Settings2, Menu, Users, Shield, ShieldCheck, Activity, Star, Headphones, Home, Contact, BrainCircuit, Sparkles, ChevronsLeft, ChevronsRight } from "lucide-react";
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
import { ForcePasswordChangeDialog } from "@/components/admin/ForcePasswordChangeDialog";
import { CancellationReviewDialog } from "@/components/stakeholders/CancellationReviewDialog";

import { listMyPendingInvites } from "@/lib/pending-invites.functions";
import { useAreaAccess } from "@/lib/permissions/useAreaAccess";
import { useActiveAccount } from "@/hooks/useActiveAccount";
import { useImpersonation, useImpersonationQuerySync } from "@/hooks/useImpersonation";
import { ROUTE_PERMISSION_LIST, permissionForPath } from "@/lib/permissions/routeAreas";
import { AccessDenied } from "@/components/permissions/AreaGate";
import { Skeleton } from "@/components/ui/skeleton";



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

// Rótulos curtos pro menu inferior mobile — a barra é apertada, então só ali
// (nunca na sidebar desktop nem na gaveta mobile, que têm espaço de sobra)
// usa-se uma versão encurtada do nome real da seção.
const BOTTOM_NAV_SHORT_LABEL: Record<string, string> = {
  "Stakeholders": "Pessoas",
  "IA Concierge": "IA",
  "Atendimento": "Suporte",
  "Administrativo": "Config.",
};

function AdminLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [email, setEmail] = useState<string>("");
  const [open, setOpen] = useState(false);
  // Recolher o menu lateral (só desktop — no mobile o menu já é um overlay
  // que abre/fecha por cima, "recolher" não se aplica lá). Lembra a escolha
  // entre sessões.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("sidebar-collapsed") === "1";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
    } catch {
      // localStorage indisponível (modo privado etc.) — não é crítico.
    }
  }, [collapsed]);
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
  const { impersonation } = useImpersonation();
  const activeAccountId = impersonation?.userId;
  const pending = useQuery({
    queryKey: ["handoff-pending-count", activeAccountId ?? "self"],
    queryFn: async () => {
      try { return await pendingFn({ data: { accountOwnerId: activeAccountId } }); } catch { return { count: 0 }; }
    },
    enabled: access.data?.allowed === true,
    refetchInterval: 15_000,
    retry: false,
  });

  const handoffEnabled = access.data?.allowed === true;
  const areaAccess = useAreaAccess(ROUTE_PERMISSION_LIST);
  // Empresa ativa (auto-seleção para membros) + recarga dos dados ao trocar.
  const { resolving: resolvingAccount, awaitingAccountChoice } = useActiveAccount();
  const navAll = handoffEnabled
    ? ([
        ...baseNav,
        { to: "/admin/atendimento", label: "Atendimento", icon: Headphones, exact: false, badge: pending.data?.count ?? 0 },
        { to: "/admin/administrativo", label: "Administrativo", icon: Settings2, exact: false },
      ] as const)
    : ([
        ...baseNav,
        { to: "/admin/administrativo", label: "Administrativo", icon: Settings2, exact: false },
      ] as const);
  // Admin do SaaS sem conta selecionada: o menu da conta do cliente fica
  // oculto até que ele escolha um cliente no seletor acima.
  const nav = (awaitingAccountChoice ? [] : navAll).filter((item) => {
    const permission = permissionForPath(item.to);
    return !permission || areaAccess.can(permission);
  });
  const routePermission = permissionForPath(pathname);
  useImpersonationQuerySync();

  // Primeiro acesso: se a página atual estiver bloqueada, leva o usuário
  // para a PRIMEIRA página do menu à qual ele tem acesso.
  const firstAllowedPath = nav[0]?.to as string | undefined;
  useEffect(() => {
    if (resolvingAccount || awaitingAccountChoice) return;
    if (!areaAccess.ready) return;
    if (!routePermission) return;
    if (areaAccess.can(routePermission)) return;
    if (!firstAllowedPath || firstAllowedPath === pathname) return;
    navigate({ to: firstAllowedPath, replace: true });
  }, [
    resolvingAccount,
    awaitingAccountChoice,
    areaAccess.ready,
    routePermission,
    firstAllowedPath,
    pathname,
  ]);




  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  async function signOut() {
    try {
      const { recordClientEvent } = await import("@/lib/audit.functions");
      await recordClientEvent({
        data: { eventType: "logout", eventCategory: "AUTHENTICATION", description: "Sessão encerrada pelo usuário." },
      });
    } catch { /* auditoria nunca bloqueia o logout */ }
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true, search: { next: undefined } });
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
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen shrink-0 border-r border-border bg-surface flex flex-col transition-[transform,width] duration-300 ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"} ${collapsed ? "lg:w-[76px]" : "w-72"}`}
      >
        <div className={`relative border-b border-border flex items-center ${collapsed ? "px-4 py-6 justify-center" : "px-6 py-6 justify-between"}`}>
          <Link to="/admin" className="inline-flex items-center gap-2.5 min-w-0">
            <img src={conciergeLogo} alt="ConciergeIA" className="size-10 rounded-xl object-contain shrink-0" />
            {!collapsed && <div className="font-display text-xl leading-none truncate">ConciergeIA</div>}
          </Link>
          {/* Recolher/expandir — só aparece no desktop (lg+); no mobile o
              controle é o botão de hambúrguer que já existia. */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className={`hidden lg:grid size-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0 ${collapsed ? "absolute -right-3 top-7 bg-surface shadow-sm" : ""}`}
          >
            {collapsed ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 pb-8 space-y-1 overflow-y-auto min-h-0">
          {!collapsed && (isAdmin ? (
            <div className="px-1 pb-3 mb-2 border-b border-border/60">
              <ClientSwitcher />
            </div>
          ) : (
            <div className="px-1 pb-3 mb-2 border-b border-border/60">
              <AccountSwitcher />
            </div>
          ))}
          {nav.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const Icon = item.icon;
            const badge = ("badge" in item ? item.badge : 0) ?? 0;
            return (
              <Link
                key={item.label}
                to={item.to}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${collapsed ? "justify-center" : ""} ${
                  active
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "text-foreground/70 hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className="size-4 shrink-0" strokeWidth={2} />
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {badge > 0 && !collapsed && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold grid place-items-center">
                    {badge}
                  </span>
                )}
                {badge > 0 && collapsed && (
                  <span className="absolute ml-6 -mt-5 size-2 rounded-full bg-red-500" aria-hidden />
                )}
              </Link>
            );
          })}

          {isAdmin && (
            <div className="pt-6 mt-2 border-t border-border/60">
              {!collapsed && (
                <div className="px-3 pb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
                  <Shield className="size-3" /> Admin SaaS
                </div>
              )}
              {adminOnlyNav.map((item) => {
                const active = pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${collapsed ? "justify-center" : ""} ${
                      active
                        ? "bg-primary text-primary-foreground font-medium shadow-sm"
                        : "text-foreground/70 hover:bg-secondary hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={2} />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        <div className={`border-t border-border p-3 space-y-2 shrink-0 ${collapsed ? "flex flex-col items-center" : ""}`}>
          <div className={`flex items-center gap-3 px-2 py-1 ${collapsed ? "justify-center px-0" : ""}`}>
            <div className="size-9 rounded-full bg-accent text-accent-foreground grid place-items-center text-xs font-semibold shrink-0">
              {initials}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{email ? "Conectado como" : "Anfitrião"}</div>
                <div className="text-[11px] text-muted-foreground truncate">{email || "—"}</div>
              </div>
            )}
          </div>
          <button
            onClick={signOut}
            title={collapsed ? "Sair / Trocar usuário" : undefined}
            className={`flex items-center gap-3 rounded-xl text-sm font-medium border border-border bg-secondary/40 hover:bg-secondary transition-colors ${collapsed ? "size-9 justify-center px-0 py-0" : "w-full px-3 py-2.5"}`}
          >
            <LogOut className="size-4 shrink-0" strokeWidth={2} />
            {!collapsed && "Sair / Trocar usuário"}
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

        <main className="flex-1 pb-[86px] lg:pb-0">
          <PushNotificationBanner />
          {resolvingAccount || (routePermission && areaAccess.loading) ? (
            <div className="mx-auto w-full max-w-7xl space-y-3 px-4 py-10">
              <Skeleton className="h-10 w-64" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : needsPlan ? (
            <OnboardingCheckout onSignOut={signOut} />

          ) : routePermission && !areaAccess.can(routePermission) ? (
            <AccessDenied reason={areaAccess.reasonFor(routePermission)} />
          ) : (
            <Outlet />
          )}
        </main>

        {/* Menu inferior — só mobile (lg:hidden); desktop usa a sidebar.
            Mesmo padrão visual do menu do guia do hóspede: emblema circular
            com gradiente da marca no item ativo, ícone monocromático nos
            demais. Os itens vêm do mesmo array `nav` já filtrado por
            permissão que alimenta a sidebar — nunca uma lista fixa própria,
            pra não desalinhar do que a pessoa realmente pode acessar. */}
        {!awaitingAccountChoice && nav.length > 0 && (
          <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-20 flex items-stretch justify-around gap-1 border-t border-border bg-background/85 backdrop-blur-xl px-3 pt-2 pb-[max(env(safe-area-inset-bottom),8px)]">
            {nav
              .filter((item) => item.label !== "Atendimento" && item.label !== "Administrativo")
              .map((item) => {

              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              const Icon = item.icon;
              const badge = Number(("badge" in item ? item.badge : 0) ?? 0);

              const shortLabel = BOTTOM_NAV_SHORT_LABEL[item.label] ?? item.label;
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-1.5 rounded-2xl relative"
                >
                  <span
                    className={`size-10 rounded-2xl grid place-items-center ${
                      active
                        ? "bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white shadow-[0_4px_20px_-2px_rgba(232,45,174,0.65)]"
                        : "text-muted-foreground"
                    }`}
                  >
                    <Icon className="size-[18px]" strokeWidth={1.9} />
                  </span>
                  <span
                    className={`ds-1l max-w-full text-[10px] font-bold tracking-tight ${active ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {shortLabel}
                  </span>

                  {badge > 0 && (
                    <span className="absolute top-0 right-[18%] min-w-[15px] h-[15px] px-1 rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white text-[9px] font-bold grid place-items-center ring-2 ring-background">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        )}

      </div>
      {handoffEnabled &&
        areaAccess.ready &&
        areaAccess.can("tenant.atendimento") &&
        !awaitingAccountChoice &&
        !pathname.startsWith("/admin/atendimento") && <FloatingHandoffDock />}
      <PendingInviteDialog />
      <CompleteProfileDialog />
      <ForcePasswordChangeDialog />
      <CancellationReviewDialog />

    </div>

  );
}
