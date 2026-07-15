import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  listMyTeam,
  inviteTeamMember,
  revokeTeamInvite,
  resendTeamInvite,
  removeTeamMember,
  updateTeamMemberRole,
} from "@/lib/team.functions";
import { getAtendimentoAccess } from "@/lib/handoff.functions";
import { enablePush, disablePush, isPushSupported, currentPushSubscription } from "@/lib/push-client";
import { supabase } from "@/integrations/supabase/client";
import { Users, Bell, BellOff, Loader2, Trash2, Mail, Send as SendIcon } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/equipe")({
  component: EquipePage,
});

function EquipePage() {
  const accessFn = useServerFn(getAtendimentoAccess);
  const listFn = useServerFn(listMyTeam);
  const inviteFn = useServerFn(inviteTeamMember);
  const revokeFn = useServerFn(revokeTeamInvite);
  const removeFn = useServerFn(removeTeamMember);
  const updateRoleFn = useServerFn(updateTeamMemberRole);
  const qc = useQueryClient();

  const access = useQuery({ queryKey: ["handoff-access"], queryFn: () => accessFn(), staleTime: 5 * 60_000 });
  const team = useQuery({ queryKey: ["my-team"], queryFn: () => listFn(), enabled: access.data?.allowed === true });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "agent" | "viewer">("agent");

  const invite = useMutation({
    mutationFn: async () => inviteFn({ data: { email: email.trim().toLowerCase(), role } }),
    onSuccess: () => { setEmail(""); qc.invalidateQueries({ queryKey: ["my-team"] }); },
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => revokeFn({ data: { inviteId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-team"] }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => removeFn({ data: { memberId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-team"] }),
  });
  const changeRole = useMutation({
    mutationFn: async (v: { id: string; r: "owner" | "agent" | "viewer" }) => updateRoleFn({ data: { memberId: v.id, role: v.r } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-team"] }),
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
      if (pushOn) { await disablePush(); setPushOn(false); }
      else {
        const r = await enablePush();
        if (r.ok) setPushOn(true);
        else alert("Não foi possível ativar notificações: " + r.reason);
      }
    } finally { setPushBusy(false); }
  }

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
    <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Users className="size-5 text-primary" />
        <h1 className="font-display text-2xl">Equipe de atendimento</h1>
      </div>

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
          <select value={role} onChange={(e) => setRole(e.target.value as any)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="agent">Atendente</option>
            <option value="viewer">Somente leitura</option>
            <option value="owner">Co-titular</option>
          </select>
          <button
            type="submit"
            disabled={invite.isPending || !email.trim()}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {invite.isPending ? "Enviando…" : "Convidar"}
          </button>
        </form>
        {invite.isError && <p className="text-xs text-red-500 mt-2">{(invite.error as Error).message}</p>}
        <p className="text-[11px] text-muted-foreground mt-2">
          Business: até 2 atendentes além do titular. Enterprise: ilimitado. O convidado precisa se cadastrar com o mesmo e-mail para ativar.
        </p>
      </section>

      <section className="glass rounded-2xl p-4 lg:p-6 border border-border">
        <h2 className="font-display text-lg mb-3">Membros ativos</h2>
        <div className="divide-y divide-border">
          {team.data?.members?.length === 0 && <div className="text-sm text-muted-foreground py-2">Nenhum membro ainda.</div>}
          {(team.data?.members ?? []).map((m) => {
            const prof = team.data?.profiles[m.member_user_id as string];
            return (
              <div key={m.id} className="py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{prof?.full_name || prof?.email || m.member_user_id}</div>
                  {prof?.email && <div className="text-[11px] text-muted-foreground truncate">{prof.email}</div>}
                </div>
                <select
                  value={m.role as string}
                  onChange={(e) => changeRole.mutate({ id: m.id as string, r: e.target.value as any })}
                  className="text-xs rounded-md border border-border bg-background px-2 py-1"
                >
                  <option value="agent">Atendente</option>
                  <option value="viewer">Somente leitura</option>
                  <option value="owner">Co-titular</option>
                </select>
                <button
                  onClick={() => { if (confirm("Remover este atendente?")) remove.mutate(m.id as string); }}
                  className="size-8 grid place-items-center rounded-md text-red-500 hover:bg-red-500/10"
                  aria-label="Remover"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="glass rounded-2xl p-4 lg:p-6 border border-border">
        <h2 className="font-display text-lg mb-3">Convites pendentes</h2>
        <div className="divide-y divide-border">
          {team.data?.invites?.length === 0 && <div className="text-sm text-muted-foreground py-2">Nenhum convite pendente.</div>}
          {(team.data?.invites ?? []).map((i) => (
            <div key={i.id} className="py-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{i.email as string}</div>
                <div className="text-[11px] text-muted-foreground">Expira {new Date(i.expires_at as string).toLocaleDateString("pt-BR")}</div>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary">{i.role as string}</span>
              <button onClick={() => revoke.mutate(i.id as string)} className="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary">Revogar</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
