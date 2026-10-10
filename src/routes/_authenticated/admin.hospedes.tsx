import { createFileRoute } from "@tanstack/react-router";
import { HospedesPage } from "@/components/admin-pages/HospedesPage";
import { PageShell } from "@/components/ds/PageShell";

/**
 * Hóspedes — página própria no menu (10/10/2026, pedido explícito, junto do
 * desmembramento de Stakeholders). Mesmo conteúdo de antes, agora com o
 * cabeçalho padrão das páginas (data + título), igual a Proprietários e
 * Prestadores. Permissão inalterada: `tenant.stakeholders.hospedes`.
 */
export const Route = createFileRoute("/_authenticated/admin/hospedes")({
  head: () => ({
    meta: [{ title: "Hóspedes — ConciergeIA" }],
  }),
  component: HospedesRoutePage,
});

function HospedesRoutePage() {
  return (
    <div className="ds-blocks w-full max-w-[1440px] px-3.5 py-5 sm:px-5 lg:px-8 lg:py-8">
      <PageShell title="Hóspedes" subtitle="Dados enviados pelos hóspedes ao abrirem o guia." />
      <HospedesPage embedded />
    </div>
  );
}
