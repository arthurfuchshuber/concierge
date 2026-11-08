/**
 * Etapa 1 (08/11/2026) — ações operacionais da IA respeitam o horário humano:
 *  1. checkout da IA nunca antes do horário da EQUIPE (maior que o oficial) nem do late checkout autorizado;
 *  2. previsão dita pelo hóspede grava só previsão (origem guest_ai), nunca conclusão;
 *  3. 00:00–04:59 no fuso do imóvel = madrugada da noite de entrada ("nesta madrugada"), nunca "amanhã";
 *  4. late checkout depois do oficial só com autorização humana expressa da equipe no chat (G2c).
 */
import { describe, expect, it } from "vitest";
import {
  evaluateOpsSignals,
  isMadrugada,
  staffCheckoutCutMinutes,
  type OpsPolicyInput,
} from "@/lib/guest-ai/ops/policy";
import { detectStaffLateCheckout } from "@/lib/guest-ai/ops/late-checkout";
import { GUEST_AI_ARRIVAL_SOURCE, type OpsCardState } from "@/lib/guest-ai/ops/contracts";
import { predictionDayLabel } from "@/lib/prediction-day-label";
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import { v6 } from "./helpers/b23-chain";

const TZ = "America/Sao_Paulo";
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const card = (over: Partial<OpsCardState> = {}): OpsCardState => ({
  status: "pending",
  doneAt: null,
  arrivalTimeOverride: null,
  arrivalTimeSource: null,
  mutedUntil: null,
  lateCheckoutTime: null,
  lateCheckoutApprovedAt: null,
  ...over,
});
const departure = (quote: string): ModelDecision =>
  ({
    ...(v6() as unknown as ModelDecision),
    hospitalityMilestone: { kind: "checkout_confirmed", evidence: ["hist:guest:h1"] },
    milestoneQuote: quote,
    intents: ["departure_confirmation"],
  }) as ModelDecision;

const input = (o: {
  text: string;
  now: Date;
  checkout: OpsCardState | null;
  decision?: ModelDecision;
  phase?: OpsPolicyInput["phase"];
}): OpsPolicyInput => ({
  decision: o.decision ?? departure(o.text),
  history: [{ ref: "hist:guest:h1", messageId: "m1", speaker: "guest", text: o.text }],
  phase: o.phase ?? "in_stay",
  timezone: TZ,
  now: o.now,
  reservation: { id: "r1", status: "confirmed", checkinDate: "2026-11-04", checkoutDate: "2026-11-08" },
  conversation: {
    status: "needs_human",
    assignedTo: null,
    handoffReason: "PADRAO",
    handoffUrgency: null,
    aiPaused: false,
    pausedUntil: null,
  },
  cards: { checkin: null, checkout: o.checkout },
  property: { checkinTime: "15:00", checkinTimeMax: "22:00", checkoutTime: "11:00", checkoutTimeMin: "06:00" },
  defaultHandoffReason: "PADRAO",
});
const only = (i: OpsPolicyInput) => {
  const r = evaluateOpsSignals(i);
  expect(r).toHaveLength(1);
  return r[0]!;
};

describe("1. checkout da IA respeita o corte humano", () => {
  const msg = "Check out feito, deixamos a chave";

  it("sem corte humano: fato consumado no dia da saída ⇒ checkout_done (regra comum preservada)", () => {
    expect(only(input({ text: msg, now: at("2026-11-08", "09:00"), checkout: card() }))).toMatchObject({
      action: "checkout_done",
      outcome: "would_apply",
    });
  });

  it("horário da EQUIPE 13:00 > oficial: às 12:59 recusa; às 13:00 aplica", () => {
    const c = card({ arrivalTimeOverride: "13:00", arrivalTimeSource: "staff" });
    expect(only(input({ text: msg, now: at("2026-11-08", "12:59"), checkout: c }))).toMatchObject({
      outcome: "refused",
      code: "before_staff_cut",
    });
    expect(only(input({ text: msg, now: at("2026-11-08", "13:00"), checkout: c }))).toMatchObject({
      action: "checkout_done",
      outcome: "would_apply",
    });
  });

  it("horário da equipe MENOR ou igual ao oficial não vira corte (não antecipa nem trava)", () => {
    const c = card({ arrivalTimeOverride: "10:00", arrivalTimeSource: "staff" });
    expect(only(input({ text: msg, now: at("2026-11-08", "09:00"), checkout: c })).outcome).toBe("would_apply");
  });

  it("late checkout autorizado (R6) 14:00: recusa antes, aplica a partir dele", () => {
    const c = card({ lateCheckoutTime: "14:00", lateCheckoutApprovedAt: "2026-11-07T20:00:00Z" });
    expect(only(input({ text: msg, now: at("2026-11-08", "13:30"), checkout: c })).code).toBe("before_staff_cut");
    expect(only(input({ text: msg, now: at("2026-11-08", "14:00"), checkout: c })).outcome).toBe("would_apply");
  });

  it("late checkout sem aprovação não é corte", () => {
    expect(staffCheckoutCutMinutes(card({ lateCheckoutTime: "14:00" }), "11:00")).toBeNull();
  });

  it("previsão do hóspede/IA nunca vira corte humano", () => {
    for (const src of ["guest", GUEST_AI_ARRIVAL_SOURCE]) {
      expect(staffCheckoutCutMinutes(card({ arrivalTimeOverride: "13:00", arrivalTimeSource: src }), "11:00")).toBeNull();
    }
  });

  it("saída antecipada (dia anterior) com corte humano espera a equipe/baixa automática", () => {
    const c = card({ arrivalTimeOverride: "13:00", arrivalTimeSource: "staff" });
    expect(only(input({ text: "Já saí, deixei as chaves", now: at("2026-11-07", "18:00"), checkout: c }))).toMatchObject({
      action: "early_departure",
      outcome: "refused",
      code: "before_staff_cut",
    });
  });
});

describe("2. previsão do hóspede é só previsão", () => {
  it.each(["Vou fazer o check out às 10h", "Amanhã a gente sai cedo", "Vamos sair daqui a pouco"])(
    "'%s' declarado como saída pelo modelo ⇒ recusado pela barreira (nunca conclusão)",
    (text) => {
      const r = only(input({ text, now: at("2026-11-08", "09:00"), checkout: card() }));
      expect(r.outcome).toBe("refused");
      expect(r.code).toMatch(/^lexical_|quote_not_in_message/);
    },
  );

  it("a origem gravada pela IA numa previsão é guest_ai", () => {
    expect(GUEST_AI_ARRIVAL_SOURCE).toBe("guest_ai");
  });
});

describe("3. madrugada = 00:00–04:59 no fuso do imóvel", () => {
  it("limites", () => {
    expect(isMadrugada("00:00")).toBe(true);
    expect(isMadrugada("04:59")).toBe(true);
    expect(isMadrugada("05:00")).toBe(false);
    expect(isMadrugada("23:59")).toBe(false);
  });

  it("rótulo: chegada 02:00 no card de hoje ⇒ 'nesta madrugada' (antes e depois da virada); nunca 'amanhã'", () => {
    expect(predictionDayLabel("2026-11-08", "2026-11-08", "02:00", "checkin", 20 * 60).label).toBe("nesta madrugada");
    // depois da meia-noite, ainda madrugada: o card é do dia anterior e continua "nesta madrugada"
    expect(predictionDayLabel("2026-11-08", "2026-11-09", "02:00", "checkin", 1 * 60).label).toBe("nesta madrugada");
    expect(predictionDayLabel("2026-11-08", "2026-11-09", "04:59", "checkin", 4 * 60 + 59).label).toBe("nesta madrugada");
    // 05:00 já não é madrugada: card de ontem vira "ontem"
    expect(predictionDayLabel("2026-11-08", "2026-11-09", "05:00", "checkin", 5 * 60).label).toBe("ontem");
  });

  it("card de amanhã com chegada na madrugada não vira 'amanhã'", () => {
    expect(predictionDayLabel("2026-11-09", "2026-11-08", "03:00", "checkin", 10 * 60).label).toBe("madrugada");
    expect(predictionDayLabel("2026-11-09", "2026-11-08", "15:00", "checkin", 10 * 60).label).toBe("amanhã");
  });
});

describe("4. late checkout só com autorização humana expressa", () => {
  const now = at("2026-11-08", "08:00");
  const h = (speaker: "guest" | "team", text: string, hm = "07:00") => ({
    messageId: `${speaker}-${hm}`,
    speaker,
    text,
    at: at("2026-11-08", hm).toISOString(),
  });

  it("pedido ou afirmação do hóspede nunca é autorização", () => {
    expect(
      detectStaffLateCheckout([h("guest", "Posso sair às 14h?"), h("guest", "Vou sair às 14h", "07:30")], {
        officialCheckout: "11:00",
        now,
      }),
    ).toBeNull();
  });

  it("concessão afirmativa explícita da equipe com um horário depois do oficial ⇒ concedida", () => {
    const r = detectStaffLateCheckout([h("guest", "Posso sair às 14h?"), h("team", "Pode sim, pode sair às 14h!", "07:30")], {
      officialCheckout: "11:00",
      now,
    });
    expect(r).toMatchObject({ status: "granted", time: "14:00" });
  });

  it("equipe com pergunta/condição ⇒ não concede", () => {
    const r = detectStaffLateCheckout([h("team", "Se a limpeza permitir, pode sair às 14h", "07:30")], {
      officialCheckout: "11:00",
      now,
    });
    expect(r?.status === "granted").toBe(false);
  });
});
