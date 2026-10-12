import { createFileRoute } from "@tanstack/react-router";
import { OperationWorkspace } from "@/components/dashboard/OperationWorkspace";

// A antiga aba "Limpeza" foi MOVIDA (não duplicada) para cá (pedido explícito,
// 11/10/2026): "Financeiro" é uma página própria dentro de Dashboard, no menu
// lateral. O conteúdo é o mesmo da Limpeza; só mudou de lugar.
export const Route = createFileRoute("/_authenticated/admin/dashboard/financeiro")({
  head: () => ({
    meta: [
      { title: "Financeiro — ConciergeIA" },
      {
        name: "description",
        content: "Histórico e custos das limpezas realizadas.",
      },
      { property: "og:title", content: "Financeiro — ConciergeIA" },
      { property: "og:description", content: "Histórico e custos das limpezas realizadas." },
    ],
  }),
  component: DashboardFinanceiro,
});

function DashboardFinanceiro() {
  return <OperationWorkspace view="limpeza" />;
}
