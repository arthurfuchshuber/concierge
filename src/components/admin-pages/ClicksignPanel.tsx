import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw, Trash2, FileSignature, ExternalLink, UserPlus, Copy, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  getMyClicksignConfig,
  saveMyClicksignConfig,
  disconnectMyClicksign,
  syncMyClicksignDocuments,
  listMyClicksignDocuments,
} from "@/lib/clicksign.functions";
import { ClicksignImportDialog } from "@/components/admin-pages/ClicksignImportDialog";
import { ClicksignDisconnectDialog } from "@/components/admin-pages/ClicksignDisconnectDialog";

const VINCULO: Record<string, string> = {
  owner: "Proprietário",
  provider: "Prestador",
  guest: "Hóspede",
};

export function ClicksignPanel() {
  const getFn = useServerFn(getMyClicksignConfig);
  const saveFn = useServerFn(saveMyClicksignConfig);
  const discFn = useServerFn(disconnectMyClicksign);
  const syncFn = useServerFn(syncMyClicksignDocuments);
  const listFn = useServerFn(listMyClicksignDocuments);
  const qc = useQueryClient();

  const [token, setToken] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const cfg = useQuery({ queryKey: ["clicksign-config"], queryFn: () => getFn(), retry: false });
  const connected = !!cfg.data?.hasToken;

  const docs = useQuery({
    queryKey: ["clicksign-docs"],
    queryFn: () => listFn(),
    enabled: connected,
  });

  const save = useMutation({
    mutationFn: async () => saveFn({ data: { apiToken: token || undefined, environment: "production" } }),
    onSuccess: () => {
      toast.success("ClickSign conectado.");
      setToken("");
      qc.invalidateQueries({ queryKey: ["clicksign-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: async () => syncFn(),
    onSuccess: (r) => {
      toast.success(`${r.total} contratos importados — ${r.linked} vinculados a cadastros.`);
      qc.invalidateQueries({ queryKey: ["clicksign-docs"] });
      qc.invalidateQueries({ queryKey: ["clicksign-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: async (purge: boolean) => discFn({ data: { purge } }),
    onSuccess: (r) => {
      toast.success(
        r.purged
          ? "ClickSign desconectado e dados da integração removidos."
          : "ClickSign desconectado. Os dados importados foram mantidos.",
      );
      setDisconnectOpen(false);
      qc.invalidateQueries({ queryKey: ["clicksign-config"] });
      qc.invalidateQueries({ queryKey: ["clicksign-docs"] });
      qc.invalidateQueries({ queryKey: ["stakeholders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (cfg.isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Chave de API</Label>
        <Input
          type="password"
          placeholder={connected ? "•••••••• (salva)" : "access_token do ClickSign"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Gere a chave em Configurações → API no painel do ClickSign.{" "}
        <a
          href="https://app.clicksign.com"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline inline-flex items-center gap-0.5"
        >
          Abrir ClickSign <ExternalLink className="size-3" />
        </a>
      </p>

      {connected && (
        <div className="space-y-2 rounded-xl border border-border bg-secondary/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">Webhook</p>
            {cfg.data?.webhookLastEventAt ? (
              <span className="text-[10px] text-muted-foreground">
                último evento {new Date(cfg.data.webhookLastEventAt).toLocaleString("pt-BR")}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">nenhum evento recebido</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Em Configurações → API → Webhooks no ClickSign, adicione a URL abaixo e cole o segredo
            no campo de HMAC para receber assinaturas em tempo real.
          </p>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">URL</Label>
            <div className="flex items-center gap-1.5">
              <Input readOnly value={webhookUrl} className="h-8 font-mono text-[11px]" />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 rounded-full px-2"
                onClick={() => copy(webhookUrl, "URL copiada.")}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Segredo (HMAC-SHA256)
            </Label>
            <div className="flex items-center gap-1.5">
              <Input
                readOnly
                value={cfg.data?.webhookSecret ?? ""}
                type={showSecret ? "text" : "password"}
                className="h-8 font-mono text-[11px]"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 rounded-full px-2"
                onClick={() => setShowSecret((v) => !v)}
              >
                {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 rounded-full px-2"
                onClick={() => copy(cfg.data?.webhookSecret ?? "", "Segredo copiado.")}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 rounded-full text-[11px]"
            onClick={() => rotate.mutate()}
            disabled={rotate.isPending}
          >
            {rotate.isPending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
            Gerar novo segredo
          </Button>
        </div>
      )}


      {cfg.data?.lastError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
          {cfg.data.lastError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8 rounded-full text-xs" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
          {connected ? "Atualizar chave" : "Conectar"}
        </Button>
        {connected && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-full text-xs"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
            >
              {sync.isPending ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 size-3.5" />
              )}
              Importar contratos
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-full text-xs"
              onClick={() => setImportOpen(true)}
            >
              <UserPlus className="mr-1 size-3.5" /> Importar cadastros
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-full text-xs text-red-600 hover:bg-red-500/10"
              onClick={() => setDisconnectOpen(true)}
              disabled={disconnect.isPending}
            >
              <Trash2 className="mr-1 size-3.5" /> Desconectar
            </Button>
          </>
        )}
      </div>

      {connected && (
        <div className="rounded-xl border border-border bg-secondary/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium">
              Contratos importados
              <span className="ml-1 text-muted-foreground">({cfg.data?.documentsCount ?? 0})</span>
            </p>
            {cfg.data?.lastSyncAt && (
              <span className="text-[10px] text-muted-foreground">
                última importação {new Date(cfg.data.lastSyncAt).toLocaleString("pt-BR")}
              </span>
            )}
          </div>
          {docs.isLoading ? (
            <p className="py-3 text-center text-[11px] text-muted-foreground">Carregando contratos…</p>
          ) : (docs.data?.documents.length ?? 0) === 0 ? (
            <p className="py-3 text-center text-[11px] text-muted-foreground">
              Nenhum contrato importado ainda.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {docs.data!.documents.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 rounded-lg bg-card px-2.5 py-2 text-[11px]"
                >
                  <FileSignature className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{d.name ?? d.document_key}</span>
                  {d.stakeholder_type && (
                    <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                      {VINCULO[d.stakeholder_type] ?? d.stakeholder_type}
                    </Badge>
                  )}
                  <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] capitalize">
                    {d.status ?? "—"}
                  </Badge>
                  {(d.url_signed || d.url_original) && (
                    <a
                      href={(d.url_signed ?? d.url_original) as string}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-primary"
                      aria-label="Abrir contrato"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ClicksignImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ClicksignDisconnectDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        pending={disconnect.isPending}
        onConfirm={(purge) => disconnect.mutate(purge)}
      />
    </div>
  );
}
