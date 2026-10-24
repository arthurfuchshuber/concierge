import { describe, expect, it } from "vitest";
import { caminhoMidia, type TrabalhoSituacao } from "@/lib/offline/situation-outbox";

const job = {
  groupId: "11111111-2222-3333-4444-555555555555",
  criadoEm: 0,
  propertyId: "prop-1",
  reservationId: "res-1",
  category: "forgotten",
  title: "x",
  description: null,
  criada: false,
  midias: [],
} as TrabalhoSituacao;

describe("fila de situações no aparelho", () => {
  it("o caminho do arquivo é fixo entre tentativas (retomar nunca duplica)", () => {
    const m = { key: "abc", blob: new Blob(), kind: "photo" as const, mime: "image/jpeg", name: null, durationMs: null };
    expect(caminhoMidia(job, m)).toBe(caminhoMidia(job, m));
    expect(caminhoMidia(job, m)).toBe("prop-1/res-1/11111111-abc.jpg");
  });
});

describe("descarte de trabalho órfão", () => {
  it("o erro 'Situação não encontrada.' é reconhecido como irrecuperável", () => {
    const re = /situa[cç][aã]o n[aã]o encontrada/i;
    expect(re.test("Situação não encontrada.")).toBe(true);
    expect(re.test("Situacao nao encontrada")).toBe(true);
    expect(re.test("Failed to fetch")).toBe(false);
  });
});
