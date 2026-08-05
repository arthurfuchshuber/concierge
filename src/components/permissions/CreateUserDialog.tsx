import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inviteTeamMember } from "@/lib/team.functions";

/**
 * Convite de membro — segue o fluxo oficial de equipe: e-mail de convite,
 * convite pendente e popup de aceite no primeiro acesso.
 */
export function CreateUserDialog() {
  const qc = useQueryClient();
  const invite = useServerFn(inviteTeamMember);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");

  const mutation = useMutation({
    mutationFn: () => invite({ data: { email, role: "agent" as const } }),
    onSuccess: (res) => {
      const r = res as { emailSent?: boolean; existingUser?: boolean };
      toast.success(
        r?.existingUser
          ? "Convite criado. A pessoa verá o aviso para aceitar assim que entrar no painel."
          : r?.emailSent
            ? "Convite enviado por e-mail. Assim que a pessoa aceitar, você já pode liberar as áreas."
            : "Convite criado, mas o e-mail não saiu. Use “Reenviar” para tentar de novo.",
      );
      qc.invalidateQueries({ queryKey: ["permission-center-overview"] });
      qc.invalidateQueries({ queryKey: ["permission-center-audit"] });
      qc.invalidateQueries({ queryKey: ["my-team"] });
      setOpen(false);
      setEmail("");
    },
    onError: (err: Error) => toast.error(err?.message || "Não foi possível enviar o convite."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-10 gap-1.5">
          <UserPlus className="h-4 w-4" /> Convidar Membro
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar Membro</DialogTitle>
          <DialogDescription>
            Enviamos um convite por e-mail. O acesso passa a valer quando a pessoa aceita o convite
            no primeiro acesso ao painel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">E-mail</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@empresa.com"
              className="mt-1"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Depois de aceitar o convite, a pessoa entra sem nenhum acesso. Você libera cada área
            aqui mesmo, escolhendo entre “Sem acesso”, “Visualizar” ou “Editar”.
          </p>
        </div>

        <DialogFooter>
          <Button
            disabled={mutation.isPending || !email.includes("@")}
            onClick={() => mutation.mutate()}
          >
            Enviar convite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

