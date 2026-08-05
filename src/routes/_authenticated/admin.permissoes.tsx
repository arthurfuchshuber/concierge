import { createFileRoute } from "@tanstack/react-router";
import { PermissionCenterPage } from "@/components/admin-pages/PermissionCenterPage";

export const Route = createFileRoute("/_authenticated/admin/permissoes")({
  component: PermissionCenterPage,
});
