import { describe, expect, it } from "vitest";
import { pickNormalized, publicReviewText, publicReviews, sanitizeIdentificacao } from "@/lib/guest-ai/data/listing-normalized";

describe("identificacao: prefixo interno isolado com splitListingTitle", () => {
  const content = "Título do anúncio: 45998276006 Arthur Tenório · Casa Charmosa Próx. a Avenida das Cataratas\nCidade: Foz do Iguaçu\nCapacidade máxima: 7 hóspedes";
  it("com o título público cadastrado: fica só o público + cidade + capacidade", () => {
    expect(sanitizeIdentificacao(content, "Casa Charmosa Próx. a Avenida das Cataratas")).toBe(
      "Título do anúncio: Casa Charmosa Próx. a Avenida das Cataratas\nCidade: Foz do Iguaçu\nCapacidade máxima: 7 hóspedes",
    );
  });
  it("sem título cadastrado, mas com separador: usa a parte pública", () => {
    expect(sanitizeIdentificacao(content, null)).toContain("Título do anúncio: Casa Charmosa Próx. a Avenida das Cataratas");
    expect(sanitizeIdentificacao(content, null)).not.toContain("Arthur");
  });
  it("título que não se separa com segurança e sem título público: a linha do título sai inteira", () => {
    expect(sanitizeIdentificacao("Título do anúncio: 45998276006 Arthur Tenório Casa\nCidade: Foz", null)).toBe("Cidade: Foz");
  });
  it("título sem separador e sem título público cadastrado (mesmo sem números): não comprovado, sai inteiro", () => {
    expect(sanitizeIdentificacao("Título do anúncio: Arthur Tenório Casa Charmosa\nCidade: Foz", null)).toBe("Cidade: Foz");
  });
  it("título já público (sem prefixo) é mantido; números longos nunca passam", () => {
    expect(sanitizeIdentificacao("Título do anúncio: Casa X", "Casa X")).toBe("Título do anúncio: Casa X");
    expect(sanitizeIdentificacao("Título do anúncio: Fulano · Casa 45998276006", null)).toBe("");
  });
  it("demais linhas e fatos intactos", () => {
    const n = pickNormalized({ facts: [{ key: "identificacao", title: "I", content }, { key: "qualquer", title: "Q", content: "abc" }] }, "Casa Charmosa Próx. a Avenida das Cataratas");
    expect(n?.facts.map((f) => f.key)).toEqual(["identificacao", "qualquer"]);
    expect(n?.facts[1]?.content).toBe("abc");
  });
});

describe("reviews: só a parte pública", () => {
  it("corta no 'Private feedback'", () => {
    expect(publicReviewText("Public review:\r\nÓtimo.\r\n\r\nPrivate feedback:\r\nSó para você.")).toBe("Ótimo.");
  });
  it("sem 'Private feedback': texto público integral", () => {
    expect(publicReviewText("Public review:\nLinha 1\nLinha 2")).toBe("Linha 1\nLinha 2");
  });
  it("sem marcador público: não é review público (retido e contado)", () => {
    expect(publicReviewText("Private feedback:\nSó para você.")).toBeNull();
    expect(publicReviewText(null)).toBeNull();
    expect(publicReviews([{ content: "Private feedback: x" }, { content: "Public review: y", score: 8 }])).toEqual({
      reviews: [{ score: 8, receivedAt: null, text: "y", hostReply: null }],
      withheld: 1,
    });
  });
  it("nenhum review é truncado", () => {
    const long = "a".repeat(20_000);
    expect(publicReviewText(`Public review: ${long}`)).toHaveLength(20_000);
  });
});
