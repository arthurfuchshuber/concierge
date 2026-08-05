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
import { createPermissionCenterUser } from "@/lib/permission-center.functions";

/** Criação de usuário — gera um convite de acesso pendente na conta. */
export function CreateUserDialog() {
  const qc = useQueryClient();
  const create = useServerFn(createPermissionCenterUser);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("agent");

  const mutation = useMutation({
    mutationFn: () => create({ data: { email, role: role as "agent" } }),
    onSuccess: (res) => {
      toast.success(res?.message ?? "Convite criado.");
      qc.invalidateQueries({ queryKey: ["permission-center-overview"] });
      qc.invalidateQueries({ queryKey: ["permission-center-audit"] });
      setOpen(false);
      setEmail("");
    },
    onError: (err: Error) => toast.error(err?.message || "Não foi possível criar o usuário."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Criar usuário
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar usuário</DialogTitle>
          <DialogDescription>
            Um convite de acesso é criado para o e-mail informado. O acesso passa a valer quando o
            convite é aceito.
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
          <div>
            <Label className="text-xs">Papel inicial</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">Atendente</SelectItem>
                <SelectItem value="viewer">Visualizador</SelectItem>
                <SelectItem value="owner">Titular da conta</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            disabled={mutation.isPending || !email.includes("@")}
            onClick={() => mutation.mutate()}
          >
            Criar acesso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
