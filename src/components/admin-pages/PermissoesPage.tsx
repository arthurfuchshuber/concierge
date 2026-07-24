import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  listMemberPermissions,
  updateMemberPermission,
  MEMBER_PERMISSIONS,
  PERMISSION_META,
  type MemberPermission,
} from "@/lib/member-permissions.functions";
import { supabase } from "@/integrations/supabase/client";
import { useImpersonation } from "@/hooks/useImpersonation";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function PermissoesPage() {
  const listFn = useServerFn(listMemberPermissions);
  const updFn = useServerFn(updateMemberPermission);
  const qc = useQueryClient();
  const { impersonation } = useImpersonation();
  const [myUserId, setMyUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
  }, []);
  // Owner context = no impersonation, OR impersonating own account (SaaS admin viewing self).
  // The server function always scopes to context.userId, so it's safe.
  const isOwnerContext = !impersonation || (!!myUserId && impersonation.userId === myUserId);

  const q = useQuery({
    queryKey: ["member-permissions"],
    queryFn: () => listFn(),
    enabled: isOwnerContext,
  });

  const upd = useMutation({
    mutationFn: (v: { memberUserId: string; permission: MemberPermission; granted: boolean }) =>
      updFn({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["member-permissions"] });
      const prev = qc.getQueryData<any>(["member-permissions"]);
      if (prev?.matrix?.[v.memberUserId]) {
        qc.setQueryData(["member-permissions"], {
          ...prev,
          matrix: {
            ...prev.matrix,
            [v.memberUserId]: { ...prev.matrix[v.memberUserId], [v.permission]: v.granted },
          },
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["member-permissions"], ctx.prev);
      toast.error("Não foi possível salvar a permissão.");
    },
    onSuccess: () => toast.success("Permissão atualizada.", { duration: 1500 }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["my-permissions"] }),
  });

  if (!isOwnerContext) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="glass rounded-2xl p-8 border border-border">
          <h1 className="font-display text-2xl mb-2 flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" /> Permissões da equipe
          </h1>
          <p className="text-sm text-muted-foreground">
            Somente o dono da conta pode gerenciar permissões dos membros.
          </p>
        </div>
      </div>
    );
  }

  const members = q.data?.members ?? [];
  const matrix = q.data?.matrix ?? {};
  const profiles = q.data?.profiles ?? {};

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-primary" />
        <h1 className="font-display text-2xl">Permissões da equipe</h1>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Defina o que cada membro convidado pode fazer dentro da sua conta. Recursos operacionais
        respeitam os limites do seu plano.
      </p>

      {q.isLoading && (
        <div className="glass rounded-2xl p-6 border border-border flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      )}

      {!q.isLoading && members.length === 0 && (
        <div className="glass rounded-2xl p-8 border border-border text-center">
          <Users className="size-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Você ainda não tem membros na equipe. Convide um em <a href="/admin/administrativo?tab=equipe" className="text-primary underline">Equipe</a>.
          </p>
        </div>
      )}

      {members.map((m) => {
        const prof = profiles[m.member_user_id as string];
        const isSelf = m.member_user_id === myUserId;
        const perms = matrix[m.member_user_id as string] ?? {};
        return (
          <section key={m.id as string} className="glass rounded-2xl border border-border overflow-hidden">
            <header className="px-5 py-4 border-b border-border bg-secondary/40 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {prof?.full_name || prof?.email || (m.member_user_id as string)}
                  {isSelf && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">(você)</span>}
                </div>
                {prof?.email && <div className="text-[11px] text-muted-foreground truncate">{prof.email}</div>}
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-background border border-border capitalize">
                {m.role as string}
              </span>
            </header>
            <div className="p-5">
              <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">
                Operacional
              </h3>
              <ul className="space-y-3">
                {MEMBER_PERMISSIONS.filter((p) => PERMISSION_META[p].group === "operational").map((p) => {
                  const meta = PERMISSION_META[p];
                  const val = !!perms[p];
                  return (
                    <li key={p} className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{meta.label}</div>
                        <div className="text-[12px] text-muted-foreground">{meta.description}</div>
                      </div>
                      <Switch
                        checked={val}
                        disabled={isSelf || upd.isPending}
                        onCheckedChange={(checked) =>
                          upd.mutate({
                            memberUserId: m.member_user_id as string,
                            permission: p,
                            granted: checked,
                          })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        );
      })}
    </div>
  );
}
