import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CreditCard, ShieldCheck, User as UserIcon, Plug } from "lucide-react";
import { AssinaturaPage } from "@/components/admin-pages/AssinaturaPage";
import { PermissionCenterPage } from "@/components/admin-pages/PermissionCenterPage";
import { MeuPerfilPage } from "@/components/admin-pages/MeuPerfilPage";
import { IntegracoesPage } from "@/components/admin-pages/IntegracoesPage";
import { useMyPermissions } from "@/hooks/useMyPermissions";
import { useIsAdmin } from "@/hooks/useIsAdmin";

type Tab = "perfil" | "assinatura" | "permissoes" | "integracoes";

function coerceTab(v: unknown): Tab {
  // "equipe" (legacy) redireciona para "permissoes" — a aba foi substituída.
  if (v === "equipe") return "permissoes";
  return v === "assinatura" || v === "permissoes" || v === "integracoes" ? v : "perfil";
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

  return (
    <div className="min-h-screen">
      <div className="px-6 lg:px-10 pt-8 lg:pt-10 pb-2 max-w-7xl mx-auto w-full">
        <h1 className="font-display text-3xl md:text-4xl tracking-tight">Administrativo</h1>
        <p className="text-sm text-muted-foreground mt-1">Perfil, assinatura, equipe e integrações da sua conta.</p>
      </div>
      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          navigate({ to: "/admin/administrativo", search: { tab: coerceTab(v), checkout: undefined } })
        }
        className="w-full"
      >
        <div className="px-6 lg:px-10 max-w-7xl mx-auto w-full">
          <TabsList>
            <TabsTrigger value="perfil">
              <UserIcon className="size-4" /> Meu perfil
            </TabsTrigger>
            {canSeeBilling && (
              <TabsTrigger value="assinatura">
                <CreditCard className="size-4" /> Assinatura
              </TabsTrigger>
            )}
            <TabsTrigger value="permissoes">
              <ShieldCheck className="size-4" /> Permissões
            </TabsTrigger>
            <TabsTrigger value="integracoes">
              <Plug className="size-4" /> Integrações
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="px-6 lg:px-10 max-w-7xl mx-auto w-full pt-6 pb-16">
          <TabsContent value="perfil" className="mt-0">
            <MeuPerfilPage />
          </TabsContent>
          {canSeeBilling && (
            <TabsContent value="assinatura" className="mt-0">
              <AssinaturaPage />
            </TabsContent>
          )}
          <TabsContent value="permissoes" className="mt-0">
            <PermissionCenterPage />
          </TabsContent>

          <TabsContent value="integracoes" className="mt-0">
            <IntegracoesPage />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

