import { createFileRoute } from "@tanstack/react-router";
import { OperationWorkspace } from "@/components/dashboard/OperationWorkspace";

export const Route = createFileRoute("/_authenticated/admin/dashboard/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário de ocupação — ConciergeIA" },
      {
        name: "description",
        content: "Agenda de ocupação dos imóveis dia a dia, com chegadas, saídas e limpezas.",
      },
      { property: "og:title", content: "Calendário de ocupação — ConciergeIA" },
      { property: "og:description", content: "Ocupação dos imóveis dia a dia." },
    ],
  }),
  component: DashboardCalendario,
});

function DashboardCalendario() {
  return <OperationWorkspace view="calendario" />;
}
