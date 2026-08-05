import { createFileRoute, redirect } from "@tanstack/react-router";

// A página de Integrações passou a viver dentro de Administrativo.
export const Route = createFileRoute("/_authenticated/admin/integracoes")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/administrativo", search: { tab: "integracoes" as const, checkout: undefined } });
  },
});
