import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * PÁGINA DESATIVADA (limpeza das recomendações, 24/09/2026) — ver
 * `admin.cidades.index.tsx`. Redireciona para Recomendações. Pode ser apagada
 * no Lovable.
 */
export const Route = createFileRoute("/_authenticated/admin/cidades/$cityKey")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/recomendacoes-sigma" });
  },
});
