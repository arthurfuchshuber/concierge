import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CreditCard, User as UserIcon, Plug } from "lucide-react";
import { AssinaturaPage } from "@/components/admin-pages/AssinaturaPage";
import { MeuPerfilPage } from "@/components/admin-pages/MeuPerfilPage";
import { IntegracoesPage, useIntegrationStatusQueries } from "@/components/admin-pages/IntegracoesPage";
import { useMyPermissions } from "@/hooks/useMyPermissions";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { PageHeader } from "@/components/ds/PageHeader";

type Tab = "perfil" | "assinatura" | "integracoes";

function coerceTab(v: unknown): Tab {
  // A aba "Permissões" foi removida (nova versão virá depois): links antigos caem em "Meu perfil".
  return v === "assinatura" || v === "integracoes" ? v : "perfil";
}

export const Route = createFileRoute("/_authenticated/admin/administrativo")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: coerceTab(s.tab),
    checkout: typeof s.checkout === "string" ? s.checkout : undefined,
  }),
  component: AdministrativoPage,
});


function AdministrativoPage() {
  const { tab } = useSearch({ from: "/_authenticated/admin/administrativo" });
  const navigate = useNavigate();
  // Assinatura é informação do titular da conta — membros não veem.
  const { isOwner } = useMyPermissions();
  const { isAdmin } = useIsAdmin();
  const canSeeBilling = isOwner || isAdmin;
  const activeTab: Tab = tab === "assinatura" && !canSeeBilling ? "perfil" : tab;
  // Pré-carrega o status das integrações ao abrir qualquer aba: tocar em "Integrações" fica instantâneo.
  useIntegrationStatusQueries();

  const headers: Record<Tab, { title: string; subtitle: string }> = {
    perfil: { title: "Meu perfil", subtitle: "Seus dados pessoais e preferências nesta conta." },
    assinatura: { title: "Assinatura", subtitle: "Cobrança por imóvel, cartão e pagamentos." },
    integracoes: { title: "Integrações", subtitle: "Conexões externas e canais da sua conta." },
  };

  // Celular (mockups aprovados): data dourada no lugar do rótulo, títulos com iniciais maiúsculas
  // e subtítulo da Assinatura "por imóvel". O computador segue como estava.
  const mobileHeaders: Partial<Record<Tab, { title: string; subtitle: string }>> = {
    perfil: { title: "Meu Perfil", subtitle: "Seus dados pessoais e preferências nesta conta." },
    assinatura: { title: "Assinatura", subtitle: "Cobrança por imóvel, cartão e pagamentos." },
    integracoes: { title: "Integrações", subtitle: "Conexões externas e canais da sua conta." },
  };
  const mobileHead = mobileHeaders[activeTab];
  const hoje = new Date()
    .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" })
    .replace(/^\w/, (c) => c.toUpperCase());
  const tabsMobile: Array<{ value: Tab; label: string }> = [
    { value: "perfil", label: "Meu Perfil" },
    ...(canSeeBilling ? [{ value: "assinatura" as Tab, label: "Assinatura" }] : []),
    { value: "integracoes", label: "Integrações" },
  ];

  return (
    <div className="min-h-screen">
      <div
        className={`${
          mobileHead ? "px-[14px] pt-5 pb-0 lg:px-10 lg:pl-4 lg:pt-10 lg:pb-2" : "px-6 lg:px-10 lg:pl-4 pt-8 lg:pt-10 pb-2"
        } max-w-[1440px] mx-auto w-full`}
      >
        {mobileHead ? (
          <div className="flex flex-col gap-1.5 lg:hidden">
            <p className="ds-eyebrow ds-data truncate text-[10.5px] leading-[1.2] tracking-[0.2em]">{hoje}</p>
            <div className="flex min-w-0 flex-col gap-1.5">
              <h1 className="font-display text-[18px] font-bold leading-7 tracking-[-0.02em] [overflow-wrap:anywhere]">
                {mobileHead.title}
              </h1>
              <p className="ds-page-subtitle truncate">{mobileHead.subtitle}</p>
            </div>
          </div>
        ) : null}
        <div className={mobileHead ? "hidden lg:block" : undefined}>
          <PageHeader
            eyebrow="Administrativo"
            title={headers[activeTab].title}
            subtitle={headers[activeTab].subtitle}
          />
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          navigate({ to: "/admin/administrativo", search: { tab: coerceTab(v), checkout: undefined } })
        }
        className="w-full"
      >
        <div className={`${mobileHead ? "px-[14px] pt-5 lg:pt-0 lg:px-10 lg:pl-4" : "px-6 lg:px-10 lg:pl-4"} max-w-[1440px] mx-auto w-full`}>
          {/* Celular: barra `ds-tabs` do Dashboard (fatias iguais de 44px, sem ícones). */}
          <nav className="ds-tabs lg:hidden" aria-label="Administrativo">
            {tabsMobile.map((t) => {
              const active = t.value === activeTab;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() =>
                    navigate({ to: "/admin/administrativo", search: { tab: t.value, checkout: undefined } })
                  }
                  className={`relative flex min-h-[44px] min-w-0 flex-1 items-center justify-center px-2 text-center text-[13px] leading-none transition-colors ${
                    active ? "ds-tab-active font-bold" : "font-semibold text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
          <TabsList className="ds-segmented h-auto max-lg:hidden">
            <TabsTrigger value="perfil">
              <UserIcon className="size-4" /> Meu perfil
            </TabsTrigger>
            {canSeeBilling && (
              <TabsTrigger value="assinatura">
                <CreditCard className="size-4" /> Assinatura
              </TabsTrigger>
            )}
            <TabsTrigger value="integracoes">
              <Plug className="size-4" /> Integrações
            </TabsTrigger>
          </TabsList>
        </div>
        <div
          className={`${
            mobileHead ? "px-[14px] pb-28 lg:px-10 lg:pl-4 lg:pb-16" : "px-6 lg:px-10 lg:pl-4 pb-16"
          } max-w-[1440px] mx-auto w-full pt-6`}
        >
          <TabsContent value="perfil" className="mt-0">
            <MeuPerfilPage />
          </TabsContent>
          {canSeeBilling && (
            <TabsContent value="assinatura" className="mt-0">
              <AssinaturaPage embedded />
            </TabsContent>
          )}
          <TabsContent value="integracoes" className="mt-0">
            <IntegracoesPage />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

