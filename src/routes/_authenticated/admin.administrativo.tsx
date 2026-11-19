import { useSyncExternalStore } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AssinaturaPage } from "@/components/admin-pages/AssinaturaPage";
import { MeuPerfilPage } from "@/components/admin-pages/MeuPerfilPage";
import { IntegracoesPage, useIntegrationStatusQueries } from "@/components/admin-pages/IntegracoesPage";
import { useMyPermissions } from "@/hooks/useMyPermissions";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/**
 * Administrativo (mockups aprovados):
 *  · CELULAR (18/11/2026): três abas — Perfil | Assinatura | Integrações. Assinatura e Integrações
 *    aparecem para todo usuário da conta, mas só o titular altera (os demais veem em modo leitura).
 *  · COMPUTADOR (10/11/2026): "Perfil e Assinatura" (lado a lado) | Integrações; `tab=assinatura`
 *    abre essa mesma visão unificada.
 */
type Tab = "perfil" | "assinatura" | "integracoes";

function coerceTab(v: unknown): Tab {
  // A aba "Permissões" foi removida (nova versão virá depois) e cai em "perfil".
  return v === "integracoes" ? "integracoes" : v === "assinatura" ? "assinatura" : "perfil";
}

/** Computador (≥ 1024px, o `lg` do Tailwind): decide qual visão montar, para não montar o Perfil duas vezes. */
const LG = "(min-width: 1024px)";
function useIsLg(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(LG);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(LG).matches,
    () => false,
  );
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
  // Só o titular (ou o admin do SaaS) altera plano, cartão e integrações; os demais, só leitura.
  const readOnly = !canSeeBilling;
  const isLg = useIsLg();
  const headers: Record<Tab, { title: string; subtitle: string; mobileTitle: string; mobileSubtitle: string }> = {
    perfil: {
      title: perfilLabel,
      subtitle: canSeeBilling
        ? "Seus dados pessoais, plano, cartão e pagamentos."
        : "Seus dados pessoais e preferências nesta conta.",
      mobileTitle: "Perfil",
      mobileSubtitle: "Seus dados pessoais e da empresa.",
    },
    assinatura: {
      title: perfilLabel,
      subtitle: canSeeBilling
        ? "Seus dados pessoais, plano, cartão e pagamentos."
        : "Seus dados pessoais e preferências nesta conta.",
      mobileTitle: "Assinatura",
      mobileSubtitle: "Plano, cartão e pagamentos.",
    },
    integracoes: {
      title: "Integrações",
      subtitle: "Conexões externas e canais da sua conta.",
      mobileTitle: "Integrações",
      mobileSubtitle: readOnly ? "Somente o titular da conta pode alterar." : "Conexões externas e canais da sua conta.",
    },
  };
  const head = headers[activeTab];
  const hoje = new Date()
    .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" })
    .replace(/^\w/, (c) => c.toUpperCase());
  // `only`: a aba existe só no celular ("mobile") ou em ambos.
  const tabs: Array<{ value: Tab; label: string; desktopLabel?: string; only?: "mobile" }> = [
    { value: "perfil", label: "Perfil", desktopLabel: perfilLabel },
    { value: "assinatura", label: "Assinatura", only: "mobile" },
    { value: "integracoes", label: "Integrações" },
  ];
  // Computador: Perfil (5) à esquerda, Assinatura (7) à direita; membros veem só o Perfil.
  const desktopPerfil = canSeeBilling ? (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <MeuPerfilPage />
      <AssinaturaPage embedded />
    </div>
  ) : (
    <MeuPerfilPage />
  );
  const wrap = "mx-auto w-full max-w-none px-[14px] lg:px-10 lg:pl-4";

  return (
    <div className="min-h-screen">
      {/* Cabeçalho único (celular e computador): data dourada, título e subtítulo. */}
      <div className={`${wrap} pt-5 pb-0 lg:pt-10`}>
        <div className="flex flex-col gap-1.5">
          <p className="ds-eyebrow ds-data truncate text-[10.5px] leading-[1.2] tracking-[0.2em]">{hoje}</p>
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="font-display text-[18px] font-bold leading-7 tracking-[-0.02em] [overflow-wrap:anywhere]">
              <span className="lg:hidden">{head.mobileTitle}</span>
              <span className="hidden lg:inline">{head.title}</span>
            </h1>
            <p className="ds-page-subtitle truncate">
              <span className="lg:hidden">{head.mobileSubtitle}</span>
              <span className="hidden lg:inline">{head.subtitle}</span>
            </p>
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
          {/* Barra `ds-tabs` do Dashboard (fatias iguais, mesma altura da barra de filtros, sem ícones). */}
          <nav className="ds-tabs" aria-label="Administrativo">
            {tabs.map((t) => {
              // No computador "Perfil e Assinatura" é uma aba só: `tab=assinatura` marca "Perfil".
              const active = t.value === (isLg && activeTab === "assinatura" ? "perfil" : activeTab);
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() =>
                    navigate({ to: "/admin/administrativo", search: { tab: t.value, checkout: undefined } })
                  }
                  className={`relative flex h-10 min-w-0 flex-1 items-center justify-center px-2 text-center text-sm lg:h-[var(--ds-action-h-lg)] leading-none transition-colors ${
                    t.only === "mobile" ? "lg:hidden" : ""
                  } ${active ? "ds-tab-active font-bold" : "font-semibold text-muted-foreground hover:text-foreground"}`}
                >
                  <span className="truncate lg:hidden">{t.label}</span>
                  <span className="hidden truncate lg:inline">{t.desktopLabel ?? t.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
        <div className={`${wrap} pb-28 pt-2.5 lg:pb-16`}>
          <TabsContent value="perfil" className="mt-0">
            {isLg ? desktopPerfil : <MeuPerfilPage />}
          </TabsContent>
          <TabsContent value="assinatura" className="mt-0">
            {isLg ? desktopPerfil : <AssinaturaPage embedded readOnly={readOnly} />}
          </TabsContent>
          <TabsContent value="integracoes" className="mt-0">
            <IntegracoesPage />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
