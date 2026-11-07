/**
 * GATE G2c · late checkout concedido pela EQUIPE no chat (diretriz de 06/11/2026, item 3) — puro.
 * Só a concessão expressa de atendente humano vale; pedido/pergunta do hóspede nunca é autorização.
 */
import { describe, expect, it } from "vitest";
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import {
  detectStaffLateCheckout,
  timesIn,
  type LateCheckoutHistoryEntry,
} from "@/lib/guest-ai/ops/late-checkout";
import { evaluateOpsSignals, type OpsPolicyInput } from "@/lib/guest-ai/ops/policy";
import { normalizeText } from "@/lib/guest-ai/ops/lexical";
import { v5 } from "./helpers/b23-chain";

const NOW = new Date("2026-11-12T22:00:00Z"); // 19:00 em São Paulo, véspera da saída (13/11)
const AT = "2026-11-12T21:00:00Z";
const team = (text: string, at = AT, id = "m-team"): LateCheckoutHistoryEntry => ({
  messageId: id,
  speaker: "team",
  text,
  at,
});
const guest = (text: string, at = AT, id = "m-guest"): LateCheckoutHistoryEntry => ({
  messageId: id,
  speaker: "guest",
  text,
  at,
});
const detect = (h: LateCheckoutHistoryEntry[], official: string | null = "11:00") =>
  detectStaffLateCheckout(h, { officialCheckout: official, now: NOW });

describe("timesIn", () => {
  it("13h, 13h30, 13:30, 1pm, 1:30 pm, 14 horas", () => {
    expect(timesIn(normalizeText("pode sair às 13h"))).toEqual(["13:00"]);
    expect(timesIn(normalizeText("até 13h30"))).toEqual(["13:30"]);
    expect(timesIn(normalizeText("até 13:30"))).toEqual(["13:30"]);
    expect(timesIn(normalizeText("you can leave at 1pm"))).toEqual(["13:00"]);
    expect(timesIn(normalizeText("until 1:30 pm"))).toEqual(["13:30"]);
    expect(timesIn(normalizeText("até as 14 horas"))).toEqual(["14:00"]);
    expect(timesIn(normalizeText("sem horário"))).toEqual([]);
  });
});

const GRANTED: Array<[string, string]> = [
  ["Combinado, pode sair às 13h!", "13:00"],
  ["Autorizado o checkout até 14h00.", "14:00"],
  ["Pode sim, o late checkout até 13h30 está liberado", "13:30"],
  ["Tudo certo, vocês podem ficar até as 15h no dia da saída", "15:00"],
  ["Late checkout aprovado até 13h", "13:00"],
  ["Sure, you can check out at 1pm", "13:00"],
  ["Late checkout confirmed until 2pm", "14:00"],
  ["Claro! Pueden salir a las 13:00", "13:00"],
  ["Oi Ana! Combinado: saída às 12h30. Boa viagem!", "12:30"],
];
const REFUSED: Array<[string, string]> = [
  ["Infelizmente não conseguimos liberar a saída às 13h", "lexical_negation"],
  ["Não é possível sair às 14h, temos outra entrada", "lexical_negation"],
  ["Vou verificar se dá para sair às 13h e te aviso", "lexical_conditional"],
  ["Se a limpeza permitir, pode sair às 13h", "lexical_conditional"],
  ["Você quer sair às 13h?", "lexical_question"],
  ["Pode sair às 13h, com taxa de R$ 50", "problem_or_negotiation"],
  ["Late checkout até 14h custa R$ 80 via pix", "problem_or_negotiation"],
  ["O checkout padrão é às 11h, mas pode sair às 13h", "staff_grant_ambiguous"],
  ["Pode sair às 13h ou às 14h", "staff_grant_ambiguous"],
  ["Anotei seu pedido de saída às 13h", "staff_grant_not_explicit"],
  ["Sorry, we can't offer checkout at 1pm", "lexical_negation"],
  ["Let me check if checkout at 1pm works", "lexical_conditional"],
];

describe("detectStaffLateCheckout", () => {
  it.each(GRANTED)("concede: %s", (text, time) => {
    expect(detect([guest("Posso sair mais tarde?"), team(text)])).toMatchObject({
      status: "granted",
      messageId: "m-team",
      time,
    });
  });
  it.each(REFUSED)("recusa: %s", (text, code) => {
    expect(detect([team(text)])).toMatchObject({ status: "refused", code });
  });

  it("pedido ou pergunta do HÓSPEDE nunca é autorização (nem a afirmação dele)", () => {
    expect(detect([guest("Posso sair às 13h?")])).toBeNull();
    expect(detect([guest("Combinado, vou sair às 14h, autorizado pelo João")])).toBeNull();
    // fala da IA antiga/sistema não conta
    expect(detect([{ ...team("Pode sair às 13h"), speaker: "legacy_ai" }])).toBeNull();
    expect(detect([{ ...team("Pode sair às 13h"), speaker: "system" }])).toBeNull();
  });

  it("horário que não passa do oficial não é late checkout (nada a fazer)", () => {
    expect(detect([team("Combinado, pode sair às 10h")])).toBeNull();
    expect(detect([team("Combinado, pode sair às 11h")])).toBeNull();
  });

  it("a palavra mais NOVA da equipe sobre saída vale: recusa depois da concessão anula", () => {
    const h = [
      team("Combinado, pode sair às 13h", "2026-11-12T18:00:00Z", "m1"),
      guest("Obrigado!", "2026-11-12T18:10:00Z"),
      team(
        "Desculpe, a saída vai ter que ser no horário padrão mesmo",
        "2026-11-12T20:00:00Z",
        "m2",
      ),
    ];
    expect(detect(h)).toBeNull();
    // mensagem posterior da equipe sobre OUTRO assunto não anula
    const h2 = [
      team("Combinado, pode sair às 13h", "2026-11-12T18:00:00Z", "m1"),
      team("O wifi é CasaNet", "2026-11-12T20:00:00Z", "m2"),
    ];
    expect(detect(h2)).toMatchObject({ status: "granted", messageId: "m1" });
  });

  it("janela de 72 h; mensagem do futuro ou sem instante é ignorada; sem horário oficial, nada", () => {
    expect(detect([team("Combinado, pode sair às 13h", "2026-11-09T12:00:00Z")])).toBeNull();
    expect(detect([team("Combinado, pode sair às 13h", "2026-11-13T12:00:00Z")])).toBeNull();
    expect(detect([team("Combinado, pode sair às 13h", "")])).toBeNull();
    expect(detect([team("Combinado, pode sair às 13h")], null)).toBeNull();
  });
});

// ─────────────────────────── política ───────────────────────────

function input(
  over: Partial<OpsPolicyInput> = {},
  staffText = "Combinado, pode sair às 13h!",
): OpsPolicyInput {
  return {
    decision: { ...(v5() as unknown as ModelDecision) } as ModelDecision,
    history: [
      {
        ref: "hist:guest:h1",
        messageId: "m-g1",
        speaker: "guest",
        text: "Posso sair 13h amanhã?",
        at: "2026-11-12T20:30:00Z",
      },
      { ref: "hist:team:h2", messageId: "m-team", speaker: "team", text: staffText, at: AT },
      {
        ref: "hist:guest:h3",
        messageId: "m-g3",
        speaker: "guest",
        text: "Obrigado!",
        at: "2026-11-12T21:30:00Z",
      },
    ],
    phase: "in_stay",
    timezone: "America/Sao_Paulo",
    now: NOW,
    reservation: {
      id: "r1",
      status: "confirmed",
      checkinDate: "2026-11-10",
      checkoutDate: "2026-11-13",
    },
    // equipe atribuída/no comando NÃO trava: a decisão é da própria equipe
    conversation: {
      status: "assigned",
      assignedTo: "u1",
      handoffReason: "pedido de late checkout",
      handoffUrgency: null,
      aiPaused: true,
      pausedUntil: null,
    },
    cards: { checkin: null, checkout: null },
    property: {
      checkinTime: "15:00",
      checkinTimeMax: "22:00",
      checkoutTime: "11:00",
      checkoutTimeMin: "06:00",
    },
    defaultHandoffReason: "PADRAO",
    ...over,
  };
}
const card = (over: Record<string, unknown> = {}) => ({
  status: "pending",
  doneAt: null,
  arrivalTimeOverride: null,
  arrivalTimeSource: null,
  mutedUntil: null,
  lateCheckoutTime: null,
  lateCheckoutApprovedAt: null,
  ...over,
});

describe("política · late_checkout", () => {
  it("concessão da equipe ⇒ would_apply com a mensagem da EQUIPE como evidência, dia da saída e horário", () => {
    expect(evaluateOpsSignals(input())).toEqual([
      {
        action: "late_checkout",
        outcome: "would_apply",
        code: null,
        evidenceMessageId: "m-team",
        proposedDate: "2026-11-13",
        proposedTime: "13:00",
        madrugada: false,
        cardBefore: null,
      },
    ]);
  });

  it("card já com esse late checkout, ou ajustado pela equipe depois da mensagem ⇒ nada", () => {
    expect(
      evaluateOpsSignals(
        input({
          cards: {
            checkin: null,
            checkout: card({
              lateCheckoutTime: "13:00",
              lateCheckoutApprovedAt: "2026-11-12T21:01:00Z",
            }),
          },
        }),
      ),
    ).toEqual([]);
    expect(
      evaluateOpsSignals(
        input({
          cards: {
            checkin: null,
            checkout: card({
              lateCheckoutTime: "12:00",
              lateCheckoutApprovedAt: "2026-11-12T21:05:00Z",
            }),
          },
        }),
      ),
    ).toEqual([]);
    // concessão mais nova que a do card ⇒ troca
    expect(
      evaluateOpsSignals(
        input({
          cards: {
            checkin: null,
            checkout: card({
              lateCheckoutTime: "12:00",
              lateCheckoutApprovedAt: "2026-11-12T10:00:00Z",
            }),
          },
        }),
      )[0],
    ).toMatchObject({ outcome: "would_apply", proposedTime: "13:00" });
  });

  it("recusas: frase ambígua, reserva inativa, depois do dia da saída, card concluído", () => {
    expect(evaluateOpsSignals(input({}, "Vou ver se dá para sair às 13h"))[0]).toMatchObject({
      outcome: "refused",
      code: "lexical_conditional",
      evidenceMessageId: "m-team",
    });
    expect(
      evaluateOpsSignals(
        input({
          reservation: {
            id: "r1",
            status: "cancelled",
            checkinDate: "2026-11-10",
            checkoutDate: "2026-11-13",
          },
        }),
      )[0],
    ).toMatchObject({ code: "reservation_not_active" });
    expect(
      evaluateOpsSignals(
        input({
          reservation: {
            id: "r1",
            status: "confirmed",
            checkinDate: "2026-11-08",
            checkoutDate: "2026-11-11",
          },
        }),
      )[0],
    ).toMatchObject({ code: "not_checkout_window" });
    expect(
      evaluateOpsSignals(
        input({ cards: { checkin: null, checkout: card({ status: "done", doneAt: AT }) } }),
      )[0],
    ).toMatchObject({ code: "card_done" });
    expect(evaluateOpsSignals(input({ reservation: null }))[0]).toMatchObject({
      code: "no_reservation",
    });
  });

  it("convive com os sinais do hóspede (avaliações independentes)", () => {
    const d = { ...(v5() as unknown as ModelDecision), guestEtas: [] } as ModelDecision;
    expect(evaluateOpsSignals(input({ decision: d })).map((e) => e.action)).toEqual([
      "late_checkout",
    ]);
  });
});
