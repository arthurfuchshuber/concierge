import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fns = vi.hoisted(() => ({ get: vi.fn(), undo: vi.fn(), scope: vi.fn(), div: vi.fn(), rec: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f, createServerFn: () => ({}) }));
vi.mock("@/lib/guest-ai-learning.functions", () => ({
  getConversationLearnings: fns.get,
  undoLearningEntry: fns.undo,
  updateLearningEntryScope: fns.scope,
}));
vi.mock("@/lib/admin-ia-telemetry.functions", () => ({ getAiDivergences: fns.div, getRecentLearnings: fns.rec }));
import { LearnedBadge } from "../LearnedBadge";
import { TelemetryLearningPanels } from "@/components/admin/ia/TelemetryLearningPanels";

const wrap = (el: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{el}</QueryClientProvider>
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("selo 'IA aprendeu' no chat", () => {
  it("mostra o escopo e desfaz com 1 clique", async () => {
    fns.undo.mockResolvedValue({ closed: 1 });
    render(wrap(<LearnedBadge conversationId="c1" learning={{ messageId: "m1", entryId: "e1", statement: "O ferro fica no armário.", scope: "city" }} />));
    expect(screen.getByText(/IA aprendeu · Cidade/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(fns.undo).toHaveBeenCalledWith({ data: { id: "e1" } }));
  });
  it("erro ao desfazer aparece sem quebrar a tela", async () => {
    fns.undo.mockRejectedValue(new Error("Você não tem permissão para revisar aprendizados da IA neste imóvel."));
    render(wrap(<LearnedBadge conversationId="c1" learning={{ messageId: "m1", entryId: "e1", statement: "x", scope: "property" }} />));
    fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

const DIV = {
  entryId: "e1",
  propertyName: "Studio 104",
  ownerName: "Maria",
  ownerPhone: null,
  ownerPhoneCountry: null,
  dossierLabel: "Manual · Lavanderia",
  dossierExcerpt: "O ferro fica na bancada.",
  livingStatement: "O ferro fica no armário do corredor.",
  decidedAt: "2026-11-10T15:42:00Z",
  decidedByName: "Ana",
};
const REC = {
  entryId: "e2",
  statement: "A coleta de lixo passa às terças.",
  propertyName: "Studio 101",
  ownerName: "Maria",
  ownerPhone: null,
  ownerPhoneCountry: null,
  decidedAt: "2026-11-10T14:15:00Z",
  decidedByName: "Ana",
  scope: "city",
  replicas: 6,
};

describe("/admin/ia · divergências e aprendidos recentemente", () => {
  it("cartão da divergência: imóvel, proprietário, original × atualizado, autor e Reverter ao Dossiê", async () => {
    fns.div.mockResolvedValue([DIV]);
    fns.rec.mockResolvedValue([]);
    fns.undo.mockResolvedValue({ closed: 1 });
    render(wrap(<TelemetryLearningPanels />));
    expect(await screen.findByText("Studio 104")).toBeTruthy();
    expect(screen.getByText("O ferro fica na bancada.")).toBeTruthy();
    expect(screen.getByText("O ferro fica no armário do corredor.")).toBeTruthy();
    expect(screen.getByText(/Maria/)).toBeTruthy();
    expect(screen.getByText(/Ana/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reverter ao Dossiê/ }));
    await waitFor(() => expect(fns.undo).toHaveBeenCalledWith({ data: { id: "e1" } }));
  });
  it("lista recente: escopo atual marcado, troca de escopo e desfazer", async () => {
    fns.div.mockResolvedValue([]);
    fns.rec.mockResolvedValue([REC]);
    fns.scope.mockResolvedValue({ removed: 0, replicated: 2 });
    render(wrap(<TelemetryLearningPanels />));
    expect(await screen.findByText("A coleta de lixo passa às terças.")).toBeTruthy();
    expect(screen.getByText(/réplica em 6 imóveis/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cidade" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Conta" }));
    await waitFor(() => expect(fns.scope).toHaveBeenCalledWith({ data: { id: "e2", scope: "account" } }));
  });
  it("sem dados: estados vazios, nada quebra", async () => {
    fns.div.mockResolvedValue([]);
    fns.rec.mockResolvedValue([]);
    render(wrap(<TelemetryLearningPanels />));
    expect(await screen.findByText(/Nenhum aprendizado ativo diverge/)).toBeTruthy();
    expect(await screen.findByText(/ainda não aprendeu nada novo/)).toBeTruthy();
  });
});
