import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, DatabaseZap, Eye, EyeOff, Loader2, Lock, Plug, Save } from "lucide-react";
import { toast } from "sonner";
import {
  getMyClicksignConfig,
  saveMyClicksignConfig,
  disconnectMyClicksign,
  syncMyClicksignDocuments,
  listMyClicksignDocuments,
  rotateMyClicksignWebhookSecret,
  refreshClicksignStakeholderData,
} from "@/lib/clicksign.functions";
import { previewClicksignStakeholders } from "@/lib/clicksign-import.functions";
import { ClicksignImportDialog } from "@/components/admin-pages/ClicksignImportDialog";
import { ClicksignDisconnectDialog } from "@/components/admin-pages/ClicksignDisconnectDialog";
import {
  ClicksignContractStartConflictDialog,
  type ClicksignContractStartConflict,
} from "@/components/admin-pages/ClicksignContractStartConflictDialog";
import { DocPreviewDialog, type PreviewTarget } from "@/components/stakeholders/DocPreviewDialog";
import { CLICKSIGN_STATUS as STATUS, sortClicksignDocs } from "@/lib/clicksign-doc-order";
import {
  ActionSquare,
  DisconnectMenu,
  FieldAction,
  IntegrationShell,
  MergedField,
  PrimaryAction,
  SoftToggles,
  StatusTag,
  Step,
} from "@/components/admin-pages/integration-window";

const VINCULO: Record<string, string> = {
  owner: "Proprietário",
  provider: "Prestador",
  guest: "Hóspede",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Doc = {
  id: string;
  document_key: string | null;
  name: string | null;
  status: string | null;
  url_signed: string | null;
  url_original: string | null;
  finished_at: string | null;
  synced_at: string | null;
  stakeholder_type: string | null;
};

type View = "webhook" | "contratos";

/**
 * Janela do ClickSign (mockups aprovados, 08/11/2026): Webhook | Contratos (N) em botões suaves;
 * "Atualizar Dados" faz tudo de uma vez (importa os contratos, vincula aos cadastros, completa os
 * dados e, se houver contratante sem cadastro, abre a janela "Novos Cadastros"); o "⋯" guarda só
 * o Desconectar.
 */
export function ClicksignPanel({
  accountOwnerId = null,
  readOnly = false,
  inWindow = false,
}: {
  accountOwnerId?: string | null;
  readOnly?: boolean;
  /** Dentro da janela (celular): cabeçalho e recuos da janela. */
  inWindow?: boolean;
}) {
  const getFn = useServerFn(getMyClicksignConfig);
  const saveFn = useServerFn(saveMyClicksignConfig);
  const saveSecretFn = useServerFn(rotateMyClicksignWebhookSecret);
  const discFn = useServerFn(disconnectMyClicksign);
  const syncFn = useServerFn(syncMyClicksignDocuments);
  const listFn = useServerFn(listMyClicksignDocuments);
  const refreshDataFn = useServerFn(refreshClicksignStakeholderData);
  const previewFn = useServerFn(previewClicksignStakeholders);
  const qc = useQueryClient();

  const [view, setView] = useState<View>("webhook");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget>(null);
  const [contractStartConflicts, setContractStartConflicts] = useState<
    ClicksignContractStartConflict[]
  >([]);
  /** Resumo da atualização que ficou esperando a decisão dos conflitos de vigência. */
  const pendingSummary = useRef<{ total: number; filled: number } | null>(null);

  const cfg = useQuery({
    queryKey: ["clicksign-config", accountOwnerId],
    queryFn: () => getFn({ data: { ownerId: accountOwnerId } }),
    retry: false,
  });
  const connected = !!cfg.data?.hasToken;

  const docs = useQuery({
    queryKey: ["clicksign-docs", accountOwnerId],
    queryFn: () => listFn({ data: { ownerId: accountOwnerId } }),
    enabled: connected,
  });
  const sortedDocs = useMemo(
    () => sortClicksignDocs((docs.data?.documents ?? []) as Doc[]),
    [docs.data],
  );

  // O segredo nunca chega em texto puro do servidor — o campo começa vazio e
  // só é enviado quando alguém digita um novo valor.
  useEffect(() => {
    setSecret("");
  }, [cfg.data?.webhookSecretMasked]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = cfg.data?.ownerId
    ? `${origin}/api/public/clicksign-webhook?o=${cfg.data.ownerId}`
    : "";

  const copy = (value: string, msg: string) => {
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => toast.success(msg));
  };

  // Um único "Salvar": grava a chave de API (revalidando a conexão) e o segredo do webhook.
  const save = useMutation({
    mutationFn: async () => {
      await saveFn({ data: { apiToken: token || undefined, environment: "production" } });
      const s = secret.trim();
      if (s.length >= 8) await saveSecretFn({ data: { secret: s } });
    },
    onSuccess: () => {
      toast.success(connected ? "Integração salva." : "ClickSign conectado.");
      setToken("");
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

  /** Fim da atualização: contratantes sem cadastro abrem "Novos Cadastros"; senão, aviso claro. */
  async function finishUpdate(summary: { total: number; filled: number }) {
    const res = await qc.fetchQuery({
      queryKey: ["clicksign-import-preview"],
      queryFn: () => previewFn(),
      staleTime: 0,
    });
    const pending = res.candidates.filter((c) => c.status !== "linked").length;
    const linked = res.candidates.length - pending;
    if (pending > 0) {
      setImportOpen(true);
      return;
    }
    const dataLine =
      summary.filled > 0
        ? `${plural(summary.filled, "cadastro foi completado", "cadastros foram completados")} com os dados dos contratos.`
        : linked > 0
          ? linked === 1
            ? "O cadastro vinculado já está com os dados em dia."
            : `Os ${linked} cadastros vinculados já estão com os dados em dia.`
          : "Nenhum contrato está vinculado a um cadastro ainda.";
    toast.success("ClickSign Atualizado", {
      // Aviso de várias linhas: cantos de janela (16px), não a pílula das notificações curtas.
      className: "!rounded-[16px]",
      description: `${plural(summary.total, "contrato conferido", "contratos conferidos")}. ${dataLine} Nenhum cadastro novo para criar.`,
    });
  }

  /**
   * "Atualizar Dados" (tudo de uma vez): importa os contratos e vincula aos cadastros, relê os
   * contratos dos cadastros vinculados para completar o que falta e, por fim, confere se algum
   * contratante ainda não tem cadastro.
   */
  async function runUpdate(overwriteContractStart: boolean) {
    setUpdating(true);
    try {
      const s = await syncFn({ data: { overwriteContractStart } });
      const r = await refreshDataFn({ data: { overwriteContractStart } });
      qc.invalidateQueries({ queryKey: ["clicksign-docs"] });
      qc.invalidateQueries({ queryKey: ["clicksign-config"] });
      qc.invalidateQueries({ queryKey: ["stakeholders"] });
      if (r.failed > 0)
        toast.warning(
          `${plural(r.failed, "contrato não pôde", "contratos não puderam")} ser lido(s).`,
        );
      const summary = { total: s.total, filled: s.dataFilled + r.updated };
      const seen = new Set<string>();
      const conflicts = [...s.contractStartConflicts, ...r.contractStartConflicts].filter((c) => {
        const k = `${c.kind}:${c.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (conflicts.length > 0) {
        pendingSummary.current = summary;
        setContractStartConflicts(conflicts);
        return;
      }
      await finishUpdate(summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar dados");
    } finally {
      setUpdating(false);
    }
  }

  const openDoc = (d: Doc) => {
    const url = d.url_signed ?? d.url_original;
    if (!url) return;
    // Visão de outra conta (admin): o leitor busca pelo dono logado, então abre o link direto.
    if (accountOwnerId) {
      window.open(url, "_blank", "noopener");
      return;
    }
    setPreview({ name: d.name ?? d.document_key ?? "Contrato", docId: d.id });
  };

  if (cfg.isLoading) {
    return (
      <div
        className={
          inWindow
            ? "flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground"
            : "flex items-center gap-2 py-4 text-xs text-muted-foreground"
        }
      >
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const docCount = cfg.data?.documentsCount ?? sortedDocs.length;
  const errorLine = cfg.data?.lastError ? (
    <p className="rounded-[10px] border border-[#c98c8c]/30 bg-[#c98c8c]/[0.06] px-3 py-2 text-[11.5px] text-[#c98c8c]">
      {cfg.data.lastError}
    </p>
  ) : null;

  // ── Ainda não conectado: chave de API + passo a passo + "Conectar". ──
  if (!connected) {
    return (
      <IntegrationShell
        inWindow={inWindow}
        title="ClickSign"
        subtitle="Documentos · Não Conectado"
        bodyDeps={[connected]}
        footer={
          readOnly ? null : (
            <PrimaryAction
              icon={save.isPending ? <Loader2 className="animate-spin" /> : <Plug />}
              onClick={() => save.mutate()}
              disabled={save.isPending || !token.trim()}
            >
              Conectar
            </PrimaryAction>
          )
        }
      >
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
          {!readOnly && (
            <MergedField
              label="Chave de API"
              action={
                <FieldAction
                  label={showToken ? "Ocultar Chave" : "Mostrar Chave"}
                  onClick={() => setShowToken((v) => !v)}
                >
                  {showToken ? <EyeOff strokeWidth={1.8} /> : <Eye strokeWidth={1.8} />}
                </FieldAction>
              }
            >
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type={showToken ? "text" : "password"}
                autoComplete="off"
                placeholder="Cole aqui a chave do ClickSign"
                className="w-full min-w-0 bg-transparent font-mono text-[11.5px] outline-none placeholder:font-sans placeholder:text-muted-foreground"
              />
            </MergedField>
          )}
          <div className="overflow-hidden rounded-[12px] border border-border bg-[var(--card-surface)]">
            <div className="px-3 pb-2 pt-2.5 text-[12px] font-bold">
              Vá ao ClickSign e siga o passo a passo:
            </div>
            <div className="grid gap-2 px-3 pb-3">
              <Step n={1}>
                Abra <b className="font-semibold text-foreground">Configurações → API</b>.
              </Step>
              <Step n={2}>
                Gere uma chave de acesso, cole no campo{" "}
                <b className="font-semibold text-foreground">Chave de API</b> acima e toque em
                Conectar.
              </Step>
            </div>
          </div>
          {errorLine}
        </div>
      </IntegrationShell>
    );
  }

  return (
    <>
      <IntegrationShell
        inWindow={inWindow}
        title="ClickSign"
        subtitle="Documentos · Conectado"
        bodyDeps={[view, sortedDocs.length, docs.isLoading]}
        toggles={
          <SoftToggles
            items={[
              { key: "webhook", label: "Webhook" },
              { key: "contratos", label: `Contratos (${docCount})` },
            ]}
            value={view}
            onChange={setView}
          />
        }
        footer={
          <>
            <PrimaryAction
              icon={updating ? <Loader2 className="animate-spin" /> : <DatabaseZap />}
              onClick={() => void runUpdate(false)}
              disabled={updating}
            >
              Atualizar Dados
            </PrimaryAction>
            <ActionSquare label="Salvar" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save strokeWidth={1.8} />}
            </ActionSquare>
            <DisconnectMenu
              onDisconnect={() => setDisconnectOpen(true)}
              disabled={disconnect.isPending}
            />
          </>
        }
      >
        {view === "webhook" ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
            <MergedField
              label="URL do Webhook"
              action={
                <FieldAction label="Copiar URL" onClick={() => copy(webhookUrl, "URL copiada.")}>
                  <Copy strokeWidth={1.8} />
                </FieldAction>
              }
            >
              <span className="block truncate font-mono text-[11.5px]">
                {webhookUrl.replace(/^https?:\/\//, "")}
              </span>
            </MergedField>
            <MergedField
              label="Segredo (HMAC-SHA256)"
              action={
                <FieldAction
                  label={showSecret ? "Ocultar Segredo" : "Mostrar Segredo"}
                  onClick={() => setShowSecret((v) => !v)}
                >
                  {showSecret ? <EyeOff strokeWidth={1.8} /> : <Eye strokeWidth={1.8} />}
                </FieldAction>
              }
            >
              <input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                type={showSecret ? "text" : "password"}
                autoComplete="off"
                placeholder={
                  cfg.data?.hasWebhookSecret
                    ? `Salvo: ${cfg.data.webhookSecretMasked}`
                    : "Cole aqui o segredo do ClickSign"
                }
                className="w-full min-w-0 bg-transparent font-mono text-[11.5px] outline-none placeholder:text-muted-foreground"
              />
            </MergedField>
            <div className="overflow-hidden rounded-[12px] border border-border bg-[var(--card-surface)]">
              <div className="px-3 pb-2 pt-2.5 text-[12px] font-bold">
                Vá ao ClickSign e siga o passo a passo:
              </div>
              <div className="grid gap-2 px-3 pb-3">
                <Step n={1}>
                  Abra{" "}
                  <b className="font-semibold text-foreground">Configurações → API → Webhooks</b>.
                </Step>
                <Step n={2}>
                  Adicione a <b className="font-semibold text-foreground">URL do Webhook</b> acima.
                </Step>
                <Step n={3}>
                  Copie o segredo gerado pelo ClickSign, cole no campo{" "}
                  <b className="font-semibold text-foreground">Segredo</b> acima e salve.
                </Step>
              </div>
              <div className="flex items-center gap-2 border-t border-[var(--panel-div)] px-3 py-2.5 text-[11.5px] leading-snug text-muted-foreground">
                <Lock className="size-[13px] shrink-0" strokeWidth={1.8} />
                <span>
                  O segredo salvo fica oculto por segurança. Para trocar, digite um novo e salve.
                </span>
              </div>
            </div>
            {errorLine}
          </div>
        ) : docs.isLoading ? (
          <p className="py-6 text-center text-[12px] text-muted-foreground">
            Carregando contratos…
          </p>
        ) : sortedDocs.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-muted-foreground">
            Nenhum contrato importado ainda.
          </p>
        ) : (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
            {sortedDocs.map((d, i) => {
              const st = STATUS[d.status ?? ""];
              const hasFile = !!(d.url_signed || d.url_original);
              return (
                <button
                  key={d.id}
                  type="button"
                  data-clip-row
                  disabled={!hasFile}
                  onClick={() => openDoc(d)}
                  className={`flex min-h-[42px] min-w-0 items-center gap-2 text-left disabled:cursor-default ${
                    i ? "border-t border-[var(--panel-div)]" : ""
                  }`}
                >
                  <span
                    className="min-w-0 flex-1 truncate text-[12.5px] font-semibold"
                    title={d.name ?? undefined}
                  >
                    {d.name ?? d.document_key}
                  </span>
                  {d.stakeholder_type ? (
                    <StatusTag tone="neutral">
                      {VINCULO[d.stakeholder_type] ?? d.stakeholder_type}
                    </StatusTag>
                  ) : null}
                  <StatusTag tone={st?.tone ?? "neutral"}>{st?.label ?? d.status ?? "—"}</StatusTag>
                </button>
              );
            })}
          </div>
        )}
      </IntegrationShell>

      <ClicksignContractStartConflictDialog
        open={contractStartConflicts.length > 0}
        onOpenChange={(next) => {
          if (next) return;
          setContractStartConflicts([]);
          // Decidiu manter as datas atuais: segue o fim da atualização (Novos Cadastros ou aviso).
          const summary = pendingSummary.current;
          pendingSummary.current = null;
          if (summary) void finishUpdate(summary).catch((e: Error) => toast.error(e.message));
        }}
        conflicts={contractStartConflicts}
        pending={updating}
        onConfirm={() => {
          pendingSummary.current = null;
          setContractStartConflicts([]);
          void runUpdate(true);
        }}
      />
      <ClicksignImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ClicksignDisconnectDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        pending={disconnect.isPending}
        onConfirm={(purge) => disconnect.mutate(purge)}
      />
      <DocPreviewDialog doc={preview} onClose={() => setPreview(null)} />
    </>
  );
}
