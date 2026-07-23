import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Mail, UserPlus, X } from "lucide-react";
import {
  listMyPendingInvites,
  acceptMyInvite,
  declineMyInvite,
} from "@/lib/pending-invites.functions";

const ROLE_LABEL: Record<string, string> = {
  owner: "titular",
  agent: "atendente",
  viewer: "leitor",
};

export function PendingInviteDialog() {
  const listFn = useServerFn(listMyPendingInvites);
  const acceptFn = useServerFn(acceptMyInvite);
  const declineFn = useServerFn(declineMyInvite);
  const qc = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const invites = useQuery({
    queryKey: ["my-pending-invites"],
    queryFn: () => listFn(),
    staleTime: 30_000,
    retry: false,
  });

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["my-pending-invites"] }),
      qc.invalidateQueries({ queryKey: ["my-accounts"] }),
      qc.invalidateQueries({ queryKey: ["my-permissions"] }),
    ]);
  };

  const accept = useMutation({
    mutationFn: (id: string) => acceptFn({ data: { inviteId: id } }),
    onError: (e: Error) => setErrorMsg(e.message),
    onSuccess: invalidateAll,
  });
  const decline = useMutation({
    mutationFn: (id: string) => declineFn({ data: { inviteId: id } }),
    onError: (e: Error) => setErrorMsg(e.message),
    onSuccess: invalidateAll,
  });

  const list = invites.data ?? [];
  if (invites.isLoading || list.length === 0) return null;

  const inv = list[0];
  const ownerLabel = inv.owner_name || inv.owner_email || "outra conta";
  const roleLabel = ROLE_LABEL[inv.role] ?? inv.role;

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm grid place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-3">
            <UserPlus className="size-5" strokeWidth={2} />
          </div>
          <h2 className="font-display text-xl leading-tight">
            Você foi convidado para uma equipe
          </h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            Aceite para ter acesso ao painel administrativo desta conta.
          </p>
        </div>

        <div className="px-6 py-5 space-y-3">
          <div className="rounded-xl border border-border bg-background/60 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Conta:</span>
              <span className="font-medium truncate">{ownerLabel}</span>
            </div>
            {inv.owner_email && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="size-3.5" />
                <span className="truncate">{inv.owner_email}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Papel:</span>
              <span className="font-medium capitalize">{roleLabel}</span>
            </div>
          </div>

          {list.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Você tem {list.length} convites pendentes. Responda um de cada vez.
            </p>
          )}

          {errorMsg && (
            <p className="text-xs text-red-500">{errorMsg}</p>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-2">
          <button
            disabled={decline.isPending || accept.isPending}
            onClick={() => {
              setErrorMsg(null);
              decline.mutate(inv.id);
            }}
            className="flex-1 h-10 rounded-xl border border-border text-sm font-medium hover:bg-secondary/60 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <X className="size-4" /> Recusar
          </button>
          <button
            disabled={accept.isPending || decline.isPending}
            onClick={() => {
              setErrorMsg(null);
              accept.mutate(inv.id);
            }}
            className="flex-[1.4] h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-95 transition-opacity disabled:opacity-50"
          >
            {accept.isPending ? "Aceitando…" : "Aceitar convite"}
          </button>
        </div>
      </div>
    </div>
  );
}
