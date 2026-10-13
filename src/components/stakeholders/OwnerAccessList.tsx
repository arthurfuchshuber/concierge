import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Activity,
  BookOpen,
  Coins,
  Headphones,
  LayoutGrid,
  Loader2,
  Settings,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  getPermissionCenterUser,
  grantPermissionCenterPermission,
} from "@/lib/permission-center.functions";
import { ACCOUNT_AREAS } from "@/lib/permissions/permission.areas";
import { useImpersonation } from "@/hooks/useImpersonation";
import { GroupList, GroupRow, GroupTitle, StatusTrail } from "./owner-ui";

/**
 * ABA "ACESSOS" DO PROPRIETÁRIO (mockup Prop9): e-mail com a situação do acesso
 * e, embaixo, "Pode acessar" com UM interruptor por página do menu.
 *
 * Ligar = "Visualizar"; desligar = "Sem acesso" (mesma concessão do Centro de
 * Permissões, `grantPermissionCenterPermission`). Quem já tem "Editar" continua
 * ligado e mostra a legenda "Pode editar" — o ajuste fino por ação continua no
 * Centro de Permissões.
 */
type Level = "NONE" | "READ" | "WRITE";

function iconFor(title: string) {
  const t = title.toLowerCase();
  if (/painel|dashboard/.test(t)) return Activity;
  if (/guia/.test(t)) return BookOpen;
  if (/financ/.test(t)) return Coins;
  if (/limpez|opera/.test(t)) return Sparkles;
  if (/prestador|propriet|stakeholder|equipe/.test(t)) return Users;
  if (/suporte|atendimento|conversa/.test(t)) return Headphones;
  if (/config|ajuste/.test(t)) return Settings;
  return LayoutGrid;
}

export function OwnerAccessList({
  userId,
  email,
  status,
}: {
  userId: string;
  email: string;
  status: "active" | "pending";
}) {
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const qc = useQueryClient();
  const fn = useServerFn(getPermissionCenterUser);
  const grant = useServerFn(grantPermissionCenterPermission);

  const q = useQuery({
    queryKey: ["permission-center-user", accountOwnerId, userId],
    queryFn: () => fn({ data: { targetUserId: userId, ownerId: accountOwnerId } }),
    retry: false,
  });
  const detail = q.data && q.data.allowed !== false ? q.data : null;

  const levels = useMemo(() => {
    const map = new Map<string, Level>();
    if (!detail) return map;
    for (const i of detail.inherited) map.set(i.namespace, i.level as Level);
    for (const d of detail.direct) map.set(d.namespace, d.level as Level);
    return map;
  }, [detail]);

  const mutation = useMutation({
    mutationFn: (input: { namespace: string; level: Level }) =>
      grant({
        data: {
          targetUserId: userId,
          namespace: input.namespace,
          level: input.level,
          scopeType: "TENANT" as const,
          scopeId: null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["permission-center-user", userId] });
      qc.invalidateQueries({ queryKey: ["permission-center-overview"] });
      qc.invalidateQueries({ queryKey: ["area-access"] });
    },
    onError: (e: Error) =>
      toast.error(
        e.message || "Não conseguimos salvar essa alteração agora. Tente de novo em instantes.",
      ),
  });

  const isOwner = !!detail?.user.isOwner;
  const pages = ACCOUNT_AREAS.map((g) => ({
    namespace: g.namespace,
    title: g.title,
    level: (isOwner ? "WRITE" : (levels.get(g.namespace) ?? "NONE")) as Level,
  }));
  const on = pages.filter((p) => p.level !== "NONE").length;

  return (
    <div className="grid gap-6">
      <GroupList>
        <GroupRow
          icon={User}
          roundIcon
          title={email}
          sub={
            status === "active"
              ? "Acesso liberado"
              : "Convite enviado, aguardando o primeiro acesso"
          }
          trailing={
            <StatusTrail tone={status === "active" ? "ok" : "at"}>
              {status === "active" ? "Ativo" : "Pendente"}
            </StatusTrail>
          }
          chevron={false}
        />
      </GroupList>

      <div>
        <GroupTitle title="Pode acessar" count={detail ? `${on} de ${pages.length}` : undefined} />
        {q.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando acessos…
          </p>
        ) : !detail ? (
          <p className="ds-meta">Você não tem permissão para gerenciar os acessos desta conta.</p>
        ) : (
          <GroupList>
            {pages.map((p) => (
              <GroupRow
                key={p.namespace}
                icon={iconFor(p.title)}
                title={p.title}
                sub={p.level === "WRITE" && !isOwner ? "Pode editar" : undefined}
                minH={56}
                chevron={false}
                trailing={
                  <Switch
                    checked={p.level !== "NONE"}
                    disabled={isOwner || mutation.isPending}
                    onCheckedChange={(v) =>
                      mutation.mutate({ namespace: p.namespace, level: v ? "READ" : "NONE" })
                    }
                    aria-label={p.title}
                  />
                }
              />
            ))}
          </GroupList>
        )}
      </div>
    </div>
  );
}
