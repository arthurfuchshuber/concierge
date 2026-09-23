import { createFileRoute } from "@tanstack/react-router";
import { RecordsWorkspace } from "@/components/dashboard/RecordsWorkspace";

export const Route = createFileRoute("/_authenticated/admin/dashboard/registros")({
  head: () => ({
    meta: [
      { title: "Registros — ConciergeIA" },
      {
        name: "description",
        content: "Fotos, vídeos, áudios e notas registrados em todos os imóveis.",
      },
      { property: "og:title", content: "Registros — ConciergeIA" },
      {
        property: "og:description",
        content: "Fotos, vídeos, áudios e notas registrados em todos os imóveis.",
      },
    ],
  }),
  component: DashboardRegistros,
});

function DashboardRegistros() {
  return <RecordsWorkspace />;
}
