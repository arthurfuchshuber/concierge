/**
 * A IA NÃO SAI DA CONVERSA — travado em teste.
 *
 * Regra do produto: do ponto de vista do hóspede existe uma voz só, do começo
 * ao fim. Três lugares do código quebravam isso com texto fixo, e um quarto
 * quebrava na tela. Como é uma regra que se perde fácil numa reescrita de
 * frase, ela passa a ser verificada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  continuityLine,
  continuityVariants,
  isContinuityLine,
  type ContinuityKind,
} from "@/lib/ai/continuity";
import { handoffFallback } from "@/lib/ai/confidence";
import { pendingNotice } from "@/lib/ai/human-loop/escalations.server";

const TIPOS: ContinuityKind[] = ["confirming", "pending", "no_answer"];

/** Palavras que denunciam a transferência para quem está lendo do outro lado. */
const PROIBIDAS = [
  "equipe",
  "atendente",
  "transfer",
  "anfitri",
  "responsável",
  "responsavel",
  "suporte",
  "team",
  "agent will",
  "equipo",
];

describe("frases de continuidade", () => {
  it("nenhuma delas menciona equipe, atendente ou transferência", () => {
    const vazamentos: string[] = [];
    for (const tipo of TIPOS) {
      for (const frase of continuityVariants(tipo)) {
        const baixa = frase.toLowerCase();
        for (const p of PROIBIDAS) {
          if (baixa.includes(p)) vazamentos.push(`${tipo}: "${frase}" contém "${p}"`);
        }
      }
    }
    expect(vazamentos).toEqual([]);
  });

  it("cada tipo tem três formas diferentes nos três idiomas", () => {
    for (const tipo of TIPOS) {
      for (const idioma of ["pt-BR", "en-US", "es-ES"]) {
        const formas = continuityVariants(tipo, idioma);
        expect(formas).toHaveLength(3);
        expect(new Set(formas).size).toBe(3);
      }
    }
  });

  it("duas ocorrências seguidas nunca saem iguais", () => {
    for (const tipo of TIPOS) {
      for (let s = 0; s < 6; s += 1) {
        expect(continuityLine(tipo, "pt-BR", s)).not.toBe(continuityLine(tipo, "pt-BR", s + 1));
      }
    }
  });

  it("a mesma semente reproduz o mesmo texto (auditável, não aleatório)", () => {
    expect(continuityLine("pending", "pt-BR", 7)).toBe(continuityLine("pending", "pt-BR", 7));
  });

  it("cai no português quando o idioma é desconhecido ou ausente", () => {
    expect(continuityVariants("confirming", "pt-BR")).toContain(continuityLine("confirming", null));
    expect(continuityVariants("confirming", "pt-BR")).toContain(continuityLine("confirming", "fr"));
  });

  it("reconhece o próprio texto, para não empilhar duas frases iguais", () => {
    expect(isContinuityLine(continuityLine("no_answer", "pt-BR", 2))).toBe(true);
    expect(isContinuityLine("O check-in é às 15h.")).toBe(false);
  });
});

describe("os dois pontos antigos passam a usar a fonte única", () => {
  it("handoffFallback varia com a semente", () => {
    expect(handoffFallback("pt-BR", 0)).not.toBe(handoffFallback("pt-BR", 1));
    expect(continuityVariants("confirming", "pt-BR")).toContain(handoffFallback("pt-BR", 0));
  });

  it("pendingNotice não fala mais em equipe do anfitrião", () => {
    const frase = pendingNotice("pt-BR", 0).toLowerCase();
    expect(frase).not.toContain("equipe");
    expect(frase).not.toContain("anfitri");
    expect(continuityVariants("pending", "pt-BR")).toContain(pendingNotice("pt-BR", 0));
  });
});

describe("a tela do hóspede", () => {
  const widget = readFileSync(resolve(process.cwd(), "src/components/GuideAiChat.tsx"), "utf8");

  it("não anuncia mais que um atendente humano vai responder", () => {
    expect(widget).not.toContain("Um atendente humano vai responder");
  });

  it("não carimba mais as mensagens com o selo Atendente", () => {
    expect(widget).not.toContain(">Atendente<");
  });
});

describe("o gatilho de pedido explícito de humano", () => {
  it("continua pegando o pedido de verdade", async () => {
    const { EXPLICIT_HUMAN_REQUEST: re } = await import("@/lib/ai/orchestrator.server");
    for (const frase of [
      "quero falar com alguém",
      "posso conversar com o anfitrião?",
      "queria falar com a responsável",
      "gostaria de falar com uma pessoa",
      "quero falar com o atendente",
      "quero um atendente",
      "me transfere por favor",
      "preciso de atendimento humano",
      "chamar o responsável",
    ]) {
      expect(re.test(frase), frase).toBe(true);
    }
  });

  it("não escala mais uma saudação", () => {
    // "tem alguém aí?" é como se pergunta se o chat está vivo — e virava
    // escalonamento. Há um handoff real nos logs por exatamente isso.
    return import("@/lib/ai/orchestrator.server").then(({ EXPLICIT_HUMAN_REQUEST: re }) => {
      for (const frase of ["oi, tem alguém aí?", "tem alguem ai", "bom dia!", "olá"]) {
        expect(re.test(frase), frase).toBe(false);
      }
    });
  });
});
