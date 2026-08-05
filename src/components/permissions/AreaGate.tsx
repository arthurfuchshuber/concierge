import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAreaAccess } from "@/lib/permissions/useAreaAccess";
import type { AccessLevelInput } from "@/lib/permissions/permissionClient";

export function AccessDenied({ reason }: { reason?: string }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16">
      <Card className="flex flex-col items-center gap-2 p-10 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">Você não tem acesso a esta área</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {reason || "Peça ao responsável pela conta para liberar esta permissão."}
        </p>
      </Card>
    </div>
  );
}

/**
 * `AreaGate` — bloqueia uma área inteira quando o backend nega o acesso.
 * Enquanto a decisão não chega, exibe um esqueleto (nunca conteúdo protegido).
 */
export function AreaGate({
  permission,
  required = "READ",
  children,
}: {
  permission: string;
  required?: AccessLevelInput;
  children: ReactNode;
}) {
  const { can, reasonFor, loading } = useAreaAccess([permission], required);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 px-4 py-10">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!can(permission)) return <AccessDenied reason={reasonFor(permission)} />;
  return <>{children}</>;
}
