import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Building2, Users, Wrench } from "lucide-react";
import { StakeholderDirectory } from "@/components/stakeholders/StakeholderDirectory";
import { WorkspaceHeader, type WorkspaceTab } from "@/components/ds/WorkspaceHeader";
import { HospedesPage } from "@/components/admin-pages/HospedesPage";

type Tab = "proprietarios" | "hospedes" | "prestadores";

function coerceTab(v: unknown): Tab {
  return v === "hospedes" || v === "prestadores" ? v : "proprietarios";
}

const TABS: WorkspaceTab[] = [
  {
    key: "proprietarios",
    label: (
      <>
        <Building2 className="size-4 shrink-0" />
        <span className="truncate">Proprietários</span>
      </>
    ),
  },
  {
    key: "hospedes",
    label: (
      <>
        <Users className="size-4 shrink-0" />
        <span className="truncate">Hóspedes</span>
      </>
    ),
  },
  {
    key: "prestadores",
    label: (
      <>
        <Wrench className="size-4 shrink-0" />
        <span className="truncate">Prestadores</span>
      </>
    ),
  },
];

const SUBTITLES: Record<Tab, string> = {
  proprietarios: "Cadastro, situação contratual e residências de cada proprietário.",
  hospedes: "Todos os dados enviados pelos hóspedes ao abrirem o guia.",
  prestadores: "Equipe de limpeza, manutenção e demais parceiros da operação.",
};

export const Route = createFileRoute("/_authenticated/admin/stakeholders")({
  head: () => ({
    meta: [
      { title: "Stakeholders — ConciergeIA" },
      {
        name: "description",
        content: "Proprietários, hóspedes e prestadores da sua operação em um só lugar.",
      },
      { property: "og:title", content: "Stakeholders — ConciergeIA" },
      {
        property: "og:description",
        content: "Cadastro e acompanhamento de proprietários, hóspedes e prestadores.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    s.tab === "hospedes" || s.tab === "prestadores" ? { tab: s.tab } : {},
  component: StakeholdersPage,
});

function StakeholdersPage() {
  const search = useSearch({ from: "/_authenticated/admin/stakeholders" });
  const tab = coerceTab(search.tab);
  const navigate = useNavigate();

  return (
    <div className="px-2.5 sm:px-5 lg:px-8 py-5 lg:py-8 max-w-[1440px] w-full">
      <WorkspaceHeader
        title="Stakeholders"
        subtitle={SUBTITLES[tab]}
        tabs={TABS}
        activeTab={tab}
        onTabChange={(k) =>
          navigate({ to: "/admin/stakeholders", search: { tab: coerceTab(k) } })
        }
      />

      {tab === "proprietarios" && <StakeholderDirectory kind="owner" />}
      {tab === "hospedes" && <HospedesPage embedded />}
      {tab === "prestadores" && <StakeholderDirectory kind="provider" />}
    </div>
  );
}
