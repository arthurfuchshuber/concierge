import { useEffect } from "react";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { startGuideLive } from "@/lib/guide-live";

function GuideLayout() {
  const { slug } = Route.useParams();
  // Tempo real do guia (aviso mínimo do banco; sem login nem dados expostos).
  useEffect(() => startGuideLive(slug), [slug]);
  return <Outlet />;
}

export const Route = createFileRoute("/g/$slug")({
  component: GuideLayout,
});
