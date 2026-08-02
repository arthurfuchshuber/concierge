import { createFileRoute } from "@tanstack/react-router";
import { HospedesPage } from "@/components/admin-pages/HospedesPage";

export const Route = createFileRoute("/_authenticated/admin/hospedes")({
  component: HospedesPage,
});
