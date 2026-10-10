import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * A página "Stakeholders" foi desmembrada (10/10/2026) em Proprietários,
 * Prestadores (e Hóspedes, que já tinha rota própria). Esta rota só existe
 * para links antigos e favoritos: leva cada aba para a página nova.
 */
export const Route = createFileRoute("/_authenticated/admin/stakeholders")({
  validateSearch: (s: Record<string, unknown>): { tab?: "proprietarios" | "hospedes" | "prestadores" } =>
    s.tab === "hospedes" || s.tab === "prestadores" || s.tab === "proprietarios" ? { tab: s.tab } : {},
  beforeLoad: ({ search }) => {
    throw redirect({
      to:
        search.tab === "hospedes"
          ? "/admin/hospedes"
          : search.tab === "prestadores"
            ? "/admin/prestadores"
            : "/admin/proprietarios",
      replace: true,
    });
  },
});
