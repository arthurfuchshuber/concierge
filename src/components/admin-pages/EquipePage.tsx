import { useServerFn } from "@tanstack/react-start";
import { useImpersonation } from "@/hooks/useImpersonation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import {
  listMyTeam,
  inviteTeamMember,
  revokeTeamInvite,
  resendTeamInvite,
  resendAllPendingInvites,
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

import { Shield as ShieldIcon } from "lucide-react";
import { PermissionTreeManager } from "@/components/permissions/PermissionTreeManager";
import { UserAccess } from "@/components/admin-pages/PermissionCenterPage";
import { getPermissionCenterOverview } from "@/lib/permission-center.functions";
import { PlanLockCard } from "@/components/ds/PlanLockCard";
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
import { Users, Bell, BellOff, Loader2, Trash2, Mail, Send as SendIcon, ShieldCheck, Home } from "lucide-react";
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
  const resendAllFn = useServerFn(resendAllPendingInvites);
  const removeFn = useServerFn(removeTeamMember);
  const updateRoleFn = useServerFn(updateTeamMemberRole);
  const qc = useQueryClient();
  const { impersonation } = useImpersonation();
  const acctId = impersonation?.userId ?? null;
  const scope = acctId ? { accountOwnerId: acctId } : {};
  const { info: sub } = useSubscription();
  const planFeatures = sub.features;
  const planName = sub.plan ? sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1) : "atual";

  const access = useQuery({ queryKey: ["handoff-access"], queryFn: () => accessFn(), staleTime: 5 * 60_000 });
  const team = useQuery({ queryKey: ["my-team", acctId], queryFn: () => listFn({ data: scope }), enabled: access.data?.allowed === true });
  const perms = useQuery({
    queryKey: ["member-permissions", acctId],
    queryFn: () => permsFn({ data: scope }),
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
  const [openSection, setOpenSection] = useState<string>("");


  const invite = useMutation({
    mutationFn: async () => inviteFn({ data: { ...scope, email: email.trim().toLowerCase(), role } }),
    onSuccess: (res) => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["my-team", acctId] });
      setFeedback(res?.emailSent ? "Convite enviado por email." : "Convite criado, mas o email não foi enviado. Use “Reenviar”.");
      setTimeout(() => setFeedback(null), 4500);
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => revokeFn({ data: { ...scope, inviteId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-team", acctId] }),
  });
  const resend = useMutation({
    mutationFn: async (id: string) => resendFn({ data: { ...scope, inviteId: id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-team", acctId] });
      setFeedback("Convite reenviado.");
      setTimeout(() => setFeedback(null), 3500);
    },
    onError: (e) => {
      setFeedback("Falha ao reenviar: " + (e as Error).message);
      setTimeout(() => setFeedback(null), 5000);
    },
  });
  const resendAll = useMutation({
    mutationFn: async () => resendAllFn({ data: scope }),
    onSuccess: (res) => {
      const r = res as { total: number; sent: number; failed: Array<{ email: string }> };
      qc.invalidateQueries({ queryKey: ["my-team", acctId] });
      if (r.sent > 0) {
        toast.success(
          `${r.sent} de ${r.total} convite(s) reenviado(s) por e-mail.` +
            (r.failed.length ? ` ${r.failed.length} falharam.` : ""),
        );
      } else if (r.total === 0) {
        toast.info("Não há convites pendentes.");
      } else {
        toast.error("Nenhum e-mail pôde ser enviado agora.");
      }
    },
    onError: (e) => toast.error("Falha ao reenviar: " + (e as Error).message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => removeFn({ data: { ...scope, memberId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-team", acctId] }),
  });
  const changeRole = useMutation({
    mutationFn: async (v: { id: string; r: "owner" | "agent" | "viewer" }) => updateRoleFn({ data: { ...scope, memberId: v.id, role: v.r } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-team", acctId] });
      toast.success("Permissão atualizada");
    },
    onError: (e) => toast.error("Falha ao atualizar: " + (e as Error).message),
  });

  const updPerm = useMutation({
    mutationFn: (v: { memberUserId: string; permission: MemberPermission; granted: boolean }) =>
      updPermFn({ data: { ...scope, ...v } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["member-permissions", acctId] });
      const prev = qc.getQueryData<any>(["member-permissions", acctId]);
      if (prev?.matrix?.[v.memberUserId]) {
        // Cascade espelho do servidor: ligar EDIT liga VIEW; desligar VIEW desliga EDIT.
        const area = PERMISSION_AREAS.find((a) => a.view === v.permission || a.edit === v.permission);
        const patch: Record<string, boolean> = { [v.permission]: v.granted };
        if (area) {
          if (v.permission === area.edit && v.granted) patch[area.view] = true;
          else if (v.permission === area.view && !v.granted) patch[area.edit] = false;
        }
        qc.setQueryData(["member-permissions", acctId], {
          ...prev,
          matrix: {
            ...prev.matrix,
            [v.memberUserId]: { ...prev.matrix[v.memberUserId], ...patch },
          },
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["member-permissions", acctId], ctx.prev);
      toast.error("Não foi possível salvar a permissão.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["member-permissions", acctId] });
      qc.invalidateQueries({ queryKey: ["my-permissions"] });
    },
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
      <PlanLockCard
        title="Permissões disponíveis no Business e Enterprise"
        description="Convidar atendentes e controlar quem acessa o quê faz parte dos planos superiores."
        bullets={[
          "Convite e gestão de atendentes",
          "Permissões por área e por imóvel",
          "Permissões detalhadas por recurso",
        ]}
        currentPlan={planName}
      />
    );
  }

  return (
    <div className="w-full space-y-8">


      <Accordion
        type="single"
        collapsible
        value={openSection}
        onValueChange={setOpenSection}
        className="flex flex-col gap-1.5"
      >

        <AccordionItem
          value="push"
          className="glass border border-border overflow-hidden data-[state=open]:border-primary/40"
        >
          <AccordionTrigger className="px-4 lg:px-6 py-4 hover:no-underline">
            <span className="ds-card-title flex items-center gap-2">
              {pushOn ? <Bell className="size-4 text-primary" /> : <BellOff className="size-4 text-muted-foreground" />}
              Notificações neste dispositivo
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <div className="px-4 lg:px-6 pb-5 pt-1 border-t border-border/60">
              <p className="text-sm text-muted-foreground mb-3 mt-3">
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
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="invite"
          className="glass border border-border overflow-hidden data-[state=open]:border-primary/40"
        >
          <AccordionTrigger className="px-4 lg:px-6 py-4 hover:no-underline">
            <span className="ds-card-title flex items-center gap-2">
              <Mail className="size-4 text-primary" /> Convidar atendente
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <div className="px-4 lg:px-6 pb-5 pt-4 border-t border-border/60">
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
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="members"
          className="glass border border-border overflow-hidden data-[state=open]:border-primary/40"
        >
          <AccordionTrigger className="px-4 lg:px-6 py-4 hover:no-underline">
            <span className="ds-card-title flex items-center gap-2">
              <Users className="size-4 text-primary" /> Membros da equipe
              <span className="ds-meta px-2 py-0.5 rounded-full bg-secondary border border-border">
                {members.length}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <div className="px-4 lg:px-6 pb-5 pt-4 border-t border-border/60">
              {members.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">Nenhum membro ainda. Envie um convite acima.</div>
              ) : (
                <Accordion type="single" collapsible value={openMemberId} onValueChange={setOpenMemberId} className="flex flex-col gap-1.5">
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
                        className="border border-border overflow-hidden bg-background/60 data-[state=open]:border-primary/40"
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
                                <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                                  <ShieldCheck className="size-3" /> Permissões por área
                                </h3>
                                <ul className="divide-y divide-border/60 rounded-lg border border-border/60 overflow-hidden">
                                  {PERMISSION_AREAS.map((area) => {
                                    const viewVal = !!perms[area.view];
                                    const editVal = !!perms[area.edit];
                                    const feature = PERMISSION_FEATURE[area.edit] ?? PERMISSION_FEATURE[area.view];
                                    const locked = !!feature && !planFeatures[feature];
                                    return (
                                      <li
                                        key={area.area}
                                        className={`flex items-center gap-3 px-3 py-2 ${locked ? "opacity-60" : ""}`}
                                        title={locked ? `Disponível em planos superiores ao ${planName}` : area.description}
                                      >
                                        <div className="flex-1 min-w-0">
                                          <div className="text-[13px] font-medium truncate flex items-center gap-1.5">
                                            {area.label}
                                            {locked && (
                                              <span className="text-[9px] uppercase tracking-wide px-1 py-px rounded bg-secondary border border-border text-muted-foreground">
                                                Indisponível
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <label className="flex items-center gap-1.5 shrink-0">
                                          <span className="text-[11px] text-muted-foreground">Ver</span>
                                          <Switch
                                            checked={locked ? false : viewVal}
                                            disabled={updPerm.isPending || locked}
                                            onCheckedChange={(checked) =>
                                              updPerm.mutate({ memberUserId: id, permission: area.view, granted: checked })
                                            }
                                          />
                                        </label>
                                        <label className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-border/60">
                                          <span className="text-[11px] text-muted-foreground">Editar</span>
                                          <Switch
                                            checked={locked ? false : editVal}
                                            disabled={updPerm.isPending || locked}
                                            onCheckedChange={(checked) =>
                                              updPerm.mutate({ memberUserId: id, permission: area.edit, granted: checked })
                                            }
                                          />
                                        </label>
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
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="invites"
          className="glass border border-border overflow-hidden data-[state=open]:border-primary/40"
        >
          <AccordionTrigger className="px-4 lg:px-6 py-4 hover:no-underline">
            <span className="ds-card-title flex items-center gap-2">
              <SendIcon className="size-4 text-primary" /> Convites pendentes
              <span className="ds-meta px-2 py-0.5 rounded-full bg-secondary border border-border">
                {team.data?.invites?.length ?? 0}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <div className="px-4 lg:px-6 pb-5 pt-2 border-t border-border/60">
              {(team.data?.invites?.length ?? 0) > 0 && (
                <div className="flex justify-end pt-3">
                  <button
                    onClick={() => resendAll.mutate()}
                    disabled={resendAll.isPending}
                    className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {resendAll.isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <SendIcon className="size-3" />
                    )}
                    Reenviar todos os convites
                  </button>
                </div>
              )}
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
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="permissoes-v2"
          className="glass border border-border overflow-hidden data-[state=open]:border-primary/40"
        >
          <AccordionTrigger className="px-4 lg:px-6 py-4 hover:no-underline">
            <span className="ds-card-title flex items-center gap-2">
              <ShieldIcon className="size-4 text-primary" /> Permissões detalhadas por recurso
              <span className="ds-meta px-2 py-0.5 rounded-full bg-secondary border border-border">
                em validação
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <div className="px-4 lg:px-6 pb-5 pt-4 border-t border-border/60">
              <p className="text-xs text-muted-foreground mb-3">
                Nova arquitetura de permissões por página, aba, seção e recurso. As alterações aqui
                ainda não substituem os acessos configurados acima.
              </p>
              <PermissionTreeManager context="account" />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="acesso-area-imovel"
          className="glass border border-border overflow-hidden data-[state=open]:border-primary/40"
        >
          <AccordionTrigger className="px-4 lg:px-6 py-4 hover:no-underline">
            <span className="ds-card-title flex items-center gap-2">
              <Home className="size-4 text-primary" /> Acesso por área e imóvel
              <AreaAccessCountBadge />
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <div className="px-4 lg:px-6 pb-5 pt-4 border-t border-border/60">
              <p className="ds-body text-muted-foreground mb-4">
                Controle fino de área (visualizar ou editar) e de quais imóveis cada pessoa
                enxerga. O titular da conta sempre tem acesso total.
              </p>
              <AreaPropertyAccessList />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>



    </div>
  );
}

/* ---------- 6ª seção: acesso por área e imóvel ---------- */

function useAreaAccessOverview() {
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const fn = useServerFn(getPermissionCenterOverview);
  return useQuery({
    queryKey: ["permission-center-overview", accountOwnerId],
    queryFn: () => fn({ data: { ownerId: accountOwnerId } }),
    retry: false,
  });
}

function AreaAccessCountBadge() {
  const q = useAreaAccessOverview();
  const users = q.data && q.data.allowed !== false ? q.data.users.filter((u) => !u.isOwner) : [];
  if (!users.length) return null;
  return (
    <span className="ds-meta px-2 py-0.5 rounded-full bg-secondary border border-border">
      {users.length} {users.length === 1 ? "pessoa" : "pessoas"}
    </span>
  );
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function AreaPropertyAccessList() {
  const q = useAreaAccessOverview();
  const [open, setOpen] = useState<string>("");

  if (q.isLoading) {
    return (
      <div className="ds-meta flex items-center gap-2">
        <Loader2 className="size-3 animate-spin" /> Carregando acessos…
      </div>
    );
  }
  if (q.isError || !q.data || q.data.allowed === false) {
    return (
      <p className="ds-body text-muted-foreground">
        Esta área só pode ser gerenciada pelo titular da conta.
      </p>
    );
  }
  const users = q.data.users;
  if (!users.length) {
    return (
      <p className="ds-body text-muted-foreground">
        Ainda não há ninguém além de você nesta conta.
      </p>
    );
  }

  return (
    <Accordion type="single" collapsible value={open} onValueChange={setOpen} className="flex flex-col gap-1.5">
      {users.map((u) => (
        <AccordionItem
          key={u.userId}
          value={u.userId}
          className="border border-border overflow-hidden bg-background/60 data-[state=open]:border-primary/40"
        >
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <span className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold">
                {initialsOf(u.name || u.email || "?")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{u.name}</span>
                <span className="ds-meta block truncate">
                  {u.isOwner ? "Titular da conta" : (u.email ?? "—")}
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <div className="border-t border-border/60 p-4">
              {open === u.userId ? <UserAccess userId={u.userId} /> : null}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
