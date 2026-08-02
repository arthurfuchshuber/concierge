import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CreditCard, UsersRound, User as UserIcon } from "lucide-react";
import { AssinaturaPage } from "@/components/admin-pages/AssinaturaPage";
import { EquipePage } from "@/components/admin-pages/EquipePage";
import { MeuPerfilPage } from "@/components/admin-pages/MeuPerfilPage";

type Tab = "perfil" | "assinatura" | "equipe";

function coerceTab(v: unknown): Tab {
  // "permissoes" (legacy) redireciona para "equipe" — as duas abas foram unificadas.
  if (v === "permissoes") return "equipe";
  return v === "assinatura" || v === "equipe" ? v : "perfil";
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

  return (
    <div className="min-h-screen">
      <div className="px-6 lg:px-10 pt-8 lg:pt-10 pb-2 max-w-7xl mx-auto w-full">
        <h1 className="font-display text-3xl md:text-4xl tracking-tight">Administrativo</h1>
        <p className="text-sm text-muted-foreground mt-1">Perfil, assinatura e equipe da sua conta.</p>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) =>
          navigate({ to: "/admin/administrativo", search: { tab: coerceTab(v) } })
        }
        className="w-full"
      >
        <div className="px-6 lg:px-10 max-w-7xl mx-auto w-full">
          <TabsList>
            <TabsTrigger value="perfil">
              <UserIcon className="size-4" /> Meu perfil
            </TabsTrigger>
            <TabsTrigger value="assinatura">
              <CreditCard className="size-4" /> Assinatura
            </TabsTrigger>
            <TabsTrigger value="equipe">
              <UsersRound className="size-4" /> Equipe & Permissões
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="px-6 lg:px-10 max-w-7xl mx-auto w-full pt-6 pb-16">
          <TabsContent value="perfil" className="mt-0">
            <MeuPerfilPage />
          </TabsContent>
          <TabsContent value="assinatura" className="mt-0">
            <AssinaturaPage />
          </TabsContent>
          <TabsContent value="equipe" className="mt-0">
            <EquipePage />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

