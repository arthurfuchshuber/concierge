import { describe, expect, it } from "vitest";
import { INFO_PADRAO, infoValida, lugaresDeDormir, montarChecklist, progresso, saldoDeLugares } from "./catalog";

const nomes = (id: string, info = INFO_PADRAO) =>
  montarChecklist(info).find((c) => c.id === id)!.itens.map((x) => x.nome);

describe("checklist", () => {
  it("calcula lugares de dormir", () => {
    expect(lugaresDeDormir(INFO_PADRAO)).toBe(6);
    expect(saldoDeLugares(INFO_PADRAO)).toBe(0);
    expect(infoValida(INFO_PADRAO)).toBe(true);
    expect(infoValida({ ...INFO_PADRAO, hospedes: 8 })).toBe(false);
  });

  it("calcula quantidades do exemplo (6 hóspedes, 2 banheiros, 4 camas)", () => {
    const cats = montarChecklist(INFO_PADRAO);
    const q = (c: string, n: string) => cats.find((x) => x.id === c)!.itens.find((x) => x.nome === n)!.qtd;
    expect(q("q", "Edredom")).toBe(4);
    expect(q("q", "Lençol elástico")).toBe(12);
    expect(q("q", "Fronha de travesseiro")).toBe(18);
    expect(q("q", "Ar-condicionado")).toBe(3);
    expect(q("b", "Toalha de banho")).toBe(18);
    expect(q("b", "Tapete de chão")).toBe(6);
    expect(q("c", "Garfo")).toBe(12);
  });

  it("sem geladeira/frigobar move jarra e forma de gelo para opcionais", () => {
    const i = { ...INFO_PADRAO, geladeira: 0, frigobar: 0 };
    expect(nomes("c", i)).not.toContain("Jarra de água");
    expect(nomes("o", i)).toContain("Forma de gelo");
  });

  it("sem fogão move utensílios de cozimento; sem mesa apenas oculta", () => {
    const i = { ...INFO_PADRAO, fogao: 0, mesa: 0 };
    expect(nomes("c", i)).not.toContain("Panela grande");
    expect(nomes("o", i)).toContain("Panela grande");
    expect(nomes("c", i)).not.toContain("Prato fundo");
    expect(nomes("o", i)).not.toContain("Prato fundo");
  });

  it("calcula progresso por itens", () => {
    const cat = montarChecklist(INFO_PADRAO)[0];
    expect(progresso(cat, new Set(["Edredom", "Cabide"]))).toEqual({ feitos: 2, total: 14, pct: 14 });
  });
});
