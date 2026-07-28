import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import {
  listMyTeam,
  inviteTeamMember,
  revokeTeamInvite,
  resendTeamInvite,
  removeTeamMember,
  updateTeamMemberRole,
} from "@/lib/team.functions";
import {
  listMemberPermissions,
  updateMemberPermission,
  MEMBER_PERMISSIONS,
  PERMISSION_META,
  PERMISSION_FEATURE,
  PERMISSION_AREAS,
  type MemberPermission,
} from "@/lib/member-permissions.functions";

import { getAtendimentoAccess } from "@/lib/handoff.functions";
import { useSubscription } from "@/hooks/useSubscription";
import { enablePush, disablePush, isPushSupported, currentPushSubscription } from "@/lib/push-client";
import { supabase } from "@/integrations/supabase/client";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { Users, Bell, BellOff, Loader2, Trash2, Mail, Send as SendIcon, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export { EquipePage };

const OPERATIONAL_PERMS = MEMBER_PERMISSIONS.filter(
  (p) => PERMISSION_META[p].group === "operational",
);
const TOTAL_TOGGLES = PERMISSION_AREAS.length * 2;


function EquipePage() {
  const accessFn = useServerFn(getAtendimentoAccess);
  const listFn = useServerFn(listMyTeam);
  const permsFn = useServerFn(listMemberPermissions);
  const updPermFn = useServerFn(updateMemberPermission);
  const inviteFn = useServerFn(inviteTeamMember);
  const revokeFn = useServerFn(revokeTeamInvite);
  const resendFn = useServerFn(resendTeamInvite);
  const removeFn = useServerFn(removeTeamMember);
  const updateRoleFn = useServerFn(updateTeamMemberRole);
  const qc = useQueryClient();
  const { info: sub } = useSubscription();
  const planFeatures = sub.features;
  const planName = sub.plan ? sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1) : "atual";

  const access = useQuery({ queryKey: ["handoff-access"], queryFn: () => accessFn(), staleTime: 5 * 60_000 });
  const team = useQuery({ queryKey: ["my-team"], queryFn: () => listFn(), enabled: access.data?.allowed === true });
  const perms = useQuery({
    queryKey: ["member-permissions"],
    queryFn: () => permsFn(),
    enabled: access.data?.allowed === true,
  });

  const [myUserId, setMyUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
  }, []);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "agent" | "viewer">("agent");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [openMemberId, setOpenMemberId] = useState<string>("");

  const invite = useMutation({
    mutationFn: async () => inviteFn({ data: { email: email.trim().toLowerCase(), role } }),
    onSuccess: (res) => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["my-team"] });
      setFeedback(res?.emailSent ? "Convite enviado por email." : "Convite criado, mas o email não foi enviado. Use “Reenviar”.");
      setTimeout(() => setFeedback(null), 4500);
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => revokeFn({ data: { inviteId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-team"] }),
  });
  const resend = useMutation({
    mutationFn: async (id: string) => resendFn({ data: { inviteId: id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-team"] });
      setFeedback("Convite reenviado.");
      setTimeout(() => setFeedback(null), 3500);
    },
    onError: (e) => {
      setFeedback("Falha ao reenviar: " + (e as Error).message);
      setTimeout(() => setFeedback(null), 5000);
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => removeFn({ data: { memberId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-team"] }),
  });
  const changeRole = useMutation({
    mutationFn: async (v: { id: string; r: "owner" | "agent" | "viewer" }) => updateRoleFn({ data: { memberId: v.id, role: v.r } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-team"] });
      toast.success("Permissão atualizada");
    },
    onError: (e) => toast.error("Falha ao atualizar: " + (e as Error).message),
  });

  const updPerm = useMutation({
    mutationFn: (v: { memberUserId: string; permission: MemberPermission; granted: boolean }) =>
      updPermFn({ data: v }),
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

  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    if (!isPushSupported()) { setPushOn(false); return; }
    currentPushSubscription().then((s) => setPushOn(!!s));
  }, []);

  async function togglePush() {
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        toast.success("Notificações desativadas");
        return;
      }
      if (!isPushSupported()) {
        const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
        const nav = typeof window !== "undefined" ? (window.navigator as Navigator & { standalone?: boolean }) : null;
        const standalone = nav?.standalone || window.matchMedia?.("(display-mode: standalone)").matches;
        if (isIOS && !standalone) {
          toast.error("No iPhone/iPad, adicione o app à Tela de Início e abra por ali para ativar notificações.");
        } else {
          toast.error("Este navegador não suporta notificações push.");
        }
        return;
      }
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        toast.error("Notificações bloqueadas. Ative nas configurações do navegador para este site.");
        return;
      }
      const r = await enablePush();
      if (r.ok) {
        setPushOn(true);
        toast.success("Notificações ativadas neste dispositivo");
      } else if (r.reason === "denied") {
        toast.error("Você negou a permissão de notificações.");
      } else {
        toast.error("Não foi possível ativar notificações (" + r.reason + ")");
      }
    } catch (e) {
      console.error("[push] enable error", e);
      toast.error("Erro ao ativar notificações: " + ((e as Error)?.message ?? "desconhecido"));
    } finally {
      setPushBusy(false);
    }
  }

  const members = team.data?.members ?? [];
  const profiles = team.data?.profiles ?? {};
  const permMatrix = perms.data?.matrix ?? {};

  const membersWithPerms = useMemo(
    () => members.filter((m) => (m.member_user_id as string) !== myUserId),
    [members, myUserId],
  );

  if (access.data?.allowed !== true) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="glass rounded-2xl p-8 border border-border">
          <h1 className="font-display text-2xl mb-2">Equipe</h1>
          <p className="text-sm text-muted-foreground mb-4">
            Convidar atendentes está disponível nos planos <strong>Business</strong> e <strong>Enterprise</strong>.
          </p>
          <a href="/admin/assinatura" className="inline-flex items-center rounded-xl px-4 py-2 bg-primary text-primary-foreground font-medium">
            Fazer upgrade
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-2">
        <Users className="size-5 text-primary" />
        <h1 className="font-display text-2xl">Equipe & Permissões</h1>
      </div>
      <p className="text-sm text-muted-foreground -mt-4">
        Dados e recursos que cada membro pode acessar. Recursos operacionais respeitam os limites do seu plano.
      </p>

      <section className="glass rounded-2xl p-4 lg:p-6 border border-border">
        <h2 className="font-display text-lg mb-1 flex items-center gap-2">
          {pushOn ? <Bell className="size-4 text-primary" /> : <BellOff className="size-4 text-muted-foreground" />}
          Notificações neste dispositivo
        </h2>
        <p className="text-sm text-muted-foreground mb-3">
          Receba um alerta com som e badge no ícone quando um hóspede pedir atendimento humano.
          {typeof window !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent) && (
            <> No iPhone/iPad, primeiro adicione o app à tela de início ("Adicionar à Tela de Início") e abra por ali.</>
          )}
        </p>
        <button
          onClick={togglePush}
          disabled={pushBusy || pushOn === null}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 border border-border font-medium hover:bg-secondary disabled:opacity-50"
        >
          {pushBusy && <Loader2 className="size-4 animate-spin" />}
          {pushOn ? "Desativar notificações" : "Ativar notificações"}
        </button>
      </section>

      <section className="glass rounded-2xl p-4 lg:p-6 border border-border">
        <h2 className="font-display text-lg mb-3 flex items-center gap-2">
          <Mail className="size-4 text-primary" /> Convidar atendente
        </h2>
        <form
          onSubmit={(e) => { e.preventDefault(); if (email.trim() && !invite.isPending) invite.mutate(); }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@atendente.com"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />


          <button
            type="submit"
            disabled={invite.isPending || !email.trim()}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {invite.isPending ? "Enviando…" : "Convidar"}
          </button>
        </form>
        {invite.isError && <p className="text-xs text-red-500 mt-2">{(invite.error as Error).message}</p>}
        {feedback && <p className="text-xs text-primary mt-2">{feedback}</p>}
        <p className="text-[11px] text-muted-foreground mt-2">
          Business: até 2 atendentes além do titular. Enterprise: ilimitado. O convidado precisa se cadastrar com o mesmo e-mail para ativar.
        </p>
      </section>

      <section className="glass rounded-2xl p-4 lg:p-6 border border-border">
        <h2 className="font-display text-lg mb-3">Membros da equipe</h2>
        {members.length === 0 ? (
          <div className="text-sm text-muted-foreground py-2">Nenhum membro ainda. Envie um convite acima.</div>
        ) : (
          <Accordion type="single" collapsible value={openMemberId} onValueChange={setOpenMemberId} className="space-y-3">
            {members.map((m) => {
              const id = m.member_user_id as string;
              const prof = profiles[id];
              const isSelf = !!(myUserId && id === myUserId);
              const perms = permMatrix[id] ?? {};
              const activeCount = OPERATIONAL_PERMS.filter((p) => !!perms[p]).length;

              return (
                <AccordionItem
                  key={m.id as string}
                  value={id}
                  className="rounded-2xl border border-border overflow-hidden bg-background/60 data-[state=open]:border-primary/40"
                >
                  <AccordionTrigger className="px-4 py-3 hover:no-underline">
                    <div className="flex-1 min-w-0 text-left flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {prof?.full_name || prof?.email || id}
                          {isSelf && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">(você · titular)</span>}
                        </div>
                        {prof?.email && <div className="text-[11px] text-muted-foreground truncate">{prof.email}</div>}
                      </div>
                      {!isSelf && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary border border-border">
                          {activeCount}/{TOTAL_TOGGLES} permissões
                        </span>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-0">
                    <div className="p-5 border-t border-border space-y-6">
                      {!isSelf && (
                        <div className="flex items-center justify-end">
                          <button
                            onClick={() => { if (confirm("Remover este atendente?")) remove.mutate(m.id as string); }}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/30"
                          >
                            <Trash2 className="size-3.5" /> Remover
                          </button>
                        </div>
                      )}


                      {!isSelf && (
                        <div>
                          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                            <ShieldCheck className="size-3.5" /> Permissões
                          </h3>
                          <ul className="space-y-3">
                            {OPERATIONAL_PERMS.map((p) => {
                              const meta = PERMISSION_META[p];
                              const val = !!perms[p];
                              const feature = PERMISSION_FEATURE[p];
                              const locked = !!feature && !planFeatures[feature];
                              return (
                                <li
                                  key={p}
                                  className={`flex items-start gap-3 ${locked ? "opacity-60" : ""}`}
                                  title={locked ? `Disponível em planos superiores ao ${planName}` : undefined}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                                      {meta.label}
                                      {locked && (
                                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                                          Indisponível no plano
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[12px] text-muted-foreground">{meta.description}</div>
                                  </div>
                                  <Switch
                                    checked={locked ? false : val}
                                    disabled={updPerm.isPending || locked}
                                    onCheckedChange={(checked) =>
                                      updPerm.mutate({
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
                      )}
                      {isSelf && (
                        <p className="text-xs text-muted-foreground">
                          Como titular da conta, você tem acesso total. Permissões são configuradas por membro convidado.
                        </p>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
        {membersWithPerms.length > 0 && perms.isLoading && (
          <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-3 animate-spin" /> Carregando permissões…
          </div>
        )}
      </section>

      <section className="glass rounded-2xl p-4 lg:p-6 border border-border">
        <h2 className="font-display text-lg mb-3">Convites pendentes</h2>
        <div className="divide-y divide-border">
          {team.data?.invites?.length === 0 && <div className="text-sm text-muted-foreground py-2">Nenhum convite pendente.</div>}
          {(team.data?.invites ?? []).map((i) => {
            const isResending = resend.isPending && resend.variables === (i.id as string);
            return (
              <div key={i.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{i.email as string}</div>
                  <div className="text-[11px] text-muted-foreground">Expira {new Date(i.expires_at as string).toLocaleDateString("pt-BR")}</div>
                </div>
                
                <button
                  onClick={() => resend.mutate(i.id as string)}
                  disabled={isResending}
                  className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1 disabled:opacity-60"
                >
                  {isResending ? <Loader2 className="size-3 animate-spin" /> : <SendIcon className="size-3" />}
                  Reenviar
                </button>
                <button onClick={() => revoke.mutate(i.id as string)} className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary">Revogar</button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
