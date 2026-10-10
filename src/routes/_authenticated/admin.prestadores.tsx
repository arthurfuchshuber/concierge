import { createFileRoute } from "@tanstack/react-router";
import { StakeholderDirectory } from "@/components/stakeholders/StakeholderDirectory";
import { PageShell } from "@/components/ds/PageShell";

/**
 * Prestadores — página própria (10/10/2026, pedido explícito: "desmembre
 * stakeholders em duas páginas distintas: Proprietários e Prestadores").
 * Mesmo diretório e mesmas permissões (`tenant.stakeholders`) da antiga aba.
 */
export const Route = createFileRoute("/_authenticated/admin/prestadores")({
  head: () => ({
    meta: [
      { title: "Prestadores — ConciergeIA" },
      { name: "description", content: "Limpeza, manutenção e parceiros da operação." },
      { property: "og:title", content: "Prestadores — ConciergeIA" },
    ],
  }),
  component: PrestadoresPage,
});

function PrestadoresPage() {
  return (
    <div className="ds-blocks w-full max-w-[1440px] px-3.5 py-5 sm:px-5 lg:px-8 lg:py-8">
      <PageShell title="Prestadores" subtitle="Limpeza, manutenção e parceiros da operação." />
      <StakeholderDirectory kind="provider" />
    </div>
  );
}
