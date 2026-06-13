import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/g/$slug")({
  component: () => <Outlet />,
});