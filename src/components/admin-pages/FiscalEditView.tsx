import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import { fiscalCompanyUpdate } from "@/lib/fiscal/fiscal.functions";
import { IntegrationShell, PrimaryAction, SegmentedToggle } from "@/components/admin-pages/integration-window";
import { Banner, LockedField, SelectField, TextField } from "@/components/admin-pages/fiscal-window-ui";
import { fiscalErrorText, fmtCep, fmtCnae, fmtCnpj, fmtPhone, REGIME_OPTIONS, simplesLabel } from "@/components/admin-pages/fiscal-format";
import type { FiscalCompany, FiscalView, Prefill } from "@/components/admin-pages/fiscal-types";
import { FISCAL_STATUS_KEY } from "@/components/admin-pages/fiscal-keys";

type Tab = "empresa" | "fiscal" | "avancado";
const TABS = [
  { key: "empresa", label: "Empresa" },
  { key: "fiscal", label: "Fiscal" },
  { key: "avancado", label: "Avançado" },
] as const;

/** "Editar dados" (mockups E, F, Q): mesmos campos da ativação; o que vem da Receita continua bloqueado. */
export function FiscalEditView({ company, prefill, setView }: { company: FiscalCompany; prefill: Prefill | null; setView: (v: FiscalView) => void }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(fiscalCompanyUpdate);
  const [tab, setTab] = useState<Tab>("empresa");
  const [im, setIm] = useState(company.municipalRegistration ?? "");
  const [email, setEmail] = useState(company.email ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [regime, setRegime] = useState<number>(company.specialRegime);
  const [series, setSeries] = useState(company.dpsSeries);
  const [next, setNext] = useState(String(company.dpsNextNumber));
  const [error, setError] = useState<string | null>(null);

  const nextNum = Number(next);
  const valid = im.trim().length > 0 && /^[0-9]{1,5}$/.test(series) && Number.isInteger(nextNum) && nextNum >= 1;

  const save = useMutation({
    mutationFn: () => updateFn({ data: { companyId: company.companyId, data: { tradeName: company.tradeName, municipalRegistration: im.trim(), email: email.trim() || null, phone: phone.replace(/\D/g, "") || null, specialRegime: regime, dpsSeries: series, dpsNextNumber: nextNum } } }),
    onSuccess: async (r) => {
      if (r.ok) { toast.success("Dados salvos."); await qc.invalidateQueries({ queryKey: FISCAL_STATUS_KEY }); setView("main"); }
      else setError(r.code);
    },
    onError: () => setError("unknown"),
  });

  const p = prefill;
  return (
    <IntegrationShell
      inWindow bodyPad="pl-4 pr-2" title="Editar dados" subtitle="Notas Fiscais (NFS-e) · Financeiro" bodyDeps={[tab, error]}
      toggles={<SegmentedToggle items={TABS} value={tab} onChange={setTab} />}
      footer={<PrimaryAction icon={<Check />} onClick={() => { setError(null); save.mutate(); }} disabled={!valid || save.isPending}>Salvar alterações</PrimaryAction>}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 pb-1">
        {error ? <Banner tone="bad" icon={<AlertTriangle />}>{fiscalErrorText(error)}</Banner> : null}
        {tab === "empresa" ? (
          <>
            <div className="flex gap-3">
              <LockedField label="CNPJ" value={fmtCnpj(company.taxId)} style={{ flex: 1.4 }} />
              <TextField label="Insc. municipal" value={im} inputMode="numeric" maxLength={30} onChange={(v) => setIm(v.slice(0, 30))} style={{ flex: 0.8 }} />
            </div>
            <LockedField label="Razão social" value={company.legalName} />
            <LockedField label="Nome fantasia" value={company.tradeName ?? ""} />
            {p ? (
              <>
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
            ) : null}
          </>
        ) : tab === "fiscal" ? (
          <>
            {p?.email ? <LockedField label="E-mail" value={p.email} /> : <TextField label="E-mail" value={email} type="email" inputMode="email" maxLength={200} onChange={setEmail} />}
            {p?.phone ? <LockedField label="Telefone" value={fmtPhone(p.phone)} /> : <TextField label="Telefone" value={phone} inputMode="tel" maxLength={16} onChange={setPhone} />}
            <LockedField label="Optante pelo Simples Nacional" value={simplesLabel(company.simples)} />
            <LockedField label="Código CNAE principal" value={company.cnae?.code ? fmtCnae(company.cnae.code) : "—"} />
          </>
        ) : (
          <>
            <SelectField label="Regime especial de tributação" value={regime} options={REGIME_OPTIONS} onChange={setRegime} />
            <div className="flex gap-3">
              <TextField label="Série da NF" value={series} inputMode="numeric" maxLength={5} className="flex-1" onChange={(v) => setSeries(v.replace(/\D/g, ""))} />
              <TextField label="Próximo número do DPS" value={next} inputMode="numeric" maxLength={9} className="flex-1" onChange={(v) => setNext(v.replace(/\D/g, ""))} />
            </div>
          </>
        )}
      </div>
    </IntegrationShell>
  );
}
