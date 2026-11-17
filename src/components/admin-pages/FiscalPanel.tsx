import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search } from "lucide-react";
import { fiscalCompanyPrefill, fiscalStatus } from "@/lib/fiscal/fiscal.functions";
import { IntegrationShell } from "@/components/admin-pages/integration-window";
import { FiscalConnectView } from "@/components/admin-pages/FiscalConnectView";
import { FiscalActiveView } from "@/components/admin-pages/FiscalActiveView";
import { FiscalEditView } from "@/components/admin-pages/FiscalEditView";
import { FiscalServiceView } from "@/components/admin-pages/FiscalServiceView";
import { FISCAL_STATUS_KEY } from "@/components/admin-pages/fiscal-keys";
import { TextField } from "@/components/admin-pages/fiscal-window-ui";
import type { FiscalService, FiscalView, MainTab } from "@/components/admin-pages/fiscal-types";

/** Máscara progressiva 00.000.000/0000-00 enquanto digita. */
const maskCnpj = (d: string) =>
  d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");

export { FISCAL_STATUS_KEY };
export { fiscalErrorText } from "@/components/admin-pages/fiscal-format";
export type { FiscalView };

/**
 * Janela "Notas Fiscais (NFS-e)" (mockups A–R aprovados em 16/11/2026). Ao abrir, TODOS os dados da empresa vêm sozinhos
 * (CNPJ da conta + Receita Federal) e ficam bloqueados; só a inscrição municipal (e e-mail/telefone, quando a Receita não tem)
 * é digitada. O certificado A1 e a senha vão direto ao provedor e nada fica no navegador depois do envio.
 * Estados: Conectar (3 abas) → Ativando → Ativo (Empresa | Serviços | Preferências) ou Erro; subjanelas com "‹ Voltar".
 */
export function FiscalPanel({ view, setView, readOnly = false }: { view: FiscalView; setView: (v: FiscalView) => void; readOnly?: boolean }) {
  if (readOnly) {
    return (
      <IntegrationShell inWindow bodyPad="pl-4 pr-2" title="Notas Fiscais (NFS-e)" subtitle="Financeiro" bodyDeps={["readonly"]}>
        <div className="rounded-[12px] border border-border bg-[var(--card-surface)] p-3 text-[12px] leading-[1.5] text-muted-foreground">
          Apenas o titular da empresa pode ativar e gerenciar o módulo fiscal.
        </div>
      </IntegrationShell>
    );
  }
  return <FiscalPanelOwner view={view} setView={setView} />;
}

function FiscalPanelOwner({ view, setView }: { view: FiscalView; setView: (v: FiscalView) => void }) {
  const statusFn = useServerFn(fiscalStatus);
  const prefillFn = useServerFn(fiscalCompanyPrefill);
  const status = useQuery({
    queryKey: FISCAL_STATUS_KEY, queryFn: () => statusFn({ data: {} }), retry: false, staleTime: 60_000,
  });
  const company = status.data?.companies[0] ?? null;
  // CNPJ informado pelo titular (quem tem CPF no perfil digita o CNPJ da empresa emissora); vazio ⇒ usa o do perfil.
  const [typedCnpj, setTypedCnpj] = useState("");
  const [searched, setSearched] = useState("");
  const prefillQ = useQuery({ queryKey: ["fiscal-prefill", searched], queryFn: () => prefillFn({ data: { taxId: searched || null } }), retry: false, staleTime: 5 * 60_000 });
  const prefill = prefillQ.data && prefillQ.data.ok ? prefillQ.data : null;

  const [mainTab, setMainTab] = useState<MainTab>("empresa");
  const [target, setTarget] = useState<FiscalService | null>(null);

  const connected = !!company && company.status !== "Pendente";

  if (connected && company && view === "edit") return <FiscalEditView company={company} prefill={prefill} setView={setView} />;
  if (connected && company && view === "service") return <FiscalServiceView key={target?.id ?? "novo"} company={company} service={target} setView={setView} />;
  if (connected && company && view !== "replace") {
    return <FiscalActiveView company={company} tab={mainTab} setTab={setMainTab} setView={setView} openService={(s) => { setTarget(s); setView("service"); }} />;
  }

  const loading = prefillQ.isLoading || (status.isLoading && !status.data);
  if (loading) {
    return (
      <IntegrationShell inWindow bodyPad="pl-4 pr-2" title="Notas Fiscais (NFS-e)" subtitle="Financeiro · Não conectado" bodyDeps={["loading"]}>
        <div className="grid place-items-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      </IntegrationShell>
    );
  }
  if (!prefill) {
    const code = prefillQ.data && !prefillQ.data.ok ? prefillQ.data.code : null;
    const digits = typedCnpj.replace(/\D/g, "").slice(0, 14);
    const busy = prefillQ.isFetching;
    const search = () => { if (digits.length === 14) setSearched(digits); };
    const onType = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 14); setTypedCnpj(d); if (d.length === 14) setSearched(d); };
    const hint = code === "not_found" && searched ? "Não encontramos este CNPJ na Receita Federal. Confira os números."
      : code === "unavailable" || prefillQ.isError ? "Não foi possível consultar a Receita agora. Tente de novo."
      : "Informe o CNPJ da empresa que emitirá as notas fiscais.";
    return (
      <IntegrationShell inWindow bodyPad="pl-4 pr-2" title="Notas Fiscais (NFS-e)" subtitle="Financeiro · Não conectado" bodyDeps={["nocnpj", code, busy]}>
        <div className="space-y-3">
          <TextField
            label="CNPJ da empresa" value={maskCnpj(digits)} onChange={onType}
            inputMode="numeric" maxLength={18} placeholder="00.000.000/0000-00"
            adornment={busy ? <Loader2 className="size-4 animate-spin" /> : undefined}
          />
          <p className="text-[12px] leading-[1.5] text-muted-foreground">{hint}</p>
          <button
            type="button" onClick={search} disabled={digits.length !== 14 || busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-foreground px-3 text-[12.5px] font-bold text-background disabled:opacity-40"
          >
            <Search className="size-3.5" /> Buscar dados
          </button>
        </div>
      </IntegrationShell>
    );
  }
  return <FiscalConnectView key={view} view={view} setView={setView} company={company} prefill={prefill} />;
}
