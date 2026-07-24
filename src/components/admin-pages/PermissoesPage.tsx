import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { ShieldCheck, Users, Loader2, X } from "lucide-react";
import { toast } from "sonner";

const OPERATIONAL_PERMS = MEMBER_PERMISSIONS.filter(
  (p) => PERMISSION_META[p].group === "operational",
);

export function PermissoesPage() {
  const listFn = useServerFn(listMemberPermissions);
  const updFn = useServerFn(updateMemberPermission);
  const qc = useQueryClient();
  const { impersonation } = useImpersonation();
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
  }, []);
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
    onSettled: () => qc.invalidateQueries({ queryKey: ["my-permissions"] }),
  });

  const members = q.data?.members ?? [];
  const matrix = q.data?.matrix ?? {};
  const profiles = q.data?.profiles ?? {};

  const selectableIds = useMemo(
    () =>
      members
        .map((m) => m.member_user_id as string)
        .filter((id) => id !== myUserId),
    [members, myUserId],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleAll(on: boolean) {
    setSelected(on ? new Set(selectableIds) : new Set());
  }

  async function applyBulk(permission: MemberPermission, granted: boolean) {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const label = PERMISSION_META[permission].label;
    await Promise.allSettled(
      ids.map((memberUserId) => upd.mutateAsync({ memberUserId, permission, granted })),
    );
    toast.success(
      `${label}: ${granted ? "ativada" : "desativada"} para ${ids.length} membro${ids.length > 1 ? "s" : ""}.`,
      { duration: 1800 },
    );
  }

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

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6 pb-32">
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
            Você ainda não tem membros na equipe. Convide um em{" "}
            <a href="/admin/administrativo?tab=equipe" className="text-primary underline">
              Equipe
            </a>
            .
          </p>
        </div>
      )}

      {selectableIds.length > 0 && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(v) => toggleAll(!!v)}
            aria-label="Selecionar todos"
          />
          <span>Selecionar todos ({selectableIds.length})</span>
        </div>
      )}

      <Accordion
        type="single"
        collapsible
        value={openId}
        onValueChange={setOpenId}
        className="space-y-3"
      >
        {members.map((m) => {
          const id = m.member_user_id as string;
          const prof = profiles[id];
          const isSelf = id === myUserId;
          const perms = matrix[id] ?? {};
          const activeCount = OPERATIONAL_PERMS.filter((p) => !!perms[p]).length;
          return (
            <AccordionItem
              key={m.id as string}
              value={id}
              className="glass rounded-2xl border border-border overflow-hidden data-[state=open]:border-primary/40"
            >
              <div className="flex items-center gap-3 pl-4 pr-2 bg-secondary/40">
                {!isSelf ? (
                  <Checkbox
                    checked={selected.has(id)}
                    onCheckedChange={(v) => toggleOne(id, !!v)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Selecionar ${prof?.full_name || prof?.email || id}`}
                  />
                ) : (
                  <span className="w-4" />
                )}
                <AccordionTrigger className="flex-1 py-4 hover:no-underline">
                  <div className="flex-1 min-w-0 text-left flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {prof?.full_name || prof?.email || id}
                        {isSelf && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            (você)
                          </span>
                        )}
                      </div>
                      {prof?.email && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {prof.email}
                        </div>
                      )}
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-background border border-border">
                      {activeCount}/{OPERATIONAL_PERMS.length} permissões
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-background border border-border capitalize">
                      {m.role as string}
                    </span>
                  </div>
                </AccordionTrigger>
              </div>
              <AccordionContent className="pb-0">
                <div className="p-5 border-t border-border">
                  <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">
                    Operacional
                  </h3>
                  <ul className="space-y-3">
                    {OPERATIONAL_PERMS.map((p) => {
                      const meta = PERMISSION_META[p];
                      const val = !!perms[p];
                      return (
                        <li key={p} className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{meta.label}</div>
                            <div className="text-[12px] text-muted-foreground">
                              {meta.description}
                            </div>
                          </div>
                          <Switch
                            checked={val}
                            disabled={isSelf || upd.isPending}
                            onCheckedChange={(checked) =>
                              upd.mutate({
                                memberUserId: id,
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
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {selected.size > 0 && (
        <div className="fixed bottom-4 inset-x-4 md:left-auto md:right-8 md:bottom-8 md:max-w-xl z-40">
          <div className="glass rounded-2xl border border-primary/40 shadow-2xl p-4 space-y-3 bg-background/95 backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                Edição em massa · {selected.size} selecionado{selected.size > 1 ? "s" : ""}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7"
                onClick={() => setSelected(new Set())}
                aria-label="Limpar seleção"
              >
                <X className="size-4" />
              </Button>
            </div>
            <ul className="space-y-2">
              {OPERATIONAL_PERMS.map((p) => (
                <li
                  key={p}
                  className="flex items-center gap-2 rounded-xl border border-border p-2"
                >
                  <div className="flex-1 min-w-0 text-sm">{PERMISSION_META[p].label}</div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={upd.isPending}
                    onClick={() => applyBulk(p, true)}
                  >
                    Ativar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={upd.isPending}
                    onClick={() => applyBulk(p, false)}
                  >
                    Desativar
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
