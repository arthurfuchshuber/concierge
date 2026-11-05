/**
 * COPILOTO · frente 2 (interface). O cartão "Sugestão da IA" da tela de Atendimento com as server functions
 * falsas (nenhum envio real). Cobre: estados (Gerando, Disponível, Editada, Enviando, Enviada, Falha no envio,
 * Descartada), rótulo de IA + "rascunho — não enviado" (nunca confundível com mensagem enviada), texto,
 * intenção, contexto e avisos; Editar/Descartar/Enviar; envio bloqueado sem poder compor; clique repetido não
 * dispara segundo envio; pedido automático único por mensagem nova do hóspede; Copiloto desligado ⇒ nada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CopilotSuggestionRow } from "@/lib/guest-ai/copilot/contracts";

const fns = vi.hoisted(() => ({
  get: vi.fn(),
  ensure: vi.fn(),
  edit: vi.fn(),
  discard: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (f: unknown) => f }));
vi.mock("@/lib/copilot.functions", () => ({
  getCopilotSuggestion: fns.get,
  ensureCopilotSuggestion: fns.ensure,
  editCopilotSuggestion: fns.edit,
  discardCopilotSuggestion: fns.discard,
  sendCopilotSuggestion: fns.send,
}));
const channel = vi.hoisted(() => ({ handlers: [] as Array<() => void> }));
vi.mock("@/integrations/supabase/client", () => {
  const ch = {
    on: (_e: string, _f: unknown, cb: () => void) => {
      channel.handlers.push(cb);
      return ch;
    },
    subscribe: () => ch,
  };
  return { supabase: { channel: () => ch, removeChannel: () => {} } };
});

import { AiSuggestionCard, STATE_LABEL, contextSummary } from "../AiSuggestionCard";

const CONV = "c0000000-0000-4000-8000-000000000001";
const MSG = "m0000000-0000-4000-8000-000000000001";
const row = (over: Partial<CopilotSuggestionRow> = {}): CopilotSuggestionRow => ({
  id: "s0000000-0000-4000-8000-000000000001",
  tenant_id: "t",
  property_id: "p",
  conversation_id: CONV,
  trigger_message_id: MSG,
  surface: "airbnb",
  state: "available",
  suggested_text: "O check-in é às 15h, no horário do imóvel.",
  edited_text: null,
  internal_question: null,
  intents: ["informational_query"],
  strategy: "answer",
  handoff_needed: false,
  handoff_urgency: null,
  outcome_kind: "reply",
  outcome_code: null,
  warnings: ["unknown_facts"],
  context_stay_phase: "pre_stay",
  context_reservation_linked: true,
  context_history_messages: 4,
  context_dossier_entries: 12,
  context_credential_policy: "deny",
  context_sender_identity: "resolved",
  context_human_in_command: false,
  model_id: "google/gemini-3.8-flash",
  gateway_error: null,
  generation_attempts: 1,
  generation_started_at: "2026-11-05T12:00:00Z",
  generation_finished_at: "2026-11-05T12:00:05Z",
  edited_at: null,
  edited_by: null,
  send_attempts: 0,
  send_claimed_at: null,
  sent_at: null,
  sent_by: null,
  sent_message_id: null,
  sent_channel: null,
  send_error: null,
  created_at: "2026-11-05T12:00:00Z",
  updated_at: "2026-11-05T12:00:05Z",
  expires_at: "2026-11-19T12:00:00Z",
  ...over,
});

function mount(props: Partial<Parameters<typeof AiSuggestionCard>[0]> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSent = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <AiSuggestionCard
        conversationId={CONV}
        latestGuestMessageId={MSG}
        canSend
        onSent={onSent}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSent, qc };
}

beforeEach(() => {
  for (const f of Object.values(fns)) f.mockReset();
  channel.handlers.length = 0;
  fns.ensure.mockResolvedValue({ status: "exists", suggestion: null });
});
afterEach(cleanup);

describe("Cartão Sugestão da IA", () => {
  it("Disponível: rótulo IA, 'rascunho — não enviado', texto integral, intenção, contexto, avisos e as três ações", async () => {
    fns.get.mockResolvedValue({ enabled: true, suggestion: row() });
    mount();
    expect((await screen.findByTestId("ai-suggestion-text")).textContent).toContain(
      "O check-in é às 15h, no horário do imóvel.",
    );
    expect(screen.getByText("Sugestão da IA")).toBeTruthy();
    expect(screen.getByText("IA")).toBeTruthy();
    expect(screen.getByText("rascunho — não enviado")).toBeTruthy();
    expect(screen.getByTestId("ai-suggestion-state").textContent).toContain("Disponível");
    expect(screen.getByText(/intenção: dúvida/)).toBeTruthy();
    expect(screen.getByTestId("ai-suggestion-context").textContent).toContain(
      "pré-estadia · reserva vinculada · 4 msg de histórico · 12 itens do Dossiê · credenciais bloqueadas · remetente Airbnb confirmado",
    );
    expect(screen.getByTestId("ai-suggestion-warnings").textContent).toContain(
      "A IA não encontrou toda a informação",
    );
    expect(screen.getByTestId("ai-suggestion-edit")).toBeTruthy();
    expect(screen.getByTestId("ai-suggestion-discard")).toBeTruthy();
    expect(screen.getByTestId("ai-suggestion-send").textContent).toContain("Enviar ao Hóspede");
    // um rascunho existente para a mensagem atual ⇒ nenhum pedido de geração
    expect(fns.ensure).not.toHaveBeenCalled();
  });

  it("Enviar ao Hóspede: chama o envio do backend UMA vez, mesmo com cliques repetidos; sucesso avisa a conversa", async () => {
    fns.get.mockResolvedValue({ enabled: true, suggestion: row() });
    let resolve!: (v: unknown) => void;
    fns.send.mockReturnValue(new Promise((r) => (resolve = r)));
    const { onSent } = mount();
    const btn = await screen.findByTestId("ai-suggestion-send");
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() =>
      expect((screen.getByTestId("ai-suggestion-send") as HTMLButtonElement).disabled).toBe(true),
    );
    expect(fns.send).toHaveBeenCalledTimes(1);
    expect(fns.send).toHaveBeenCalledWith({ data: { suggestionId: row().id } });
    fns.get.mockResolvedValue({
      enabled: true,
      suggestion: row({ state: "sent", sent_at: "2026-11-05T12:01:00Z", sent_by: "u" }),
    });
    await act(async () =>
      resolve({ outcome: { status: "sent", messageId: "m" }, suggestion: null }),
    );
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Enviada ao hóspede pela equipe/)).toBeTruthy();
    expect(screen.queryByTestId("ai-suggestion-send")).toBeNull();
    expect(screen.queryByText("rascunho — não enviado")).toBeNull();
  });

  it("Editar: abre o editor com o texto; salvar envia o texto editado; enviar durante a edição usa o texto editado", async () => {
    fns.get.mockResolvedValue({ enabled: true, suggestion: row() });
    fns.edit.mockResolvedValue({ ok: true, suggestion: null });
    fns.send.mockResolvedValue({ outcome: { status: "send_in_progress" }, suggestion: null });
    mount();
    fireEvent.click(await screen.findByTestId("ai-suggestion-edit"));
    const editor = screen.getByTestId("ai-suggestion-editor") as HTMLTextAreaElement;
    expect(editor.value).toBe("O check-in é às 15h, no horário do imóvel.");
    fireEvent.change(editor, { target: { value: "O check-in é às 15h. Bem-vindo!" } });
    fireEvent.click(screen.getByText("Salvar edição"));
    await waitFor(() =>
      expect(fns.edit).toHaveBeenCalledWith({
        data: { suggestionId: row().id, text: "O check-in é às 15h. Bem-vindo!" },
      }),
    );
    fireEvent.click(screen.getByTestId("ai-suggestion-edit"));
    fireEvent.change(screen.getByTestId("ai-suggestion-editor"), {
      target: { value: "Texto final" },
    });
    fireEvent.click(screen.getByTestId("ai-suggestion-send"));
    await waitFor(() =>
      expect(fns.send).toHaveBeenCalledWith({
        data: { suggestionId: row().id, text: "Texto final" },
      }),
    );
    expect(await screen.findByText(/Envio já em andamento/)).toBeTruthy();
  });

  it("Editada mostra o texto editado e o estado 'Editada'", async () => {
    fns.get.mockResolvedValue({
      enabled: true,
      suggestion: row({ state: "edited", edited_text: "Versão da equipe", edited_by: "u" }),
    });
    mount();
    expect((await screen.findByTestId("ai-suggestion-text")).textContent).toContain(
      "Versão da equipe",
    );
    expect(screen.getByTestId("ai-suggestion-state").textContent).toContain("Editada");
  });

  it("Descartar chama o backend; Descartada fica riscada e sem ações", async () => {
    fns.get.mockResolvedValue({ enabled: true, suggestion: row() });
    fns.discard.mockResolvedValue({ ok: true, suggestion: null });
    mount();
    fireEvent.click(await screen.findByTestId("ai-suggestion-discard"));
    await waitFor(() =>
      expect(fns.discard).toHaveBeenCalledWith({ data: { suggestionId: row().id } }),
    );
    cleanup();
    fns.get.mockResolvedValue({ enabled: true, suggestion: row({ state: "discarded" }) });
    mount();
    expect((await screen.findByTestId("ai-suggestion-state")).textContent).toContain("Descartada");
    expect(screen.getByTestId("ai-suggestion-text").className).toContain("line-through");
    expect(screen.queryByTestId("ai-suggestion-send")).toBeNull();
  });

  it("sem poder compor (outro responsável): envio desabilitado com orientação; editar/descartar seguem", async () => {
    fns.get.mockResolvedValue({ enabled: true, suggestion: row() });
    mount({ canSend: false });
    expect(((await screen.findByTestId("ai-suggestion-send")) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText("Assuma a conversa para poder enviar a sugestão.")).toBeTruthy();
    expect((screen.getByTestId("ai-suggestion-edit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Gerando e Enviando: indicador de processamento, sem ações de envio duplicado", async () => {
    fns.get.mockResolvedValue({
      enabled: true,
      suggestion: row({ state: "generating", suggested_text: null }),
    });
    mount();
    expect((await screen.findByTestId("ai-suggestion-state")).textContent).toContain("Gerando");
    expect(screen.getByText(/A IA está lendo a conversa/)).toBeTruthy();
    expect(screen.queryByTestId("ai-suggestion-send")).toBeNull();
    cleanup();
    fns.get.mockResolvedValue({
      enabled: true,
      suggestion: row({ state: "sending", send_claimed_at: "2026-11-05T12:01:00Z" }),
    });
    mount();
    expect((await screen.findByTestId("ai-suggestion-state")).textContent).toContain("Enviando");
    expect(screen.queryByTestId("ai-suggestion-send")).toBeNull();
    expect(screen.getByText("Verificar envio")).toBeTruthy();
  });

  it("Falha no envio: motivo legível (remetente do Airbnb) e 'Tentar novamente'", async () => {
    fns.get.mockResolvedValue({
      enabled: true,
      suggestion: row({
        state: "send_failed",
        send_error: "sender_identity_preference_other_tenant",
        send_attempts: 1,
      }),
    });
    mount();
    expect((await screen.findByTestId("ai-suggestion-send-error")).textContent).toContain(
      "Conta remetente do Airbnb não confirmada (preference other tenant). Nada foi enviado.",
    );
    expect(screen.getByTestId("ai-suggestion-state").textContent).toContain("Falha no envio");
    expect(screen.getByTestId("ai-suggestion-send").textContent).toContain("Tentar novamente");
  });

  it("sem sugestão / não gerada: explicação fechada e pergunta interna da IA à equipe", async () => {
    fns.get.mockResolvedValue({
      enabled: true,
      suggestion: row({
        state: "no_suggestion",
        suggested_text: null,
        outcome_kind: "human_action",
        outcome_code: "human_action",
        internal_question: "O hóspede pode levar um pet?",
      }),
    });
    mount();
    expect(
      await screen.findByText("A IA precisa de uma decisão da equipe antes de responder."),
    ).toBeTruthy();
    expect(screen.getByText(/O hóspede pode levar um pet\?/)).toBeTruthy();
    expect(screen.queryByTestId("ai-suggestion-send")).toBeNull();
    cleanup();
    fns.get.mockResolvedValue({
      enabled: true,
      suggestion: row({
        state: "generation_failed",
        suggested_text: null,
        outcome_code: "budget_daily_exceeded",
      }),
    });
    mount();
    expect(await screen.findByText(/Limite diário de uso da IA atingido/)).toBeTruthy();
  });

  it("mensagem mais nova do hóspede: pede UMA geração e avisa que a sugestão é da mensagem anterior", async () => {
    fns.get.mockResolvedValue({ enabled: true, suggestion: row({ trigger_message_id: "antiga" }) });
    mount();
    expect(await screen.findByText(/O hóspede enviou mensagem mais nova/)).toBeTruthy();
    await waitFor(() => expect(fns.ensure).toHaveBeenCalledTimes(1));
    expect(fns.ensure).toHaveBeenCalledWith({ data: { conversationId: CONV } });
    act(() => channel.handlers.forEach((h) => h()));
    await new Promise((r) => setTimeout(r, 30));
    expect(fns.ensure).toHaveBeenCalledTimes(1);
  });

  it("Copiloto desligado ⇒ nada é renderizado nem pedido; sem mensagem do hóspede ⇒ nada", async () => {
    fns.get.mockResolvedValue({ enabled: false, suggestion: null });
    mount();
    await waitFor(() => expect(fns.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("ai-suggestion-card")).toBeNull();
    expect(fns.ensure).not.toHaveBeenCalled();
    cleanup();
    fns.get.mockResolvedValue({ enabled: true, suggestion: null });
    mount({ latestGuestMessageId: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("ai-suggestion-card")).toBeNull();
  });

  it("todos os estados têm rótulo; contexto só com dados fechados", () => {
    for (const s of [
      "generating",
      "available",
      "edited",
      "sending",
      "sent",
      "send_failed",
      "discarded",
    ] as const)
      expect(STATE_LABEL[s]).toBeTruthy();
    expect(STATE_LABEL.send_failed).toBe("Falha no envio");
    expect(contextSummary(row({ surface: "whatsapp", context_human_in_command: true }))).toContain(
      "equipe no comando",
    );
    expect(contextSummary(row({ surface: "whatsapp" })).join(" ")).not.toContain("remetente");
  });
});
