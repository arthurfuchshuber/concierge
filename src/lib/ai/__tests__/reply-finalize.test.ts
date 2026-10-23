import { describe, expect, it } from "vitest";
import { finalizeAgentReply } from "../reply-finalize";

describe("finalizeAgentReply", () => {
  it("não adiciona assinatura em nenhum canal", () => {
    expect(finalizeAgentReply("Olá", "airbnb")).toBe("Olá");
    expect(finalizeAgentReply("Olá", "whatsapp")).toBe("Olá");
  });
  it("remove assinatura escrita pelo modelo", () => {
    expect(finalizeAgentReply("Olá\n\n[Assistente IA]", "airbnb")).toBe("Olá");
  });
  it("silêncio não envia nada", () => {
    expect(finalizeAgentReply("[SILENCIO]", "airbnb")).toBe("");
  });
  it("remove menção a comissão e repasse líquido, mantendo o valor bruto", () => {
    const r = finalizeAgentReply("O total da reserva é R$ 900. A comissão da plataforma é de 15%. O repasse líquido ao anfitrião é menor.", "airbnb");
    expect(r).toBe("O total da reserva é R$ 900.");
  });
  it("só conteúdo sensível vira resposta neutra", () => {
    expect(finalizeAgentReply("O valor líquido que recebo é R$ 700.", "airbnb")).toContain("valor total");
  });
});

import { formatListSpacing } from "../reply-finalize";
import { LIST_SPACING_RULES } from "../prompt-rules";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("formatListSpacing", () => {
  it("separa itens de hífen colados com linha em branco", () => {
    expect(formatListSpacing("Opções:\n- Piscina\n- Academia\n- Sauna")).toBe("Opções:\n\n- Piscina\n\n- Academia\n\n- Sauna");
  });
  it("mantém itens numerados juntos e junta os que vieram separados", () => {
    expect(formatListSpacing("Passos:\n1. Abra\n2. Gire\n3. Entre")).toBe("Passos:\n\n1. Abra\n2. Gire\n3. Entre");
    expect(formatListSpacing("1. Abra\n\n2. Gire")).toBe("1. Abra\n2. Gire");
  });
  it("linha em branco antes e depois da lista", () => {
    expect(formatListSpacing("- A\n- B\nQuer algo mais?")).toBe("- A\n\n- B\n\nQuer algo mais?");
    expect(formatListSpacing("1. A\n2. B\nPronto?")).toBe("1. A\n2. B\n\nPronto?");
  });
  it("continuação indentada fica no mesmo item", () => {
    expect(formatListSpacing("- A\n  detalhe\n- B")).toBe("- A\n  detalhe\n\n- B");
  });
  it("não mexe em texto sem lista nem em hífen sem espaço", () => {
    expect(formatListSpacing("Olá\n\nTudo bem?")).toBe("Olá\n\nTudo bem?");
    expect(formatListSpacing("Faz -5 graus\nlá")).toBe("Faz -5 graus\nlá");
  });
  it("idempotente e aplicado por finalizeAgentReply", () => {
    const once = formatListSpacing("- A\n- B");
    expect(formatListSpacing(once)).toBe(once);
    expect(finalizeAgentReply("Veja:\n- A\n- B", "airbnb")).toBe("Veja:\n\n- A\n\n- B");
  });
  it("prompt traz a regra nos blocos FORMATO e CANAL AIRBNB", () => {
    expect(LIST_SPACING_RULES).toMatch(/linha em branco entre um tópico/);
    expect(LIST_SPACING_RULES).toMatch(/JUNTAS/);
    const src = readFileSync(join(process.cwd(), "src/lib/ai/orchestrator.server.ts"), "utf-8");
    expect(src.match(/\$\{LIST_SPACING_RULES\}/g)?.length).toBe(2);
  });
});
