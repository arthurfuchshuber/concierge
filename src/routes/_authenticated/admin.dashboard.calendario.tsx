import { createFileRoute, redirect } from "@tanstack/react-router";

// O calendário de ocupação deixou de ser uma aba própria e passou a viver
// dentro da página "Dashboard" (final da tela, com o mesmo botão "Filtros").
// Esta rota continua existindo só para não quebrar links/favoritos antigos —
// quem cair aqui é levado direto pro Dashboard.
export const Route = createFileRoute("/_authenticated/admin/dashboard/calendario")({
  beforeLoad: async () => {
    throw redirect({ to: "/admin/dashboard" });
  },
});
