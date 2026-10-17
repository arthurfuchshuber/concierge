import { describe, expect, it } from "vitest";
import { isCheckinReleased, withinAccessWindow, parseAgreedCheckout, parseAgreedTime } from "@/lib/ai/stay-access.server";
import { accessGuidanceText, decideAccess } from "@/lib/ai/access-guidance.server";
import { followUpDelayMs, followUpText } from "@/lib/ai/stalled-replies.server";

describe("check-in liberado = botão verde do card", () => {
  const base = { today: "2026-10-17", checkin: "2026-10-17", checkinDone: false, openTurnoverCheckouts: [] as string[] };
  it("data chegou e sem turnover: liberado", () => expect(isCheckinReleased(base)).toBe(true));
  it("data futura: não liberado", () => expect(isCheckinReleased({ ...base, checkin: "2026-10-18" })).toBe(false));
  it("saída anterior pendente (hoje ou antes): não liberado", () => {
    expect(isCheckinReleased({ ...base, openTurnoverCheckouts: ["2026-10-17"] })).toBe(false);
    expect(isCheckinReleased({ ...base, openTurnoverCheckouts: ["2026-10-15"] })).toBe(false);
  });
  it("saída futura de outra estadia não trava", () => expect(isCheckinReleased({ ...base, openTurnoverCheckouts: ["2026-10-20"] })).toBe(true));
  it("check-in já feito: liberado mesmo com pendência antiga", () =>
    expect(isCheckinReleased({ ...base, checkinDone: true, openTurnoverCheckouts: ["2026-10-10"] })).toBe(true));
});

describe("decisão de acesso (regras do anfitrião, 17/10)", () => {
  const d = (isCheckinDay: boolean, early: boolean, released: boolean, hasTeamAnswer = false) =>
    decideAccess({ isCheckinDay, early, released, hasTeamAnswer });
  it("dia do check-in, antes do horário, card NÃO liberado: entrega reforçando, sem equipe", () =>
    expect(d(true, true, false)).toBe("deliver_not_released"));
  it("dia do check-in, antes do horário, card liberado: confirma com a equipe", () =>
    expect(d(true, true, true)).toBe("confirm_early"));
  it("horário passou e card liberado: é só seguir, sem equipe", () => expect(d(true, false, true)).toBe("deliver"));
  it("horário passou e card NÃO liberado: entrega e informa a equipe sobre o atraso", () =>
    expect(d(true, false, false)).toBe("report_delay"));
  it("estadia em andamento (outro dia) e card liberado: entrega", () => expect(d(false, false, true)).toBe("deliver"));
  it("resposta da equipe na conversa destrava a entrega", () => {
    expect(d(true, true, true, true)).toBe("deliver");
    expect(d(true, false, false, true)).toBe("deliver");
  });
});

describe("orientação de acesso ao modelo", () => {
  const t = { isCheckinDay: true, early: true, allowed: "15:00", staff: null, checkoutOverdue: false, minutesLate: 0, checkoutLimit: null };
  it("antes do horário e não liberado: pode entregar, reforçando que o check-in ainda não foi liberado", () => {
    const g = accessGuidanceText(t, false, "deliver_not_released");
    expect(g).toMatch(/PODE entregar/);
    expect(g).toMatch(/ainda não foi liberado/);
    expect(g).toMatch(/Não acione a equipe/);
  });
  it("antes do horário e liberado: entrega ciente e confirma com a equipe em paralelo", () => {
    const g = accessGuidanceText(t, false, "confirm_early");
    expect(g).toMatch(/PODE entregar/);
    expect(g).toMatch(/request_human_handoff/);
    expect(g).not.toMatch(/NÃO envie senha/);
  });
  it("horário passou e travado: informa o atraso na liberação à equipe", () => {
    const g = accessGuidanceText({ ...t, early: false }, false, "report_delay");
    expect(g).toMatch(/ATRASO NA LIBERAÇÃO/);
    expect(g).toMatch(/request_human_handoff/);
    expect(g).toMatch(/PODE entregar/);
    expect(g).toMatch(/SENTIMENTO/);
    expect(g).not.toMatch(/NÃO envie senha/);
  });
  it("horário passou e liberado: segue as instruções sem equipe", () => {
    const g = accessGuidanceText({ ...t, early: false }, false, "deliver");
    expect(g).toMatch(/sem acionar a equipe/);
  });
});

describe("acompanhamento único com a equipe", () => {
  it("10 min para acesso/problema/urgência alta, 30 para o resto", () => {
    expect(followUpDelayMs("Incidente de acesso físico", "normal")).toBe(10 * 60_000);
    expect(followUpDelayMs("chuveiro não funciona", "normal")).toBe(10 * 60_000);
    expect(followUpDelayMs("pergunta sobre cortesia", "high")).toBe(10 * 60_000);
    expect(followUpDelayMs("dúvida sobre nota fiscal", "normal")).toBe(30 * 60_000);
  });
  it("texto honesto: sem prazo e sem promessa de ação da IA", () => {
    for (let i = 0; i < 2; i += 1) {
      const t = followUpText("Pedro", "pt", i);
      expect(t).toMatch(/equipe/i);
      expect(t).toMatch(/por aqui/i);
      expect(t).not.toMatch(/\d+ ?min|vou (verificar|checar|confirmar)|em breve/i);
    }
  });
});

import { checkoutLateness } from "@/lib/ai/access-guidance.server";

describe("check-out atrasado", () => {
  const tz = "America/Sao_Paulo"; // UTC-3
  const mk = (iso: string) => Date.parse(iso);
  it("antes do limite: não atrasado", () => {
    const r = checkoutLateness({ nowMs: mk("2026-10-17T13:00:00Z"), checkoutDate: "2026-10-17", checkoutTime: "11:00:00", tz });
    expect(r.overdue).toBe(false);
    expect(r.label).toBe("11:00");
  });
  it("40 min depois do limite: atrasado", () => {
    const r = checkoutLateness({ nowMs: mk("2026-10-17T14:40:00Z"), checkoutDate: "2026-10-17", checkoutTime: "11:00", tz });
    expect(r.overdue).toBe(true);
    expect(r.minutesLate).toBe(40);
  });
  it("sem data ou horário: nunca atrasado", () => {
    expect(checkoutLateness({ nowMs: Date.now(), checkoutDate: null, checkoutTime: "11:00", tz }).overdue).toBe(false);
    expect(checkoutLateness({ nowMs: Date.now(), checkoutDate: "2026-10-17", checkoutTime: null, tz }).overdue).toBe(false);
  });
  it("orientação de check-out atrasado informa hóspede e equipe com sentimento", () => {
    const g = accessGuidanceText(
      { isCheckinDay: false, early: false, allowed: null, staff: null, checkoutOverdue: true, minutesLate: 40, checkoutLimit: "11:00" },
      false,
      "deliver",
    );
    expect(g).toContain("CHECK-OUT ATRASADO");
    expect(g).toContain("SENTIMENTO");
    expect(g).toContain("request_human_handoff");
  });
});

describe("janela de acesso: check-in até 1 h após o check-out", () => {
  const tz = "America/Sao_Paulo"; // UTC-3
  const base = { checkin: "2026-10-15", checkout: "2026-10-17", checkoutTime: "11:00", tz };
  const at = (iso: string) => ({ today: "2026-10-17", nowMs: Date.parse(iso) });
  it("antes do check-in: fechado", () =>
    expect(withinAccessWindow({ ...base, today: "2026-10-14", nowMs: Date.parse("2026-10-14T15:00:00Z") })).toBe(false));
  it("dentro de 1 h após o horário padrão: aberto", () =>
    expect(withinAccessWindow({ ...base, ...at("2026-10-17T14:30:00Z") })).toBe(true)); // 11:30 local
  it("passou de 1 h após o padrão: fechado", () =>
    expect(withinAccessWindow({ ...base, ...at("2026-10-17T15:30:00Z") })).toBe(false)); // 12:30 local
  it("check-out tardio alinhado (14:00): aberto até 15:00", () => {
    expect(withinAccessWindow({ ...base, agreedCheckoutTime: "14:00", ...at("2026-10-17T17:30:00Z") })).toBe(true); // 14:30
    expect(withinAccessWindow({ ...base, agreedCheckoutTime: "14:00", ...at("2026-10-17T18:30:00Z") })).toBe(false); // 15:30
  });
  it("horário alinhado mais cedo que o padrão não encurta a janela", () =>
    expect(withinAccessWindow({ ...base, agreedCheckoutTime: "09:00", ...at("2026-10-17T14:30:00Z") })).toBe(true));
  it("check-out às 23h: janela atravessa a meia-noite", () =>
    expect(withinAccessWindow({ ...base, checkoutTime: "23:00", today: "2026-10-18", nowMs: Date.parse("2026-10-18T02:30:00Z") })).toBe(true)); // 23:30 local
  it("sem horário configurado: regra por data", () => {
    expect(withinAccessWindow({ ...base, checkoutTime: null, ...at("2026-10-17T23:00:00Z") })).toBe(true);
    expect(withinAccessWindow({ ...base, checkoutTime: null, today: "2026-10-18", nowMs: Date.parse("2026-10-18T12:00:00Z") })).toBe(false);
  });
});

describe("check-out tardio alinhado em mensagem da equipe", () => {
  const msg = (texto: string) => [{ texto }];
  it("equipe autoriza saída até as 14h", () =>
    expect(parseAgreedCheckout(msg("Combinado! Pode fazer o check-out até as 14h."), "11:00")).toBe("14:00"));
  it("aceita 13:30", () =>
    expect(parseAgreedCheckout(msg("Tudo bem, a saída pode ser às 13:30."), "11:00:00")).toBe("13:30"));
  it("pergunta não conta", () =>
    expect(parseAgreedCheckout(msg("Pode sair até as 14h?"), "11:00")).toBeNull());
  it("recusa não conta", () =>
    expect(parseAgreedCheckout(msg("Não dá para o check-out às 14h, desculpe."), "11:00")).toBeNull());
  it("horário igual ou anterior ao padrão não conta", () =>
    expect(parseAgreedCheckout(msg("Ok, check-out às 11h."), "11:00")).toBeNull());
  it("mensagem sem saída não conta", () =>
    expect(parseAgreedCheckout(msg("Pode entrar às 14h, tudo bem."), "11:00")).toBeNull());
});

describe("rótulo das senhas", () => {
  it("códigos de acesso são 'senha temporária'; Wi-Fi não", () => {
    const g = accessGuidanceText(null, false, "deliver");
    expect(g).toMatch(/senha temporária do cadeado cofre é 0000/);
    expect(g).toMatch(/Wi-Fi/);
  });
});

import { forecastAllowed } from "@/lib/ai/stay-intent-resolver.server";

describe("previsão conduzida pela IA: só dentro do permitido ou alinhada", () => {
  it("check-out até o limite: ok", () => expect(forecastAllowed({ kind: "checkout", time: "10:30", standard: "11:00:00" }).ok).toBe(true));
  it("check-out depois do limite sem alinhamento: recusa e informa o permitido", () => {
    const r = forecastAllowed({ kind: "checkout", time: "14:00", standard: "11:00" });
    expect(r.ok).toBe(false);
    expect(r.permitido).toBe("11:00");
  });
  it("check-out depois do limite com alinhamento até 14h: ok; 15h não", () => {
    expect(forecastAllowed({ kind: "checkout", time: "14:00", standard: "11:00", agreed: "14:00" }).ok).toBe(true);
    expect(forecastAllowed({ kind: "checkout", time: "15:00", standard: "11:00", agreed: "14:00" }).ok).toBe(false);
  });
  it("check-in antes do permitido: recusa; alinhado: ok", () => {
    expect(forecastAllowed({ kind: "checkin", time: "10:00", standard: "15:00" }).ok).toBe(false);
    expect(forecastAllowed({ kind: "checkin", time: "12:00", standard: "15:00", agreed: "12:00" }).ok).toBe(true);
    expect(forecastAllowed({ kind: "checkin", time: "16:00", standard: "15:00" }).ok).toBe(true);
  });
  it("sem horário configurado: não há regra a violar", () =>
    expect(forecastAllowed({ kind: "checkout", time: "20:00", standard: null }).ok).toBe(true));
  it("entrada antecipada autorizada pela equipe é lida da mensagem", () => {
    expect(parseAgreedTime("checkin", [{ texto: "Pode sim, liberamos a entrada antecipada às 12h." }], "15:00")).toBe("12:00");
    expect(parseAgreedTime("checkin", [{ texto: "Check-in só às 15h, tudo bem?" }], "15:00")).toBeNull();
  });
});
