import type { ReactNode } from "react";
import { Lock, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
 * "Não consegui verificar" NÃO é "você não tem acesso". Quando a consulta de
 * permissão falha (rede, servidor reiniciando), dizer ao usuário que ele não
 * tem acesso é falso e o leva a pedir liberação sem necessidade.
 */
export function AccessCheckFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16">
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <RefreshCw className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">Não foi possível verificar o seu acesso</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Foi uma falha de conexão, não falta de permissão. Tente de novo.
        </p>
        <Button size="sm" onClick={onRetry}>
          Tentar de novo
        </Button>
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
  const { can, reasonFor, loading, failed, retry } = useAreaAccess([permission], required);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-3 px-4 py-10">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (failed) return <AccessCheckFailed onRetry={retry} />;
  if (!can(permission)) return <AccessDenied reason={reasonFor(permission)} />;
  return <>{children}</>;
}
