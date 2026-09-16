import { createFileRoute } from "@tanstack/react-router";
import { OperationWorkspace } from "@/components/dashboard/OperationWorkspace";

export const Route = createFileRoute("/_authenticated/admin/dashboard/limpeza")({
  head: () => ({
    meta: [
      { title: "Limpeza — ConciergeIA" },
      {
        name: "description",
        content: "Histórico e custos das limpezas realizadas.",
      },
      { property: "og:title", content: "Limpeza — ConciergeIA" },
      { property: "og:description", content: "Histórico e custos das limpezas realizadas." },
    ],
  }),
  component: DashboardLimpeza,
});

function DashboardLimpeza() {
  return <OperationWorkspace view="limpeza" />;
}
