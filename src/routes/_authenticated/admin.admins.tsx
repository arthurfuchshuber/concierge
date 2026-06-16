import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  adminGrantSaasAdmin,
  adminListSaasAdmins,
  adminRevokeSaasAdmin,
  checkIsAdmin,
} from "@/lib/admin-subs.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, ShieldCheck, Trash2, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

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
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [granting, setGranting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin-saas-admins"],
    queryFn: () => listFn(),
  });

  const admins = query.data?.admins ?? [];
  const selfUserId = query.data?.selfUserId ?? "";

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setGranting(true);
    try {
      await grantFn({ data: { email: email.trim() } });
      toast.success("Acesso admin concedido");
      setEmail("");
      qc.invalidateQueries({ queryKey: ["admin-saas-admins"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao conceder");
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
      toast.error(err instanceof Error ? err.message : "Erro ao revogar");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="px-5 lg:px-10 py-8 lg:py-10 max-w-4xl mx-auto w-full">
      <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-accent font-semibold mb-2">
        <Shield className="size-3" /> Admin SaaS
      </div>
      <h1 className="font-serif text-3xl md:text-4xl flex items-center gap-2.5">
        <ShieldCheck className="size-7 text-muted-foreground" /> Administradores
      </h1>
      <p className="text-sm text-muted-foreground mt-1.5">
        Gerencie quem tem acesso de administrador da plataforma SigmaGuide.
      </p>

      <form
        onSubmit={handleGrant}
        className="mt-8 p-5 rounded-2xl border border-border bg-surface flex gap-3 items-end flex-wrap"
      >
        <div className="flex-1 min-w-[240px]">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Email do usuário (precisa já ter conta criada)
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
          Conceder acesso
        </Button>
      </form>

      <div className="mt-8 rounded-2xl border border-border bg-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-medium text-sm">Administradores atuais</h2>
          <span className="text-xs text-muted-foreground">{admins.length} no total</span>
        </div>
        {query.isLoading ? (
          <div className="p-8 grid place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
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
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
                      Você
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revokingId === a.userId}
                      onClick={() => handleRevoke(a.userId, label)}
                      className="text-destructive hover:text-destructive"
                    >
                      {revokingId === a.userId ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      Revogar
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
