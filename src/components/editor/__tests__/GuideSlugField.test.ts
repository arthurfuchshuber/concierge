import { describe, expect, it } from "vitest";
import { SLUG_RE, normalizeSlugInput } from "@/components/editor/GuideSlugField";

describe("slug do guia", () => {
  it("normaliza o que a pessoa digita (o hífen final só sai ao sair do campo)", () => {
    expect(normalizeSlugInput("Casa Charmosa!")).toBe("casa-charmosa-");
    expect(normalizeSlugInput("Apto São João")).toBe("apto-sao-joao");
  });
  it("aceita só de 3 a 62 letras minúsculas, números e hífens", () => {
    expect(SLUG_RE.test("casa-charmosa-2")).toBe(true);
    expect(SLUG_RE.test("ab")).toBe(false);
    expect(SLUG_RE.test("-casa")).toBe(false);
    expect(SLUG_RE.test("Casa")).toBe(false);
  });
});
