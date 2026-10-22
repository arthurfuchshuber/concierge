import { createFileRoute } from "@tanstack/react-router";
import { PlaybookPage } from "@/components/playbook/PlaybookPage";

/**
 * Playbook do imóvel (21/10/2026): o registro/fonte da verdade do imóvel.
 * Chega pelo ícone de documento do card do imóvel (Proprietários → Imóveis).
 */
export const Route = createFileRoute("/_authenticated/admin/playbook/$id")({
  component: PlaybookRoute,
});

function PlaybookRoute() {
  const { id } = Route.useParams();
  return <PlaybookPage propertyId={id} />;
}
