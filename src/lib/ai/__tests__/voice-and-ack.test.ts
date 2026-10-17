import { describe, expect, it } from "vitest";
import { acknowledgementReply, alreadyAcknowledged } from "@/lib/ai/human-support";
import { applyVoiceRules, hasLaughter, readGuestVoice, rewritePreserves, toneLint } from "@/lib/ai/voice";
import { claimsRemoteAction, isAccessIncident, isDepartureReport } from "@/lib/ai/guest-safety.server";
import { detectLanguage, classifyIntent } from "@/lib/ai/intent.server";
import { isClosedQuestion } from "@/lib/ai/quick-replies.server";
import { readResolutionCheck, maskPii } from "@/lib/ai/learning/conversation-analyzer.server";
import { fallbackDraft, formatDraftForTeam } from "@/lib/ai/human-loop/handoff-draft.server";
import { resolutionCheckText } from "@/lib/ai/stalled-replies.server";

const manha = new Date("2026-10-17T13:00:00Z");

describe("reconhecimento com retorno da equipe", () => {
  const base = { guestName: "Pedro", language: "pt", notifiable: true, now: manha } as const;
  it("com chamado criado: acolhe e diz que a equipe retorna por aqui, sem prometer ação própria nem prazo", () => {
    const r = acknowledgementReply({ ...base, history: [{ role: "assistant", content: "Oi" }], ticketCreated: true });
    expect(r).toMatch(/equipe/i);
    expect(r).toMatch(/por aqui/i);
    expect(r).not.toMatch(/vou (confirmar|verificar|checar)|estou (verificando|checando)|em \d+ ?min|em breve|hoje até/i);
  });
  it("sem chamado criado: nada de promessa (saudação ou silêncio)", () => {
    expect(acknowledgementReply({ ...base, history: [{ role: "assistant", content: "Oi" }], ticketCreated: false })).toBe("[SILENCIO]");
    expect(acknowledgementReply({ ...base, history: [], ticketCreated: false })).toMatch(/Pedro/);
  });
  it("uma vez por assunto", () => {
    const first = acknowledgementReply({ ...base, history: [{ role: "assistant", content: "Oi" }], ticketCreated: true });
    expect(alreadyAcknowledged([{ role: "assistant", content: first }])).toBe(true);
    expect(acknowledgementReply({ ...base, history: [{ role: "assistant", content: first }], ticketCreated: true })).toBe("[SILENCIO]");
  });
  it("primeira fala traz saudação + reconhecimento", () => {
    const r = acknowledgementReply({ ...base, history: [], ticketCreated: true });
    expect(r).toMatch(/^(Olá|Oi|Bom dia|Boa)/);
    expect(r).toMatch(/equipe/i);
  });
});

describe("voz: emoji e risada", () => {
  const hist = [{ role: "assistant", content: "Claro! 😊 Pode contar comigo." }];
  it("hóspede sem emoji: remove emoji da IA", () => {
    const v = readGuestVoice([], "Qual o horário do check-in?");
    expect(applyVoiceRules({ reply: "O check-in é às 15h 😊", history: [], voice: v, negative: false })).toBe("O check-in é às 15h");
  });
  it("hóspede com emoji: no máximo 1 e nunca o repetido das últimas falas", () => {
    const v = readGuestVoice([], "Chegamos! 😀");
    const out = applyVoiceRules({ reply: "Que bom 😊 Aproveitem 🎉🎉", history: hist, voice: v, negative: false });
    expect(out).not.toContain("😊");
    expect((out.match(/\p{Extended_Pictographic}/gu) ?? []).length).toBeLessThanOrEqual(1);
  });
  it("nenhum emoji nem risada em problema/sentimento negativo", () => {
    const v = readGuestVoice([], "O chuveiro quebrou 😡 kkk");
    const out = applyVoiceRules({ reply: "Sinto muito 😊 haha vamos resolver", history: [], voice: v, negative: true });
    expect(out).not.toMatch(/😊|haha/);
  });
  it("risada só em resposta à risada do hóspede", () => {
    expect(hasLaughter("kkkk que legal")).toBe(true);
    const sem = readGuestVoice([], "Adoramos a casa");
    expect(applyVoiceRules({ reply: "Haha que bom!", history: [], voice: sem, negative: false })).not.toMatch(/haha/i);
    const com = readGuestVoice([], "Adoramos a casa kkk");
    expect(applyVoiceRules({ reply: "Haha que bom!", history: [], voice: com, negative: false })).toMatch(/haha/i);
  });
});

describe("lint de tom", () => {
  const prev = [{ role: "assistant", content: "Perfeito! O check-in é às 15h. Qualquer dúvida, me avise?" }];
  it("pega abertura e fecho repetidos", () => {
    const issues = toneLint("Perfeito! A garagem fica no subsolo. Qualquer dúvida, me avise?", prev);
    expect(issues).toContain("crutch_opener");
    expect(issues).toContain("same_closing");
  });
  it("não reclama de respostas diferentes", () => {
    expect(toneLint("A garagem fica no subsolo, vaga 12.", prev)).toEqual([]);
  });
  it("reescrita que muda números/horários é descartada", () => {
    expect(rewritePreserves("O check-in é às 15h.", "A entrada é a partir das 15h.")).toBe(true);
    expect(rewritePreserves("O check-in é às 15h.", "A entrada é a partir das 14h.")).toBe(false);
  });
});

describe("guardrail normalizado", () => {
  it.each([
    "Estou na portaria e ninguém me atendeu",
    "chegamos e não conseguimos entrar",
    "A porta está trancada",
    "o código não deu certo",
    "NÃO ACHEI A CHAVE",
  ])("incidente: %s", (m) => expect(isAccessIncident(m)).toBe(true));
  it.each([
    "Estou na casa da minha tia no fim de semana",
    "Tranquei a casa e já saí",
    "Não tem ninguém na piscina",
    "Estou na casa, tudo ótimo",
    "Entrei",
  ])("não é incidente: %s", (m) => expect(isAccessIncident(m)).toBe(false));
  it("saída concluída não é incidente", () => expect(isDepartureReport("Já saí e deixei a chave no cofre")).toBe(true));
  it("barra alegação de ação remota", () => {
    expect(claimsRemoteAction("Acabei de abrir o portão para você")).toBe(true);
    expect(claimsRemoteAction("Já liberei o código remotamente")).toBe(true);
    expect(claimsRemoteAction("O portão abre com o cadeado-cofre; o código está nas instruções.")).toBe(false);
  });
});

describe("intenção e idioma", () => {
  it("idioma por pontuação", () => {
    expect(detectLanguage("Hola, buenos días, estamos en la puerta y no funciona la llave")).toBe("es");
    expect(detectLanguage("Hello, we are at the door and the key is not working")).toBe("en");
    expect(detectLanguage("Bom dia, tudo bem? Chegamos")).toBe("pt");
  });
  it("sem falsos positivos de urgência/categoria", async () => {
    const a = (await classifyIntent("Agora vou almoçar, depois volto")).intent;
    expect(a.urgency).toBe("normal");
    const b = (await classifyIntent("Sem problema, obrigado pela casa linda")).intent;
    expect(b.category).not.toBe("operacional");
    const c = (await classifyIntent("Estamos com vazamento no banheiro, é urgente")).intent;
    expect(c.urgency).toBe("high");
    expect(c.category).toBe("operacional");
  });
});

describe("botões só para pergunta fechada", () => {
  it("fechada", () => expect(isClosedQuestion("Quer que eu indique um restaurante?")).toBe(true));
  it("aberta", () => {
    expect(isClosedQuestion("Qual horário você pretende chegar?")).toBe(false);
    expect(isClosedQuestion("Fica tudo certo. O que aconteceu exatamente?")).toBe(false);
  });
});

describe("desfecho real: 'deu certo?'", () => {
  const check = { role: "assistant", content: resolutionCheckText("Pedro", 0) };
  it("pergunta contém a marca lida pelo analisador", () => {
    for (let i = 0; i < 3; i += 1) expect(readResolutionCheck([{ role: "assistant", content: resolutionCheckText(null, i) }])).toBe("unanswered");
  });
  it("lê confirmação e negativa", () => {
    expect(readResolutionCheck([check, { role: "user", content: "Deu certo, obrigado!" }])).toBe("confirmed");
    expect(readResolutionCheck([check, { role: "user", content: "Não resolveu, continua sem água quente" }])).toBe("denied");
    expect(readResolutionCheck([{ role: "user", content: "oi" }])).toBeNull();
  });
  it("mascara dados pessoais", () => {
    const m = maskPii("Meu email é a@b.com, tel +55 11 98888-7777, código Sigma2610");
    expect(m).not.toMatch(/a@b\.com|98888|Sigma2610/);
  });
});

describe("rascunho para a equipe", () => {
  it("fallback traz resumo e o que a IA já orientou", () => {
    const d = fallbackDraft([{ role: "assistant", content: "Verifique o disjuntor." }], "Continua sem luz", "sem energia");
    expect(formatDraftForTeam("sem energia", d)).toMatch(/Resumo:.*Continua sem luz/s);
    expect(formatDraftForTeam("sem energia", d)).toMatch(/disjuntor/);
    expect(formatDraftForTeam("x".repeat(3000), d).length).toBeLessThanOrEqual(1200);
  });
});
