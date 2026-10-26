import { createFileRoute } from "@tanstack/react-router";
import { StakeholderDirectory } from "@/components/stakeholders/StakeholderDirectory";
import { PageShell } from "@/components/ds/PageShell";

/**
 * Proprietários — página própria (10/10/2026, pedido explícito: "desmembre
 * stakeholders em duas páginas distintas: Proprietários e Prestadores").
 * Mesmo diretório e mesmas permissões (`tenant.stakeholders`) da antiga aba.
 */
export const Route = createFileRoute("/_authenticated/admin/proprietarios")({
  head: () => ({
    meta: [
      { title: "Proprietários — ConciergeIA" },
      { name: "description", content: "Cadastramento e histórico de proprietários." },
      { property: "og:title", content: "Proprietários — ConciergeIA" },
    ],
  }),
  component: ProprietariosPage,
});

function ProprietariosPage() {
  return (
    <div className="ds-page w-full max-w-[1440px] px-3.5 py-5 sm:px-5 lg:px-8 lg:py-8">
      <PageShell title="Proprietários" subtitle="Cadastramento e histórico de proprietários." />
      <StakeholderDirectory kind="owner" />
    </div>
  );
}
