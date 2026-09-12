import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Plus, ShieldCheck, Trash2, UserMinus, UserX } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AccessBadge } from "@/components/permissions/AccessBadge";
import { ConfirmActionDialog } from "@/components/permissions/ConfirmActionDialog";
import {
  assignPermissionCenterRole,
  grantPermissionCenterPermission,
  removePermissionCenterRole,
  removePermissionCenterUser,
  revokePermissionCenterPermission,
  setPermissionCenterPropertyScope,
  setPermissionCenterUserStatus,
} from "@/lib/permission-center.functions";

type Direct = {
  id: string;
  namespace: string;
  label: string;
  level: string;
  scopeType: string;
  scopeId: string | null;
};

type Props = {
  targetUserId: string;
  isOwner: boolean;
  role: string;
  status: string;
  direct: Direct[];
  properties: Array<{ id: string; name: string; assigned: boolean }>;
  permissions: Array<{ namespace: string; label: string; permissionable: boolean }>;
  onDone?: () => void;
};

const ROLE_OPTIONS = [
  { value: "owner", label: "Titular da conta" },
  { value: "agent", label: "Atendente" },
  { value: "viewer", label: "Visualizador" },
];

const SCOPE_OPTIONS = ["TENANT", "CLIENT", "PROPERTY", "RECORD"] as const;

/** Gestão de atribuições (FASE 4.3): roles, permissões diretas e escopos. */
export function UserAccessManager({
  targetUserId,
  isOwner,
  role,
  status,
  direct,
  properties,
  permissions,
  onDone,
}: Props) {
  const qc = useQueryClient();
  const assignRole = useServerFn(assignPermissionCenterRole);
  const removeRole = useServerFn(removePermissionCenterRole);
  const setStatus = useServerFn(setPermissionCenterUserStatus);
  const removeUser = useServerFn(removePermissionCenterUser);
  const grant = useServerFn(grantPermissionCenterPermission);
  const revoke = useServerFn(revokePermissionCenterPermission);
  const setProperty = useServerFn(setPermissionCenterPropertyScope);

  const [confirm, setConfirm] = useState<null | {
    title: string;
    description: string;
    run: () => Promise<unknown>;
  }>(null);

  const [namespace, setNamespace] = useState("");
  const [level, setLevel] = useState<"READ" | "WRITE">("READ");
  const [scopeType, setScopeType] = useState<(typeof SCOPE_OPTIONS)[number]>("TENANT");
  const [scopeId, setScopeId] = useState<string>("");

  const grantable = useMemo(
    () => permissions.filter((p) => p.permissionable !== false),
    [permissions],
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["permission-center-user", targetUserId] });
    qc.invalidateQueries({ queryKey: ["permission-center-overview"] });
    qc.invalidateQueries({ queryKey: ["permission-center-audit"] });
    onDone?.();
  };

  const mutation = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
    onSuccess: (res) => {
      const message = (res as { message?: string })?.message ?? "Alteração aplicada.";
      toast.success(message);
      refresh();
    },
    onError: (err: Error) => toast.error(err?.message || "Não foi possível aplicar a alteração."),
  });

  const busy = mutation.isPending;

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ roles */}
      <Card className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold">Papel do usuário</p>
          <p className="text-xs text-muted-foreground">
            O papel define a herança base. Permissões diretas somam-se a ela.
          </p>
        </div>

        {isOwner ? (
          <p className="text-xs text-muted-foreground">
            Titular da conta — papel fixo e não editável.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <Label className="text-xs">Papel atribuído</Label>
              <Select
                value={role}
                disabled={busy}
                onValueChange={(value) =>
                  mutation.mutate(() => assignRole({ data: { targetUserId, role: value as "agent" } }))
                }
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Selecionar papel" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                setConfirm({
                  title: "Remover papel do usuário",
                  description:
                    "O usuário perderá as permissões herdadas do papel atual e ficará como Visualizador. Deseja continuar?",
                  run: () => removeRole({ data: { targetUserId } }),
                })
              }
            >
              <UserMinus className="mr-1.5 h-4 w-4" /> Remover papel
            </Button>
          </div>
        )}

        {!isOwner && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={status === "active"}
                disabled={busy}
                onCheckedChange={(checked) =>
                  mutation.mutate(() =>
                    setStatus({
                      data: { targetUserId, status: checked ? "active" : "revoked" },
                    }),
                  )
                }
              />
              <span className="text-sm">
                {status === "active" ? "Usuário ativo" : "Usuário inativo (sem acesso)"}
              </span>
            </div>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() =>
                setConfirm({
                  title: "Remover acesso do usuário",
                  description:
                    "Todo o acesso deste usuário à conta será removido, incluindo permissões diretas e imóveis vinculados. Deseja continuar?",
                  run: () => removeUser({ data: { targetUserId } }),
                })
              }
            >
              <UserX className="mr-1.5 h-4 w-4" /> Remover acesso
            </Button>
          </div>
        )}
      </Card>

      {/* ---------------------------------------------- permissões diretas */}
      <Card className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold">Conceder permissão direta</p>
          <p className="text-xs text-muted-foreground">
            Grants explícitos para este usuário. Imóveis são apenas escopo — nunca permissão.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Label className="text-xs">Permissão</Label>
            <Select value={namespace} onValueChange={setNamespace} disabled={busy}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Selecionar permissão" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {grantable.map((p) => (
                  <SelectItem key={p.namespace} value={p.namespace}>
                    {p.label} — {p.namespace}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Nível</Label>
            <Select value={level} onValueChange={(v) => setLevel(v as "READ")} disabled={busy}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="READ">READ</SelectItem>
                <SelectItem value="WRITE">WRITE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Escopo</Label>
            <Select
              value={scopeType}
              onValueChange={(v) => {
                setScopeType(v as "TENANT");
                setScopeId("");
              }}
              disabled={busy}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {scopeType === "PROPERTY" && (
            <div className="sm:col-span-2">
              <Label className="text-xs">Residência do escopo</Label>
              <Select value={scopeId} onValueChange={setScopeId} disabled={busy}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Selecionar residência" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <Button
          disabled={busy || !namespace || (scopeType === "PROPERTY" && !scopeId)}
          onClick={() =>
            mutation.mutate(() =>
              grant({
                data: {
                  targetUserId,
                  namespace,
                  level,
                  scopeType,
                  scopeId: scopeType === "PROPERTY" ? scopeId : null,
                },
              }),
            )
          }
        >
          <Plus className="mr-1.5 h-4 w-4" /> Adicionar permissão
        </Button>

        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Concedidas diretamente
          </p>
          {direct.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma permissão direta atribuída.</p>
          ) : (
            direct.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.label}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {d.namespace}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> Direta
                  </Badge>
                  <Badge variant="secondary">{d.scopeType}</Badge>
                  <AccessBadge level={d.level as "READ"} showIcon={false} />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    aria-label={`Remover ${d.namespace}`}
                    onClick={() =>
                      setConfirm({
                        title: "Remover permissão direta",
                        description: `A permissão ${d.namespace} deixará de ser concedida diretamente. A herança por papel permanece. Deseja continuar?`,
                        run: () => revoke({ data: { targetUserId, assignmentId: d.id } }),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* -------------------------------------------------- escopo PROPERTY */}
      <Card className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold">Imóveis vinculados (escopo PROPERTY)</p>
          <p className="text-xs text-muted-foreground">
            O vínculo restringe o alcance das permissões — não cria permissões novas.
          </p>
        </div>
        {properties.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma residência cadastrada na conta.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {properties.map((p) => (
              <label
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{p.name}</span>
                </span>
                <Switch
                  checked={p.assigned}
                  disabled={busy}
                  onCheckedChange={(checked) => {
                    if (!checked) {
                      setConfirm({
                        title: "Remover imóvel vinculado",
                        description: `O usuário deixará de ter acesso à residência "${p.name}". Deseja continuar?`,
                        run: () =>
                          setProperty({
                            data: { targetUserId, propertyId: p.id, assigned: false },
                          }),
                      });
                      return;
                    }
                    mutation.mutate(() =>
                      setProperty({ data: { targetUserId, propertyId: p.id, assigned: true } }),
                    );
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </Card>

      <ConfirmActionDialog
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel="Confirmar remoção"
        onConfirm={() => {
          const run = confirm?.run;
          setConfirm(null);
          if (run) mutation.mutate(run);
        }}
      />
    </div>
  );
}
