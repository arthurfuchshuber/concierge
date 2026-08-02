import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyWhatsappConfig,
  saveMyWhatsappConfig,
  disconnectMyWhatsappConfig,
} from "@/lib/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function WhatsappBusinessPage() {
  const getFn = useServerFn(getMyWhatsappConfig);
  const saveFn = useServerFn(saveMyWhatsappConfig);
  const disconnectFn = useServerFn(disconnectMyWhatsappConfig);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["whatsapp-config"],
    queryFn: () => getFn(),
  });

  const [form, setForm] = useState({
    senderNumber: "",
    projectId: "",
    appId: "",
    apiToken: "",
  });

  const cfg = q.data;
  const initialized = cfg?.senderNumber ?? "";
  const showForm = initialized === "" || (form.senderNumber !== "" || form.apiToken !== "");

  const save = useMutation({
    mutationFn: async () => saveFn({ data: {
      senderNumber: form.senderNumber || (cfg?.senderNumber ?? ""),
      projectId: form.projectId || (cfg?.projectId ?? ""),
      appId: form.appId || (cfg?.appId ?? ""),
      apiToken: form.apiToken || undefined,
    } }),
    onSuccess: () => {
      toast.success("Configuração salva. Cole a URL de webhook no painel da Sinch para receber mensagens.");
      qc.invalidateQueries({ queryKey: ["whatsapp-config"] });
      setForm({ senderNumber: "", projectId: "", appId: "", apiToken: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: async () => disconnectFn(),
    onSuccess: () => {
      toast.success("WhatsApp desconectado.");
      qc.invalidateQueries({ queryKey: ["whatsapp-config"] });
    },
  });

  if (q.isLoading) return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</div>;

  const statusColor =
    cfg?.status === "active" ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" :
    cfg?.status === "error" ? "bg-red-500/15 text-red-700 border-red-500/30" :
    cfg?.status === "testing" ? "bg-amber-500/15 text-amber-700 border-amber-500/30" :
    "bg-muted text-muted-foreground border-border";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Conecte sua conta Sinch para conversar com hóspedes pelo WhatsApp.
        </p>
        <Badge variant="outline" className={`capitalize shrink-0 ${statusColor}`}>
          {cfg?.status ?? "pendente"}
        </Badge>
      </div>

      {cfg?.lastError && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {cfg.lastError}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">Número emissor</Label>
          <Input
            placeholder="+5511999999999"
            value={form.senderNumber || cfg?.senderNumber || ""}
            onChange={(e) => setForm((f) => ({ ...f, senderNumber: e.target.value }))}
          />
        </div>
        <div>
          <Label className="text-xs">Project ID</Label>
          <Input
            placeholder="12345678-abcd-…"
            value={form.projectId || cfg?.projectId || ""}
            onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
          />
        </div>
        <div>
          <Label className="text-xs">App ID</Label>
          <Input
            placeholder="01H…"
            value={form.appId || cfg?.appId || ""}
            onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))}
          />
        </div>
        <div>
          <Label className="text-xs">API Token</Label>
          <Input
            type="password"
            placeholder={cfg?.hasToken ? "•••••••• (salvo)" : "Token da Sinch"}
            value={form.apiToken}
            onChange={(e) => setForm((f) => ({ ...f, apiToken: e.target.value }))}
          />
        </div>
      </div>

      <details className="rounded-xl border border-border bg-secondary/30 px-3 py-2 group">
        <summary className="text-xs cursor-pointer text-muted-foreground list-none flex items-center justify-between">
          Webhook e ajuda
          <ExternalLink className="size-3 opacity-60" />
        </summary>
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input readOnly value={cfg?.webhookUrl ?? ""} className="font-mono text-[11px] h-8" />
            <CopyButton value={cfg?.webhookUrl ?? ""} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Cadastre essa URL na Sinch (eventos <code>message_inbound</code> e <code>message_delivery</code>). O segredo
            HMAC ({cfg?.webhookSecretMasked ?? "—"}) só aparece uma vez; para trocar, desconecte e reconfigure.
            Credenciais em{" "}
            <a
              href="https://dashboard.sinch.com"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              dashboard.sinch.com
            </a>
            .
          </p>
        </div>
      </details>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full text-red-600 hover:bg-red-500/10"
          onClick={() => { if (confirm("Remover configuração de WhatsApp Business?")) disconnect.mutate(); }}
          disabled={!cfg?.hasToken || disconnect.isPending}
        >
          <Trash2 className="size-4 mr-1" /> Desconectar
        </Button>
        <Button className="rounded-full" onClick={() => save.mutate()} disabled={save.isPending || !showForm}>
          {save.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </div>
  );
}

