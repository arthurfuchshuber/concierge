import { afterEach, describe, expect, it, vi } from "vitest";
import { canReleaseCredentials } from "@/lib/guest-ai/policy/credential-policy";
import type { CredentialPolicyInput } from "@/lib/guest-ai/types";

/**
 * D9 — política oficial de liberação de credenciais (ordem de vetos, janela de 24 h, fuso).
 * Cenário-base: imóvel em America/Sao_Paulo (UTC−3, sem horário de verão), check-in 15:00 de 10/11/2026
 * (= 18:00Z), checkout 11:00 de 12/11/2026 (= 14:00Z). Janela abre em 09/11/2026 18:00:00Z.
 */
const RELEASE = "2026-11-09T18:00:00Z";
const CHECKIN = "2026-11-10T18:00:00Z";
const CLOSE = "2026-11-12T14:00:00Z";

function input(over: {
  now: string;
  reservation?: Partial<CredentialPolicyInput["reservation"]>;
  property?: Partial<CredentialPolicyInput["property"]>;
  checkinCard?: CredentialPolicyInput["checkinCard"];
  late?: CredentialPolicyInput["authorizedLateCheckout"];
}): CredentialPolicyInput {
  return {
    reservation: {
      exists: true,
      status: "confirmed",
      noShow: false,
      checkInDate: "2026-11-10",
      checkOutDate: "2026-11-12",
      checkoutConfirmed: false,
      confirmedCheckoutAt: null,
      ...over.reservation,
    },
    property: { timezone: "America/Sao_Paulo", checkInTime: "15:00", officialCheckOutTime: "11:00", ...over.property },
    checkinCard: over.checkinCard === undefined ? { released: false, noShow: false } : over.checkinCard,
    authorizedLateCheckout: over.late ?? null,
    now: over.now,
  };
}
const plus = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString();
const run = (i: CredentialPolicyInput) => canReleaseCredentials(i);

afterEach(() => vi.useRealTimers());

describe("D9 · janela de 24 horas", () => {
  it("exatamente 24 h antes do check-in oficial local: allow", () => {
    const r = run(input({ now: RELEASE }));
    expect(r).toMatchObject({ decision: "allow", allowed: true, reason: "within_release_window" });
    expect(r.releaseAt).toBe("2026-11-09T18:00:00.000Z");
  });
  it("um segundo antes: deny", () => {
    expect(run(input({ now: plus(RELEASE, -1) }))).toMatchObject({ decision: "deny", allowed: false, reason: "outside_release_window" });
  });
  it("um segundo depois: allow", () => {
    expect(run(input({ now: plus(RELEASE, 1) })).allowed).toBe(true);
  });
  it("bem antes da janela: deny", () => {
    expect(run(input({ now: "2026-11-01T12:00:00Z" })).reason).toBe("outside_release_window");
  });
});

describe("D9 · estadia em andamento e teto de checkout", () => {
  it("estadia ativa, sem no-show e sem checkout confirmado: allow", () => {
    expect(run(input({ now: "2026-11-11T12:00:00Z" })).allowed).toBe(true);
  });
  it("exatamente no horário limite de checkout (janela já aberta): allow", () => {
    expect(run(input({ now: CLOSE }))).toMatchObject({ allowed: true, reason: "within_release_window" });
  });
  it("um segundo após o horário limite: deny", () => {
    expect(run(input({ now: plus(CLOSE, 1) }))).toMatchObject({ allowed: false, reason: "checkout_expired" });
  });
  it("antes do horário oficial de checkout, avaliam-se as demais regras (janela aberta ⇒ allow)", () => {
    expect(run(input({ now: plus(CLOSE, -3600) })).allowed).toBe(true);
  });
  it("late checkout autorizado usa o horário final autorizado", () => {
    const late = { date: "2026-11-12", time: "15:00" }; // 18:00Z
    expect(run(input({ now: plus(CLOSE, 3600), late })).allowed).toBe(true);
    expect(run(input({ now: "2026-11-12T18:00:00Z", late })).allowed).toBe(true);
    expect(run(input({ now: "2026-11-12T18:00:01Z", late })).reason).toBe("checkout_expired");
  });
  it("late checkout sem registro confiável (inválido) não amplia o prazo", () => {
    for (const late of [
      { date: "2026-11-12", time: "25:99" },
      { date: "12/11/2026", time: "15:00" },
      { date: "2026-11-12", time: "" },
    ]) {
      expect(run(input({ now: plus(CLOSE, 60), late })).reason).toBe("checkout_expired");
    }
  });
  it("prazo efetivo = autorização formal ?? oficial (R6): se a autorização vier mais cedo, vale ela (o banco nem aceita aprovar antes do oficial)", () => {
    expect(run(input({ now: plus(CLOSE, -60), late: { date: "2026-11-12", time: "08:00" } })).reason).toBe("checkout_expired");
    expect(run(input({ now: "2026-11-12T10:59:00Z", late: { date: "2026-11-12", time: "08:00" } })).allowed).toBe(true);
  });
  it("late checkout formal não supera no-show, checkout confirmado nem reserva cancelada", () => {
    const late = { date: "2026-11-12", time: "15:00" };
    const now = "2026-11-12T16:00:00Z";
    expect(run(input({ now, late, reservation: { noShow: true } })).reason).toBe("no_show");
    expect(run(input({ now, late, reservation: { checkoutConfirmed: true } })).reason).toBe("checkout_confirmed");
    expect(run(input({ now, late, reservation: { status: "cancelled" } })).reason).toBe("reservation_cancelled");
    expect(run(input({ now, late, property: { timezone: null } })).reason).toBe("missing_timezone");
  });
  it("sem late checkout informado pelo hóspede: o frontend não amplia (a função só aceita o registro)", () => {
    expect(run(input({ now: plus(CLOSE, 60) })).reason).toBe("checkout_expired");
  });
});

describe("D9 · VETO 2 — no-show é absoluto", () => {
  const cases: Array<[string, Parameters<typeof input>[0]]> = [
    ["antes da janela de 24 h", { now: "2026-11-01T12:00:00Z", reservation: { noShow: true } }],
    ["dentro da janela", { now: "2026-11-09T20:00:00Z", reservation: { noShow: true } }],
    ["com cartão liberado manualmente", { now: "2026-11-01T12:00:00Z", reservation: { noShow: true }, checkinCard: { released: true, noShow: false } }],
    ["com estadia aparentemente ativa", { now: "2026-11-11T12:00:00Z", reservation: { noShow: true } }],
    ["marcado só no cartão de check-in", { now: "2026-11-11T12:00:00Z", checkinCard: { released: true, noShow: true } }],
    ["status da reserva equivalente a no-show", { now: "2026-11-11T12:00:00Z", reservation: { status: "no_show" } }],
    ["status 'nao_compareceu'", { now: "2026-11-11T12:00:00Z", reservation: { status: "nao_compareceu" } }],
  ];
  for (const [name, i] of cases) {
    it(`deny: ${name}`, () => {
      expect(run(input(i))).toMatchObject({ decision: "deny", allowed: false, reason: "no_show" });
    });
  }
});

describe("D9 · VETO 3 — checkout confirmado", () => {
  it("checkoutConfirmed: deny", () => {
    expect(run(input({ now: "2026-11-11T12:00:00Z", reservation: { checkoutConfirmed: true } })).reason).toBe("checkout_confirmed");
  });
  it("confirmedCheckoutAt (checkout_confirmed_at/concluded_at) preenchido: deny", () => {
    expect(run(input({ now: "2026-11-11T12:00:00Z", reservation: { confirmedCheckoutAt: "2026-11-11T10:00:00Z" } })).reason).toBe("checkout_confirmed");
  });
  it("checkout confirmado ANTES do horário previsto: deny imediato", () => {
    const r = run(input({ now: "2026-11-11T09:00:00Z", reservation: { confirmedCheckoutAt: "2026-11-11T08:59:00Z" } }));
    expect(r).toMatchObject({ allowed: false, reason: "checkout_confirmed" });
  });
  it("liberação manual após o checkout: deny", () => {
    const r = run(input({ now: "2026-11-01T12:00:00Z", reservation: { checkoutConfirmed: true }, checkinCard: { released: true, noShow: false } }));
    expect(r).toMatchObject({ allowed: false, reason: "checkout_confirmed" });
  });
});

describe("D9 · VETO 1 — reserva", () => {
  it("inexistente: deny", () => {
    expect(run(input({ now: RELEASE, reservation: { exists: false } })).reason).toBe("reservation_invalid");
  });
  it("cancelada (e variantes reais: cancelled_duplicate): deny", () => {
    for (const status of ["cancelled", "cancelled_duplicate", "canceled"]) {
      expect(run(input({ now: RELEASE, reservation: { status } })).reason).toBe("reservation_cancelled");
    }
  });
  it("inválida (bloqueio de calendário, status nulo/desconhecido): deny", () => {
    for (const status of ["blocked", null, "", "banana"]) {
      expect(run(input({ now: RELEASE, reservation: { status } })).reason).toBe("reservation_invalid");
    }
  });
});

describe("D9 · liberação manual (exceção)", () => {
  it("cartão liberado antes da janela: allow", () => {
    expect(run(input({ now: "2026-11-01T12:00:00Z", checkinCard: { released: true, noShow: false } }))).toMatchObject({ allowed: true, reason: "manual_release" });
  });
  it("cartão NÃO liberado antes da janela: deny", () => {
    expect(run(input({ now: "2026-11-01T12:00:00Z", checkinCard: { released: false, noShow: false } })).reason).toBe("outside_release_window");
  });
  it("sem cartão (null) antes da janela: deny", () => {
    expect(run(input({ now: "2026-11-01T12:00:00Z", checkinCard: null })).allowed).toBe(false);
  });
  it("cartão liberado com checkout expirado: deny (não supera o veto 4)", () => {
    expect(run(input({ now: plus(CLOSE, 1), checkinCard: { released: true, noShow: false } })).reason).toBe("checkout_expired");
  });
});

describe("D9 · ordem de precedência dos vetos", () => {
  it("cancelada + no-show ⇒ reservation_cancelled (veto 1 primeiro)", () => {
    expect(run(input({ now: RELEASE, reservation: { status: "cancelled", noShow: true } })).reason).toBe("reservation_cancelled");
  });
  it("no-show + checkout confirmado ⇒ no_show (veto 2 antes do 3)", () => {
    expect(run(input({ now: RELEASE, reservation: { noShow: true, checkoutConfirmed: true } })).reason).toBe("no_show");
  });
  it("checkout confirmado + horário vencido ⇒ checkout_confirmed (veto 3 antes do 4)", () => {
    expect(run(input({ now: plus(CLOSE, 99), reservation: { checkoutConfirmed: true } })).reason).toBe("checkout_confirmed");
  });
  it("no-show vence até a falta de fuso (o veto operacional é informado primeiro)", () => {
    expect(run(input({ now: RELEASE, reservation: { noShow: true }, property: { timezone: null } })).reason).toBe("no_show");
  });
  it("janela aberta + liberação manual ⇒ within_release_window (regra padrão antes da exceção)", () => {
    expect(run(input({ now: RELEASE, checkinCard: { released: true, noShow: false } })).reason).toBe("within_release_window");
  });
});

describe("D9 · fuso horário do imóvel (IANA)", () => {
  // Mesmo relógio local (check-in 15:00 em 10/11/2026) em três fusos: instantes absolutos diferentes.
  const open = (tz: string) => run(input({ now: "2026-11-09T00:00:00Z", property: { timezone: tz } })).releaseAt;
  it("America/Noronha (UTC−2): janela abre 24 h antes de 17:00Z", () => expect(open("America/Noronha")).toBe("2026-11-09T17:00:00.000Z"));
  it("America/Sao_Paulo (UTC−3): janela abre 24 h antes de 18:00Z", () => expect(open("America/Sao_Paulo")).toBe("2026-11-09T18:00:00.000Z"));
  it("America/Manaus (UTC−4): janela abre 24 h antes de 19:00Z", () => expect(open("America/Manaus")).toBe("2026-11-09T19:00:00.000Z"));
  it("fronteira respeita o fuso: 18:00:00Z libera em São Paulo mas NÃO em Manaus", () => {
    const now = "2026-11-09T18:00:00Z";
    expect(run(input({ now, property: { timezone: "America/Sao_Paulo" } })).allowed).toBe(true);
    expect(run(input({ now, property: { timezone: "America/Manaus" } })).allowed).toBe(false);
    expect(run(input({ now, property: { timezone: "America/Noronha" } })).allowed).toBe(true);
  });
  it("o resultado não depende do fuso do servidor nem do relógio do sistema", () => {
    vi.useFakeTimers();
    const outs = ["1999-01-01T00:00:00Z", "2030-06-30T23:59:59Z"].map((sys) => {
      vi.setSystemTime(new Date(sys));
      return run(input({ now: RELEASE }));
    });
    expect(outs[0]).toEqual(outs[1]);
    expect(outs[0]?.evaluatedAt).toBe(RELEASE);
  });
  it("fuso com horário de verão (Europe/Lisbon): janela calculada em instantes absolutos", () => {
    // 10/11/2026 em Lisboa = UTC+0 (WET). 15:00 local = 15:00Z.
    const r = run(input({ now: "2026-11-09T15:00:00Z", property: { timezone: "Europe/Lisbon" } }));
    expect(r).toMatchObject({ allowed: true, releaseAt: "2026-11-09T15:00:00.000Z" });
  });
});

describe("D9 · falhas e ausência de informação (sempre bloqueio)", () => {
  it("timestamp 'now' inválido ou sem fuso (data solta)", () => {
    for (const now of ["", "ontem", "2026-11-10", "2026-11-10T12:00", "2026-13-40T99:00:00Z"]) {
      expect(run(input({ now })).allowed).toBe(false);
    }
    expect(run(input({ now: "ontem" })).reason).toBe("invalid_operational_state");
  });
  it("timezone ausente, inválido ou offset fixo ⇒ missing_timezone", () => {
    for (const timezone of [null, "", "Mars/Phobos", "+03:00", "GMT-3", "BRT"]) {
      expect(run(input({ now: RELEASE, property: { timezone } })).reason).toBe("missing_timezone");
    }
  });
  it("check-in ausente/inválido ⇒ missing_checkin_time", () => {
    expect(run(input({ now: RELEASE, property: { checkInTime: null } })).reason).toBe("missing_checkin_time");
    expect(run(input({ now: RELEASE, property: { checkInTime: "25:00" } })).reason).toBe("missing_checkin_time");
    expect(run(input({ now: RELEASE, reservation: { checkInDate: null } })).reason).toBe("missing_checkin_time");
    expect(run(input({ now: RELEASE, reservation: { checkInDate: "2026-02-30" } })).reason).toBe("missing_checkin_time");
  });
  it("checkout ausente/inválido ⇒ invalid_operational_state", () => {
    expect(run(input({ now: RELEASE, property: { officialCheckOutTime: null } })).reason).toBe("invalid_operational_state");
    expect(run(input({ now: RELEASE, reservation: { checkOutDate: null } })).reason).toBe("invalid_operational_state");
  });
  it("checkout anterior ao check-in (estado inconclusivo) ⇒ deny", () => {
    expect(run(input({ now: RELEASE, reservation: { checkOutDate: "2026-11-09" } })).reason).toBe("invalid_operational_state");
  });
  it("entrada malformada nunca autoriza", () => {
    expect(canReleaseCredentials(null as never).allowed).toBe(false);
    expect(canReleaseCredentials({} as never).allowed).toBe(false);
    expect(canReleaseCredentials({ now: RELEASE, reservation: null, property: null } as never).allowed).toBe(false);
  });
  it("o resultado nunca carrega credenciais nem campos além dos documentados", () => {
    const r = run(input({ now: RELEASE }));
    expect(Object.keys(r).sort()).toEqual(["allowed", "closeAt", "decision", "evaluatedAt", "reason", "releaseAt"]);
  });
});
