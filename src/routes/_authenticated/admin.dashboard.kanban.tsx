import { createFileRoute } from "@tanstack/react-router";
import { OperationWorkspace } from "@/components/dashboard/OperationWorkspace";

export const Route = createFileRoute("/_authenticated/admin/dashboard/kanban")({
  head: () => ({
    meta: [
      { title: "Kanban da operação — ConciergeIA" },
      {
        name: "description",
        content: "Quadro de reservas por etapa: chegada, estadia, saída, limpeza e concluídos.",
      },
      { property: "og:title", content: "Kanban da operação — ConciergeIA" },
      { property: "og:description", content: "Cada reserva na etapa em que ela realmente está." },
    ],
  }),
  component: DashboardKanban,
});

function DashboardKanban() {
  return <OperationWorkspace view="kanban" />;
}
