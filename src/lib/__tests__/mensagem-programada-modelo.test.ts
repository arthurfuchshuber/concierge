import { describe, expect, it } from "vitest";
import { isRecurringTemplate, templateSimilarity } from "@/lib/channex-messages.server";

const checkout = (nome: string) =>
  `Olá, ${nome}.\nSua estadia está chegando ao fim! ☀️\n\nSegue abaixo instruções de Checkout, que deve acontecer até 11:00 horas.\n\nCom base nisso, por favor, qual é o seu horário estimado de saída?`;

describe("mensagem programada reconhecida por repetição (caso Whyll, 18/11/2026)", () => {
  it("o mesmo aviso de check-out para hóspedes diferentes é quase idêntico", () => {
    expect(templateSimilarity(checkout("Whyll"), checkout("Carlos Eduardo"))).toBeGreaterThanOrEqual(0.85);
  });

  it("enviado a 2+ outras conversas ⇒ modelo da conta (não pausa a IA)", () => {
    const others = [
      { conversationId: "a", content: checkout("Higor") },
      { conversationId: "b", content: checkout("Gustavo Paulo") },
    ];
    expect(isRecurringTemplate(checkout("Whyll"), others)).toBe(true);
  });

  it("uma única coincidência não basta", () => {
    expect(isRecurringTemplate(checkout("Whyll"), [{ conversationId: "a", content: checkout("Higor") }])).toBe(false);
  });

  it("fala humana curta ou diferente segue humana", () => {
    const others = [
      { conversationId: "a", content: "Portão aberto, Whyll." },
      { conversationId: "b", content: "Portão aberto, Alice." },
    ];
    expect(isRecurringTemplate("Portão aberto, Ana.", others)).toBe(false);
    const longos = [
      { conversationId: "a", content: checkout("Higor") },
      { conversationId: "b", content: checkout("Gustavo Paulo") },
    ];
    expect(isRecurringTemplate("Marcela, teremos hóspedes neste outro studio. Não temos um lugar específico para que guarde as malas, mas a equipe de limpeza pode alinhar com você.", longos)).toBe(false);
  });
});
