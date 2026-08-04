import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  adminGrantSaasAdmin,
  adminListSaasAdmins,
  adminRevokeSaasAdmin,
  adminListInvites,
  adminRevokeInvite,
  adminListAuditLogs,
  checkIsAdmin,
} from "@/lib/admin-subs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Shield, ShieldCheck, Trash2, Loader2, UserPlus, Mail, Activity, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { PermissionTreeManager } from "@/components/permissions/PermissionTreeManager";


export const Route = createFileRoute("/_authenticated/admin/admins")({
  beforeLoad: async () => {
    try {
      const res = await checkIsAdmin();
      if (!res.isAdmin) throw redirect({ to: "/admin" });
    } catch {
      throw redirect({ to: "/admin" });
    }
  },
  component: AdminsPage,
});

function AdminsPage() {
  const listFn = useServerFn(adminListSaasAdmins);
  const grantFn = useServerFn(adminGrantSaasAdmin);
  const revokeFn = useServerFn(adminRevokeSaasAdmin);
  const invitesFn = useServerFn(adminListInvites);
  const revokeInviteFn = useServerFn(adminRevokeInvite);
  const logsFn = useServerFn(adminListAuditLogs);
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [granting, setGranting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingInvite, setRevokingInvite] = useState<string | null>(null);
  const [logSearch, setLogSearch] = useState("");
  const [tab, setTab] = useState("admins");

  const query = useQuery({
    queryKey: ["admin-saas-admins"],
    queryFn: () => listFn(),
  });

  const invitesQuery = useQuery({
    queryKey: ["admin-invites"],
    queryFn: () => invitesFn(),
  });

  const logsQuery = useQuery({
    queryKey: ["admin-audit-logs", logSearch],
    queryFn: () => logsFn({ data: { search: logSearch || undefined, limit: 500 } }),
    enabled: tab === "logs",
  });

  const admins = query.data?.admins ?? [];
  const selfUserId = query.data?.selfUserId ?? "";
  const invites = invitesQuery.data?.invites ?? [];
  const logs = logsQuery.data?.logs ?? [];

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setGranting(true);
    try {
      const res = await grantFn({ data: { email: email.trim() } });
      toast.success(res.invited ? "Convite enviado para o email." : "Acesso admin concedido.");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["admin-saas-admins"] });
      qc.invalidateQueries({ queryKey: ["admin-invites"] });
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(userId: string, label: string) {
    if (!confirm(`Revogar acesso admin de ${label}?`)) return;
    setRevokingId(userId);
    try {
      await revokeFn({ data: { userId } });
      toast.success("Acesso revogado");
      qc.invalidateQueries({ queryKey: ["admin-saas-admins"] });
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeInvite(inviteId: string, emailLabel: string) {
    if (!confirm(`Cancelar convite enviado para ${emailLabel}?`)) return;
    setRevokingInvite(inviteId);
    try {
      await revokeInviteFn({ data: { inviteId } });
      toast.success("Convite cancelado.");
      qc.invalidateQueries({ queryKey: ["admin-invites"] });
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRevokingInvite(null);
    }
  }

  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-7xl mx-auto w-full">
      <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-accent font-semibold mb-2">
        <Shield className="size-3" /> Admin SaaS
      </div>
      <h1 className="font-display text-3xl md:text-4xl flex items-center gap-2.5">
        <ShieldCheck className="size-7 text-muted-foreground" /> Administradores
      </h1>
      <p className="text-sm text-muted-foreground mt-1.5">
        Gerencie quem tem acesso de administrador e veja tudo o que cada pessoa fez no SaaS.
      </p>

      <Tabs value={tab} onValueChange={setTab} className="mt-8">
        <TabsList>
          <TabsTrigger value="admins"><ShieldCheck className="size-4 mr-1.5" />Administradores</TabsTrigger>
          <TabsTrigger value="invites"><Mail className="size-4 mr-1.5" />Convites {invites.length > 0 && <span className="ml-1 text-[10px] bg-accent text-accent-foreground px-1.5 rounded-full">{invites.length}</span>}</TabsTrigger>
          <TabsTrigger value="permissoes"><Shield className="size-4 mr-1.5" />Permissões</TabsTrigger>
          <TabsTrigger value="logs"><Activity className="size-4 mr-1.5" />Log de atividades</TabsTrigger>
        </TabsList>

        <TabsContent value="permissoes" className="mt-6">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground mb-4">
            Nova arquitetura de permissões (em validação). As alterações aqui ainda não substituem o
            controle de acesso atual do sistema.
          </div>
          <PermissionTreeManager context="saas" />
        </TabsContent>


        <TabsContent value="admins" className="mt-6 space-y-6">
          <form
            onSubmit={handleGrant}
            className="p-5 rounded-2xl border border-border bg-surface flex gap-3 items-end flex-wrap"
          >
            <div className="flex-1 min-w-[240px]">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Email do convidado (se ainda não tiver conta, enviamos um convite)
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@exemplo.com"
                required
              />
            </div>
            <Button type="submit" disabled={granting} className="rounded-full">
              {granting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Conceder ou convidar
            </Button>
          </form>

          <div className="rounded-2xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-medium text-sm">Administradores atuais</h2>
              <span className="text-xs text-muted-foreground">{admins.length} no total</span>
            </div>
            {query.isLoading ? (
              <div className="p-8 grid place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
            ) : admins.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Nenhum admin.</div>
            ) : (
              <ul className="divide-y divide-border">
                {admins.map((a) => {
                  const isSelf = a.userId === selfUserId;
                  const label = a.email ?? a.userId;
                  return (
                    <li key={a.userId} className="px-5 py-4 flex items-center gap-4">
                      <div className="size-9 rounded-full bg-accent text-accent-foreground grid place-items-center text-xs font-semibold shrink-0">
                        {(a.email ?? "?").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{a.fullName ?? a.email ?? "—"}</div>
                        <div className="text-xs text-muted-foreground truncate">{a.email ?? a.userId}</div>
                      </div>
                      {isSelf ? (
                        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">Você</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={revokingId === a.userId}
                          onClick={() => handleRevoke(a.userId, label)}
                          className="text-destructive hover:text-destructive"
                        >
                          {revokingId === a.userId ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                          Revogar
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="invites" className="mt-6">
          <div className="rounded-2xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-medium text-sm">Convites pendentes</h2>
              <span className="text-xs text-muted-foreground">{invites.length} no total</span>
            </div>
            {invitesQuery.isLoading ? (
              <div className="p-8 grid place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
            ) : invites.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Nenhum convite pendente.</div>
            ) : (
              <ul className="divide-y divide-border">
                {invites.map((inv) => (
                  <li key={inv.id} className="px-5 py-4 flex items-center gap-4">
                    <Mail className="size-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{inv.email}</div>
                      <div className="text-xs text-muted-foreground">
                        Convidado{inv.invitedByEmail ? ` por ${inv.invitedByEmail}` : ""}
                        {inv.createdAt ? ` • ${new Date(inv.createdAt).toLocaleString("pt-BR")}` : ""}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revokingInvite === inv.id}
                      onClick={() => handleRevokeInvite(inv.id, inv.email)}
                      className="text-destructive hover:text-destructive"
                    >
                      {revokingInvite === inv.id ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                      Cancelar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-6 space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Buscar por email, ação, tabela ou ID…"
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["admin-audit-logs"] })}>
              Atualizar
            </Button>
          </div>

          <div className="rounded-2xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-medium text-sm">Atividades recentes</h2>
              <span className="text-xs text-muted-foreground">{logs.length} registros</span>
            </div>
            {logsQuery.isLoading ? (
              <div className="p-8 grid place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
            ) : logs.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Nenhum registro encontrado.</div>
            ) : (
              <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap w-[150px]">Quando</th>
                      <th className="text-left px-4 py-2.5 font-medium w-[280px]">Usuário</th>
                      <th className="text-left px-4 py-2.5 font-medium whitespace-nowrap w-[240px]">Ação</th>
                      <th className="text-left px-4 py-2.5 font-medium">Item</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {logs.map((l) => (
                      <tr key={l.id} className="hover:bg-muted/20 align-middle">
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(l.createdAt).toLocaleString("pt-BR")}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-medium truncate" title={l.userEmail ?? ""}>{l.userEmail ?? "—"}</div>
                          {l.userId && <div className="text-[10px] text-muted-foreground font-mono truncate" title={l.userId}>{l.userId.slice(0, 8)}…</div>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-medium whitespace-nowrap">
                            {l.actionLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="font-medium">{l.itemLabel}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
