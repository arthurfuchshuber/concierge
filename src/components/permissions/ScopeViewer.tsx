import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Building2, Globe, Layers, Building, FileText } from "lucide-react";

export type ScopeRow = { type: string; description: string; count: number };
export type ScopeProperty = { id: string; name: string; assigned: boolean };

const ICONS: Record<string, typeof Globe> = {
  GLOBAL: Globe,
  TENANT: Layers,
  CLIENT: Building,
  PROPERTY: Building2,
  RECORD: FileText,
};

/** Visualização dos escopos suportados e dos imóveis autorizados. */
export function ScopeViewer({
  scopes,
  properties,
  emptyLabel = "Nenhum escopo configurado para este usuário.",
}: {
  scopes: ScopeRow[];
  properties: ScopeProperty[];
  emptyLabel?: string;
}) {
  const assigned = properties.filter((p) => p.assigned);

  if (!scopes.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {scopes.map((scope) => {
          const Icon = ICONS[scope.type] ?? Layers;
          return (
            <Card key={scope.type} className="flex items-start gap-3 p-3">
              <span className="mt-0.5 rounded-md bg-muted p-1.5">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs font-semibold">{scope.type}</p>
                  <Badge variant="secondary">{scope.count}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{scope.description}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-3">
        <p className="text-sm font-medium">Imóveis autorizados (escopo PROPERTY)</p>
        {assigned.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Nenhum imóvel vinculado — o acesso segue o escopo da conta.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {assigned.map((p) => (
              <Badge key={p.id} variant="outline" className="gap-1">
                <Building2 className="h-3 w-3" />
                {p.name}
              </Badge>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
