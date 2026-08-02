import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Building2, Users, Wrench } from "lucide-react";
import { StakeholderDirectory } from "@/components/stakeholders/StakeholderDirectory";
import { HospedesPage } from "@/components/admin-pages/HospedesPage";

type Tab = "proprietarios" | "hospedes" | "prestadores";

function coerceTab(v: unknown): Tab {
  return v === "hospedes" || v === "prestadores" ? v : "proprietarios";
}

export const Route = createFileRoute("/_authenticated/admin/stakeholders")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    s.tab === "hospedes" || s.tab === "prestadores" ? { tab: s.tab } : {},
  component: StakeholdersPage,
});

function StakeholdersPage() {
  const search = useSearch({ from: "/_authenticated/admin/stakeholders" });
  const tab = coerceTab(search.tab);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <div className="px-6 lg:px-10 pt-8 lg:pt-10 pb-2 max-w-7xl mx-auto w-full">
        <h1 className="font-display text-3xl md:text-4xl tracking-tight">Stakeholders</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Proprietários, hóspedes e prestadores da sua operação em um só lugar.
        </p>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => navigate({ to: "/admin/stakeholders", search: { tab: coerceTab(v) } })}
        className="w-full"
      >
        <div className="px-6 lg:px-10 max-w-7xl mx-auto w-full">
          <TabsList>
            <TabsTrigger value="proprietarios">
              <Building2 className="size-4" /> Proprietários
            </TabsTrigger>
            <TabsTrigger value="hospedes">
              <Users className="size-4" /> Hóspedes
            </TabsTrigger>
            <TabsTrigger value="prestadores">
              <Wrench className="size-4" /> Prestadores
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="px-6 lg:px-10 max-w-7xl mx-auto w-full pt-6 pb-16">
          <TabsContent value="proprietarios" className="mt-0">
            <StakeholderDirectory kind="owner" />
          </TabsContent>
          <TabsContent value="hospedes" className="mt-0">
            <HospedesPage embedded />
          </TabsContent>
          <TabsContent value="prestadores" className="mt-0">
            <StakeholderDirectory kind="provider" />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
