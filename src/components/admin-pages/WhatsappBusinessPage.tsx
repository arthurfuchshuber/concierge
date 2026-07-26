import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMyWhatsappConfig,
  saveMyWhatsappConfig,
  disconnectMyWhatsappConfig,
} from "@/lib/whatsapp.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { MessageCircle, ExternalLink, Loader2, Trash2 } from "lucide-react";
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
    <div className="space-y-6">
      <Card className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-full bg-emerald-500/15 text-emerald-600 grid place-items-center">
              <MessageCircle className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-medium">WhatsApp Business (via Sinch)</h2>
              <p className="text-sm text-muted-foreground">
                Contate hóspedes proativamente e receba respostas na central de atendimento.
              </p>
            </div>
          </div>
          <Badge variant="outline" className={`capitalize ${statusColor}`}>
            {cfg?.status ?? "pending"}
          </Badge>
        </div>

        {cfg?.lastError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700 dark:text-red-400">
            Último erro: {cfg.lastError}
          </div>
        )}

        <div className="rounded-lg bg-secondary/40 p-4 space-y-3 text-sm">
          <div className="font-medium">1. Configure o webhook na Sinch</div>
          <p className="text-muted-foreground">
            No Conversations API Dashboard da Sinch, cadastre o webhook abaixo (evento <code>message_inbound</code> e <code>message_delivery</code>) usando este segredo como assinatura HMAC-SHA256.
          </p>
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Label className="w-24 text-xs text-muted-foreground">URL</Label>
              <Input readOnly value={cfg?.webhookUrl ?? ""} className="font-mono text-xs" />
              <CopyButton value={cfg?.webhookUrl ?? ""} />
            </div>
            <div className="flex items-center gap-2">
              <Label className="w-24 text-xs text-muted-foreground">Segredo</Label>
              <Input readOnly value={cfg?.webhookSecretMasked ?? ""} className="font-mono text-xs" />
            </div>
            <p className="text-xs text-muted-foreground">
              O segredo completo é gerado uma vez e nunca exibido. Se precisar rotacionar, desconecte e reconfigure.
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-secondary/40 p-4 space-y-3 text-sm">
          <div className="font-medium">2. Credenciais Sinch</div>
          <p className="text-muted-foreground">
            Encontre em <a href="https://dashboard.sinch.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">Sinch Dashboard <ExternalLink className="size-3" /></a> → Conversations API.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Número emissor (E.164)</Label>
              <Input
                placeholder="+5511999999999"
                value={form.senderNumber || cfg?.senderNumber || ""}
                onChange={(e) => setForm((f) => ({ ...f, senderNumber: e.target.value }))}
              />
            </div>
            <div>
              <Label>Project ID</Label>
              <Input
                placeholder="Ex: 12345678-abcd-…"
                value={form.projectId || cfg?.projectId || ""}
                onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
              />
            </div>
            <div>
              <Label>App ID</Label>
              <Input
                placeholder="Ex: 01H…"
                value={form.appId || cfg?.appId || ""}
                onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))}
              />
            </div>
            <div>
              <Label>API Token {cfg?.hasToken ? <span className="text-xs text-muted-foreground">(deixe em branco para manter)</span> : null}</Label>
              <Input
                type="password"
                placeholder={cfg?.hasToken ? "•••••••• (salvo)" : "Bearer token da Sinch"}
                value={form.apiToken}
                onChange={(e) => setForm((f) => ({ ...f, apiToken: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 border-red-500/30 hover:bg-red-500/10"
            onClick={() => { if (confirm("Remover configuração de WhatsApp Business?")) disconnect.mutate(); }}
            disabled={!cfg?.hasToken || disconnect.isPending}
          >
            <Trash2 className="size-4 mr-1" /> Desconectar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!showForm)}>
            {save.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            Salvar configuração
          </Button>
        </div>
      </Card>

      <div className="text-xs text-muted-foreground px-1">
        Observação: fora da janela de 24h desde a última resposta do hóspede, a Meta permite apenas <b>templates HSM pré-aprovados</b>. Gerencie seus templates diretamente no dashboard da Sinch e aguarde aprovação antes de enviar.
      </div>
    </div>
  );
}
