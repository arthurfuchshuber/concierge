import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, Loader2, MoreHorizontal, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { fiscalDeactivate, fiscalPreferencesSave, fiscalServiceDelete, fiscalServiceSave, fiscalServicesList } from "@/lib/fiscal/fiscal.functions";
import { ActionSquare, IntegrationShell, PrimaryAction, SegmentedToggle, StatusTag } from "@/components/admin-pages/integration-window";
import { Banner, InfoBox, Kv, SelectField, TextAreaField, TextField } from "@/components/admin-pages/fiscal-window-ui";
import { fiscalErrorText, fmtCnpj, fmtNationalCode, simplesLabel } from "@/components/admin-pages/fiscal-format";
import type { FiscalCompany, FiscalService, FiscalView, MainTab } from "@/components/admin-pages/fiscal-types";
import { FISCAL_STATUS_KEY } from "@/components/admin-pages/fiscal-keys";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const TABS = [
  { key: "empresa", label: "Empresa" },
  { key: "servicos", label: "Serviços" },
  { key: "preferencias", label: "Preferências" },
] as const;
const TAX_OPTIONS = [
  { value: "none", label: "Não incluir tributos aproximados" },
  { value: "included", label: "Incluir tributos aproximados" },
] as const;

export const SERVICES_KEY = (companyId: string) => ["fiscal-services", companyId] as const;

/** Janela com a empresa conectada (mockups D, G, H, L, R): abas Empresa | Serviços | Preferências. */
export function FiscalActiveView({ company, tab, setTab, setView, openService }: { company: FiscalCompany; tab: MainTab; setTab: (t: MainTab) => void; setView: (v: FiscalView) => void; openService: (s: FiscalService | null) => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(fiscalServicesList);
  const saveFn = useServerFn(fiscalServiceSave);
  const delFn = useServerFn(fiscalServiceDelete);
  const prefFn = useServerFn(fiscalPreferencesSave);
  const deactFn = useServerFn(fiscalDeactivate);
  const soon = company.certificateAlert.level === "expiring" || company.certificateAlert.level === "expired";

  const services = useQuery({ queryKey: SERVICES_KEY(company.companyId), queryFn: () => listFn({ data: { companyId: company.companyId } }), enabled: tab === "servicos", retry: false });
  const items = services.data?.items ?? [];
  const suggestion = services.data?.suggestion ?? null;

  const [toDelete, setToDelete] = useState<FiscalService | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const invalidateServices = () => qc.invalidateQueries({ queryKey: SERVICES_KEY(company.companyId) });

  const useSuggestion = useMutation({
    mutationFn: () => saveFn({ data: { companyId: company.companyId, data: { nationalCode: suggestion!.nationalCode, description: suggestion!.description, isDefault: true } } }),
    onSuccess: () => { toast.success("Serviço adicionado."); void invalidateServices(); },
    onError: () => toast.error(fiscalErrorText()),
  });
  const remove = useMutation({
    mutationFn: (id: string) => delFn({ data: { companyId: company.companyId, serviceId: id } }),
    onSuccess: () => { setToDelete(null); toast.success("Serviço excluído."); void invalidateServices(); },
    onError: () => toast.error(fiscalErrorText()),
  });
  const deactivate = useMutation({
    mutationFn: () => deactFn({ data: { companyId: company.companyId } }),
    onSuccess: async () => { setConfirmOff(false); toast.success("Módulo fiscal desativado."); await qc.invalidateQueries({ queryKey: FISCAL_STATUS_KEY }); },
    onError: () => toast.error(fiscalErrorText()),
  });

  // Preferências (mockup L)
  const pr = company.preferences;
  const [taxes, setTaxes] = useState<"none" | "included">(pr.approximateTaxes);
  const [note, setNote] = useState(pr.invoiceNote ?? "");
  const [ir, setIr] = useState(pr.withholdingTextIr ?? "");
  const [csrf, setCsrf] = useState(pr.withholdingTextCsrf ?? "");
  const [inss, setInss] = useState(pr.withholdingTextInss ?? "");
  const savePrefs = useMutation({
    mutationFn: () => prefFn({ data: { companyId: company.companyId, data: { approximateTaxes: taxes, invoiceNote: note, withholdingTextIr: ir, withholdingTextCsrf: csrf, withholdingTextInss: inss } } }),
    onSuccess: async () => { toast.success("Preferências salvas."); await qc.invalidateQueries({ queryKey: FISCAL_STATUS_KEY }); },
    onError: () => toast.error(fiscalErrorText()),
  });

  const menu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Mais Ações" title="Mais Ações" className="grid size-7 shrink-0 place-items-center rounded-[7px] border-0 bg-[var(--action-sq-bg)] text-foreground transition-colors hover:bg-primary/[0.08] data-[state=open]:bg-primary/[0.08]">
          <MoreHorizontal className="size-3.5" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-48">
        <DropdownMenuItem onSelect={() => setConfirmOff(true)} className="text-[#e06666] focus:text-[#e06666]"><Trash2 className="mr-2 size-3.5" /> Desativar</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const footer =
    tab === "empresa" ? (
      <>
        <PrimaryAction icon={<Upload />} onClick={() => setView("replace")}>Substituir certificado</PrimaryAction>
        <ActionSquare label="Editar dados" onClick={() => setView("edit")}><Pencil /></ActionSquare>
        {menu}
      </>
    ) : tab === "servicos" ? (
      services.isLoading ? null : items.length === 0 && suggestion ? (
        <>
          <PrimaryAction icon={<Check />} onClick={() => useSuggestion.mutate()} disabled={useSuggestion.isPending}>Usar sugestão</PrimaryAction>
          <ActionSquare label="Adicionar serviço" onClick={() => openService(null)}><Plus /></ActionSquare>
        </>
      ) : (
        <PrimaryAction icon={<Plus />} onClick={() => openService(null)}>Adicionar serviço</PrimaryAction>
      )
    ) : (
      <PrimaryAction icon={<Check />} onClick={() => savePrefs.mutate()} disabled={savePrefs.isPending}>Salvar alterações</PrimaryAction>
    );

  const iss = company.simples === "nao_optante" || !company.simples ? "ISS" : "ISS Simples";

  return (
    <>
      <IntegrationShell
        inWindow bodyPad="pl-4 pr-2" title="Notas Fiscais (NFS-e)" subtitle="Financeiro · Conectado" bodyDeps={[tab, items.length, services.isLoading]}
        toggles={<SegmentedToggle items={TABS} value={tab} onChange={setTab} />} footer={footer}
      >
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 pb-1">
          {tab === "empresa" ? (
            <>
              <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
                <StatusTag tone={soon ? "warn" : "ok"}>{soon ? "Vence em breve" : "Ativa"}</StatusTag>
                <span className="min-w-0 truncate">{company.certificateLabel ?? "Certificado A1 ativo"}</span>
              </div>
              <InfoBox>
                <Kv k="CNPJ" v={fmtCnpj(company.taxId)} />
                <Kv k="Razão social" v={company.legalName} />
                <Kv k="Nome fantasia" v={company.tradeName ?? "—"} />
                <Kv k="Inscrição municipal" v={company.municipalRegistration ?? "—"} />
                <Kv k="E-mail" v={company.email ?? "—"} />
                <Kv k="Simples Nacional" v={simplesLabel(company.simples)} />
              </InfoBox>
            </>
          ) : tab === "servicos" ? (
            services.isLoading ? (
              <div className="grid place-items-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            ) : items.length === 0 ? (
              <>
                <Banner tone="warn" icon={<AlertTriangle />}>Falta o serviço padrão. Sem ele não é possível emitir notas.</Banner>
                {suggestion ? (
                  <InfoBox>
                    <div className="text-[11.5px] font-semibold text-muted-foreground">Sugestão pelo seu CNAE</div>
                    <div className="text-[13px] font-bold">{suggestion.title}</div>
                    <div className="text-[11.5px] text-muted-foreground">{fmtNationalCode(suggestion.nationalCode)} · {iss === "ISS Simples" ? "ISS pelo Simples Nacional" : "ISS"}</div>
                  </InfoBox>
                ) : null}
              </>
            ) : (
              <>
                <div className="grid gap-2">
                  {items.map((s) => (
                    <div key={s.id} data-clip-row className="flex min-w-0 items-center gap-2.5 rounded-[12px] border border-border bg-[var(--card-surface)] px-3 py-2.5">
                      <span className="grid size-4 shrink-0 place-items-center text-emerald-600">{s.isDefault ? <Check className="size-3.5" aria-label="Serviço padrão" /> : null}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-bold">{s.description}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">{fmtNationalCode(s.nationalCode)} · {iss}</span>
                      </span>
                      <ActionSquare label="Editar serviço" onClick={() => openService(s)}><Pencil /></ActionSquare>
                      <ActionSquare label="Excluir serviço" onClick={() => setToDelete(s)}><Trash2 /></ActionSquare>
                    </div>
                  ))}
                </div>
                <div className="text-[11.5px] text-muted-foreground">1 a {items.length} do total de {items.length} {items.length === 1 ? "item" : "itens"}</div>
              </>
            )
          ) : (
            <>
              <SelectField label="Tributos aproximados na nota fiscal" value={taxes} options={TAX_OPTIONS} onChange={setTaxes} />
              <TextAreaField label="Observação nas notas fiscais" optional value={note} onChange={setNote} maxLength={2000} />
              <TextField label="Texto quando houver retenção de IR" optional value={ir} onChange={setIr} maxLength={500} />
              <TextField label="Texto quando houver retenção de CSRF" optional value={csrf} onChange={setCsrf} maxLength={500} />
              <TextField label="Texto quando houver retenção de INSS" optional value={inss} onChange={setInss} maxLength={500} />
            </>
          )}
        </div>
      </IntegrationShell>

      <AlertDialog open={!!toDelete} onOpenChange={(v) => { if (!v) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir serviço?</AlertDialogTitle>
            <AlertDialogDescription>O serviço “{toDelete?.description}” será removido da lista. As notas já emitidas não são afetadas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-[#e06666] text-white hover:bg-[#e06666]/90" disabled={remove.isPending} onClick={(e) => { e.preventDefault(); if (toDelete) remove.mutate(toDelete.id); }}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar notas fiscais?</AlertDialogTitle>
            <AlertDialogDescription>A emissão e o recebimento de notas ficam parados. Nenhuma nota já emitida é apagada, e você pode ativar de novo enviando o certificado.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-[#e06666] text-white hover:bg-[#e06666]/90" disabled={deactivate.isPending} onClick={(e) => { e.preventDefault(); deactivate.mutate(); }}>Desativar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
