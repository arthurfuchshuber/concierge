import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, LayoutDashboard, Settings2, Menu, Users, Shield, ShieldCheck, Activity, Star, Headphones, Bot, Home, Contact, Sparkles, ChevronsLeft, ChevronsRight } from "lucide-react";
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
import { FloatingDock } from "@/components/FloatingDock";
import { PushNotificationBanner } from "@/components/PushNotificationBanner";
import { getAtendimentoAccess, countPendingHandoffs } from "@/lib/handoff.functions";
import { useHasSession } from "@/hooks/useHasSession";
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
  { to: "/admin/ia", label: "IA Concierge", icon: Bot, exact: false },
  
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
  const hasSession = useHasSession();
  const accessFn = useServerFn(getAtendimentoAccess);
  const pendingFn = useServerFn(countPendingHandoffs);
  const access = useQuery({
    queryKey: ["handoff-access"],
    queryFn: async () => {
      try { return await accessFn(); } catch { return { allowed: false as const, as: null, plan: null }; }
    },
    staleTime: 5 * 60_000,
    retry: false,
    enabled: hasSession === true,
  });
  const { impersonation } = useImpersonation();
  const activeAccountId = impersonation?.userId;
  const pending = useQuery({
    queryKey: ["handoff-pending-count", activeAccountId ?? "self"],
    queryFn: async () => {
      try { return await pendingFn({ data: { accountOwnerId: activeAccountId } }); } catch { return { count: 0 }; }
    },
    enabled: hasSession === true && access.data?.allowed === true,
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
  const nav = (awaitingAccountChoice ? [] : navAll)
    .filter((item) => {
      const permission = permissionForPath(item.to);
      return !permission || areaAccess.can(permission);
    });

  /**
   * Barra inferior (mobile): no máximo 5 destinos — Dashboard, Guias,
   * Pessoas, IA e Suporte, como no mockup. "Administrativo" continua na
   * gaveta lateral; 6 itens não cabem numa tela de 390px sem virar rótulo
   * cortado.
   */
  const BOTTOM_NAV_PATHS = [
    "/admin/dashboard",
    "/admin/guias",
    "/admin/stakeholders",
    "/admin/ia",
    "/admin/atendimento",
  ];
  const bottomNav = nav.filter((item) => BOTTOM_NAV_PATHS.includes(item.to));




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

        <nav className="flex-1 px-3 py-4 pb-8 space-y-1.5 overflow-y-auto min-h-0">
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
                /* PADRÃO "A · NOITE" (mockup aprovado, 17/09/2026): item ativo
                   com fundo de marca bem fraco, texto cheio e um traço de
                   gradiente na borda esquerda — em vez do bloco branco que
                   invertia a cor do texto. */
                className={`relative flex items-center gap-3 rounded-xl px-3.5 py-0 h-11 text-sm transition-colors ${collapsed ? "justify-center" : ""} ${
                  active
                    ? "bg-accent/10 font-bold text-foreground"
                    : "font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                {active && !collapsed && (
                  <span
                    aria-hidden
                    className="absolute -left-2 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-gradient-to-b from-[#7C1AD8] to-[#E82DAE]"
                  />
                )}
                <Icon
                  className={`size-4 shrink-0 ${active ? "text-accent" : ""}`}
                  strokeWidth={2}
                />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                {badge > 0 && !collapsed && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-1.5 text-[10px] font-extrabold text-white">
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
                <div className="px-3 pb-2 flex items-center gap-2 ds-eyebrow">
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
                    className={`relative flex items-center gap-3 rounded-xl px-3.5 py-0 h-11 text-sm transition-colors ${collapsed ? "justify-center" : ""} ${
                      active
                        ? "bg-accent/10 font-bold text-foreground"
                        : "font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    }`}
                  >
                    <Icon
                      className={`size-4 shrink-0 ${active ? "text-accent" : ""}`}
                      strokeWidth={2}
                    />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
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
            className={`flex items-center gap-3 rounded-xl border border-border bg-secondary/40 text-sm font-semibold transition-colors hover:bg-secondary ${collapsed ? "size-9 justify-center px-0 py-0" : "h-11 w-full px-3.5"}`}
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
        {/* CABEÇALHO DO CELULAR — padrão "A · Noite" (mockup aprovado,
            17/09/2026): fundo do app com transparência e desfoque, fio de 1px
            embaixo, e o alvo do menu com 44px (o mínimo confortável no dedo).
            Sem cantos arredondados: ele é a borda da tela. */}
        <header className="sticky top-0 z-20 flex h-[60px] items-center justify-between border-b border-border bg-background/85 px-3 backdrop-blur-xl lg:hidden">
          <button
            onClick={() => setOpen(true)}
            className="grid size-11 place-items-center rounded-xl text-foreground transition-colors hover:bg-secondary/60"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </button>
          <Link to="/admin" className="inline-flex items-center gap-2.5">
            <img
              src={conciergeLogo}
              alt="ConciergeIA"
              className="size-9 shrink-0 rounded-lg object-contain"
            />
            <span className="font-display text-[18px] font-bold leading-none tracking-[-0.01em]">
              ConciergeIA
            </span>
          </Link>
          <div className="size-11" />
        </header>

        <main className="flex-1 pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-0">
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
        {!awaitingAccountChoice && bottomNav.length > 0 && (
          <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-20 flex items-stretch justify-around gap-1 border-t border-border bg-background/85 backdrop-blur-xl px-3 pt-2 pb-[max(env(safe-area-inset-bottom),8px)]">
            {bottomNav.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              const Icon = item.icon;
              const badge = ("badge" in item ? item.badge : 0) ?? 0;
              const shortLabel = BOTTOM_NAV_SHORT_LABEL[item.label] ?? item.label;
              return (
                /* PADRÃO "A · NOITE" (mockup aprovado, 17/09/2026): o item
                   ativo ganha um traço de gradiente no topo da barra e uma
                   caixinha com o rosa da marca bem fraco — o emblema cheio
                   virava uma mancha forte demais ao lado dos outros quatro. */
                <Link
                  key={item.label}
                  to={item.to}
                  className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl pt-1"
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute -top-2 h-[3px] w-7 rounded-b-[3px] bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE]"
                    />
                  )}
                  <span
                    className={`grid h-8 w-11 place-items-center rounded-xl ${
                      active ? "bg-accent/15 text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Icon className="size-[18px]" strokeWidth={1.9} />
                  </span>
                  <span
                    className={`max-w-full truncate text-[10.5px] tracking-tight ${
                      active ? "font-extrabold text-foreground" : "font-semibold ds-faint"
                    }`}
                  >
                    {shortLabel}
                  </span>
                  {badge > 0 && (
                    <span className="absolute top-0 right-[18%] grid h-[15px] min-w-[15px] place-items-center rounded-full bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-1 text-[9px] font-extrabold text-white ring-2 ring-background">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        )}


      </div>
      {/* Canto flutuante (07/09/2026): um botão só, que abre "Atendimento" e
          "Assistente". O Assistente vale para TODA a área logada — inclusive
          prestador de limpeza, que não atende hóspede e antes não via botão
          nenhum aqui; é justamente quem mais precisa de "onde eu marco isso?".
          Por isso o FloatingDock não depende da permissão de atendimento: ela
          só decide se o menu tem uma opção ou duas. */}
      {!awaitingAccountChoice && (
        <FloatingDock
          handoffAvailable={
            handoffEnabled &&
            areaAccess.ready &&
            areaAccess.can("tenant.atendimento") &&
            !pathname.startsWith("/admin/atendimento")
          }
          pendingCount={pending.data?.count ?? 0}
        />
      )}
      {handoffEnabled &&
        areaAccess.ready &&
        areaAccess.can("tenant.atendimento") &&
        !awaitingAccountChoice &&
        !pathname.startsWith("/admin/atendimento") && <FloatingHandoffDock launcher={false} />}
      <PendingInviteDialog />
      <CompleteProfileDialog />
      <ForcePasswordChangeDialog />
      <CancellationReviewDialog />

    </div>

  );
}
