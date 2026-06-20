import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/painel")({
  beforeLoad: () => {
    throw redirect({ to: "/admin" });
  },
  component: () => null,
});