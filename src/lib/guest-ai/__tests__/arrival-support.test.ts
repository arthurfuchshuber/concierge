/**
 * Apoio prático ao acesso no check-in (diretiva de 11/11/2026, anti-engessamento): chegada tranquila sem
 * interrogatório; dificuldade relatada ⇒ instrução imediata do dossiê em 2–3 frases + checagem breve; sucesso ⇒
 * encerramento sóbrio. Comportamento do modelo é guiado por roteiro; aqui se conferem o roteiro, o exemplo de ouro
 * e a trava que impede prometer entrada antecipada.
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { renderPersona } from "@/lib/guest-ai/persona";
import { analyzeReplyCommitments } from "@/lib/guest-ai/validation/commitment-text";

const sys = buildSystemPrompt("airbnb");
const example1 = (sys.match(/Exemplo 1 \(acesso e fechadura[^\n]*/) ?? [""])[0];
const tone1 = (example1.match(/Tom ideal: ([^(]*)/) ?? ["", ""])[1]!.trim();

describe("chegada tranquila", () => {
  it("acolhe sem interrogar onde o hóspede está e sem blocos de instruções não pedidas", () => {
    expect(sys).toMatch(/Chegada tranquila, sem dúvida relatada: acolhimento natural e conciso/);
    expect(sys).toMatch(/Não interrogue onde o hóspede está nem por onde já passou/);
    expect(renderPersona()).toMatch(/Na chegada sem dúvida relatada, acolha sem interrogar/);
  });
});

describe("dificuldade de acesso relatada", () => {
  it("vai direto ao obstáculo, com as instruções reais do dossiê, em até 3 frases e checagem de sucesso", () => {
    expect(sys).toMatch(/foque no obstáculo que o hóspede relatou/);
    expect(sys).toMatch(/usando estritamente as instruções reais de acesso do dossiê/);
    expect(sys).toMatch(/no máximo duas ou três frases objetivas/);
    expect(sys).toMatch(/checagem breve de sucesso/);
    expect(tone1.split(/(?<=[.?!])\s+/).filter(Boolean).length).toBeLessThanOrEqual(4);
    expect(tone1).toMatch(/Deu certo para abrir\?$/);
    expect(tone1).not.toMatch(/onde você está|já está na porta|portaria ou/i);
  });
  it("pergunta de localização só quando o relato não deixa claro o bloqueio; sucesso encerra o ciclo", () => {
    expect(sys).toMatch(/Só quando o relato não deixa claro o ponto do bloqueio faça UMA pergunta-chave/);
    expect(sys).toMatch(/encerre o ciclo com uma frase sóbria, sem novas perguntas nem mensagens seguintes/);
    expect(sys).toMatch(/nunca despeje um manual inteiro/);
  });
  it("entrada antecipada prometida no texto continua sendo compromisso detectado (sem autorização ⇒ bloqueado)", () => {
    const kinds = analyzeReplyCommitments("Pode deixar, vou liberar a sua entrada antecipada às 11h.", { officialCheckin: "15:00", officialCheckout: "11:00" }).claims.map((c) => c.kind);
    expect(kinds).toContain("early_checkin");
    const ok = analyzeReplyCommitments("Nosso check-in é às 15h. Faremos o possível para liberar antes se a casa ficar pronta.", { officialCheckin: "15:00", officialCheckout: "11:00" }).claims.map((c) => c.kind);
    expect(ok).not.toContain("early_checkin");
  });
});
