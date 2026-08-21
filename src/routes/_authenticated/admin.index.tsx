import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAreaAccess } from "@/lib/permissions/useAreaAccess";
import { ROUTE_PERMISSIONS, ROUTE_PERMISSION_LIST } from "@/lib/permissions/routeAreas";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminEntry,
});

/**
 * Porta de entrada do painel: manda o usuário para a PRIMEIRA página do menu
 * à qual ele realmente tem acesso (ordem de `ROUTE_PERMISSIONS`, que segue a
 * ordem do menu lateral). Sem acesso a nada, cai no dashboard e o próprio
 * layout mostra o bloqueio.
 */
function AdminEntry() {
  const navigate = useNavigate();
  const access = useAreaAccess(ROUTE_PERMISSION_LIST);

  useEffect(() => {
    if (!access.ready) return;
    const first =
      ROUTE_PERMISSIONS.find((r) => access.can(r.permission))?.prefix ?? "/admin/dashboard";
    navigate({ to: first, replace: true });
  }, [access.ready]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}
