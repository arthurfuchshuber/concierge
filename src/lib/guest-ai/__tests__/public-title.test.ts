import { describe, expect, it } from "vitest";
import { publicPropertyTitle, splitPublicPropertyTitle } from "@/lib/guest-ai/data/public-title";

/** Os 44 nomes de `properties.name` em produção (02/11/2026). */
const PRODUCAO = [
  "AP005 - Apartamento com piscina, ar-condicionado e home office", "AP006 - Apê 5min do centro, 2 quartos, ar e vaga",
  "AP007 - Apto completo perto do centro, ar e vaga", "AP008 - Apto com ar-cond, vaga e ótima localização",
  "AP009 - Apto com piscina, ar e espaço home office", "AP010 - Apto completo perto do centro, ar e vaga",
  "AP011 - Cantinho Perfeito c/ Ar e vaga para 2", "AP012 - Apê completo, ar, vaga e portaria 24h",
  "AP013 - Apto c/ piscina, varanda, ar e 4 camas", "AP014 - Flat ao lado da Santa Casa, ar e vaga",
  "AP015 - Apto c/ piscina, ar, churrasqueira e vaga", "AP016 - Apê decorado, suíte, piscina, ar e vaga",
  "AP017 - Ótimo apartamento, ar cond. e vaga", "Apê Aconchegante a 2 km do Centro",
  "Casa Charmosa Próx. a Avenida das Cataratas", "Casa Charmosa Próx. a Avenida das Cataratas",
  "Casa Completa em Bairro Residencial", "Casa Completa Próx. a Avenida Turística",
  "CS001 - Casa c/ varanda, quintal e churrasqueira", "CS002 - Casa 4 minutos do centro + ar cond. e vaga",
  "CS003 - Casa perto do centro, ar e garagem", "CS004 - Loft Vila Inglesa, ar, vaga e home office",
  "CS005 - Casa dos Sonhos em Ribeirão Claro", "CS006 - Casa p/ 7, 3 quartos c/ ar, 2 vagas",
  "CS007 - Casa c/ suíte, churrasqueira e 2 vagas", "CS008 - Casa c/ 4 camas, centro, ar e garagem",
  "CS009 - Casa com quintal, perto do horto, ar, vaga", "CS010 - Casa espaçosa com ar em todos os quartos",
  "CS011 - Casa p/ 7, quartos c/ ar, 6 camas 2 vagas", "CS020 - Casa na represa, piscina, ar e muito lazer",
  "KT001 - Kit Net a 3 minutos do centro", "KT002 - Kit p/ 3 perto do centro e rodoviária, ar",
  "KT003 - Kitnet térreo p/ 3, ar e vaga", "LF001 - Loft moderno + ar condicionado e vaga",
  "SB001 - Sobrado central, Ar, garagem e Wi-Fi 500Mb", "SB002 - Sobrado 4, centro, ar, wi-fi e garagem",
  "SB003 - Sobrado central, ar-condicionado, 4 camas, Wi-Fi de 800 Mb", "Studio n° 101 Aconchegante Próximo ao Paraguai",
  "Studio n° 102 Aconchegante Próximo ao Paraguai", "Studio n° 103 Aconchegante Próximo ao Paraguai",
  "Studio n° 104 Próximo ao Paraguai", "Studio n° 105 Próximo ao Paraguai",
  "Studio n° 3 com Piscina Compartilhada", "Studio n° 4 Natureza Próx. a Corredor Turístico",
];

describe("título público: os 44 nomes de produção", () => {
  const out = PRODUCAO.map((n) => splitPublicPropertyTitle(n));
  it("32 têm código interno identificado; 12 não têm", () => {
    expect(out.filter((o) => o.internalCode).length).toBe(32);
    expect(out.filter((o) => !o.internalCode).length).toBe(12);
  });
  it("código = exatamente o prefixo antes do traço; título público não vazio e sem o código", () => {
    for (const o of out.filter((x) => x.internalCode)) {
      expect(o.internalCode).toMatch(/^(AP|CS|KT|LF|SB)\d{3}$/);
      expect(o.publicTitle.length).toBeGreaterThan(5);
      expect(o.publicTitle).not.toMatch(/^[A-Z]{2,}\d+/);
      expect(o.original).toBe(`${o.internalCode} - ${o.publicTitle}`); // nada além do prefixo foi removido
    }
  });
  it("nome original preservado (a função não altera a entrada)", () => {
    out.forEach((o, i) => expect(o.original).toBe(PRODUCAO[i]));
  });
  it("nomes sem código ficam idênticos", () => {
    for (const o of out.filter((x) => !x.internalCode)) expect(o.publicTitle).toBe(o.original);
  });
  it("exemplo do documento", () => {
    expect(splitPublicPropertyTitle("AP014 - Flat ao lado da Santa Casa")).toEqual({
      publicTitle: "Flat ao lado da Santa Casa",
      internalCode: "AP014",
      original: "AP014 - Flat ao lado da Santa Casa",
    });
  });
});

describe("título público: padrões diferentes e proteção contra remoção acidental", () => {
  it("variações de traço e espaço", () => {
    expect(publicPropertyTitle("AP14 – Casa X")).toBe("Casa X");
    expect(publicPropertyTitle("ABC123 — Casa Y")).toBe("Casa Y");
    expect(publicPropertyTitle("AP014-Flat")).toBe("Flat");
    expect(publicPropertyTitle("  CS001 -   Casa Z  ")).toBe("Casa Z");
  });
  it("não remove conteúdo legítimo", () => {
    for (const n of [
      "Studio n° 101 Aconchegante",
      "Apê 2 quartos - Centro",
      "A1 - Casa",
      "ap014 - minúsculo não é código",
      "Casa - Vista Mar",
      "AP014 Casa sem traço",
      "AP - Casa sem número",
      "SP-123 Casa",
    ]) {
      expect(publicPropertyTitle(n)).toBe(n.trim());
    }
  });
  it("traço sem título depois: nada é removido; vazio/nulo ⇒ null", () => {
    expect(publicPropertyTitle("AP014 -")).toBe("AP014 -");
    expect(publicPropertyTitle("AP014 -   ")).toBe("AP014 -");
    expect(publicPropertyTitle("")).toBeNull();
    expect(publicPropertyTitle(null)).toBeNull();
  });
});
