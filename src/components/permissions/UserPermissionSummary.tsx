import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Building2, Crown, KeyRound, Mail, ShieldCheck } from "lucide-react";

export type UserPermissionSummaryData = {
  name: string;
  email: string | null;
  status: string;
  tenantName: string;
  roles: string[];
  effectiveCount: number;
  writeCount: number;
  propertyCount: number;
  isOwner: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  pending: "Convite pendente",
  revoked: "Revogado",
};

/** Cabeçalho de resumo: usuário → roles → permissões → escopos. */
export function UserPermissionSummary({ data }: { data: UserPermissionSummaryData }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {data.isOwner && <Crown className="h-4 w-4 text-amber-500" />}
            <h3 className="truncate text-base font-semibold">{data.name}</h3>
          </div>
          {data.email && (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              {data.email}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">Conta: {data.tenantName}</p>
        </div>
        <Badge variant={data.status === "active" ? "secondary" : "outline"}>
          {STATUS_LABEL[data.status] ?? data.status}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {data.roles.map((role) => (
          <Badge key={role} variant="outline" className="gap-1">
            <ShieldCheck className="h-3 w-3" />
            {role}
          </Badge>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border bg-muted/30 p-2.5">
          <p className="text-lg font-semibold">{data.effectiveCount}</p>
          <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <KeyRound className="h-3 w-3" /> Efetivas
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-2.5">
          <p className="text-lg font-semibold">{data.writeCount}</p>
          <p className="text-[11px] text-muted-foreground">Com edição</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-2.5">
          <p className="text-lg font-semibold">{data.propertyCount}</p>
          <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <Building2 className="h-3 w-3" /> Imóveis
          </p>
        </div>
      </div>
    </Card>
  );
}
