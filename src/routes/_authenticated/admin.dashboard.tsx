import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  component: OperationLayout,
});

function OperationLayout() {
  return <Outlet />;
}
