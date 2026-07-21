import { createFileRoute } from "@tanstack/react-router";
import { AssinaturaPage } from "@/components/admin-pages/AssinaturaPage";

export const Route = createFileRoute("/_authenticated/admin/assinatura")({
  validateSearch: (s: Record<string, unknown>) => ({
    checkout: typeof s.checkout === "string" ? s.checkout : undefined,
  }),
  component: AssinaturaPage,
});
