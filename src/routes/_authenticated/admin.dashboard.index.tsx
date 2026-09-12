import { createFileRoute } from "@tanstack/react-router";
import { OperationWorkspace } from "@/components/dashboard/OperationWorkspace";

export const Route = createFileRoute("/_authenticated/admin/dashboard/")({
  head: () => ({
    meta: [
      { title: "Operação — ConciergeIA" },
      {
        name: "description",
        content: "Painel operacional diário do anfitrião: check-ins, checkouts e engajamento do guia.",
      },
      { property: "og:title", content: "Operação — ConciergeIA" },
      { property: "og:description", content: "Check-ins, checkouts e engajamento do guia em um só lugar." },
    ],
  }),
  component: DashboardResumo,
});

function DashboardResumo() {
  return <OperationWorkspace view="resumo" />;
}
