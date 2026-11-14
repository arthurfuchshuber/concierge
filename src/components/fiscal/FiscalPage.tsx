import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell } from "@/components/ds/PageShell";
import {
  type FiscalOverview,
  fiscalAudit, fiscalAuthorizeAndSend, fiscalCreateCompany, fiscalOverview, fiscalPrepareOperation,
  fiscalRejectOperation, fiscalSaveConnection, fiscalTestConnection,
} from "@/lib/fiscal/fiscal.functions";
import { DOC_STATUS, OP_STATE, OP_KIND, DOC_KIND, SEND_OUTCOME, TONE_CLASS, formatTaxId } from "./fiscal-labels";

type Overview = Extract<FiscalOverview, { enabled: true }>;
type Tab = "empresas" | "documentos" | "autorizacoes" | "provedor" | "auditoria";

function Badge({ tone, children }: { tone: keyof typeof TONE_CLASS; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>{children}</span>;
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">{children}</div>;
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível concluir.");

export function FiscalPage() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(fiscalOverview);
  const [tab, setTab] = useState<Tab>("empresas");
  const q = useQuery({ queryKey: ["fiscal-overview"], queryFn: () => overviewFn({ data: {} }), retry: false, refetchInterval: 20_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["fiscal-overview"] });

  return (
    <div className="ds-page w-full max-w-none px-3.5 py-5 sm:px-5 lg:px-8 lg:pl-4 lg:py-8">
      <PageShell title="Fiscal" subtitle="Empresas emitentes, documentos fiscais e provedor fiscal." />
      {q.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Carregando…</p>
      ) : q.isError ? (
        <p className="mt-6 text-sm text-muted-foreground">Não foi possível carregar o módulo fiscal.</p>
      ) : !q.data?.enabled ? (
        <Card><p className="text-sm">O módulo fiscal não está habilitado para esta conta.</p></Card>
      ) : (
        <>
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-4">
            <div className="overflow-x-auto px-1 pb-1">
              <TabsList className="w-max">
                <TabsTrigger value="empresas">Empresas</TabsTrigger>
                <TabsTrigger value="documentos">Documentos</TabsTrigger>
                <TabsTrigger value="autorizacoes">Autorizações{q.data.operations.some((o) => o.state === "awaiting_authorization") ? " •" : ""}</TabsTrigger>
                <TabsTrigger value="provedor">Provedor fiscal</TabsTrigger>
                <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
              </TabsList>
            </div>
          </Tabs>
          <div className="mt-4 space-y-4">
            {tab === "empresas" && <Companies data={q.data} onChange={refresh} />}
            {tab === "documentos" && <Documents data={q.data} onChange={refresh} />}
            {tab === "autorizacoes" && <Authorizations data={q.data} onChange={refresh} />}
            {tab === "provedor" && <Provider data={q.data} onChange={refresh} />}
            {tab === "auditoria" && <Audit />}
          </div>
        </>
      )}
    </div>
  );
}

function Companies({ data, onChange }: { data: Overview; onChange: () => void }) {
  const create = useServerFn(fiscalCreateCompany);
  const [open, setOpen] = useState(false);
  const [taxId, setTaxId] = useState("");
  const [name, setName] = useState("");
  const [connectionId, setConnectionId] = useState(data.connections[0]?.id ?? "");
  const m = useMutation({
    mutationFn: () => create({ data: { connectionId, taxId, legalName: name } }),
    onSuccess: () => { toast.success("Empresa cadastrada."); setOpen(false); setTaxId(""); setName(""); onChange(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Cada CNPJ/CPF só pode existir em uma conta.</p>
        <Button onClick={() => setOpen(true)} disabled={data.connections.length === 0}>Nova empresa</Button>
      </div>
      {data.connections.length === 0 && <Card><p className="text-sm">Configure primeiro a conexão na aba “Provedor fiscal”.</p></Card>}
      <Card>
        {data.companies.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada.</p> : (
          <ul className="divide-y divide-border">
            {data.companies.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{c.legalName}</p><p className="text-xs text-muted-foreground">{formatTaxId(c.taxId)}</p></div>
                <Badge tone={c.status === "active" ? "sage" : c.status === "provider_error" ? "rose" : c.status === "awaiting_certificate" || c.status === "draft" ? "amber" : "gray"}>{COMPANY_STATUS[c.status] ?? c.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">O certificado digital é enviado direto ao provedor fiscal e nunca fica salvo no ConciergeIA.</p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>Nova empresa emitente</DialogTitle><DialogDescription>O cadastro no provedor só acontece com a sua autorização específica.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Razão social" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="CNPJ ou CPF" inputMode="numeric" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={m.isPending || !name.trim() || taxId.replace(/\D/g, "").length < 11} onClick={() => m.mutate()}>Cadastrar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
const COMPANY_STATUS: Record<string, string> = { draft: "Rascunho", pending_provider: "Pendente no provedor", awaiting_certificate: "Aguardando certificado", active: "Ativa", suspended: "Suspensa", provider_error: "Erro no provedor", deactivated: "Desativada" };

function Documents({ data, onChange }: { data: Overview; onChange: () => void }) {
  const prepare = useServerFn(fiscalPrepareOperation);
  const [open, setOpen] = useState(false);
  const [cancelDoc, setCancelDoc] = useState<{ id: string; companyId: string } | null>(null);
  const [companyId, setCompanyId] = useState(data.companies.find((c) => c.status === "active")?.id ?? "");
  const [docKind, setDocKind] = useState<"nfe" | "nfse" | "nfsen" | "cte">("nfse");
  const [json, setJson] = useState("{\n  \n}");
  const [why, setWhy] = useState("");
  const issue = useMutation({
    mutationFn: async () => {
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(json); } catch { throw new Error("O conteúdo precisa ser um JSON válido."); }
      return prepare({ data: { companyId, kind: "issue", documentKind: docKind, payload } });
    },
    onSuccess: () => { toast.success("Emissão preparada. Falta a sua autorização."); setOpen(false); onChange(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const cancel = useMutation({
    mutationFn: () => prepare({ data: { companyId: cancelDoc!.companyId, kind: "cancel", documentId: cancelDoc!.id, payload: { justificativa: why.trim() } } }),
    onSuccess: () => { toast.success("Cancelamento preparado. Falta a sua autorização."); setCancelDoc(null); setWhy(""); onChange(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const company = (id: string) => data.companies.find((c) => c.id === id)?.legalName ?? "—";
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)} disabled={!data.companies.some((c) => c.status === "active")}>Preparar emissão</Button>
        <Button variant="outline" onClick={onChange}>Atualizar situação</Button>
      </div>
      <Card>
        {data.documents.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum documento ainda.</p> : (
          <ul className="divide-y divide-border">
            {data.documents.map((d) => {
              const st = DOC_STATUS[d.status] ?? { label: d.status, tone: "gray" as const };
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{DOC_KIND[d.kind] ?? d.kind} · {company(d.companyId)}</p><p className="text-xs text-muted-foreground">{d.protocol ? `Protocolo ${d.protocol}` : "Sem protocolo"} · {new Date(d.createdAt).toLocaleDateString("pt-BR")}</p></div>
                  <div className="flex items-center gap-2"><Badge tone={st.tone}>{st.label}</Badge>
                    {d.status === "authorized" && <Button size="sm" variant="outline" onClick={() => setCancelDoc({ id: d.id, companyId: d.companyId })}>Cancelar</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {data.documents.some((d) => d.status === "unknown_result") && (
        <div className="rounded-xl bg-[#FFF3D6] px-4 py-3 text-sm text-[#7A4F00]">Documento com “Resultado desconhecido”: o envio pode ter chegado ao provedor. O sistema consulta sozinho; um novo envio só acontece com uma nova autorização sua.</div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Preparar emissão</DialogTitle><DialogDescription>Nada é enviado agora. Depois de preparar, a emissão aguarda a sua autorização na aba “Autorizações”.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Empresa emitente</option>
              {data.companies.filter((c) => c.status === "active").map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
            </select>
            <select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={docKind} onChange={(e) => setDocKind(e.target.value as typeof docKind)}>
              {Object.entries(DOC_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Textarea rows={10} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} aria-label="Dados do documento (JSON do provedor)" />
            <p className="text-xs text-muted-foreground">Dados do documento no formato do provedor fiscal.</p>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={issue.isPending || !companyId} onClick={() => issue.mutate()}>Preparar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!cancelDoc} onOpenChange={(o) => !o && setCancelDoc(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>Preparar cancelamento</DialogTitle><DialogDescription>Justificativa de 15 a 255 caracteres. O cancelamento só é enviado com a sua autorização.</DialogDescription></DialogHeader>
          <Textarea rows={4} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={255} aria-label="Justificativa" />
          <DialogFooter><Button variant="outline" onClick={() => setCancelDoc(null)}>Voltar</Button><Button disabled={cancel.isPending || why.trim().length < 15} onClick={() => cancel.mutate()}>Preparar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Authorizations({ data, onChange }: { data: Overview; onChange: () => void }) {
  const send = useServerFn(fiscalAuthorizeAndSend);
  const reject = useServerFn(fiscalRejectOperation);
  const [target, setTarget] = useState<Overview["operations"][number] | null>(null);
  const pending = data.operations.filter((o) => o.state === "awaiting_authorization");
  const recent = data.operations.filter((o) => o.state !== "awaiting_authorization").slice(0, 15);
  const go = useMutation({
    mutationFn: (id: string) => send({ data: { operationId: id } }),
    onSuccess: (r) => { const o = SEND_OUTCOME(r.outcome); (o.ok ? toast.success : toast.warning)(o.text); setTarget(null); onChange(); },
    onError: (e) => { toast.error(errMsg(e)); onChange(); },
  });
  const no = useMutation({ mutationFn: (id: string) => reject({ data: { operationId: id } }), onSuccess: () => { toast.success("Operação rejeitada."); onChange(); }, onError: (e) => toast.error(errMsg(e)) });
  const company = (id: string) => data.companies.find((c) => c.id === id)?.legalName ?? "—";
  return (
    <>
      <p className="text-sm text-muted-foreground">Nada é emitido ou cancelado sem a sua autorização. Cada autorização vale para uma única operação e expira em 10 minutos.</p>
      {pending.length === 0 ? <Card><p className="text-sm text-muted-foreground">Nenhuma operação aguardando autorização.</p></Card> : pending.map((o) => (
        <Card key={o.id}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{OP_KIND[o.kind] ?? o.kind} · {company(o.companyId)}</p><div className="mt-1.5"><Badge tone="amber">Aguardando autorização</Badge></div></div>
            <div className="flex gap-2"><Button variant="outline" onClick={() => no.mutate(o.id)} disabled={no.isPending}>Rejeitar</Button><Button onClick={() => setTarget(o)}>Autorizar e enviar</Button></div>
          </div>
        </Card>
      ))}
      {recent.length > 0 && <Card><p className="mb-2 text-sm font-medium">Operações recentes</p><ul className="divide-y divide-border">{recent.map((o) => { const st = OP_STATE[o.state] ?? { label: o.state, tone: "gray" as const }; return <li key={o.id} className="flex items-center justify-between gap-2 py-2.5 text-sm"><span className="truncate">{OP_KIND[o.kind] ?? o.kind} · {company(o.companyId)}</span><Badge tone={st.tone}>{st.label}</Badge></li>; })}</ul></Card>}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>{target ? (OP_KIND[target.kind] ?? target.kind) : ""}</DialogTitle><DialogDescription>{target ? company(target.companyId) : ""}</DialogDescription></DialogHeader>
          <div className="rounded-xl bg-[#FFF3D6] px-3 py-2.5 text-sm text-[#7A4F00]">Ao autorizar, o envio acontece agora e não pode ser repetido automaticamente. Validade: 10 minutos, uso único.</div>
          <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs">{target ? target.payloadText : ""}</pre>
          <DialogFooter><Button variant="outline" onClick={() => setTarget(null)}>Cancelar</Button><Button disabled={go.isPending} onClick={() => target && go.mutate(target.id)}>Autorizar e enviar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Provider({ data, onChange }: { data: Overview; onChange: () => void }) {
  const save = useServerFn(fiscalSaveConnection);
  const test = useServerFn(fiscalTestConnection);
  const [env, setEnv] = useState<"homologation" | "production">("homologation");
  const [token, setToken] = useState("");
  const [webhook, setWebhook] = useState<string | null>(null);
  const conn = data.connections.find((c) => c.environment === env);
  const s = useMutation({
    mutationFn: () => save({ data: { environment: env, token } }),
    onSuccess: (r) => { toast.success("Token salvo."); setToken(""); setWebhook(`${window.location.origin}${r.webhookPath}`); onChange(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const t = useMutation({
    mutationFn: (id: string) => test({ data: { connectionId: id } }),
    onSuccess: (r) => { (r.ok ? toast.success : toast.error)(r.ok ? "Conexão ativa." : `Falha na conexão (${r.code}).`); onChange(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <p className="mb-3 text-base font-semibold">Conexão com o provedor fiscal</p>
        <div className="mb-3 flex gap-2">
          <Button variant={env === "homologation" ? "default" : "outline"} onClick={() => setEnv("homologation")}>Homologação</Button>
          <Button variant={env === "production" ? "default" : "outline"} onClick={() => setEnv("production")}>Produção</Button>
        </div>
        <Input type="password" autoComplete="off" placeholder={conn?.tokenFingerprint ? `Token salvo (impressão ${conn.tokenFingerprint}) — cole outro para trocar` : "Token de acesso"} value={token} onChange={(e) => setToken(e.target.value)} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={s.isPending || token.trim().length < 8} onClick={() => s.mutate()}>Salvar token</Button>
          <Button variant="outline" disabled={!conn || t.isPending} onClick={() => conn && t.mutate(conn.id)}>Testar conexão</Button>
        </div>
        {conn && <div className="mt-3"><Badge tone={conn.status === "active" ? "sage" : conn.status === "error" ? "rose" : "amber"}>{conn.status === "active" ? "Conexão ativa" : conn.status === "error" ? `Erro (${conn.lastErrorCode ?? "—"})` : "Aguardando teste"}</Badge></div>}
      </Card>
      <Card>
        <p className="mb-2 text-base font-semibold">Aviso automático (webhook)</p>
        <p className="mb-3 text-sm text-muted-foreground">Copie este endereço no painel do provedor fiscal. Ele aparece uma única vez, ao salvar o token.</p>
        {webhook ? <Input readOnly value={webhook} onFocus={(e) => e.currentTarget.select()} /> : <p className="text-sm text-muted-foreground">{conn?.hasWebhook ? "Endereço já gerado. Salve o token novamente para gerar outro." : "Salve o token para gerar o endereço."}</p>}
        <p className="mt-3 text-sm">Os avisos só indicam que algo mudou. A situação do documento é sempre confirmada por consulta direta ao provedor.</p>
      </Card>
      <div className="rounded-xl bg-muted px-4 py-3 text-sm lg:col-span-2">Em homologação nada tem valor fiscal. Cadastrar empresas e certificados no provedor só acontece em produção e exige a sua autorização específica.</div>
    </div>
  );
}

function Audit() {
  const fn = useServerFn(fiscalAudit);
  const q = useQuery({ queryKey: ["fiscal-audit"], queryFn: () => fn({ data: {} }), retry: false });
  return (
    <Card>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : q.isError ? <p className="text-sm text-muted-foreground">Sem permissão para ver a auditoria.</p> : q.data!.items.length === 0 ? <p className="text-sm text-muted-foreground">Sem registros.</p> : (
        <ul className="divide-y divide-border">{q.data!.items.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2.5 text-sm"><span>{AUDIT_LABEL[a.action] ?? a.action}</span><span className="text-xs text-muted-foreground">{new Date(a.at).toLocaleString("pt-BR")}</span></li>)}</ul>
      )}
    </Card>
  );
}
const AUDIT_LABEL: Record<string, string> = { connection_create: "Conexão criada", connection_update: "Conexão atualizada", company_create: "Empresa cadastrada", operation_create: "Operação preparada", authorization_issue: "Operação autorizada", operation_reject: "Operação rejeitada", send_denied: "Envio negado pelo portão", attempt_unknown: "Resultado desconhecido", absence_confirmed: "Ausência confirmada", query_unmapped: "Situação não reconhecida" };
