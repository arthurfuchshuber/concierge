/**
 * Calendário do imóvel (11/11/2026, caso Gleison — Casa Completa em Bairro Residencial): o hóspede em consulta
 * pediu para sair às 22h do dia 20; já havia outro check-in confirmado no dia 20 (20 a 22/11). A IA sugeriu
 * reservar até o dia 21 e depois ensinou a tocar no calendário. Aqui: o dado (carregador e fato), a trava do
 * texto (`text_calendar_collision`) e o roteiro.
 */
import { describe, expect, it } from "vitest";
import { addDays, buildOccupancy, findCalendarCollisions, isNightOccupied, localDate, type CalendarRow } from "@/lib/guest-ai/calendar-occupancy";
import { fetchPropertyOccupancy } from "@/lib/guest-ai/data/property-calendar.server";
import { RESERVATION_COLUMNS } from "@/lib/guest-ai/data/projections";
import { checkReplyAgainstDecision } from "@/lib/guest-ai/validation/commitment-text";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { personaPrinciples, renderPersona } from "@/lib/guest-ai/persona";
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { v3 } from "./helpers/b23-chain";

const P = "prop-casa";
const TODAY = "2026-11-11";
const row = (over: Partial<CalendarRow>): CalendarRow => ({ id: "r", property_id: P, status: "confirmed", source: "channex", checkin_date: null, checkout_date: null, ...over });
const GLEISON_ROWS: CalendarRow[] = [
  row({ id: "a", checkin_date: "2026-11-10", checkout_date: "2026-11-13" }),
  row({ id: "b", checkin_date: "2026-11-14", checkout_date: "2026-11-17" }),
  row({ id: "alana", checkin_date: "2026-11-20", checkout_date: "2026-11-22" }),
];
const occGleison = buildOccupancy(GLEISON_ROWS, { propertyId: P, today: TODAY });
const occFree = buildOccupancy(GLEISON_ROWS.filter((r) => r.id !== "alana"), { propertyId: P, today: TODAY });
const collides = (reply: string, occ = occGleison) => findCalendarCollisions(reply, occ);

describe("núcleo puro: ocupação", () => {
  it("noites [entrada, saída); virada no mesmo dia = check-in confirmado de outra reserva", () => {
    expect(isNightOccupied(occGleison, "2026-11-19")).toBe(false);
    expect(isNightOccupied(occGleison, "2026-11-20")).toBe(true);
    expect(isNightOccupied(occGleison, "2026-11-21")).toBe(true);
    expect(isNightOccupied(occGleison, "2026-11-22")).toBe(false);
    expect(occGleison.sameDayTurnovers).toEqual(["2026-11-14", "2026-11-20"]);
    expect(occGleison.windowEnd).toBe(addDays(TODAY, 60));
  });

  it("mesma regra da Channex: bloqueio só manual; iCal histórico, cancelada e duplicada não ocupam; a própria reserva não conta", () => {
    const occ = buildOccupancy(
      [
        row({ id: "x", status: "blocked", source: "airbnb", checkin_date: "2026-11-25", checkout_date: "2026-11-26" }),
        row({ id: "y", status: "blocked", source: "manual", checkin_date: "2026-11-27", checkout_date: "2026-11-28" }),
        row({ id: "z", status: "cancelled", checkin_date: "2026-11-29", checkout_date: "2026-11-30" }),
        row({ id: "w", status: "cancelled_duplicate", checkin_date: "2026-11-30", checkout_date: "2026-12-01" }),
        row({ id: "mine", checkin_date: "2026-12-02", checkout_date: "2026-12-04" }),
        row({ id: "other", property_id: "outro", checkin_date: "2026-12-05", checkout_date: "2026-12-06" }),
        row({ id: "past", checkin_date: "2026-11-01", checkout_date: "2026-11-05" }),
      ],
      { propertyId: P, today: TODAY, excludeReservationId: "mine" },
    );
    expect(occ.occupiedRanges).toEqual([{ checkin: "2026-11-27", checkout: "2026-11-28", status: "blocked" }]);
    expect(occ.sameDayTurnovers).toEqual([]);
  });

  it("hoje no fuso do imóvel", () => {
    expect(localDate("2026-11-12T02:30:00Z", "America/Sao_Paulo")).toBe("2026-11-11");
    expect(localDate("2026-11-12T02:30:00Z", null)).toBeNull();
  });
});

describe("carregador: projeção fechada, imóvel do turno, janela de 60 dias", () => {
  it("lê só RESERVATION_COLUMNS (sem PII) e filtra por imóvel, status e janela", async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const q: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["select", "eq", "in", "gt", "lte", "order", "limit"]) q[m] = (...a: unknown[]) => (calls.push([m, ...a]), q);
    (q as unknown as { then: unknown }).then = (res: (v: unknown) => void) => res({ data: GLEISON_ROWS, error: null });
    const db = { from: (t: string) => (calls.push(["from", t]), q) } as never;
    const turn = issue("turn", { surface: "airbnb", conversationId: "c", messageId: "m", propertyId: P, tenantId: "t", guestSessionId: "airbnb:1", conversationStatus: "ai", reservationId: null, guestName: null, messageCreatedAt: null }) as ValidatedTurn;
    const occ = await fetchPropertyOccupancy(turn, { today: TODAY }, { db });
    expect(calls).toContainEqual(["from", "property_reservations"]);
    expect(calls).toContainEqual(["select", RESERVATION_COLUMNS.join(", ")]);
    expect(calls).toContainEqual(["eq", "property_id", P]);
    expect(calls).toContainEqual(["in", "status", ["confirmed", "blocked"]]);
    expect(calls).toContainEqual(["gt", "checkout_date", TODAY]);
    expect(calls).toContainEqual(["lte", "checkin_date", addDays(TODAY, 60)]);
    expect(occ.sameDayTurnovers).toContain("2026-11-20");
    await expect(fetchPropertyOccupancy({ ...turn } as never, { today: TODAY }, { db })).rejects.toThrow();
  });
});

describe("trava do texto: sugerir noite ocupada ⇒ text_calendar_collision", () => {
  it("a) caso Gleison: sugerir reservar até o dia 21 (outro check-in no dia 20) é bloqueado", () => {
    const bad = "Para sair às 22h, o ideal é reservar incluindo a diária com saída no dia 21.";
    expect(collides(bad)).toEqual(["2026-11-20"]);
    const check = checkReplyAgainstDecision(v3({ reply: bad }) as never, { officialCheckin: null, officialCheckout: null, calendar: occGleison }, {
      credentialReleaseAllowed: false,
      lateCheckoutAuthorizedTime: null,
      humanOwnershipActive: false,
    });
    expect(check.blocks).toContain("text_calendar_collision");
  });

  it("a) resposta correta passa: informa o outro check-in e o horário oficial; reservar até o dia 20 é livre", () => {
    const good =
      "No dia 20 já há outro check-in programado na casa, então não é possível estender: a saída precisa ser pontual às 11h, para a preparação do espaço. Se der para sair às 11h, é só reservar normalmente até o dia 20.";
    expect(collides(good)).toEqual([]);
  });

  it("b) calendário livre: orientar a incluir a diária até o dia 21 passa", () => {
    expect(collides("Para ficar até as 22h, é preciso incluir na reserva a diária com saída no dia 21; sem isso, a saída é às 11h.", occFree)).toEqual([]);
  });

  it("c) tentativa bloqueada: tutorial para selecionar o dia 21 ocupado é bloqueado; informar a indisponibilidade passa", () => {
    expect(collides("Para selecionar o dia 21, toque na data no calendário do app e confirme.")).toEqual(["2026-11-21"]);
    expect(collides("O dia 21 não está disponível no calendário: já existe outra reserva nessa data.")).toEqual([]);
  });

  it("datas em outros formatos e fora da janela", () => {
    expect(collides("Pode reservar a noite de 21/11 sem problema.")).toEqual(["2026-11-21"]);
    expect(collides("Você pode reservar a partir de 20 de novembro.")).toEqual(["2026-11-20"]);
    expect(collides("Pode reservar o dia 25.")).toEqual([]);
    expect(findCalendarCollisions("Pode reservar até o dia 21.", null)).toEqual([]);
  });
});

describe("roteiro e persona", () => {
  const sys = buildSystemPrompt("airbnb");
  it("consulta obrigatória, extensão só alterando a reserva, virada no mesmo dia e data bloqueada", () => {
    expect(sys).toMatch(/Consulta obrigatória do calendário/);
    expect(sys).toMatch(/ctx:calendario_ocupacao/);
    expect(sys).toMatch(/inclua formalmente a diária correspondente na própria reserva/);
    expect(sys).toMatch(/naquela data já há outro check-in programado na casa/);
    expect(sys).toMatch(/nunca ensine a tocar no aplicativo antes disso/);
    expect(sys).toMatch(/text_calendar_collision/);
    expect(sys).toMatch(/nunca garanta disponibilidade/);
  });
  it("persona: calendar_rigor", () => {
    expect(personaPrinciples().map((p) => p.id)).toContain("calendar_rigor");
    expect(renderPersona()).toMatch(/base estrita no calendário real/);
  });
});
