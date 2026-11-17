import { useEffect, useRef, useState } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowRight, Check, Eye, EyeOff, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { fiscalSetupCompanyWithCertificate } from "@/lib/fiscal/fiscal.functions";
import { FieldAction, IntegrationShell, MergedField, PrimaryAction, SegmentedToggle } from "@/components/admin-pages/integration-window";
import { Banner, LockedField, TextField } from "@/components/admin-pages/fiscal-window-ui";
import { activationErrorText, fmtCep, fmtCnae, fmtCnpj, fmtPhone, simplesLabel } from "@/components/admin-pages/fiscal-format";
import type { FiscalCompany, FiscalView, Prefill } from "@/components/admin-pages/fiscal-types";
import { FISCAL_STATUS_KEY } from "@/components/admin-pages/fiscal-keys";

const FISCAL_SETUP_KEY = ["fiscal-setup"] as const;
type Cert = { name: string; base64: string } | null;
type Tab = "empresa" | "fiscal" | "certificado";
const TABS = [
  { key: "empresa", label: "Empresa" },
  { key: "fiscal", label: "Fiscal" },
  { key: "certificado", label: "Certificado" },
] as const;

/** Arquivo + senha do certificado A1. Nada fica guardado: o estado é descartado após o envio. */
export function CertificateFields({ file, setFile, password, setPassword }: { file: Cert; setFile: (f: Cert) => void; password: string; setPassword: (v: string) => void }) {
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

/** Ativando (mockup M): sem abas; a ativação continua mesmo que o titular feche a janela. */
function ActivatingView() {
  const steps = [
    { label: "Validando o certificado", state: "done" },
    { label: "Cadastrando a empresa", state: "run" },
    { label: "Ativando o recebimento das notas", state: "wait" },
  ] as const;
  return (
    <IntegrationShell
      inWindow bodyPad="pl-4 pr-2" title="Notas Fiscais (NFS-e)" subtitle="Financeiro · Ativando" bodyDeps={["activating"]}
      footer={<PrimaryAction icon={<Loader2 className="animate-spin" />} onClick={() => {}} disabled>Ativando…</PrimaryAction>}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 pb-1" role="status" aria-live="polite">
        {steps.map((s) => (
          <div key={s.label} className="flex min-w-0 items-center gap-2.5 text-[12.5px]">
            <span className="grid size-[18px] shrink-0 place-items-center rounded-full [&_svg]:size-3.5">
              {s.state === "done" ? <Check className="text-emerald-600" /> : s.state === "run" ? <Loader2 className="animate-spin" /> : <span className="size-2 rounded-full bg-foreground/20" />}
            </span>
            <span className={s.state === "wait" ? "text-muted-foreground" : "font-semibold"}>{s.label}</span>
          </div>
        ))}
        <div className="text-[12px] leading-[1.5] text-muted-foreground">Isso leva alguns segundos. Você pode fechar esta janela; a ativação continua.</div>
      </div>
    </IntegrationShell>
  );
}

export function FiscalConnectView({ view, setView, company, prefill }: { view: FiscalView; setView: (v: FiscalView) => void; company: FiscalCompany | null; prefill: Prefill | null }) {
  const qc = useQueryClient();
  const setupFn = useServerFn(fiscalSetupCompanyWithCertificate);
  const replace = view === "replace";
  const p = prefill;
  const [tab, setTab] = useState<Tab>("empresa");
  const [im, setIm] = useState(p?.municipalRegistration || company?.municipalRegistration || "");
  const [email, setEmail] = useState(p?.email ?? "");
  const [phone, setPhone] = useState(p?.phone ?? "");
  const [file, setFile] = useState<Cert>(null);
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const errorCode = localError;
  // A ativação corre no servidor: mesmo fechando e reabrindo a janela, o "Ativando" continua enquanto a chamada não termina.
  const activating = useIsMutating({ mutationKey: FISCAL_SETUP_KEY }) > 0;

  useEffect(() => { if (errorCode) setTab("certificado"); }, [errorCode]);
  // Os dados do Perfil podem chegar depois da montagem: preenche só o que o titular ainda não digitou.
  useEffect(() => { if (p?.municipalRegistration && !im) setIm(p.municipalRegistration); }, [p?.municipalRegistration]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationKey: FISCAL_SETUP_KEY,
    mutationFn: async () => {
      if (!p) throw new Error("no_company");
      return setupFn({
        data: {
          taxId: p.taxId, legalName: p.legalName, tradeName: p.tradeName || null, municipalRegistration: im.trim(), address: p.address,
          email: p.email || email || null, phone: p.phone || phone || null, simples: p.simples, cnaeCode: p.cnae.code || null, cnaeDescription: p.cnae.description || null, ibgeCityCode: p.ibgeCityCode || null,
          pfxBase64: file!.base64, password,
        },
      });
    },
    onSuccess: async (r) => {
      setFile(null); setPassword("");
      await qc.invalidateQueries({ queryKey: FISCAL_STATUS_KEY });
      if (r.ok) { toast.success(replace ? "Certificado substituído." : "Módulo fiscal ativado."); setView("main"); }
      else setLocalError(r.code);
    },
    onError: async () => { setPassword(""); setLocalError("unreachable"); await qc.invalidateQueries({ queryKey: FISCAL_STATUS_KEY }); },
  });

  if (send.isPending || activating) return <ActivatingView />;

  const submit = () => { setLocalError(null); send.mutate(); };
  const canSend = !!p && !!file && password.length > 0 && im.trim().length > 0;
  const certFields = <CertificateFields file={file} setFile={setFile} password={password} setPassword={setPassword} />;

  if (replace) {
    return (
      <IntegrationShell
        inWindow bodyPad="pl-4 pr-2" title="Substituir certificado" subtitle="Notas Fiscais (NFS-e) · Financeiro" bodyDeps={["replace", !!p]}
        footer={p ? <PrimaryAction icon={<Check />} onClick={submit} disabled={!canSend}>Enviar certificado</PrimaryAction> : undefined}
      >
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 pb-1">
          {errorCode ? <Banner tone="bad" icon={<AlertTriangle />}>{activationErrorText(errorCode, p?.taxId ?? company?.taxId ?? "")}</Banner> : null}
          {!company?.municipalRegistration ? <TextField label="Inscrição municipal" value={im} inputMode="numeric" maxLength={30} onChange={setIm} /> : null}
          {certFields}
        </div>
      </IntegrationShell>
    );
  }

  const last = tab === "certificado";
  const next = () => setTab(tab === "empresa" ? "fiscal" : "certificado");
  const body = !p ? (
    <div className="rounded-[12px] border border-border bg-[var(--card-surface)] p-3 text-[12px] leading-[1.5] text-muted-foreground">
      Não foi possível carregar os dados da empresa agora.
    </div>
  ) : tab === "empresa" ? (
    <>
      <div className="flex gap-3">
        <LockedField label="CNPJ" value={fmtCnpj(p.taxId)} style={{ flex: 1.4 }} />
        <TextField label="Insc. municipal" value={im} inputMode="numeric" maxLength={30} onChange={(v) => setIm(v.slice(0, 30))} style={{ flex: 0.8 }} />
      </div>
      <LockedField label="Razão social" value={p.legalName} />
      <LockedField label="Nome fantasia" value={p.tradeName} />
      <div className="flex gap-3">
        <LockedField label="CEP" value={fmtCep(p.address.cep)} className="flex-1" />
        <LockedField label="UF" value={p.address.state} className="w-[100px] shrink-0" />
      </div>
      <div className="flex gap-3">
        <LockedField label="Logradouro" value={p.address.street} className="flex-1" />
        <LockedField label="Número" value={p.address.number} className="w-[104px] shrink-0" />
      </div>
      <div className="flex gap-3">
        <LockedField label="Bairro" value={p.address.neighborhood} className="flex-1" />
        <LockedField label="Cidade" value={p.address.city} className="flex-1" />
      </div>
    </>
  ) : tab === "fiscal" ? (
    <>
      {p.email ? <LockedField label="E-mail" value={p.email} /> : <TextField label="E-mail" value={email} type="email" inputMode="email" maxLength={200} onChange={setEmail} />}
      {p.phone ? <LockedField label="Telefone" value={fmtPhone(p.phone)} /> : <TextField label="Telefone" value={phone} inputMode="tel" maxLength={16} onChange={setPhone} />}
      <LockedField label="Optante pelo Simples Nacional" value={simplesLabel(p.simples)} />
      <LockedField label="Código CNAE principal" value={p.cnae.code ? fmtCnae(p.cnae.code) : "—"} />
    </>
  ) : (
    <>
      {errorCode ? <Banner tone="bad" icon={<AlertTriangle />}>{activationErrorText(errorCode, p.taxId)}</Banner> : null}
      {certFields}
    </>
  );

  return (
    <IntegrationShell
      inWindow bodyPad="pl-4 pr-2" title="Notas Fiscais (NFS-e)" subtitle="Financeiro · Não conectado" bodyDeps={[tab, !!p, errorCode]}
      toggles={<SegmentedToggle items={TABS} value={tab} onChange={setTab} />}
      footer={
        p ? (
          last ? <PrimaryAction icon={<Check />} onClick={submit} disabled={!canSend}>Ativar módulo fiscal</PrimaryAction>
               : <PrimaryAction icon={<ArrowRight />} onClick={next} disabled={tab === "empresa" && !im.trim()}>Continuar</PrimaryAction>
        ) : undefined
      }
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 pb-1">{body}</div>
    </IntegrationShell>
  );
}
