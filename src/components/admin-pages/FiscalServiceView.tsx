import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import { fiscalSearchServiceCodes, fiscalServiceSave } from "@/lib/fiscal/fiscal.functions";
import { IntegrationShell, PrimaryAction, SegmentedToggle } from "@/components/admin-pages/integration-window";
import { InfoBox, PercentField, SearchField, TextAreaField, TextField } from "@/components/admin-pages/fiscal-window-ui";
import { Banner } from "@/components/admin-pages/fiscal-window-ui";
import { Switch } from "@/components/ui/switch";
import { fiscalErrorText, fmtNationalCode, parsePct, pctText } from "@/components/admin-pages/fiscal-format";
import type { FiscalCompany, FiscalService, FiscalView } from "@/components/admin-pages/fiscal-types";
import { SERVICES_KEY } from "@/components/admin-pages/FiscalActiveView";

type Tab = "servico" | "retencoes" | "reforma";
const TABS = [
  { key: "servico", label: "Serviço" },
  { key: "retencoes", label: "Retenções" },
  { key: "reforma", label: "Reforma" },
] as const;

/** Adicionar/Editar serviço (mockups I, J, K, O, P). Tudo opcional além do código nacional e da descrição. */
export function FiscalServiceView({ company, service, setView }: { company: FiscalCompany; service: FiscalService | null; setView: (v: FiscalView) => void }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(fiscalServiceSave);
  const searchFn = useServerFn(fiscalSearchServiceCodes);
  const edit = !!service;
  const [tab, setTab] = useState<Tab>("servico");
  const [code, setCode] = useState(service ? fmtNationalCode(service.nationalCode) : "");
  const [serviceCode, setServiceCode] = useState(service?.serviceCode ?? "");
  const [nbs, setNbs] = useState(service?.nbsCode ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [isDefault, setIsDefault] = useState(service?.isDefault ?? false);
  const [inss, setInss] = useState(pctText(service?.inssPct ?? null));
  const [ir, setIr] = useState(pctText(service?.irPct ?? null));
  const [cst, setCst] = useState(service?.cst ?? "");
  const [cclass, setCclass] = useState(service?.cclassTrib ?? "");
  const [indicator, setIndicator] = useState(service?.operationIndicator ?? "");
  const [error, setError] = useState<string | null>(null);

  // busca do código nacional (lupa): pequeno atraso para não consultar a cada tecla
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(code), 200); return () => clearTimeout(t); }, [code]);
  const results = useQuery({ queryKey: ["fiscal-code-search", q], queryFn: () => searchFn({ data: { query: q } }), retry: false, staleTime: 60_000 });

  const digits = code.replace(/\D/g, "");
  const inssN = parsePct(inss), irN = parsePct(ir);
  const valid = digits.length === 6 && description.trim().length >= 3 && !Number.isNaN(inssN) && !Number.isNaN(irN) && (inssN ?? 0) <= 100 && (irN ?? 0) <= 100;

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          companyId: company.companyId, serviceId: service?.id ?? null,
          data: { nationalCode: digits, serviceCode, nbsCode: nbs, description: description.trim(), isDefault, inssPct: inssN, irPct: irN, cst, cclassTrib: cclass, operationIndicator: indicator },
        },
      }),
    onSuccess: async () => { toast.success(edit ? "Serviço salvo." : "Serviço adicionado."); await qc.invalidateQueries({ queryKey: SERVICES_KEY(company.companyId) }); setView("main"); },
    onError: () => setError("unknown"),
  });

  return (
    <IntegrationShell
      inWindow bodyPad="pl-4 pr-2" title={edit ? "Editar serviço" : "Adicionar serviço"} subtitle="Notas Fiscais (NFS-e) · Serviços" bodyDeps={[tab, error]}
      toggles={<SegmentedToggle items={TABS} value={tab} onChange={setTab} />}
      footer={<PrimaryAction icon={<Check />} onClick={() => { setError(null); save.mutate(); }} disabled={!valid || save.isPending}>{edit ? "Salvar alterações" : "Adicionar serviço"}</PrimaryAction>}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 pb-1">
        {error ? <Banner tone="bad" icon={<AlertTriangle />}>{fiscalErrorText(error)}</Banner> : null}
        {tab === "servico" ? (
          <>
            <SearchField
              label="Código de tributação nacional" value={code} onChange={setCode} format={fmtNationalCode} results={results.data?.items ?? []}
              onPick={(r) => { setCode(fmtNationalCode(r.code)); if (!description.trim()) setDescription(r.description); }}
            />
            <TextField label="Código de serviço" optional value={serviceCode} maxLength={20} onChange={setServiceCode} />
            <TextField label="Código NBS" optional value={nbs} maxLength={13} onChange={(v) => setNbs(v.replace(/[^0-9.]/g, ""))} />
            <TextAreaField label="Descrição do serviço" value={description} onChange={setDescription} maxLength={2000} />
            <div className="flex h-9 items-center justify-between rounded-[10px] border border-border bg-[color-mix(in_oklab,var(--card),var(--background)_55%)] px-3">
              <span className="text-[13px]">Serviço padrão</span>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} aria-label="Serviço padrão" />
            </div>
          </>
        ) : tab === "retencoes" ? (
          <>
            <InfoBox>
              {company.simples && company.simples !== "nao_optante"
                ? "Sua empresa é optante pelo Simples Nacional: o ISS é calculado pelo Simples, sem alíquota própria. As retenções abaixo são opcionais."
                : "As retenções abaixo são opcionais."}
            </InfoBox>
            <div className="flex gap-3">
              <PercentField label="INSS retido" value={inss} onChange={setInss} />
              <PercentField label="IR retido" value={ir} onChange={setIr} />
            </div>
          </>
        ) : (
          <>
            <TextField label="CST" optional value={cst} maxLength={10} onChange={setCst} />
            <TextField label="cClassTrib" optional value={cclass} maxLength={10} onChange={setCclass} />
            <TextField label="Indicador da operação" optional value={indicator} maxLength={10} onChange={setIndicator} />
          </>
        )}
      </div>
    </IntegrationShell>
  );
}
