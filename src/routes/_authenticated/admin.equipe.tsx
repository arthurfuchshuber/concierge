import { createFileRoute } from "@tanstack/react-router";
import { EquipePage } from "@/components/admin-pages/EquipePage";

export const Route = createFileRoute("/_authenticated/admin/equipe")({
  component: EquipePage,
});
