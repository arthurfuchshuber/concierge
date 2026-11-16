import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { fiscalCompanyPrefill, fiscalStatus } from "@/lib/fiscal/fiscal.functions";
import { IntegrationShell } from "@/components/admin-pages/integration-window";
import { FiscalConnectView } from "@/components/admin-pages/FiscalConnectView";
import { FiscalActiveView } from "@/components/admin-pages/FiscalActiveView";
import { FiscalEditView } from "@/components/admin-pages/FiscalEditView";
import { FiscalServiceView } from "@/components/admin-pages/FiscalServiceView";
import { FISCAL_STATUS_KEY } from "@/components/admin-pages/fiscal-keys";
import type { FiscalService, FiscalView, MainTab } from "@/components/admin-pages/fiscal-types";

export { FISCAL_STATUS_KEY };
export { fiscalErrorText } from "@/components/admin-pages/fiscal-format";
export type { FiscalView };

/**
 * Janela "Notas Fiscais (NFS-e)" (mockups A–R aprovados em 16/11/2026). Ao abrir, TODOS os dados da empresa vêm sozinhos
 * (CNPJ da conta + Receita Federal) e ficam bloqueados; só a inscrição municipal (e e-mail/telefone, quando a Receita não tem)
 * é digitada. O certificado A1 e a senha vão direto ao provedor e nada fica no navegador depois do envio.
 * Estados: Conectar (3 abas) → Ativando → Ativo (Empresa | Serviços | Preferências) ou Erro; subjanelas com "‹ Voltar".
 */
export function FiscalPanel({ view, setView }: { view: FiscalView; setView: (v: FiscalView) => void }) {
  const statusFn = useServerFn(fiscalStatus);
  const prefillFn = useServerFn(fiscalCompanyPrefill);
  const status = useQuery({
    queryKey: FISCAL_STATUS_KEY, queryFn: () => statusFn({ data: {} }), retry: false, staleTime: 60_000,
  });
  const company = status.data?.companies[0] ?? null;
  const prefillQ = useQuery({ queryKey: ["fiscal-prefill"], queryFn: () => prefillFn(), retry: false, staleTime: 5 * 60_000 });
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
    return (
      <IntegrationShell inWindow bodyPad="pl-4 pr-2" title="Notas Fiscais (NFS-e)" subtitle="Financeiro · Não conectado" bodyDeps={["noprefill", code]}>
        <div className="rounded-[12px] border border-border bg-[var(--card-surface)] p-3 text-[12px] leading-[1.5] text-muted-foreground">
          {code === "no_cnpj" ? "Cadastre o CNPJ da empresa no seu perfil para ativar as notas fiscais." : code === "not_found" ? "Não encontramos este CNPJ na Receita Federal. Confira o cadastro do seu perfil." : "Não foi possível carregar os dados da empresa agora."}
          {code === "unavailable" || prefillQ.isError ? <button type="button" onClick={() => prefillQ.refetch()} className="mt-2 block font-bold text-foreground underline">Tentar de novo</button> : null}
        </div>
      </IntegrationShell>
    );
  }
  return <FiscalConnectView key={view} view={view} setView={setView} company={company} prefill={prefill} />;
}
