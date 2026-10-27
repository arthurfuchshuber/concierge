import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// O mini-chat é pesado e não faz parte deste teste.
vi.mock("@/components/handoff/ConversationView", () => ({
  ConversationView: () => <div data-testid="mini-chat" />,
}));
vi.mock("@/components/PhoneActionButton", () => ({
  PhoneActionButton: () => <span data-testid="phone-icon" />,
}));

import { QuickChatBubbles, type QuickChatItem } from "@/components/handoff/QuickChatBubbles";
import { todayInSaoPaulo } from "@/lib/handoff-queue-order";

afterEach(() => cleanup());

// Datas relativas a "hoje" em São Paulo (a mesma conta que o aviso faz), sem depender da hora do teste.
const daysFromNow = (n: number) =>
  new Date(Date.parse(`${todayInSaoPaulo()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const alexane: QuickChatItem = {
  id: "c1",
  guestName: "Alexane",
  propertyName: "Casa Completa Próx. a Avenida Turística",
  reason: "Precisa enviar documentos das quatro hóspedes? Qual o procedimento?",
  sessionId: "airbnb:1",
  checkinDate: daysFromNow(7),
  checkoutDate: daysFromNow(10),
  at: new Date().toISOString(),
};
const julia: QuickChatItem = { ...alexane, id: "c2", guestName: "Júlia", sessionId: "whatsapp:2", checkinDate: daysFromNow(14), checkoutDate: daysFromNow(16), reason: "Quer saber da garagem." };
const pedro: QuickChatItem = { ...alexane, id: "c3", guestName: "Pedro", sessionId: null, checkinDate: daysFromNow(22), checkoutDate: daysFromNow(25), reason: "Wi-Fi não conecta." };
const quarto: QuickChatItem = { ...alexane, id: "c4", guestName: "Marcos", sessionId: "airbnb:4", checkinDate: daysFromNow(29), checkoutDate: daysFromNow(31), reason: null };

function setup(items: QuickChatItem[], extra: Partial<Parameters<typeof QuickChatBubbles>[0]> = {}) {
  const onDismiss = vi.fn();
  const onOpenFull = vi.fn();
  render(
    <QuickChatBubbles items={items} fabBottom="88px" myUserId="u1" onOpenFull={onOpenFull} onDismiss={onDismiss} {...extra} />,
  );
  return { onDismiss, onOpenFull };
}

describe("aviso flutuante do hóspede (Proposta A)", () => {
  it("um hóspede: cartão com nome, imóvel, período, etiqueta, motivo e as duas ações — sem leque", () => {
    setup([alexane]);
    expect(screen.getByText("Alexane")).toBeTruthy();
    expect(screen.getByText("Casa Completa Próx. a Avenida Turística")).toBeTruthy();
    expect(screen.getByText(/→/).textContent).toMatch(/^\d{2}\/\d{2}\/\d{4} → \d{2}\/\d{2}\/\d{4}$/);
    expect(screen.getByText("Precisa de atendimento")).toBeTruthy();
    expect(screen.getByText(/documentos das quatro hóspedes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Responder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Depois" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dispensar aviso" })).toBeTruthy();
    expect(screen.queryByText(/da fila/)).toBeNull();
  });

  it("o canal aparece como bolinha na foto do hóspede", () => {
    setup([alexane]);
    expect(screen.getByRole("img", { name: "Airbnb" })).toBeTruthy();
  });

  it("o X dispensa todos os avisos; 'Depois' dispensa só o do cartão", () => {
    const { onDismiss } = setup([alexane]);
    fireEvent.click(screen.getByRole("button", { name: "Dispensar aviso" }));
    expect(onDismiss).toHaveBeenLastCalledWith("all");
    fireEvent.click(screen.getByRole("button", { name: "Depois" }));
    expect(onDismiss).toHaveBeenLastCalledWith("c1");
  });

  it("Responder abre o mini-chat no mesmo lugar e 'Recolher' volta ao cartão", () => {
    setup([alexane]);
    fireEvent.click(screen.getByRole("button", { name: "Responder" }));
    expect(screen.getByTestId("mini-chat")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recolher" }));
    expect(screen.queryByTestId("mini-chat")).toBeNull();
    expect(screen.getByRole("button", { name: "Responder" })).toBeTruthy();
  });

  it("vários: leque pelo check-in mais próximo, cartão do 1º com 'check-in em 7 dias' e etiqueta 'Atendimento'", () => {
    // Entregues fora de ordem de propósito.
    setup([pedro, alexane, julia]);
    expect(screen.getByText("Atendimento")).toBeTruthy();
    expect(screen.getByText("1º · check-in em 7 dias")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^1º da fila: Alexane, Airbnb.*atendimento aberto$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^2º da fila: Júlia, WhatsApp/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^3º da fila: Pedro, Guia digital/ })).toBeTruthy();
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });

  it("mais de 3: o excedente vira '+N' e tocar nele traz o 4º hóspede", () => {
    setup([alexane, julia, pedro, quarto]);
    const more = screen.getByRole("button", { name: /^4º da fila: mais 1 hóspede, check-in a partir de/ });
    expect(more.textContent).toBe("+1");
    fireEvent.click(more);
    expect(screen.getByText("Marcos")).toBeTruthy();
    expect(screen.getByText(/^4º · check-in em 29 dias$/)).toBeTruthy();
  });

  it("tocar num avatar traz o cartão daquele hóspede; 'Depois' passa ao próximo da fila", () => {
    const { onDismiss } = setup([alexane, julia, pedro]);
    fireEvent.click(screen.getByRole("button", { name: /^2º da fila: Júlia/ }));
    expect(screen.getByText(/^2º · check-in em 14 dias$/)).toBeTruthy();
    expect(screen.getByText("Quer saber da garagem.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Depois" }));
    expect(onDismiss).toHaveBeenLastCalledWith("c2");
  });

  it("sem aviso, nada é desenhado", () => {
    setup([]);
    expect(screen.queryByRole("group")).toBeNull();
  });
});
