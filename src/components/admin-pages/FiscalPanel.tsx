import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, Eye, EyeOff, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { fiscalCompanyPrefill, fiscalSetupCompanyWithCertificate, fiscalStatus } from "@/lib/fiscal/fiscal.functions";
import { FieldAction, IntegrationShell, MergedField, PrimaryAction, StatusTag } from "@/components/admin-pages/integration-window";
import { cn } from "@/lib/utils";

/**
 * Janela "Notas Fiscais (NFS-e)" (mockups aprovados 16/11/2026): ao abrir, TODOS os dados da empresa vêm sozinhos
 * (CNPJ da conta + Receita Federal) e ficam BLOQUEADOS. Só edita: nome fantasia, inscrição municipal (não existe na
 * consulta pública), certificado A1 e senha. O certificado e a senha vão direto ao provedor; nada fica no navegador
 * depois do envio. Sem espaço sobrando antes do botão: a janela tem a altura do conteúdo.
 */
export const FISCAL_STATUS_KEY = ["fiscal-status"] as const;

export const fiscalErrorText = (code?: string) =>
  ({
    cnpj_mismatch: "O CNPJ da janela precisa ser o da sua conta.",
    cnpj_in_use: "Este CNPJ já está ativo em outra conta.",
    certificate_invalid: "Certificado inválido. Confira o arquivo e a senha.",
    password_required: "Informe a senha do certificado.",
    municipal_registration_required: "Informe a inscrição municipal.",
    unreachable: "Não foi possível falar com o provedor agora. Tente de novo.",
  } as Record<string, string>)[code ?? ""] ?? "Não foi possível concluir. Confira os dados e tente de novo.";

const fmtCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*/, "$1.$2.$3/$4-$5");
const fmtCep = (d: string) => d.replace(/^(\d{5})(\d{3}).*/, "$1-$2");

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("grid min-w-0 gap-1.5", className)}>
      <span className="text-[12px] leading-4 text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
const BOX = "flex h-9 min-w-0 items-center rounded-[10px] border border-border bg-[color-mix(in_oklab,var(--card),var(--background)_55%)]";
function Locked({ value }: { value: string }) {
  return (
    <span className={BOX}>
      <input readOnly tabIndex={-1} value={value} aria-readonly="true" className="min-w-0 flex-1 bg-transparent px-3 text-[13px] text-muted-foreground/80 outline-none" />
    </span>
  );
}

function CertificateFields({ file, setFile, password, setPassword }: { file: { name: string; base64: string } | null; setFile: (f: { name: string; base64: string } | null) => void; password: string; setPassword: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [show, setShow] = useState(false);
  const pick = (f?: File) => {
    if (!f) return;
    if (!/\.(pfx|p12)$/i.test(f.name) || f.size > 250_000) return void toast.error("Envie um arquivo .pfx ou .p12 válido.");
    const r = new FileReader();
    r.onload = () => setFile({ name: f.name, base64: String(r.result).split(",")[1] ?? "" });
    r.readAsDataURL(f);
  };
  return (
    <>
      <div>
        <input ref={ref} type="file" accept=".pfx,.p12" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" onClick={() => ref.current?.click()} className="flex w-full items-center gap-2.5 rounded-[10px] border border-dashed border-border bg-[color-mix(in_oklab,var(--card),var(--background)_55%)] px-3 py-2.5 text-left">
          <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[var(--action-sq-bg)]">{file ? <Check className="size-3.5" /> : <Upload className="size-3.5" />}</span>
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-bold">{file ? file.name : "Enviar certificado A1"}</span>
            <span className="block text-[11.5px] text-muted-foreground">{file ? "Toque para trocar o arquivo" : "Arquivo .pfx ou .p12"}</span>
          </span>
        </button>
      </div>
      <MergedField
        label="Senha do certificado"
        action={
          <FieldAction label={show ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShow((v) => !v)}>
            {show ? <EyeOff strokeWidth={1.8} /> : <Eye strokeWidth={1.8} />}
          </FieldAction>
        }
      >
        <input type={show ? "text" : "password"} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full min-w-0 bg-transparent text-[13px] outline-none" />
      </MergedField>
    </>
  );
}

export function FiscalPanel({ view, setView }: { view: "main" | "replace"; setView: (v: "main" | "replace") => void }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(fiscalStatus);
  const prefillFn = useServerFn(fiscalCompanyPrefill);
  const setupFn = useServerFn(fiscalSetupCompanyWithCertificate);
  const status = useQuery({ queryKey: FISCAL_STATUS_KEY, queryFn: () => statusFn({ data: {} }), retry: false, staleTime: 60_000 });
  const company = status.data?.companies[0] ?? null;
  const prefill = useQuery({ queryKey: ["fiscal-prefill"], queryFn: () => prefillFn(), retry: false, staleTime: 5 * 60_000 });
  const p = prefill.data && prefill.data.ok ? prefill.data : null;

  const [trade, setTrade] = useState<string | null>(null);
  const [im, setIm] = useState("");
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [password, setPassword] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      if (!p) throw new Error("no_company");
      return setupFn({ data: { taxId: p.taxId, legalName: p.legalName, tradeName: (trade ?? p.tradeName) || null, municipalRegistration: im.trim(), address: p.address, pfxBase64: file!.base64, password } });
    },
    onSuccess: async (r) => {
      setFile(null); setPassword("");
      if (r.ok) {
        toast.success(view === "replace" ? "Certificado substituído." : "Módulo fiscal ativado.");
        await qc.invalidateQueries({ queryKey: FISCAL_STATUS_KEY });
        setView("main");
      } else toast.error(fiscalErrorText(r.code));
    },
    onError: () => { setPassword(""); toast.error(fiscalErrorText()); },
  });

  const canSend = !!p && !!file && password.length > 0 && im.trim().length > 0 && !send.isPending;
  const active = !!company && company.status !== "Pendente" && view === "main";
  const form = !active;
  const loading = form && (prefill.isLoading || (status.isLoading && !status.data));

  const submit = (
    <PrimaryAction icon={send.isPending ? <Loader2 className="animate-spin" /> : <Check />} onClick={() => send.mutate()} disabled={!canSend}>
      {view === "replace" ? "Enviar certificado" : "Ativar módulo fiscal"}
    </PrimaryAction>
  );

  if (active && company) {
    const soon = company.certificateAlert.level === "expiring" || company.certificateAlert.level === "expired";
    return (
      <IntegrationShell
        inWindow
        bodyPad="pl-4 pr-2"
        title="Notas Fiscais (NFS-e)"
        subtitle={<span className="inline-flex items-center gap-1.5">Financeiro · <StatusTag tone={soon ? "warn" : "ok"}>{soon ? "Vence em breve" : "Ativa"}</StatusTag></span>}
        bodyDeps={[company.companyId]}
        footer={<PrimaryAction icon={<Upload />} onClick={() => setView("replace")}>Substituir certificado</PrimaryAction>}
      >
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 pb-1">
          {soon && (
            <div className="flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[12px] leading-[1.45]" style={{ color: "#c9a962", backgroundColor: "color-mix(in oklab, #c9a962 14%, transparent)" }}>
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>O certificado vence em menos de 30 dias. Envie o novo para não parar a emissão.</span>
            </div>
          )}
          <div className="text-[12px] text-muted-foreground">{company.certificateLabel ?? "Certificado A1 ativo"}</div>
          <div className="grid gap-2 rounded-[12px] border border-border bg-[var(--card-surface)] p-3 text-[12px]">
            {([["CNPJ", fmtCnpj(company.taxId)], ["Razão social", company.legalName], ["Nome fantasia", company.tradeName ?? "—"]] as const).map(([k, v]) => (
              <div key={k} className="flex min-w-0 justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="min-w-0 truncate font-semibold">{v}</span></div>
            ))}
          </div>
        </div>
      </IntegrationShell>
    );
  }

  return (
    <IntegrationShell
      inWindow
      bodyPad="pl-4 pr-2"
      title={view === "replace" ? "Substituir certificado" : "Notas Fiscais (NFS-e)"}
      subtitle={view === "replace" ? "Notas Fiscais (NFS-e) · Financeiro" : "Financeiro · Não conectado"}
      bodyDeps={[view, !!p, loading]}
      footer={p ? submit : undefined}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 pb-1">
        <div className="text-[12px] leading-[1.5] text-muted-foreground">
          {view === "replace"
            ? "Envie o novo certificado A1. O atual continua valendo até o novo ser aceito."
            : "Emita notas fiscais de serviço (NFS-e) diretamente pelo sistema vinculado ao Certificado Digital A1 da sua empresa."}
        </div>
        {loading ? (
          <div className="grid place-items-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : !p ? (
          <div className="rounded-[12px] border border-border bg-[var(--card-surface)] p-3 text-[12px] leading-[1.5] text-muted-foreground">
            {prefill.data && !prefill.data.ok && prefill.data.code === "no_cnpj"
              ? "Cadastre o CNPJ da empresa no seu perfil para ativar as notas fiscais."
              : prefill.data && !prefill.data.ok && prefill.data.code === "not_found"
                ? "Não encontramos este CNPJ na Receita Federal. Confira o cadastro do seu perfil."
                : "Não foi possível carregar os dados da empresa agora."}
            {prefill.data && !prefill.data.ok && prefill.data.code === "unavailable" || prefill.isError ? (
              <button type="button" onClick={() => prefill.refetch()} className="mt-2 block font-bold text-foreground underline">Tentar de novo</button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex gap-2.5">
              <Field label="CNPJ" className="flex-1"><Locked value={fmtCnpj(p.taxId)} /></Field>
              <Field label="Insc. municipal" className="flex-1">
                <span className={BOX}><input inputMode="numeric" autoComplete="off" value={im} onChange={(e) => setIm(e.target.value.slice(0, 30))} className="min-w-0 flex-1 bg-transparent px-3 text-[13px] outline-none" /></span>
              </Field>
            </div>
            <Field label="Razão social"><Locked value={p.legalName} /></Field>
            <Field label="Nome fantasia (opcional)">
              <span className={BOX}><input value={trade ?? p.tradeName} onChange={(e) => setTrade(e.target.value.slice(0, 200))} className="min-w-0 flex-1 bg-transparent px-3 text-[13px] outline-none" /></span>
            </Field>
            <div className="flex gap-2.5">
              <Field label="CEP" className="min-w-0 flex-1"><Locked value={fmtCep(p.address.cep)} /></Field>
              <Field label="Número" className="w-20 shrink-0"><Locked value={p.address.number} /></Field>
              <Field label="UF" className="w-14 shrink-0"><Locked value={p.address.state} /></Field>
            </div>
            <Field label="Logradouro"><Locked value={p.address.street} /></Field>
            <div className="flex gap-2.5">
              <Field label="Bairro" className="min-w-0 flex-1"><Locked value={p.address.neighborhood} /></Field>
              <Field label="Cidade" className="min-w-0 flex-1"><Locked value={p.address.city} /></Field>
            </div>
            <CertificateFields file={file} setFile={setFile} password={password} setPassword={setPassword} />
          </>
        )}
      </div>
    </IntegrationShell>
  );
}
