import { describe, it, expect } from "vitest";
import { cleanRuleLines, extractAdditionalRules, stripRuleMarker } from "@/lib/airbnb-rules";

/**
 * "Regras adicionais" do Airbnb → "Regras do espaço". O que estes testes
 * protegem é uma frase só: cada linha chega SEM marcador, e só a parte
 * "Regras adicionais" é levada (01/10/2026).
 */
describe("stripRuleMarker", () => {
  it.each([
    ["- Proibido realizar festas", "Proibido realizar festas"],
    ["\\- Proibido fumar", "Proibido fumar"],
    ["– Proibido fumar", "Proibido fumar"],
    ["— Proibido fumar", "Proibido fumar"],
    ["• Proibido fumar", "Proibido fumar"],
    ["* Proibido fumar", "Proibido fumar"],
    ["  -   Proibido fumar  ", "Proibido fumar"],
    ["1. Proibido fumar", "Proibido fumar"],
    ["2) Proibido fumar", "Proibido fumar"],
    ["- • Proibido fumar", "Proibido fumar"],
    ["**Proibido** fumar", "Proibido fumar"],
  ])("%j → %j", (entrada, saida) => {
    expect(stripRuleMarker(entrada)).toBe(saida);
  });

  it("não come hífen, número ou hora do MEIO da frase", () => {
    expect(stripRuleMarker("- Silêncio das 22:00 às 08:00 - sem exceção")).toBe(
      "Silêncio das 22:00 às 08:00 - sem exceção",
    );
    expect(stripRuleMarker("22h às 8h: silêncio")).toBe("22h às 8h: silêncio");
  });
});

describe("cleanRuleLines", () => {
  it("uma regra por linha, sem marcador, sem linha em branco", () => {
    const cru = "- Proibido festas.\n\n- Proibido fumar.\n   \n• Proibido pets.";
    expect(cleanRuleLines(cru)).toBe("Proibido festas.\nProibido fumar.\nProibido pets.");
  });

  it("remove o título 'Regras adicionais' se vier junto", () => {
    expect(cleanRuleLines("Regras adicionais\n- Proibido festas.")).toBe("Proibido festas.");
    expect(cleanRuleLines("**Regras adicionais**\n- Proibido festas.")).toBe("Proibido festas.");
  });

  it("devolve null quando não sobra nada", () => {
    expect(cleanRuleLines("")).toBeNull();
    expect(cleanRuleLines(null)).toBeNull();
    expect(cleanRuleLines("-\n  \n•")).toBeNull();
  });

  it("corta só em linha inteira ao passar do limite", () => {
    const out = cleanRuleLines("aaaa\nbbbb\ncccc", 9);
    expect(out).toBe("aaaa\nbbbb");
  });
});

describe("extractAdditionalRules", () => {
  const tres = [
    "Durante sua estadia",
    "- Máximo de 6 hóspedes",
    "- Pets não permitidos",
    "",
    "Regras adicionais",
    "- Proibido realizar festas ou eventos, independentemente do porte.",
    "- Proibido receber visitas de hóspedes não inseridos na reserva.",
    "",
    "Antes de deixar o local",
    "- Jogue o lixo fora",
    "- Devolva as chaves",
  ].join("\n");

  it("leva SÓ a parte 'Regras adicionais', limpa", () => {
    expect(extractAdditionalRules(tres)).toBe(
      "Proibido realizar festas ou eventos, independentemente do porte.\n" +
        "Proibido receber visitas de hóspedes não inseridos na reserva.",
    );
  });

  it("vai até o fim do texto quando 'Antes de deixar o local' não existe", () => {
    expect(extractAdditionalRules("Regras adicionais\n- Uma\n- Duas")).toBe("Uma\nDuas");
  });

  it("aceita o título em inglês e em markdown", () => {
    expect(
      extractAdditionalRules("## Additional rules\n- No parties\nBefore you leave\n- Lock up"),
    ).toBe("No parties");
  });

  it("devolve null sem a seção", () => {
    expect(extractAdditionalRules("Durante sua estadia\n- Sem pets")).toBeNull();
    expect(extractAdditionalRules(null)).toBeNull();
  });
});
