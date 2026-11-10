import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AssinaturaPage } from "@/components/admin-pages/AssinaturaPage";
import { MeuPerfilPage } from "@/components/admin-pages/MeuPerfilPage";
import { IntegracoesPage, useIntegrationStatusQueries } from "@/components/admin-pages/IntegracoesPage";
import { useMyPermissions } from "@/hooks/useMyPermissions";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/**
 * Administrativo tem duas abas (mockups aprovados, 10/11/2026):
 *  · "perfil"  → Perfil e Assinatura (antes eram duas abas: "Meu perfil" e "Assinatura");
 *  · "integracoes".
 */
type Tab = "perfil" | "integracoes";

function coerceTab(v: unknown): Tab {
  // Links antigos continuam válidos: `tab=assinatura` (ex.: PlanLockCard) cai na aba unificada.
  // A aba "Permissões" foi removida (nova versão virá depois) e também cai em "perfil".
  return v === "integracoes" ? "integracoes" : "perfil";
}

export const Route = createFileRoute("/_authenticated/admin/administrativo")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: coerceTab(s.tab),
    checkout: typeof s.checkout === "string" ? s.checkout : undefined,
  }),
  component: AdministrativoPage,
});

function AdministrativoPage() {
  const { tab: activeTab } = useSearch({ from: "/_authenticated/admin/administrativo" });
  const navigate = useNavigate();
  // Assinatura é informação do titular da conta — membros veem só o Perfil.
  const { isOwner } = useMyPermissions();
  const { isAdmin } = useIsAdmin();
  const canSeeBilling = isOwner || isAdmin;
  // Pré-carrega o status das integrações ao abrir qualquer aba: tocar em "Integrações" fica instantâneo.
  useIntegrationStatusQueries();

  const perfilLabel = canSeeBilling ? "Perfil e Assinatura" : "Meu Perfil";
  const headers: Record<Tab, { title: string; subtitle: string }> = {
    perfil: {
      title: perfilLabel,
      subtitle: canSeeBilling
        ? "Seus dados pessoais, plano, cartão e pagamentos."
        : "Seus dados pessoais e preferências nesta conta.",
    },
    integracoes: { title: "Integrações", subtitle: "Conexões externas e canais da sua conta." },
  };
  const head = headers[activeTab];
  const hoje = new Date()
    .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" })
    .replace(/^\w/, (c) => c.toUpperCase());
  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "perfil", label: perfilLabel },
    { value: "integracoes", label: "Integrações" },
  ];
  const wrap = "mx-auto w-full max-w-none px-[14px] lg:px-10 lg:pl-4";

  return (
    <div className="min-h-screen">
      {/* Cabeçalho único (celular e computador): data dourada, título e subtítulo. */}
      <div className={`${wrap} pt-5 pb-0 lg:pt-10`}>
        <div className="flex flex-col gap-1.5">
          <p className="ds-eyebrow ds-data truncate text-[10.5px] leading-[1.2] tracking-[0.2em]">{hoje}</p>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="font-display text-[18px] font-bold leading-7 tracking-[-0.02em] [overflow-wrap:anywhere]">
              {head.title}
            </h1>
            <p className="ds-page-subtitle truncate">{head.subtitle}</p>
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          navigate({ to: "/admin/administrativo", search: { tab: coerceTab(v), checkout: undefined } })
        }
        className="w-full"
      >
        <div className={`${wrap} pt-5`}>
          {/* Barra `ds-tabs` do Dashboard (fatias iguais de 44px, sem ícones). */}
          <nav className="ds-tabs" aria-label="Administrativo">
            {tabs.map((t) => {
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
        </div>
        <div className={`${wrap} pb-28 pt-6 lg:pb-16`}>
          <TabsContent value="perfil" className="mt-0">
            {canSeeBilling ? (
              // Computador: Perfil (5) à esquerda, Assinatura (7) à direita. Celular: um embaixo do outro.
              <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <MeuPerfilPage />
                <AssinaturaPage embedded />
              </div>
            ) : (
              <MeuPerfilPage />
            )}
          </TabsContent>
          <TabsContent value="integracoes" className="mt-0">
            <IntegracoesPage />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
