import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  RefreshCw,
  Trash2,
  FileSignature,
  ExternalLink,
  UserPlus,
  Copy,
  Eye,
  EyeOff,
  MoreHorizontal,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getMyClicksignConfig,
  saveMyClicksignConfig,
  disconnectMyClicksign,
  syncMyClicksignDocuments,
  listMyClicksignDocuments,
  rotateMyClicksignWebhookSecret,
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
  const [showSecret, setShowSecret] = useState(false);
  const [secret, setSecret] = useState("");
  // Apenas um quadrante aberto por vez; todos recolhidos ao abrir.
  const [section, setSection] = useState<string>("");

  const cfg = useQuery({ queryKey: ["clicksign-config"], queryFn: () => getFn(), retry: false });
  const connected = !!cfg.data?.hasToken;

  useEffect(() => {
    setSecret(cfg.data?.webhookSecret ?? "");
  }, [cfg.data?.webhookSecret]);

  const saveSecretFn = useServerFn(rotateMyClicksignWebhookSecret);
  const saveSecret = useMutation({
    mutationFn: async () => saveSecretFn({ data: { secret: secret.trim() } }),
    onSuccess: () => {
      toast.success("Segredo do webhook salvo.");
      qc.invalidateQueries({ queryKey: ["clicksign-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = cfg.data?.ownerId
    ? `${origin}/api/public/clicksign-webhook?o=${cfg.data.ownerId}`
    : "";

  const copy = (value: string, msg: string) => {
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => toast.success(msg));
  };

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
      <Accordion
        type="single"
        collapsible
        value={section}
        onValueChange={setSection}
        className="space-y-2"
      >
        <AccordionItem
          value="api"
          className="rounded-xl border border-border bg-secondary/30 px-3"
        >
          <AccordionTrigger className="py-2.5 text-xs font-medium hover:no-underline">
            <span className="truncate">Chave de API</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-2 pb-3">
            <Input
              type="password"
              placeholder={connected ? "•••••••• (salva)" : "access_token do ClickSign"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
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
          </AccordionContent>
        </AccordionItem>

        {connected && (
          <AccordionItem
            value="webhook"
            className="rounded-xl border border-border bg-secondary/30 px-3"
          >
            <AccordionTrigger className="py-2.5 text-xs font-medium hover:no-underline">
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2 pr-2">
                <span className="truncate">Webhook</span>
                <span className="shrink-0 whitespace-nowrap text-[10px] font-normal text-muted-foreground">
                  {cfg.data?.webhookLastEventAt
                    ? `último evento ${new Date(cfg.data.webhookLastEventAt).toLocaleString("pt-BR")}`
                    : "nenhum evento recebido"}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pb-3">
              <p className="text-[11px] text-muted-foreground">
                Em Configurações → API → Webhooks no ClickSign, adicione a URL abaixo e cole aqui o
                segredo HMAC gerado por lá.
              </p>
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  URL
                </Label>
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
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="cole aqui o segredo do ClickSign"
                    type={showSecret ? "text" : "password"}
                    autoComplete="off"
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
                    onClick={() => copy(secret, "Segredo copiado.")}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                O segredo é salvo junto com a chave de API ao clicar em “Salvar”.
              </p>

            </AccordionContent>
          </AccordionItem>
        )}

        {connected && (
          <AccordionItem
            value="docs"
            className="rounded-xl border border-border bg-secondary/30 px-3"
          >
            <AccordionTrigger className="py-2.5 text-xs font-medium hover:no-underline">
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2 pr-2">
                <span className="truncate whitespace-nowrap">
                  Contratos importados{" "}
                  <span className="text-muted-foreground">({cfg.data?.documentsCount ?? 0})</span>
                </span>
                {cfg.data?.lastSyncAt && (
                  <span className="shrink-0 whitespace-nowrap text-[10px] font-normal text-muted-foreground">
                    {new Date(cfg.data.lastSyncAt).toLocaleString("pt-BR")}
                  </span>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              {docs.isLoading ? (
                <p className="py-3 text-center text-[11px] text-muted-foreground">
                  Carregando contratos…
                </p>
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
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {cfg.data?.lastError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
          {cfg.data.lastError}
        </p>
      )}

      <div className="flex flex-nowrap items-center gap-2">
        <Button
          size="sm"
          className="h-8 shrink-0 rounded-full text-xs"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" />
          ) : (
            <Save className="mr-1 size-3.5" />
          )}
          {connected ? "Salvar" : "Conectar"}
        </Button>

        {connected && (
          <DropdownMenu modal={false}>

            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-full text-xs">
                <MoreHorizontal className="mr-1 size-3.5" /> Ações
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem onSelect={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-3.5" />
                )}
                Importar contratos
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                <UserPlus className="mr-2 size-3.5" /> Importar cadastros
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setDisconnectOpen(true)}
                disabled={disconnect.isPending}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="mr-2 size-3.5" /> Desconectar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

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
