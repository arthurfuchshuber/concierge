/**
 * CONDUÇÃO CONSULTIVA AO FECHAMENTO (commit ff7c28ed) — cenários automatizados do que o SISTEMA garante.
 *
 * Sem chamada a modelo (nenhuma rede): cada cenário compõe o prompt real do turno e prova que o modelo recebe
 * os sinais e as regras para decidir — fase calculada pelo servidor, histórico completo (para ver se a
 * condução já foi feita ou se o hóspede pediu tempo) e as regras de uma única vez, sem insistência e sem
 * urgência. O comportamento do modelo em si só se comprova com avaliação de saídas reais (não executada:
 * exigiria chamadas ao Gateway).
 */
import { describe, expect, it } from "vitest";
import { composeTurnPrompt } from "@/lib/guest-ai/composer";
import { GUEST_PERSONA, renderPersona } from "@/lib/guest-ai/persona";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { normalizeHistory, type HistoryRow } from "@/lib/guest-ai/history";
import { conversationContext, CONV, MSG, row, TEST_GUARD } from "./helpers/b21-fixtures";

const inquiry = () => conversationContext({ phase: "inquiry", stay: null, audiences: ["P"] });
const preStay = () => conversationContext();
const hist = (rows: Array<Partial<HistoryRow>>, current: string) =>
  normalizeHistory(
    [
      ...rows.map((r, i) =>
        row({
          created_at: `2026-11-03T09:${String(10 + i).padStart(2, "0")}:00.000000+00:00`,
          ...r,
        }),
      ),
      row({ id: MSG, created_at: "2026-11-03T10:00:00.000000+00:00", content: current }),
    ],
    { conversationId: CONV, currentMessageId: MSG },
  );
const compose = (
  context: ReturnType<typeof conversationContext>,
  history: ReturnType<typeof hist>,
) => {
  const r = composeTurnPrompt({ context, history }, { guard: TEST_GUARD });
  if (r.kind !== "prompt") throw new Error(r.kind);
  return { system: r.prompt.system, user: r.prompt.messages[0]!.content };
};
const team = (content: string): Partial<HistoryRow> => ({
  role: "assistant",
  sender_type: "human",
  content,
});
const guest = (content: string): Partial<HistoryRow> => ({
  role: "user",
  sender_type: "guest",
  content,
});

describe("Condução consultiva · cenários (o que o modelo recebe para decidir)", () => {
  it("consulta (inquiry) com dúvidas esclarecidas: fase inquiry no contexto + regra de conduzir após o esclarecimento", () => {
    const p = compose(
      inquiry(),
      hist(
        [guest("O apartamento tem garagem?"), team("Tem sim, uma vaga coberta.")],
        "Perfeito, e fica perto da praia?",
      ),
    );
    expect(p.user).toContain('"id":"ctx:fase","valor":"inquiry"');
    expect(p.system).toMatch(/fase do contexto for inquiry/);
    expect(p.system).toMatch(
      /dúvidas principais do hóspede sobre o imóvel, as comodidades ou a localização já estiverem esclarecidas/,
    );
  });

  it("fora da consulta (pre_stay): a fase enviada não é inquiry, e a regra só vale para inquiry", () => {
    const p = compose(preStay(), hist([], "Que horas posso chegar?"));
    expect(p.user).toContain('"id":"ctx:fase","valor":"pre_stay"');
    expect(p.user).not.toContain('"valor":"inquiry"');
    expect(p.system).toMatch(/quando a fase do contexto for inquiry \(sem reserva\)/);
  });

  it("uma única vez: o histórico completo vai ao modelo, e a regra manda não repetir se a condução já foi feita", () => {
    const p = compose(
      inquiry(),
      hist(
        [
          guest("Tem Wi-Fi?"),
          team(
            "Tem sim, fibra de 300 mega. Se quiser garantir as datas, é só reservar pela plataforma.",
          ),
        ],
        "E aceita pet?",
      ),
    );
    expect(p.user).toContain("é só reservar pela plataforma");
    expect(p.system).toMatch(
      /acontece uma única vez na conversa: se o histórico mostrar que ela já foi feita, não repita/,
    );
  });

  it("respeito ao tempo e sem insistência: hesitação do hóspede está no histórico e a regra manda não voltar a insistir", () => {
    const p = compose(
      inquiry(),
      hist(
        [team("Posso ajudar com mais alguma dúvida?")],
        "Vou conversar com minha esposa e te aviso",
      ),
    );
    expect(p.user).toContain("Vou conversar com minha esposa");
    expect(p.system).toMatch(
      /vai pensar, avaliar ou consultar outras pessoas, respeite com gentileza/,
    );
    expect(p.system).toMatch(/não volte a insistir/);
  });

  it("sem falsa urgência nem promessa: proibição explícita de escassez, prazo, procura e condição não declarada", () => {
    const sys = buildSystemPrompt("airbnb");
    expect(sys).toMatch(/nunca crie urgência artificial \(escassez, prazo ou procura inventados\)/);
    expect(sys).toMatch(
      /nem prometa preço, desconto, disponibilidade ou condição que o contexto validado não declare/,
    );
  });

  it("sem frases prontas: nem a persona nem a regra trazem texto entre aspas para reproduzir", () => {
    const closing = GUEST_PERSONA.character.find((p) => p.id === "consultative_closing")!.guidance;
    expect(closing).not.toMatch(/["“”']/);
    const rules = buildSystemPrompt("airbnb")
      .split("\n")
      .filter((l) => /Condução ao fechamento|Essa condução|Na condução/.test(l));
    expect(rules).toHaveLength(3);
    for (const l of rules) expect(l).not.toMatch(/["“”]/);
    expect(renderPersona()).toMatch(/não são frases a reproduzir/);
  });
});
