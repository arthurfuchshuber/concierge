// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

const fns = vi.hoisted(() => ({
  fiscalStatus: vi.fn(), fiscalCompanyPrefill: vi.fn(), fiscalSetupCompanyWithCertificate: vi.fn(), fiscalServicesList: vi.fn(),
  fiscalServiceSave: vi.fn(), fiscalServiceDelete: vi.fn(), fiscalPreferencesSave: vi.fn(), fiscalDeactivate: vi.fn(),
  fiscalCompanyUpdate: vi.fn(), fiscalSearchServiceCodes: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/fiscal/fiscal.functions", () => fns);

import { FiscalPanel, type FiscalView } from "../FiscalPanel";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const prefill = { ok: true, taxId: "11222333000181", legalName: "ACME LTDA", tradeName: "Acme", situation: "ATIVA", email: "contato@acme.com.br", phone: "4535230000", simples: "me_epp", cnae: { code: "6821801", description: "Corretagem" }, ibgeCityCode: "4108304", address: { cep: "85851000", street: "RUA A", number: "10", neighborhood: "CENTRO", city: "FOZ", state: "PR" } };
const active = {
  companyId: "c1", status: "Ativa", legalName: "ACME LTDA", tradeName: "Acme", taxId: "11222333000181", municipalRegistration: "999", email: "contato@acme.com.br", phone: "4535230000", simples: "me_epp",
  cnae: { code: "6821801", description: "Corretagem" }, specialRegime: 0, dpsSeries: "1", dpsNextNumber: 1,
  preferences: { approximateTaxes: "none", invoiceNote: null, withholdingTextIr: null, withholdingTextCsrf: null, withholdingTextInss: null },
  certificateValidUntil: "2099-01-01T00:00:00.000Z", certificateLabel: "Certificado A1 válido até 01/01/2099", certificateAlert: { level: "ok", daysLeft: 999 }, canReplaceCertificate: true,
};

function Host({ initial = "main" as FiscalView }) {
  const [view, setView] = useState<FiscalView>(initial);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <Dialog open><DialogContent aria-describedby={undefined}><FiscalPanel view={view} setView={setView} /></DialogContent></Dialog>
    </QueryClientProvider>
  );
}

describe("janela Notas Fiscais (NFS-e)", () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); fns.fiscalCompanyPrefill.mockResolvedValue(prefill); });

  it("titular com CPF no perfil (sem CNPJ): pede o CNPJ da empresa, busca na Receita e libera o fluxo", async () => {
    fns.fiscalStatus.mockResolvedValue({ companies: [] });
    fns.fiscalCompanyPrefill.mockImplementation(async (a?: { data?: { taxId?: string | null } }) => (a?.data?.taxId ? prefill : { ok: false, code: "no_cnpj" }));
    render(<Host />);
    const input = (await screen.findByPlaceholderText("00.000.000/0000-00")) as HTMLInputElement;
    expect(screen.queryByText(/no seu perfil/)).toBeNull();
    expect((screen.getByRole("button", { name: /Buscar dados/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "11222333000181" } });
    await screen.findByDisplayValue("ACME LTDA");
    expect(fns.fiscalCompanyPrefill).toHaveBeenLastCalledWith({ data: { taxId: "11222333000181" } });
  });

  it("Conectar: 3 abas, dados da Receita bloqueados, Continuar → Continuar → Ativar (desabilitado sem certificado)", async () => {
    fns.fiscalStatus.mockResolvedValue({ companies: [] });
    render(<Host />);
    await screen.findByDisplayValue("ACME LTDA");
    expect(screen.getByText("Financeiro · Não conectado")).toBeTruthy();
    for (const t of ["Empresa", "Fiscal", "Certificado"]) expect(screen.getByRole("button", { name: t })).toBeTruthy();
    const locked = (v: string) => (screen.getByDisplayValue(v) as HTMLInputElement).readOnly;
    expect(locked("11.222.333/0001-81")).toBe(true);
    expect(locked("ACME LTDA")).toBe(true);
    expect(locked("85851-000")).toBe(true);
    const cont = screen.getByRole("button", { name: "Continuar" }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true); // falta a inscrição municipal
    fireEvent.change(screen.getAllByRole("textbox").find((i) => !(i as HTMLInputElement).readOnly)!, { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    // aba Fiscal: tudo bloqueado, vindo da Receita
    expect(locked("contato@acme.com.br")).toBe(true);
    expect(locked("(45) 3523-0000")).toBe(true);
    expect(locked("Sim · ME/EPP")).toBe(true);
    expect(locked("6821-8/01")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("Enviar certificado A1")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Ativar módulo fiscal" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Fiscal: sem e-mail/telefone na Receita os campos abrem para digitação", async () => {
    fns.fiscalStatus.mockResolvedValue({ companies: [] });
    fns.fiscalCompanyPrefill.mockResolvedValue({ ...prefill, email: "", phone: "" });
    render(<Host />);
    await screen.findByDisplayValue("ACME LTDA");
    fireEvent.change(screen.getAllByRole("textbox").find((i) => !(i as HTMLInputElement).readOnly)!, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    const editable = screen.getAllByRole("textbox").filter((i) => !(i as HTMLInputElement).readOnly);
    expect(editable.length).toBeGreaterThanOrEqual(2);
  });

  it("Ativo: abas Empresa | Serviços | Preferências, resumo da empresa e rodapé com ações", async () => {
    fns.fiscalStatus.mockResolvedValue({ companies: [active] });
    render(<Host />);
    expect(await screen.findByText("Financeiro · Conectado")).toBeTruthy();
    expect(screen.getByText("Certificado A1 válido até 01/01/2099")).toBeTruthy();
    for (const [k, v] of [["Inscrição municipal", "999"], ["Simples Nacional", "Sim · ME/EPP"], ["Nome fantasia", "Acme"]]) {
      expect(screen.getByText(k!)).toBeTruthy();
      expect(screen.getAllByText(v!).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("button", { name: "Substituir certificado" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Editar dados" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mais Ações" })).toBeTruthy();
  });

  it("Serviços vazio: faixa de aviso, sugestão pelo CNAE e 'Usar sugestão' cria o padrão", async () => {
    fns.fiscalStatus.mockResolvedValue({ companies: [active] });
    fns.fiscalServicesList.mockResolvedValue({ items: [], suggestion: { nationalCode: "100501", title: "Gestão de imóveis e serviços para hospedagem", description: "Agenciamento…" } });
    fns.fiscalServiceSave.mockResolvedValue({});
    render(<Host />);
    await screen.findByText("Financeiro · Conectado");
    fireEvent.click(screen.getByRole("button", { name: "Serviços" }));
    expect(await screen.findByText("Falta o serviço padrão. Sem ele não é possível emitir notas.")).toBeTruthy();
    expect(screen.getByText("Sugestão pelo seu CNAE")).toBeTruthy();
    expect(screen.getByText("10.05.01 · ISS pelo Simples Nacional")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Usar sugestão" }));
    await waitFor(() => expect(fns.fiscalServiceSave).toHaveBeenCalled());
    expect(fns.fiscalServiceSave.mock.calls[0]![0].data.data).toMatchObject({ nationalCode: "100501", isDefault: true });
  });

  it("Serviços: lista com padrão marcado, contador e exclusão com confirmação", async () => {
    fns.fiscalStatus.mockResolvedValue({ companies: [active] });
    const mk = (id: string, d: boolean) => ({ id, nationalCode: "100501", serviceCode: null, nbsCode: null, description: `Serviço ${id}`, isDefault: d, inssPct: null, irPct: null, cst: null, cclassTrib: null, operationIndicator: null });
    fns.fiscalServicesList.mockResolvedValue({ items: [mk("a", true), mk("b", false)], suggestion: null });
    fns.fiscalServiceDelete.mockResolvedValue({ ok: true });
    render(<Host />);
    await screen.findByText("Financeiro · Conectado");
    fireEvent.click(screen.getByRole("button", { name: "Serviços" }));
    expect(await screen.findByText("1 a 2 do total de 2 itens")).toBeTruthy();
    expect(screen.getAllByText("10.05.01 · ISS Simples").length).toBe(2);
    expect(screen.getByLabelText("Serviço padrão")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Excluir serviço" })[1]!);
    expect(await screen.findByText("Excluir serviço?")).toBeTruthy();
    expect(screen.getByText(/As notas já emitidas não são afetadas/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(fns.fiscalServiceDelete).toHaveBeenCalledWith({ data: { companyId: "c1", serviceId: "b" } }));
  });

  it("Preferências: valores padrão e salvar", async () => {
    fns.fiscalStatus.mockResolvedValue({ companies: [active] });
    fns.fiscalPreferencesSave.mockResolvedValue({ ok: true });
    render(<Host />);
    await screen.findByText("Financeiro · Conectado");
    fireEvent.click(screen.getByRole("button", { name: "Preferências" }));
    expect(screen.getByText("Não incluir tributos aproximados")).toBeTruthy();
    for (const l of ["Observação nas notas fiscais", "Texto quando houver retenção de IR", "Texto quando houver retenção de CSRF", "Texto quando houver retenção de INSS"]) expect(screen.getByText(l)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(fns.fiscalPreferencesSave).toHaveBeenCalled());
    expect(fns.fiscalPreferencesSave.mock.calls[0]![0].data.data.approximateTaxes).toBe("none");
  });

  it("Editar dados: título, abas, regime especial e salvar com os valores avançados", async () => {
    fns.fiscalStatus.mockResolvedValue({ companies: [active] });
    fns.fiscalCompanyUpdate.mockResolvedValue({ ok: true });
    render(<Host initial="edit" />);
    expect(await screen.findByText("Editar dados")).toBeTruthy();
    expect(screen.getByText("Notas Fiscais (NFS-e) · Financeiro")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Avançado" }));
    expect(screen.getByText("Nenhum (padrão)")).toBeTruthy();
    expect(screen.getByText("Próximo número do DPS")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(fns.fiscalCompanyUpdate).toHaveBeenCalled());
    expect(fns.fiscalCompanyUpdate.mock.calls[0]![0].data.data).toMatchObject({ municipalRegistration: "999", specialRegime: 0, dpsSeries: "1", dpsNextNumber: 1 });
  });

  it("Adicionar serviço: 3 abas, código nacional obrigatório e retenções com aviso do Simples", async () => {
    fns.fiscalStatus.mockResolvedValue({ companies: [active] });
    fns.fiscalSearchServiceCodes.mockResolvedValue({ items: [] });
    render(<Host initial="service" />);
    expect(await screen.findByRole("button", { name: "Adicionar serviço" })).toBeTruthy();
    expect(screen.getAllByText("Adicionar serviço").length).toBe(2); // título + botão do rodapé
    expect((screen.getByRole("button", { name: "Adicionar serviço" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retenções" }));
    expect(screen.getByText(/optante pelo Simples Nacional: o ISS é calculado pelo Simples/)).toBeTruthy();
    expect(screen.getByText("INSS retido")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reforma" }));
    for (const l of ["CST", "cClassTrib", "Indicador da operação"]) expect(screen.getByText(l)).toBeTruthy();
  });

  it("Erro de certificado de outro CNPJ mostra a faixa vermelha na aba Certificado", async () => {
    fns.fiscalStatus.mockResolvedValue({ companies: [] });
    fns.fiscalSetupCompanyWithCertificate.mockResolvedValue({ ok: false, code: "certificate_cnpj_mismatch" });
    render(<Host />);
    await screen.findByDisplayValue("ACME LTDA");
    fireEvent.change(screen.getAllByRole("textbox").find((i) => !(i as HTMLInputElement).readOnly)!, { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    const file = new File([new Uint8Array(40)], "cert.pfx");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("cert.pfx");
    fireEvent.change(document.querySelector('input[type="password"]')!, { target: { value: "senha" } });
    fireEvent.click(screen.getByRole("button", { name: "Ativar módulo fiscal" }));
    expect(await screen.findByText("Não foi possível ativar. O certificado enviado pertence a outro CNPJ. Envie o certificado A1 da empresa 11.222.333/0001-81.")).toBeTruthy();
    const sent = fns.fiscalSetupCompanyWithCertificate.mock.calls[0]![0].data;
    expect(sent).toMatchObject({ municipalRegistration: "12345", simples: "me_epp", cnaeCode: "6821801", email: "contato@acme.com.br" });
    // senha e arquivo foram limpos do navegador após o envio
    expect((document.querySelector('input[type="password"]') as HTMLInputElement).value).toBe("");
  });
});
