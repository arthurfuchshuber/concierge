/**
 * O CONTRATO DO MODO OFFLINE (11/09/2026).
 *
 * Duas garantias que não dá para ver olhando a tela:
 *
 *  1. guardar offline é CONFORTO, nunca requisito. Em aba anônima, com cota
 *     cheia ou com IndexedDB bloqueado, tudo tem que degradar em silêncio —
 *     um app que quebra por não conseguir guardar cache é pior do que um app
 *     sem cache;
 *  2. a faixa de "sem internet" precisa dizer a HORA. É a diferença entre
 *     "os dados continuam aí" e "a faxineira limpou o imóvel errado porque a
 *     fila era de duas horas atrás".
 */
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { chaveRascunho, lerRascunho, resumoRascunho } from "@/lib/offline/situation-draft";
import { horaCurta, horaDoCacheLocal } from "@/lib/offline/cache-age";
import { idbGravar, idbLer } from "@/lib/offline/idb";

function rascunho(over: Partial<Parameters<typeof resumoRascunho>[0]> = {}) {
  return {
    criadoEm: Date.now(),
    propertyId: "p1",
    reservationId: "r1",
    cardMode: "cleaning",
    category: "cleaning_audit",
    title: "",
    description: "",
    midias: [],
    ...over,
  } as Parameters<typeof resumoRascunho>[0];
}

const midia = (kind: "photo" | "video") => ({
  key: kind,
  blob: new Blob(["x"]),
  kind,
  mime: kind === "photo" ? "image/jpeg" : "video/mp4",
  name: null,
  durationMs: null,
});

describe("chave do rascunho", () => {
  it("separa por imóvel e por reserva — duas situações não se atropelam", () => {
    const a = chaveRascunho("imovel-1", { reservationId: "res-1" });
    const b = chaveRascunho("imovel-2", { reservationId: "res-1" });
    const c = chaveRascunho("imovel-1", { reservationId: "res-2" });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("aceita a reserva pelo registro do hóspede quando não há reserva", () => {
    expect(chaveRascunho("p", { logId: "log-9" })).toContain("log-9");
  });
});

describe("resumo do rascunho", () => {
  it("conta vídeo e foto separados, como a pessoa pensa neles", () => {
    const r = rascunho({ midias: [midia("video"), midia("photo")] });
    expect(resumoRascunho(r)).toBe("1 vídeo e 1 foto");
  });

  it("cita o texto digitado, que é o que custa a refazer", () => {
    expect(resumoRascunho(rascunho({ title: "Pia" }))).toContain("“Pia”");
  });

  it("corta texto longo em vez de estourar a faixa", () => {
    const r = rascunho({ title: "x".repeat(60) });
    expect(resumoRascunho(r)).toContain("…");
    expect(resumoRascunho(r).length).toBeLessThan(60);
  });
});

describe("degradar em silêncio", () => {
  it("sem IndexedDB, ler devolve nulo e gravar não explode", async () => {
    // jsdom não tem IndexedDB: é exatamente o cenário da aba anônima.
    await expect(idbLer("qualquer")).resolves.toBeNull();
    await expect(idbGravar("qualquer", { a: 1 })).resolves.toBe(false);
    await expect(lerRascunho(chaveRascunho("p", { logId: "l" }))).resolves.toBeNull();
  });
});

describe("hora do cache local", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("sem cache guardado, não inventa hora", () => {
    expect(horaDoCacheLocal()).toBeNull();
  });

  it("pega o retrato MAIS RECENTE entre as contas do aparelho", () => {
    window.localStorage.setItem("cia-cache-v2:u1:own", JSON.stringify({ timestamp: 1000 }));
    window.localStorage.setItem("cia-cache-v2:u1:outra", JSON.stringify({ timestamp: 5000 }));
    window.localStorage.setItem("sg-theme", "dark");
    expect(horaDoCacheLocal()).toBe(5000);
  });

  it("conteúdo corrompido não derruba a faixa", () => {
    window.localStorage.setItem("cia-cache-v2:u1:own", "{isso não é json");
    expect(horaDoCacheLocal()).toBeNull();
  });

  it("formata em hora e minuto", () => {
    expect(horaCurta(new Date(2026, 8, 11, 13, 44).getTime())).toBe("13:44");
  });
});
