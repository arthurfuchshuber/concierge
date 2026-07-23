import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CreditCard, UsersRound, User as UserIcon, ShieldCheck } from "lucide-react";
import { AssinaturaPage } from "@/components/admin-pages/AssinaturaPage";
import { EquipePage } from "@/components/admin-pages/EquipePage";
import { MeuPerfilPage } from "@/components/admin-pages/MeuPerfilPage";
import { PermissoesPage } from "@/components/admin-pages/PermissoesPage";

type Tab = "perfil" | "assinatura" | "equipe" | "permissoes";

function coerceTab(v: unknown): Tab {
  return v === "assinatura" || v === "equipe" || v === "permissoes" ? v : "perfil";
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
      <div className="px-4 md:px-8 pt-6 md:pt-8 pb-2 max-w-7xl mx-auto">
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
        <div className="px-4 md:px-8 max-w-7xl mx-auto">
          <TabsList className="h-auto p-1 bg-secondary/60 rounded-2xl">
            <TabsTrigger value="perfil" className="gap-2 rounded-xl px-4 py-2 text-sm">
              <UserIcon className="size-4" /> Meu perfil
            </TabsTrigger>
            <TabsTrigger value="assinatura" className="gap-2 rounded-xl px-4 py-2 text-sm">
              <CreditCard className="size-4" /> Assinatura
            </TabsTrigger>
            <TabsTrigger value="equipe" className="gap-2 rounded-xl px-4 py-2 text-sm">
              <UsersRound className="size-4" /> Equipe
            </TabsTrigger>
            <TabsTrigger value="permissoes" className="gap-2 rounded-xl px-4 py-2 text-sm">
              <ShieldCheck className="size-4" /> Permissões
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="perfil" className="mt-0">
          <MeuPerfilPage />
        </TabsContent>
        <TabsContent value="assinatura" className="mt-0">
          <AssinaturaPage />
        </TabsContent>
        <TabsContent value="equipe" className="mt-0">
          <EquipePage />
        </TabsContent>
        <TabsContent value="permissoes" className="mt-0">
          <PermissoesPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
