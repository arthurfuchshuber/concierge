import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CreditCard, UsersRound } from "lucide-react";
import { AssinaturaPage } from "@/components/admin-pages/AssinaturaPage";
import { EquipePage } from "@/components/admin-pages/EquipePage";

type Tab = "assinatura" | "equipe";

export const Route = createFileRoute("/_authenticated/admin/administrativo")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: (s.tab === "equipe" ? "equipe" : "assinatura") as Tab,
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
        <p className="text-sm text-muted-foreground mt-1">Assinatura e equipe da sua conta.</p>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) =>
          navigate({ to: "/admin/administrativo", search: { tab: v as Tab } })
        }
        className="w-full"
      >
        <div className="px-4 md:px-8 max-w-7xl mx-auto">
          <TabsList className="h-auto p-1 bg-secondary/60 rounded-2xl">
            <TabsTrigger value="assinatura" className="gap-2 rounded-xl px-4 py-2 text-sm">
              <CreditCard className="size-4" /> Assinatura
            </TabsTrigger>
            <TabsTrigger value="equipe" className="gap-2 rounded-xl px-4 py-2 text-sm">
              <UsersRound className="size-4" /> Equipe
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="assinatura" className="mt-0">
          <AssinaturaPage />
        </TabsContent>
        <TabsContent value="equipe" className="mt-0">
          <EquipePage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
