import { describe, expect, it } from "vitest";
import { analyzeReplyCommitments } from "../validation/commitment-text";
import { buildSystemPrompt } from "../system-prompt";

const ctx = { officialCheckin: "15:00", officialCheckout: "11:00" };
const kinds = (t: string) => analyzeReplyCommitments(t, ctx).claims.map((c) => c.kind);

describe("early check-in e late check-out: a IA responde do início ao fim (15/11/2026)", () => {
  it("o prompt manda tratar os dois pedidos sem decisão da equipe, com o dossiê como exceção", () => {
    const p = buildSystemPrompt("whatsapp" as never);
    expect(p).toContain("Entrada antecipada e saída tardia: você trata esses pedidos do início ao fim");
    expect(p).toContain("nem mediante cobrança extra");
    expect(p).toContain("durante o próprio dia do check-in");
    expect(p).toContain("texto explícito do dossiê");
    expect(p).not.toContain("a equipe recebe a decisão com botões");
  });

  it("resposta de early check-in (possibilidade, equipe avisa no dia) não vira promessa não declarada", () => {
    const t = "Nosso check-in é a partir das 15h. Se houver a possibilidade de liberar antes, nossa equipe entrará em contato com você durante o dia do check-in.";
    expect(kinds(t)).toEqual([]);
  });

  it("resposta de late check-out (sem extensão, nem com taxa) não vira promessa", () => {
    const t = "O check-out é às 11h e não conseguimos estender, nem com cobrança extra. A saída precisa ser no horário combinado.";
    expect(kinds(t)).toEqual([]);
  });

  it("promessa de saída tardia com horário continua sendo detectada", () => {
    expect(kinds("Pode ficar até as 14h, vou liberar a saída tardia.")).toContain("late_checkout");
  });
});
