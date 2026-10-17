import { describe, expect, it } from "vitest";
import { makeTranslatable, translatableGuidance } from "@/lib/ai/translatable";
import { matchPlaybook, playbookText, PLAYBOOKS } from "@/lib/ai/playbooks";
import { guestKeyOf, normalizeReservationCode, reservationCodeFromDossier } from "@/lib/ai/memory.server";
import { humanityMetrics, summarizeHumanity, readGuestVoice } from "@/lib/ai/voice";

describe("português traduzível", () => {
  it("troca abreviações e gírias sem mexer em números, horários e links", () => {
    const out = makeTranslatable("Pra entrar, vc usa o código 4821 às 15hs. Tá? Veja /g/studio-105#senhas-acesso né");
    expect(out).toMatch(/Para entrar, você usa/);
    expect(out).toContain("4821");
    expect(out).toContain("15h");
    expect(out).toContain("/g/studio-105#senhas-acesso");
    expect(out).not.toMatch(/\bvc\b|\bné\b|\bTá\b/);
  });
  it("não troca pedaços de palavras (prato, provar)", () => {
    expect(makeTranslatable("O prato é para provar")).toBe("O prato é para provar");
  });
  it("orientação pede frases curtas e sem idiomas", () => expect(translatableGuidance()).toMatch(/Frases curtas/));
});

describe("playbooks de diagnóstico", () => {
  it.each([
    ["O chuveiro não esquenta", "agua_quente"],
    ["estamos sem luz aqui", "energia"],
    ["a internet caiu e não conecta", "wifi"],
    ["o ar condicionado não gela", "ar"],
    ["tem um vazamento no banheiro", "vazamento"],
    ["sinto cheiro de gás na cozinha", "gas"],
    ["o ralo está entupido", "entupimento"],
    ["a casa estava suja quando chegamos", "limpeza"],
  ])("%s → %s", (msg, id) => expect(matchPlaybook(msg)?.id).toBe(id));
  it("não casa conversa comum", () => {
    expect(matchPlaybook("Qual o horário do check-in?")).toBeNull();
    expect(matchPlaybook("Obrigada, a casa é linda")).toBeNull();
  });
  it("resposta curta usa o assunto da mensagem anterior", () =>
    expect(matchPlaybook("continua", ["o chuveiro não esquenta"])?.id).toBe("agua_quente"));
  it("riscos mandam acionar a equipe de imediato; demais diagnosticam um passo por vez", () => {
    expect(playbookText(PLAYBOOKS.find((p) => p.id === "gas")!)).toMatch(/urgência alta/);
    expect(playbookText(PLAYBOOKS.find((p) => p.id === "wifi")!)).toMatch(/UM passo ou UMA pergunta por vez/);
  });
});

describe("memória por reserva", () => {
  it("usa o código da reserva como chave", () => expect(guestKeyOf("s1", "Ana", "hm-ab12cd")).toBe("res:HMAB12CD"));
  it("sem código mantém a chave por nome ou sessão", () => {
    expect(guestKeyOf("s1", "Ana")).toBe("name:ana");
    expect(guestKeyOf("s1", null, "123")).toBe("session:s1");
  });
  it("dois hóspedes com o mesmo nome em reservas diferentes não se misturam", () =>
    expect(guestKeyOf("a", "Ana", "HMAAAAA")).not.toBe(guestKeyOf("b", "Ana", "HMBBBBB")));
  it("lê o código do dossiê oficial", () => {
    expect(reservationCodeFromDossier("Reserva\nCódigo da reserva: HMZ9Q8W7\nHóspedes: 2")).toBe("HMZ9Q8W7");
    expect(reservationCodeFromDossier("sem código")).toBeNull();
    expect(normalizeReservationCode("ab-12")).toBeNull();
  });
});

describe("métricas de humanidade", () => {
  const voice = readGuestVoice([], "Chegamos");
  const base = { history: [], voice, negative: false, rewritten: false, acknowledged: false } as const;
  it("conta emoji fora da regra e repetições", () => {
    const h = humanityMetrics({ ...base, reply: "Perfeito! Boa estadia 😊", guestMessage: "Chegamos" });
    expect(h.emojis).toBe(1);
    expect(h.emojiRuleOk).toBe(false);
  });
  it("resume taxas sem texto de conversa", () => {
    const a = humanityMetrics({ ...base, reply: "Boa estadia!", guestMessage: "Chegamos" });
    const b = humanityMetrics({ ...base, reply: "Boa estadia 😊", guestMessage: "Chegamos", rewritten: true });
    const r = summarizeHumanity([a, b]);
    expect(r.replies).toBe(2);
    expect(r.emojiViolationRate).toBe(50);
    expect(r.rewriteRate).toBe(50);
  });
  it("silêncio não entra nas taxas", () => {
    const s = humanityMetrics({ ...base, reply: "[SILENCIO]", guestMessage: "ok" });
    expect(summarizeHumanity([s]).replies).toBe(0);
  });
});

import {
  correctionQuestion,
  isSensitiveText,
  matchPropertyPlaybooks,
  playbookStatusFor,
  propertyPlaybookText,
  sanitizeDraft,
  slugTopic,
  type PropertyPlaybook,
} from "@/lib/ai/learning/property-playbooks";

describe("cérebro contínuo: playbooks por imóvel", () => {
  const pb = (over: Partial<PropertyPlaybook> = {}): PropertyPlaybook => ({
    id: "1",
    topic: "ar-condicionado",
    title: "Ar-condicionado não gela",
    triggers: ["ar condicionado", "ar-condicionado", "não gela"],
    situation: "hóspede reclama que o ar não esfria",
    steps: ["Pedir para conferir se o modo está em frio", "Limpar o filtro conforme o manual"],
    avoid: ["prometer troca do aparelho"],
    version: 2,
    status: "active",
    ...over,
  });
  it("casa pelo gatilho na mensagem atual", () => {
    const r = matchPropertyPlaybooks([pb()], "o ar condicionado não gela nada", []);
    expect(r).toHaveLength(1);
  });
  it("não casa assunto diferente nem playbook em rascunho", () => {
    expect(matchPropertyPlaybooks([pb()], "qual a senha do wifi?", [])).toHaveLength(0);
    expect(matchPropertyPlaybooks([pb({ status: "draft" })], "o ar condicionado não gela", [])).toHaveLength(0);
  });
  it("texto do prompt traz passos e o que evitar", () => {
    const t = propertyPlaybookText([pb()]);
    expect(t).toContain("1. Pedir para conferir");
    expect(t).toContain("Evite: prometer troca");
    expect(propertyPlaybookText([])).toBe("");
  });
  it("conteúdo sensível vai para rascunho; baixo risco com confiança ativa", () => {
    expect(isSensitiveText("devolver o valor via pix de R$ 100")).toBe(true);
    const ok = sanitizeDraft({ shouldLearn: true, canExplain: true, title: "Lixo", steps: ["Levar ao ponto da rua"], confidence: 0.8, risk: "low" });
    expect(ok && playbookStatusFor(ok)).toBe("active");
    const sens = sanitizeDraft({ shouldLearn: true, canExplain: true, title: "Reembolso", steps: ["Fazer estorno do valor"], confidence: 0.9, risk: "low" });
    expect(sens && playbookStatusFor(sens)).toBe("draft");
    expect(sanitizeDraft({ shouldLearn: false } as never)).toBeNull();
    expect(sanitizeDraft({ shouldLearn: true, title: "x", steps: [] } as never)).toBeNull();
  });
  it("slug do tópico", () => expect(slugTopic("Ar-Condicionado não gela!")).toBe("ar-condicionado-nao-gela"));
  it("pergunta ao anfitrião quando não entende a correção", () => {
    const q = correctionQuestion({ kind: "deleted", aiContent: "Olá, tudo bem?", replacement: null });
    expect(q).toContain("apagou");
    expect(q).toContain("não enviou outra mensagem");
    expect(q).toContain("O que eu fiz de errado e como eu deveria ter respondido?");
    expect(correctionQuestion({ kind: "edited", aiContent: "a", replacement: "b" })).toContain("editou");
  });
});
