/**
 * GATE G2 · contrato v5, barreira léxica e política determinística das ações operacionais (puro).
 * Golden set PT/EN/ES (≥ 120 frases): positivos passam; negativos (negação, futuro, pergunta, problema, condição, saída
 * temporária, acesso que não é ao imóvel, incerteza) são recusados ANTES de qualquer efeito.
 */
import { describe, expect, it } from "vitest";
import { DECISION_FORMAT_SPEC, parseDecision } from "@/lib/guest-ai/orchestrator/decision";
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import {
  lexicalGuard,
  pastDepartureMarker,
  normalizeText,
  sentenceContaining,
  timeAppearsInQuote,
} from "@/lib/guest-ai/ops/lexical";
import {
  isMadrugada,
  evaluateOpsSignals,
  localDate,
  withinBounds,
  type OpsPolicyInput,
} from "@/lib/guest-ai/ops/policy";
import { OPS_MODES, OPS_REFUSAL_CODES } from "@/lib/guest-ai/ops/contracts";
import { v4, v5 } from "./helpers/b23-chain";

// ─────────────────────────── contrato v5 ───────────────────────────

describe("G2 · contrato da decisão v5", () => {
  const eta = {
    card: "checkin",
    date: "2026-11-10",
    time: "16:30",
    evidence: ["hist:guest:h1"],
    quote: "chegamos por volta de 16:30",
  };
  it("v5 válida com guestEtas e milestoneQuote; v4 continua válida", () => {
    const r = parseDecision(v5({ guestEtas: [eta], milestoneQuote: null }), { expectVersion: 5 });
    expect(r.ok && r.version).toBe(5);
    expect(r.ok && r.decision.guestEtas).toEqual([eta]);
    expect(parseDecision(v4()).ok).toBe(true);
    expect(parseDecision(v4(), { expectVersion: 5 }).ok).toBe(false);
  });
  it("mistura parcial, formato inválido e card repetido são recusados", () => {
    const bad = (over: Record<string, unknown>) => {
      const r = parseDecision(v5(over));
      return r.ok ? null : r.error.code;
    };
    const { milestoneQuote: _m, ...noQuote } = v5() as Record<string, unknown>;
    expect(parseDecision(noQuote).ok).toBe(false);
    expect(bad({ guestEtas: [{ ...eta, time: "16h30" }] })).toBe("invalid_guest_etas");
    expect(bad({ guestEtas: [{ ...eta, date: "10/11/2026" }] })).toBe("invalid_guest_etas");
    expect(bad({ guestEtas: [{ ...eta, card: "cleaning" }] })).toBe("invalid_guest_etas");
    expect(bad({ guestEtas: [{ ...eta, evidence: [] }] })).toBe("invalid_guest_etas");
    expect(bad({ guestEtas: [{ ...eta, quote: "" }] })).toBe("invalid_guest_etas");
    expect(bad({ guestEtas: [{ ...eta, quote: "x".repeat(201) }] })).toBe("invalid_guest_etas");
    expect(bad({ guestEtas: [eta, eta] })).toBe("invalid_guest_etas");
    expect(bad({ guestEtas: [{ ...eta, extra: 1 }] })).toBe("invalid_guest_etas");
    expect(bad({ guestEtas: [{ ...eta, propertyId: "p" }] })).toBe("scope_field_forbidden");
    expect(bad({ milestoneQuote: "" })).toBe("invalid_milestone_quote");
    expect(bad({ milestoneQuote: 3 })).toBe("invalid_milestone_quote");
  });
  it("o formato pedido ao modelo descreve guestEtas e milestoneQuote", () => {
    expect(DECISION_FORMAT_SPEC).toContain('"guestEtas"');
    expect(DECISION_FORMAT_SPEC).toContain('"milestoneQuote"');
  });
  it("modos: off, shadow e live", () => expect([...OPS_MODES]).toEqual(["off", "shadow", "live"]));
});

// ─────────────────────────── barreira léxica (golden set) ───────────────────────────

const CHECKIN_OK = [
  "Já entramos!",
  "já entramos no apartamento, tudo certo",
  "Conseguimos acessar",
  "conseguimos entrar",
  "Acesso concluído",
  "já estamos no apartamento",
  "Estamos dentro",
  "chegamos e já estamos instalados",
  "We're in!",
  "We got in, thanks",
  "We are inside the apartment",
  "Ya entramos",
  "Ya estamos en el departamento",
  "Acabamos de entrar",
  "Entramos agora há pouco, apartamento lindo",
  "Tudo certo, já estamos dentro do apê",
  "deu certo, abrimos a porta e entramos",
  "Just got in, the place looks great",
  "We made it inside",
  "Already inside, all good",
  "Acabamos de entrar, todo bien",
  "Ya estamos adentro",
  "Pudimos entrar sin problema", // "sin problema" ⇒ recusado por cautela? não: "problema" ⇒ recusado
];
const CHECKIN_REFUSED: Array<[string, string]> = [
  ["Ainda não entramos", "lexical_negation"],
  ["não conseguimos entrar", "lexical_negation"],
  ["Já posso entrar?", "lexical_question"],
  ["Podemos entrar agora", "lexical_question"],
  ["Vamos entrar daqui a pouco", "lexical_future"],
  ["Quando entrarmos eu aviso", "lexical_future"],
  ["Se entrarmos cedo tem problema", "lexical_problem"],
  ["Se conseguirmos entrar te aviso", "lexical_conditional"],
  ["entramos mas a fechadura travou", "lexical_problem"],
  ["A chave não funciona, não entramos", "lexical_negation"],
  ["Entramos no Airbnb para ver as regras", "lexical_not_property_access"],
  ["já entramos no wifi", "lexical_not_property_access"],
  ["entramos no grupo", "lexical_not_property_access"],
  ["We haven't got in yet", "lexical_negation"],
  ["We will get in at 4pm", "lexical_future"],
  ["We're stuck outside", "lexical_problem"],
  ["Can we get in now", "lexical_question"],
  ["Maybe we're in the wrong building", "lexical_uncertain"],
  ["No hemos podido entrar", "lexical_negation"],
  ["Todavía no entramos", "lexical_negation"],
  ["La llave no funciona", "lexical_problem"],
  ["Cuando entremos te aviso", "lexical_future"],
  ["Estamos na porta, a senha deu erro", "lexical_problem"],
  ["Ainda estamos no aeroporto", "lexical_negation"],
  ["Vou entrar depois das 15h", "lexical_future"],
  ["Já entramos? Meu marido disse que sim", "lexical_question"],
  ["We're locked out", "lexical_problem"],
  ["We'll be in soon", "lexical_future"],
  ["Not inside yet", "lexical_negation"],
  ["Entramos al grupo de WhatsApp", "lexical_not_property_access"],
];
const CHECKOUT_OK = [
  "Já saímos",
  "já saímos, obrigado por tudo",
  "Fizemos o checkout",
  "checkout feito",
  "Chave deixada no cofre",
  "deixamos a chave no cofre e saímos",
  "Já entregamos o apartamento",
  "We left the apartment",
  "We've checked out",
  "Keys are in the lockbox, we left",
  "Ya salimos",
  "Dejamos la llave en la caja",
  "Acabamos de sair, chave no cofre",
  "saída feita, deixamos tudo organizado",
  "Entregamos as chaves na portaria",
  "We just left, keys in the box",
  "Checked out, thank you for everything",
  "Ya entregamos el departamento",
];
const CHECKOUT_REFUSED: Array<[string, string]> = [
  ["Ainda não saímos", "lexical_negation"],
  ["Vamos sair às 8h", "lexical_future"],
  ["amanhã saímos cedo", "lexical_future"],
  ["Saímos para jantar", "lexical_temporary_leave"],
  ["saímos rapidinho para o mercado", "lexical_temporary_leave"],
  ["Já volto, saímos para a praia", "lexical_temporary_leave"],
  ["Posso deixar a chave no cofre?", "lexical_question"],
  ["Se sairmos mais cedo tudo bem", "lexical_conditional"],
  ["Saímos mas a porta não trancou", "lexical_negation"],
  ["Tivemos um problema ao sair", "lexical_problem"],
  ["We'll check out at 10", "lexical_future"],
  ["We left for dinner", "lexical_temporary_leave"],
  ["We are going to leave soon", "lexical_future"],
  ["Can we leave the key inside", "lexical_question"],
  ["Not checked out yet", "lexical_negation"],
  ["Mañana salimos temprano", "lexical_future"],
  ["Salimos a cenar", "lexical_temporary_leave"],
  ["Todavía no salimos", "lexical_negation"],
  ["Saímos para passear, voltamos à noite", "lexical_temporary_leave"],
  ["Vou deixar a chave no cofre", "lexical_future"],
  ["Quando sairmos deixo a chave", "lexical_future"],
  ["We left the key but the door is broken", "lexical_problem"],
  ["Heading out for lunch", "lexical_temporary_leave"],
  ["Salimos un rato a la playa", "lexical_temporary_leave"],
];
const ETA_OK = [
  "nosso voo pousa às 14h, devemos chegar por volta de 16:30",
  "chegamos lá pelas 16h",
  "amanhã temos que sair cedo às 08h",
  "Vamos sair às 10h",
  "We land at 2pm and should arrive around 4:30 pm",
  "Llegaremos a las 17:00",
  "Previsão de chegada: 18h",
  "Devemos chegar umas 19:30",
  "Pretendemos sair às 9h",
  "Our ETA is 6pm",
  "Saldremos a las 9",
  "Chegamos às 20h, ok",
  "We should arrive around 5pm",
];
const ETA_REFUSED: Array<[string, string]> = [
  ["Não sei a que horas chegamos", "lexical_uncertain"],
  ["Talvez chegamos às 16h", "lexical_uncertain"],
  ["Podemos chegar às 13h?", "lexical_question"],
  ["Se o voo atrasar chegamos às 20h", "lexical_conditional"],
  ["Não vamos chegar antes das 22h", "lexical_negation"],
  ["Not sure, maybe 5pm", "lexical_uncertain"],
  ["We won't arrive before 9pm", "lexical_negation"],
  ["No sabemos la hora, quizás a las 18", "lexical_uncertain"],
  ["Depende do trânsito, umas 18h", "lexical_uncertain"],
  ["Se der, saímos às 7h", "lexical_conditional"],
  ["A que horas posso chegar?", "lexical_question"],
  ["If the flight is late we arrive at 11pm", "lexical_conditional"],
];

describe("G2 · barreira léxica antifalso-positivo (golden set PT/EN/ES)", () => {
  it.each(CHECKIN_OK.slice(0, -1))("check-in OK: %s", (t) =>
    expect(lexicalGuard(t, "checkin_done")).toBeNull(),
  );
  it("cautela: menção a problema recusa mesmo em frase positiva", () =>
    expect(lexicalGuard(CHECKIN_OK.at(-1)!, "checkin_done")).toBe("lexical_problem"));
  it.each(CHECKIN_REFUSED)("check-in recusado: %s ⇒ %s", (t, code) =>
    expect(lexicalGuard(t, "checkin_done")).toBe(code),
  );
  it.each(CHECKOUT_OK)("check-out OK: %s", (t) =>
    expect(lexicalGuard(t, "checkout_done")).toBeNull(),
  );
  it.each(CHECKOUT_REFUSED)("check-out recusado: %s ⇒ %s", (t, code) =>
    expect(lexicalGuard(t, "checkout_done")).toBe(code),
  );
  it.each(ETA_OK)("previsão OK: %s", (t) => expect(lexicalGuard(t, "eta")).toBeNull());
  it.each(ETA_REFUSED)("previsão recusada: %s ⇒ %s", (t, code) =>
    expect(lexicalGuard(t, "eta")).toBe(code),
  );

  it("golden set com pelo menos 120 frases", () =>
    expect(
      CHECKIN_OK.length +
        CHECKIN_REFUSED.length +
        CHECKOUT_OK.length +
        CHECKOUT_REFUSED.length +
        ETA_OK.length +
        ETA_REFUSED.length,
    ).toBeGreaterThanOrEqual(120));

  it("normalização e frase do trecho", () => {
    expect(normalizeText("  JÁ   Saímos  ")).toBe("ja saimos");
    expect(sentenceContaining("Oi! Já entramos. A chave travou?", "já entramos")).toBe(
      "ja entramos",
    );
    expect(sentenceContaining("Oi! Já entramos? Tudo bem", "já entramos")).toBe("ja entramos?");
    expect(sentenceContaining("Oi", "já entramos")).toBeNull();
    expect(sentenceContaining("ok", "ok")).toBeNull(); // trecho curto demais
  });
  it("hora proposta aparece no trecho (24 h e 12 h)", () => {
    expect(timeAppearsInQuote("chegamos por volta de 16:30", "16:30")).toBe(true);
    expect(timeAppearsInQuote("around 4:30 pm", "16:30")).toBe(true);
    expect(timeAppearsInQuote("saímos às 08h", "08:00")).toBe(true);
    expect(timeAppearsInQuote("saímos às 8h", "08:00")).toBe(true);
    expect(timeAppearsInQuote("chegamos à tarde", "16:00")).toBe(false);
    expect(timeAppearsInQuote("quarto 116", "16:00")).toBe(false);
  });
});

// ─────────────────────────── política ───────────────────────────

const TZ = "America/Sao_Paulo";
const NOW_CHECKIN_DAY = new Date("2026-11-10T20:00:00Z"); // 17:00 em São Paulo
const MSG = "m-guest-2";
const decision = (over: Partial<ModelDecision> = {}): ModelDecision =>
  ({ ...(v5() as unknown as ModelDecision), ...over }) as ModelDecision;
const milestone = (
  kind: "checkin_confirmed" | "checkout_confirmed",
  quote: string | null,
  evidence = ["hist:guest:h2"],
) =>
  decision({
    hospitalityMilestone: { kind, evidence },
    milestoneQuote: quote,
    intents: [kind === "checkin_confirmed" ? "arrival_confirmation" : "departure_confirmation"],
  });

function input(
  over: Partial<OpsPolicyInput> = {},
  guestText = "Oi! Já entramos, tudo lindo.",
): OpsPolicyInput {
  return {
    decision: milestone("checkin_confirmed", "Já entramos"),
    history: [
      {
        ref: "hist:guest:h0",
        messageId: "m-guest-0",
        speaker: "guest",
        text: "Olá, chegamos hoje",
      },
      { ref: "hist:team:h1", messageId: "m-team-1", speaker: "team", text: "Seja bem-vindo" },
      { ref: "hist:guest:h2", messageId: MSG, speaker: "guest", text: guestText },
    ],
    phase: "in_stay",
    timezone: TZ,
    now: NOW_CHECKIN_DAY,
    reservation: {
      id: "r1",
      status: "confirmed",
      checkinDate: "2026-11-10",
      checkoutDate: "2026-11-13",
    },
    conversation: {
      status: "needs_human",
      assignedTo: null,
      handoffReason: "PADRAO",
      handoffUrgency: null,
      aiPaused: false,
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
const one = (i: OpsPolicyInput) => {
  const r = evaluateOpsSignals(i);
  expect(r).toHaveLength(1);
  return r[0]!;
};

describe("G2 · política determinística", () => {
  it("sem sinal ⇒ nenhuma avaliação", () =>
    expect(evaluateOpsSignals(input({ decision: decision() }))).toEqual([]));

  it("check-in confirmado na estadia em curso ⇒ would_apply com a mensagem de evidência e a foto do card", () => {
    const card = {
      status: "pending",
      doneAt: null,
      arrivalTimeOverride: "16:00",
      arrivalTimeSource: "guest",
      mutedUntil: null,
      lateCheckoutTime: null,
      lateCheckoutApprovedAt: null,
    };
    expect(one(input({ cards: { checkin: card, checkout: null } }))).toEqual({
      action: "checkin_done",
      outcome: "would_apply",
      code: null,
      evidenceMessageId: MSG,
      proposedDate: null,
      proposedTime: null,
      madrugada: false,
      cardBefore: card,
    });
  });

  it("evidência: sem trecho, trecho fora da mensagem, mensagem da equipe, mensagem antiga ⇒ recusa", () => {
    expect(one(input({ decision: milestone("checkin_confirmed", null) })).code).toBe(
      "quote_missing",
    );
    expect(one(input({ decision: milestone("checkin_confirmed", "estamos dentro") })).code).toBe(
      "quote_not_in_message",
    );
    expect(
      one(input({ decision: milestone("checkin_confirmed", "bem-vindo", ["hist:team:h1"]) })).code,
    ).toBe("evidence_not_guest");
    expect(
      one(input({ decision: milestone("checkin_confirmed", "chegamos hoje", ["hist:guest:h0"]) }))
        .code,
    ).toBe("evidence_not_current");
    expect(
      one(input({ decision: milestone("checkin_confirmed", "x", ["hist:guest:h9"]) })).code,
    ).toBe("evidence_not_guest");
  });

  it("barreira léxica aplicada à frase do trecho", () => {
    expect(one(input({}, "Oi! Já entramos? Não achei a chave")).code).toBe("lexical_question");
    expect(
      one(input({ decision: milestone("checkin_confirmed", "entramos") }, "Ainda não entramos"))
        .code,
    ).toBe("lexical_negation");
  });

  it("item 5: antes do horário oficial (fase pre_stay) ⇒ nunca conclui o check-in", () => {
    expect(one(input({ phase: "pre_stay" })).code).toBe("not_in_stay");
    expect(one(input({ phase: "inquiry" })).code).toBe("not_in_stay");
  });

  it("reserva: sem vínculo, cancelada, no-show, sem fuso ⇒ recusa", () => {
    expect(one(input({ reservation: null })).code).toBe("no_reservation");
    expect(
      one(
        input({
          reservation: {
            id: "r1",
            status: "cancelled",
            checkinDate: "2026-11-10",
            checkoutDate: "2026-11-13",
          },
        }),
      ).code,
    ).toBe("reservation_not_active");
    expect(one(input({ phase: "no_show" })).code).toBe("reservation_not_active");
    expect(one(input({ timezone: null })).code).toBe("no_timezone");
  });

  it("card já concluído, silenciado ou estado indisponível ⇒ recusa", () => {
    const done = {
      status: "done",
      doneAt: "2026-11-10T18:00:00Z",
      arrivalTimeOverride: null,
      arrivalTimeSource: null,
      mutedUntil: null,
      lateCheckoutTime: null,
      lateCheckoutApprovedAt: null,
    };
    expect(one(input({ cards: { checkin: done, checkout: null } })).code).toBe("card_done");
    const muted = {
      status: "pending",
      doneAt: null,
      arrivalTimeOverride: null,
      arrivalTimeSource: null,
      mutedUntil: "2026-11-11T00:00:00Z",
      lateCheckoutTime: null,
      lateCheckoutApprovedAt: null,
    };
    expect(one(input({ cards: { checkin: muted, checkout: null } })).code).toBe("card_muted");
    expect(one(input({ cards: null })).code).toBe("state_unavailable");
  });

  it("item 6: atendente, equipe no comando, chamado aberto, encaminhamento, problema ou negociação ⇒ recusa", () => {
    const c = input().conversation!;
    expect(one(input({ conversation: { ...c, assignedTo: "u1" } })).code).toBe("assigned_to_team");
    expect(one(input({ conversation: { ...c, aiPaused: true } })).code).toBe("team_in_command");
    expect(
      one(input({ conversation: { ...c, aiPaused: true, pausedUntil: "2026-11-11T00:00:00Z" } }))
        .code,
    ).toBe("team_in_command");
    expect(
      one(input({ conversation: { ...c, aiPaused: true, pausedUntil: "2026-11-10T00:00:00Z" } }))
        .outcome,
    ).toBe("would_apply"); // pausa expirada
    expect(
      one(input({ conversation: { ...c, handoffReason: "Hóspede pediu desconto" } })).code,
    ).toBe("open_case");
    expect(one(input({ conversation: { ...c, handoffUrgency: "high" } })).code).toBe("open_case");
    expect(one(input({ conversation: null })).code).toBe("state_unavailable");
    const d = milestone("checkin_confirmed", "Já entramos");
    expect(
      one(
        input({ decision: { ...d, handoff: { needed: true, question: "q", urgency: "normal" } } }),
      ).code,
    ).toBe("handoff_needed");
    expect(
      one(input({ decision: { ...d, intents: ["arrival_confirmation", "problem_report"] } })).code,
    ).toBe("problem_or_negotiation");
    expect(one(input({ decision: { ...d, formalChangeRequests: ["late_checkout"] } })).code).toBe(
      "problem_or_negotiation",
    );
  });

  it("check-out: só no dia da saída, no fuso do imóvel", () => {
    const d = milestone("checkout_confirmed", "Já saímos");
    const checkoutDay = new Date("2026-11-13T13:00:00Z"); // 10:00 em São Paulo
    const ok = input({ decision: d, now: checkoutDay }, "Já saímos, obrigado!");
    expect(one(ok)).toMatchObject({ action: "checkout_done", outcome: "would_apply" });
    // dia 12 (antes da data final) sem fato consumado explícito ⇒ não é saída antecipada certa
    expect(one({ ...ok, now: new Date("2026-11-12T13:00:00Z") })).toMatchObject({
      action: "early_departure",
      code: null,
      outcome: "would_apply",
    });
    expect(one({ ...ok, now: new Date("2026-11-15T13:00:00Z") }).code).toBe("not_checkout_day");
    // 01:30 UTC do dia 14 = 22:30 do dia 13 em São Paulo ⇒ ainda é o dia da saída
    expect(
      one({ ...ok, now: new Date("2026-11-14T01:30:00Z"), phase: "post_checkout" }).outcome,
    ).toBe("would_apply");
    expect(one({ ...ok, phase: "pre_stay" }).code).toBe("not_checkout_day");
    expect(one(input({ decision: d, now: checkoutDay }, "Saímos para jantar")).code).toBe(
      "quote_not_in_message",
    );
    expect(
      one(
        input(
          { decision: milestone("checkout_confirmed", "Saímos para jantar"), now: checkoutDay },
          "Saímos para jantar",
        ),
      ).code,
    ).toBe("lexical_temporary_leave");
  });

  describe("previsão de horário", () => {
    const eta = (over: Record<string, unknown> = {}) =>
      decision({
        guestEtas: [
          {
            card: "checkin",
            date: "2026-11-10",
            time: "16:30",
            evidence: ["hist:guest:h2"],
            quote: "devemos chegar por volta de 16:30",
            ...over,
          } as never,
        ],
      });
    const text = "Nosso voo pousa às 14h, devemos chegar por volta de 16:30";
    const pre = (over: Partial<OpsPolicyInput> = {}) =>
      input(
        { decision: eta(), phase: "pre_stay", now: new Date("2026-11-10T12:00:00Z"), ...over },
        text,
      );

    it("dentro dos limites, na data do card ⇒ would_apply com data e hora propostas", () =>
      expect(one(pre())).toMatchObject({
        action: "eta_checkin",
        outcome: "would_apply",
        proposedDate: "2026-11-10",
        proposedTime: "16:30",
      }));
    it("D-G2-5: fora dos limites oficiais ⇒ não grava", () => {
      expect(one(pre({ decision: eta({ time: "14:00", quote: "voo pousa às 14h" }) })).code).toBe(
        "eta_out_of_bounds",
      );
    });
    it("hora que não aparece no trecho, data diferente da do card, depois da data ⇒ recusa", () => {
      expect(one(pre({ decision: eta({ time: "17:30" }) })).code).toBe("time_not_in_quote");
      expect(one(pre({ decision: eta({ date: "2026-11-11" }) })).code).toBe("eta_date_mismatch");
      expect(one(pre({ now: new Date("2026-11-11T12:00:00Z") })).code).toBe("eta_phase_mismatch");
    });
    it("nunca sobrescreve previsão da equipe", () => {
      const staff = {
        status: "pending",
        doneAt: null,
        arrivalTimeOverride: "18:00",
        arrivalTimeSource: "staff",
        mutedUntil: null,
        lateCheckoutTime: null,
        lateCheckoutApprovedAt: null,
      };
      expect(one(pre({ cards: { checkin: staff, checkout: null } })).code).toBe("staff_prediction");
    });
    it("saída: data da saída e limites de saída", () => {
      const out = decision({
        guestEtas: [
          {
            card: "checkout",
            date: "2026-11-13",
            time: "08:00",
            evidence: ["hist:guest:h2"],
            quote: "temos que sair cedo às 08h",
          },
        ],
      });
      const i = input(
        { decision: out, phase: "in_stay", now: new Date("2026-11-12T22:00:00Z") },
        "amanhã temos que sair cedo às 08h",
      );
      expect(one(i)).toMatchObject({
        action: "eta_checkout",
        outcome: "would_apply",
        proposedTime: "08:00",
      });
      expect(one({ ...i, property: { ...i.property!, checkoutTimeMin: "09:00" } }).code).toBe(
        "eta_out_of_bounds",
      );
    });
  });

  describe("saída antecipada (diretriz 3)", () => {
    const d = (q: string) => milestone("checkout_confirmed", q);
    const midStay = new Date("2026-11-11T18:00:00Z"); // 15:00 do dia 11 em São Paulo; saída prevista dia 13
    it("fato consumado antes da data final ⇒ early_departure com o card puxado para hoje", () => {
      const text = "Tive um imprevisto e já saí do apartamento agora, deixei as chaves no cofre";
      expect(
        one(
          input(
            { decision: d("já saí do apartamento agora, deixei as chaves no cofre"), now: midStay },
            text,
          ),
        ),
      ).toMatchObject({
        action: "early_departure",
        outcome: "would_apply",
        proposedDate: "2026-11-11",
        proposedTime: null,
      });
    });
    it("sem marca de fato consumado ⇒ não há certeza absoluta", () => {
      expect(
        one(
          input(
            { decision: d("entregamos o apartamento"), now: midStay },
            "Entregamos o apartamento",
          ),
        ).code,
      ).toBe("early_departure_not_certain");
    });
    it("plano de sair antes não é saída (barreira léxica)", () => {
      expect(
        one(
          input({ decision: d("vamos sair amanhã cedo"), now: midStay }, "vamos sair amanhã cedo"),
        ).code,
      ).toBe("lexical_future");
    });
    it("antes de a estadia começar ⇒ recusa", () => {
      const text = "Já saí, deixei as chaves";
      expect(
        one(
          input({ decision: d("Já saí, deixei as chaves"), now: midStay, phase: "pre_stay" }, text),
        ).code,
      ).toBe("not_in_stay");
    });
    it("card de saída já concluído ⇒ recusa", () => {
      const done = {
        status: "done",
        doneAt: "2026-11-11T10:00:00Z",
        arrivalTimeOverride: null,
        arrivalTimeSource: null,
        mutedUntil: null,
        lateCheckoutTime: null,
        lateCheckoutApprovedAt: null,
      };
      const text = "Já saímos, deixamos as chaves";
      expect(
        one(
          input(
            {
              decision: d("Já saímos, deixamos as chaves"),
              now: midStay,
              cards: { checkin: null, checkout: done },
            },
            text,
          ),
        ).code,
      ).toBe("card_done");
    });
    it("marca de fato consumado em PT, EN e ES", () => {
      for (const t of [
        "já saí",
        "deixamos a chave no cofre",
        "we already left",
        "just left",
        "ya salimos",
        "dejé las llaves",
      ])
        expect(pastDepartureMarker(t), t).toBe(true);
      for (const t of ["entregamos", "saindo agora", "leaving now", "salimos mañana"])
        expect(pastDepartureMarker(t), t).toBe(false);
    });
  });

  describe("madrugada (diretriz 1): 00:00–05:00 é da noite da data de entrada", () => {
    const etaM = (
      date: string,
      time = "01:30",
      quote = "devo chegar ainda hoje por volta de 1h30",
    ) =>
      decision({
        guestEtas: [{ card: "checkin", date, time, evidence: ["hist:guest:h2"], quote }],
      });
    const overnight = {
      checkinTime: "15:00",
      checkinTimeMax: "02:00",
      checkoutTime: "11:00",
      checkoutTimeMin: "06:00",
    };
    const base = (
      over: Partial<OpsPolicyInput> = {},
      text = "Oi! Devo chegar ainda hoje por volta de 1h30",
    ) =>
      input(
        { phase: "pre_stay", now: new Date("2026-11-10T20:00:00Z"), property: overnight, ...over },
        text,
      );
    it("modelo usou a data civil seguinte ⇒ card da data de entrada, marcado como madrugada", () =>
      expect(one(base({ decision: etaM("2026-11-11") }))).toMatchObject({
        action: "eta_checkin",
        outcome: "would_apply",
        proposedDate: "2026-11-10",
        madrugada: true,
      }));
    it("modelo já usou a data de entrada ⇒ mesmo resultado", () =>
      expect(one(base({ decision: etaM("2026-11-10") }))).toMatchObject({
        outcome: "would_apply",
        proposedDate: "2026-11-10",
        madrugada: true,
      }));
    it("às 00:40 da data civil seguinte (ainda antes da chegada prevista) continua valendo", () =>
      expect(
        one(
          base({
            decision: etaM("2026-11-11"),
            now: new Date("2026-11-11T03:40:00Z"),
            phase: "in_stay",
          }),
        ),
      ).toMatchObject({ outcome: "would_apply", proposedDate: "2026-11-10" }));
    it("janela oficial até 22:00 (sem virar a meia-noite) ⇒ fora dos limites, não grava (D-G2-5)", () =>
      expect(
        one(
          base({
            decision: etaM("2026-11-11"),
            property: { ...overnight, checkinTimeMax: "22:00" },
          }),
        ).code,
      ).toBe("eta_out_of_bounds"));
    it("05:00 em diante não é madrugada; dois dias depois não vira data de entrada", () => {
      expect(isMadrugada("04:59")).toBe(true);
      expect(isMadrugada("05:00")).toBe(false);
      expect(one(base({ decision: etaM("2026-11-12") })).code).toBe("eta_date_mismatch");
    });
    it("saída de madrugada não é remapeada (a regra é da chegada)", () => {
      const out = decision({
        guestEtas: [
          {
            card: "checkout",
            date: "2026-11-13",
            time: "04:00",
            evidence: ["hist:guest:h2"],
            quote: "saímos às 4h",
          },
        ],
      });
      const r = one(
        input(
          {
            decision: out,
            phase: "in_stay",
            now: new Date("2026-11-12T22:00:00Z"),
            property: { ...overnight, checkoutTimeMin: "03:00" },
          },
          "Amanhã saímos às 4h",
        ),
      );
      expect(r).toMatchObject({
        action: "eta_checkout",
        proposedDate: "2026-11-13",
        madrugada: false,
      });
    });
  });

  it("utilitários: data local no fuso e limites (mesma regra do formulário do guia)", () => {
    expect(localDate(new Date("2026-11-14T01:30:00Z"), TZ)).toBe("2026-11-13");
    expect(localDate(new Date("2026-11-14T01:30:00Z"), "Not/AZone")).toBeNull();
    expect(withinBounds("16:30", "15:00", "22:00")).toBe(true);
    expect(withinBounds("14:59", "15:00", null)).toBe(false);
    expect(withinBounds("23:00", null, "22:00")).toBe(false);
    expect(withinBounds("10:00", null, null)).toBe(true);
    expect(withinBounds("10h", null, null)).toBe(false);
    // janela que atravessa a meia-noite
    expect(withinBounds("01:30", "15:00", "02:00")).toBe(true);
    expect(withinBounds("23:00", "15:00", "02:00")).toBe(true);
    expect(withinBounds("03:00", "15:00", "02:00")).toBe(false);
    expect(withinBounds("14:00", "15:00", "02:00")).toBe(false);
  });

  it("todos os códigos de recusa usados pela política são do vocabulário fechado (e cabem na coluna)", () => {
    for (const c of OPS_REFUSAL_CODES) expect(c).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });
});
