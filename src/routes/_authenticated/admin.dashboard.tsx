import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SyncAlertBanner } from "@/components/stakeholders/SyncAlertBanner";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  component: OperationLayout,
});

function OperationLayout() {
  return (
    <>
      <SyncAlertBanner />
      <Outlet />
    </>
  );
}
