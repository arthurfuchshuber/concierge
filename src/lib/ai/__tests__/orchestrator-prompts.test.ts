import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANTI_LABEL_ECHO_RULES,
  PRE_BOOKING_CLOSING_RULES,
  THIRD_PARTY_BOOKING_RULES,
} from "@/lib/ai/prompt-rules";
import { voiceGuidance, readGuestVoice } from "@/lib/ai/voice";

const orchestratorSrc = readFileSync(resolve(__dirname, "../orchestrator.server.ts"), "utf-8");

describe("prompt do orquestrador: reserva para terceiros", () => {
  it("proíbe exigir documentos/contatos de quem está fora do chat e centraliza no titular", () => {
    expect(THIRD_PARTY_BOOKING_RULES).toMatch(/PROIBIDO exigir/);
    expect(THIRD_PARTY_BOOKING_RULES).toMatch(/documentos, e-mails, telefones/);
    expect(THIRD_PARTY_BOOKING_RULES).toMatch(/centralizado por aqui/);
    expect(THIRD_PARTY_BOOKING_RULES).toMatch(/antecedência/);
  });
  it("proíbe tom de SAC / regulamento", () => {
    expect(THIRD_PARTY_BOOKING_RULES).toMatch(/PROIBIDO tom de SAC/);
    expect(THIRD_PARTY_BOOKING_RULES).toMatch(/nossa política exige/);
  });
});

describe("prompt do orquestrador: anti-eco de rótulos", () => {
  it("proíbe espelhar cargos e profissões e dá alternativa natural", () => {
    expect(ANTI_LABEL_ECHO_RULES).toMatch(/PROIBIDO espelhar mecanicamente cargos, profissões/);
    expect(ANTI_LABEL_ECHO_RULES).toMatch(/auditores/);
    expect(ANTI_LABEL_ECHO_RULES).toMatch(/perfeito para a equipe/);
  });
  it("também está no bloco de voz do hóspede", () => {
    const g = voiceGuidance(readGuestVoice([], "Preciso de 3 vagas para meus auditores"), false);
    expect(g).toMatch(/Não espelhe cargos, profissões/);
  });
});

describe("prompt do orquestrador: fechamento pré-reserva fluido", () => {
  it("proíbe o clichê fixo e exige condução contextual e variada", () => {
    expect(PRE_BOOKING_CLOSING_RULES).toMatch(/PROIBIDO terminar sempre com o mesmo clichê/);
    expect(PRE_BOOKING_CLOSING_RULES).toMatch(/orgânica e contextual/);
    expect(PRE_BOOKING_CLOSING_RULES).toMatch(/Varie SEMPRE/);
  });
  it("não oferece mais 'Vamos seguir com a reserva?' como exemplo de frase", () => {
    expect(PRE_BOOKING_CLOSING_RULES).not.toMatch(/Exemplos de tom: "Vamos seguir/);
    expect(PRE_BOOKING_CLOSING_RULES).not.toMatch(/"Vamos seguir com a reserva\?"[,.;]/);
  });
});

describe("orquestrador usa os blocos", () => {
  it("injeta os três blocos no prompt e remove o texto antigo", () => {
    expect(orchestratorSrc).toContain("${PRE_BOOKING_CLOSING_RULES}");
    expect(orchestratorSrc).toContain("${THIRD_PARTY_BOOKING_RULES}");
    expect(orchestratorSrc).toContain("${ANTI_LABEL_ECHO_RULES}");
    expect(orchestratorSrc).not.toContain('Exemplos de tom: "Vamos seguir com a reserva?"');
  });
});
