import { describe, expect, it } from "vitest";
import { analyzeReply, classifyHandoff, summarizeReplay } from "@/lib/guest-ai/quality/reply-quality";

describe("analyzeReply · vícios que o titular proibiu", () => {
  const has = (t: string, code: string) => expect(analyzeReply(t).issues).toContain(code);
  it("frase de SAC", () => has("Sua solicitação foi encaminhada, aguarde retorno.", "sac_phrase"));
  it("terceira pessoa sobre a equipe", () => has("Nossa equipe já foi acionada e vai te ajudar.", "third_person_team"));
  it("registrando internamente", () => has("Estou registrando internamente o seu pedido.", "internal_registration"));
  it("promessa de prazo", () => has("Resolvemos isso em instantes.", "time_promise"));
  it("tag crua", () => has("Sua senha é [[CREDENCIAIS]]", "raw_tag"));
  it("abertura de SAC", () => has("Olá! Como posso te ajudar hoje?", "generic_opener"));
  it("senha solta em texto livre", () => has("A senha da porta é 482915.", "digits_secret_like"));
  it("texto natural e direto passa limpo", () => {
    expect(analyzeReply("Passa a palma da mão na tela para acender o visor e digita a senha. Deu certo para abrir?").issues).toEqual([]);
  });
  it("horário, data e valor não são tratados como senha", () => {
    expect(analyzeReply("O check-in é a partir das 15:00, dia 14/11/2026, diária R$ 1.250,00.").issues).not.toContain("digits_secret_like");
  });
  it("vazio = silêncio", () => expect(analyzeReply("  ").issues).toEqual(["empty"]));
});

describe("classifyHandoff e summarizeReplay", () => {
  it("classifica motivos", () => {
    expect(classifyHandoff("Acesso não entregue automaticamente (credencial indisponível)")).toBe("access");
    expect(classifyHandoff("Pedido de alteração formal: cancelamento")).toBe("formal_change");
    expect(classifyHandoff("Dúvida do hóspede sem resposta da IA (contingência de tempo)")).toBe("technical_failure");
    expect(classifyHandoff("Risco: cheiro de gás")).toBe("emergency");
  });
  it("resume taxas, vícios e candidatos a handoff evitável", () => {
    const s = summarizeReplay([
      { id: "a", aiReply: "Nossa equipe já foi acionada.", aiHandoff: false },
      { id: "b", aiReply: "", aiHandoff: true, aiHandoffReason: "Dúvida sobre estacionamento", humanReply: "Tem vaga na garagem 2." },
      { id: "c", aiReply: "", aiHandoff: false, humanReply: "A churrasqueira fica no térreo, pode usar até as 22h sem problema nenhum." },
      { id: "d", aiReply: "Tudo certo por aqui." },
    ]);
    expect(s).toMatchObject({ total: 4, silent: 2, spoke: 2, handoffs: 1, withIssues: 1 });
    expect(s.issueCounts.third_person_team).toBe(1);
    expect(s.possiblyAvoidableHandoffs).toEqual(["b"]);
    expect(s.silentButHumanAnswered).toEqual(["c"]);
  });
});
