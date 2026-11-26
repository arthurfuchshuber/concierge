/**
 * CASO IZABELA (26/11/2026). Hóspede que já se hospedou no Studio 104 (19→22/10) volta pela mesma conversa pedindo
 * "dia 27 ao dia 01". O 104 está ocupado em 27 e 28; o Studio 103 (MESMO proprietário) está livre de 28 a 01; a Suíte
 * do Yasser (OUTRO proprietário da mesma conta) está livre no período inteiro. Antes, a estadia encerrada fazia a IA
 * pular a consulta inteira e ela negou "outra acomodação" sem ter olhado o portfólio.
 */
import { describe, expect, it } from "vitest";
import {
  approximateBookableWindow,
  averageNightly,
  buildOccupancy,
  calendarFactValue,
  extractRequestedPeriod,
  parseStayRules,
} from "@/lib/guest-ai/calendar-occupancy";
import { fetchPropertyOccupancy } from "@/lib/guest-ai/data/property-calendar.server";
import { parseAirbnbCalendarPrices } from "@/lib/airbnb-host-api.server";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";

type Row = Record<string, unknown>;
const TODAY = "2026-11-26";
const RULE = { default_min_nights: 1, day_of_week_min_nights: [-1, -1, -1, -1, -1, -1, -1], max_days_notice: 365, seasonal_min_nights: [] };

function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const f: Array<(r: Row) => boolean> = [];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => (f.push((r) => r[k] === v), q),
        is: (k: string, v: unknown) => (f.push((r) => (r[k] ?? null) === v), q),
        in: (k: string, v: unknown[]) => (f.push((r) => v.includes(r[k])), q),
        gt: (k: string, v: string) => (f.push((r) => String(r[k]) > v), q),
        lt: (k: string, v: string) => (f.push((r) => String(r[k]) < v), q),
        lte: (k: string, v: string) => (f.push((r) => String(r[k]) <= v), q),
        order: () => q,
        limit: () => Promise.resolve({ data: (tables[table] ?? []).filter((r) => f.every((x) => x(r))), error: null }),
        maybeSingle: () => Promise.resolve({ data: (tables[table] ?? []).filter((r) => f.every((x) => x(r)))[0] ?? null, error: null }),
      };
      return q;
    },
  } as never;
}
const prop = (id: string, name: string, owner: string, over: Row = {}): Row => ({
  id,
  name,
  city: "Foz do Iguaçu",
  owner_id: "conta",
  owner_contact_id: owner,
  archived_at: null,
  airbnb_listing_url: null,
  airbnb_guest_count: 4,
  airbnb_bedroom_count: 1,
  ...over,
});
const listing = (property_id: string, id: string): Row => ({ property_id, airbnb_listing_id: id, channex_channel_id: `ch-${property_id}`, sync_paused_at: null, not_found_at: null, availability_rule: RULE });
const res = (property_id: string, ci: string, co: string, over: Row = {}): Row => ({ id: `${property_id}-${ci}`, property_id, status: "confirmed", source: "channex", checkin_date: ci, checkout_date: co, ...over });

const tables = () => ({
  property_chat_messages: [
    { id: "g2", conversation_id: "conv", role: "user", sender_type: "guest", is_internal_note: false, content: "Teria nenhum disponível " },
    { id: "g1", conversation_id: "conv", role: "user", sender_type: "guest", is_internal_note: false, content: "Olá bom dia tem disponibilidade pra dia 27 ao dia 01" },
  ],
  properties: [
    prop("s104", "Studio n° 104 Próximo ao Paraguai", "clayton"),
    prop("s103", "Studio n° 103 Aconchegante Próximo ao Paraguai", "clayton"),
    prop("s102", "Studio n° 102 Aconchegante Próximo ao Paraguai", "clayton"),
    prop("suite", "Suíte em Pousada com Macaquinhos ao Arredor", "yasser"),
    prop("apto", "Apartamento em Foz do Iguaçu!", "yasser", { airbnb_guest_count: 3 }),
  ],
  property_listing_raw_data: [
    listing("s104", "1668252578084352769"),
    listing("s103", "1668251215421954022"),
    listing("s102", "1668250000000000002"),
    listing("suite", "1795797728603849455"),
    listing("apto", "1795797728600000001"),
  ],
  property_reservations: [
    res("s104", "2026-10-19", "2026-10-22", { id: "izabela-out" }),
    res("s104", "2026-11-27", "2026-11-29"),
    res("s103", "2026-11-23", "2026-11-28"),
    res("s102", "2026-11-20", "2026-12-10"),
    res("apto", "2026-11-20", "2026-11-30"),
  ],
});
const turn = () =>
  issue("turn", {
    surface: "airbnb",
    conversationId: "conv",
    messageId: "m",
    propertyId: "s104",
    tenantId: "conta",
    guestSessionId: "airbnb:1",
    conversationStatus: "ai",
    reservationId: "izabela-out",
    guestName: "Izabela Santana",
    messageCreatedAt: null,
  }) as ValidatedTurn;
const PRICES: Record<string, number> = { "1668252578084352769": 230, "1668251215421954022": 230, "1795797728603849455": 153 };
const prices = async (l: { listingId: string }, start: string, end: string) => {
  const m = new Map<string, number>();
  for (let d = start; d <= end; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    if (PRICES[l.listingId]) m.set(d, PRICES[l.listingId]!);
  }
  return m;
};

describe("caso Izabela", () => {
  it("'dia 27 ao dia 01' é 27/11 → 01/12", () => {
    expect(extractRequestedPeriod("Olá bom dia tem disponibilidade pra dia 27 ao dia 01", TODAY)).toEqual({ checkin: "2026-11-27", checkout: "2026-12-01", nights: 4 });
  });

  it("estadia encerrada + datas novas ⇒ nova consulta, com período, data aproximada aqui e portfólio em camadas", async () => {
    const occ = await fetchPropertyOccupancy(turn(), { today: TODAY }, { db: fakeDb(tables()), prices });
    expect(occ.newInquiry).toBe(true);
    expect(occ.stay).toBeNull();
    expect(occ.requested).toMatchObject({ checkin: "2026-11-27", checkout: "2026-12-01", bookable: "nao" });
    expect(occ.approximateHere).toEqual({ checkin: "2026-11-29", checkout: "2026-12-01", nights: 2 });
    expect(occ.ownAvgNightly).toBe(230);
    expect(occ.alternatives).toEqual([
      expect.objectContaining({ propertyId: "s103", tier: "mesmo_proprietario", exact: false, checkin: "2026-11-28", checkout: "2026-12-01", avgNightly: 230 }),
      expect.objectContaining({ propertyId: "suite", tier: "outro_proprietario", exact: true, checkin: "2026-11-27", checkout: "2026-12-01", avgNightly: 153 }),
    ]);
    // o 102 (ocupado) e o apartamento (ocupado e menor) não entram
    expect(occ.alternatives!.some((a) => a.propertyId === "s102" || a.propertyId === "apto")).toBe(false);
    const fact = calendarFactValue(occ) as Record<string, unknown> & { alternativas_portfolio: Array<Record<string, unknown>> };
    expect(fact.nova_consulta).toBe(true);
    expect(fact.portfolio_consultado).toBe("sim");
    expect(fact.datas_aproximadas_neste_imovel).toEqual({ entrada: "2026-11-29", saida: "2026-12-01", noites: 2 });
    expect(fact.alternativas_portfolio[0]).toMatchObject({ camada: "mesmo_proprietario", periodo: "aproximado", link_airbnb: "https://www.airbnb.com.br/rooms/1668251215421954022" });
    expect(fact.alternativas_portfolio[1]).toMatchObject({ camada: "outro_proprietario", periodo: "exato", diaria_media_real: 153 });
    expect(fact).not.toHaveProperty("estadia");
  });

  it("outros proprietários vêm pela diária real mais parecida", async () => {
    const t = tables();
    t.properties.push(prop("cara", "Casa Grande de Luxo", "outra", { airbnb_guest_count: 6 }));
    t.property_listing_raw_data.push(listing("cara", "1795797728600000099"));
    PRICES["1795797728600000099"] = 900;
    const occ = await fetchPropertyOccupancy(turn(), { today: TODAY }, { db: fakeDb(t), prices });
    expect(occ.alternatives!.filter((a) => a.tier === "outro_proprietario").map((a) => a.propertyId)).toEqual(["suite", "cara"]);
    delete PRICES["1795797728600000099"];
  });

  it("sem leitura de preço, nada é estimado (a opção segue, sem diária)", async () => {
    const occ = await fetchPropertyOccupancy(turn(), { today: TODAY }, { db: fakeDb(tables()), prices: null });
    expect(occ.ownAvgNightly).toBeNull();
    expect(occ.alternatives!.every((a) => a.avgNightly === null)).toBe(true);
    const fact = calendarFactValue(occ) as { alternativas_portfolio: Array<Record<string, unknown>> };
    expect(fact.alternativas_portfolio.every((a) => !("diaria_media_real" in a))).toBe(true);
  });

  it("reserva ATIVA pedindo outras datas não vira consulta (pode ser alteração: regra própria)", async () => {
    const t = tables();
    t.property_reservations[0] = res("s104", "2026-11-25", "2026-11-27", { id: "izabela-out" });
    const occ = await fetchPropertyOccupancy(turn(), { today: TODAY }, { db: fakeDb(t), prices });
    expect(occ.newInquiry).toBeUndefined();
    expect(occ.stay).not.toBeNull();
  });

  it("aproximado: menor mudança, noites em comum, nunca no passado", () => {
    const rules = parseStayRules(RULE);
    const occ = buildOccupancy([res("x", "2026-11-27", "2026-11-28") as never], { propertyId: "x", today: TODAY, windowStart: "2026-11-24", windowEnd: "2026-12-04" });
    expect(approximateBookableWindow(occ, { checkin: "2026-11-27", checkout: "2026-12-01", nights: 4 }, rules)).toEqual({ checkin: "2026-11-28", checkout: "2026-12-01", nights: 3 });
    // 1 noite pedida e ocupada: nada aproximado sem noite em comum
    expect(approximateBookableWindow(occ, { checkin: "2026-11-27", checkout: "2026-11-28", nights: 1 }, rules)).toBeNull();
    expect(averageNightly(new Map([["2026-11-28", 200], ["2026-11-29", 300]]), { checkin: "2026-11-28", checkout: "2026-11-30", nights: 2 })).toBe(250);
    expect(averageNightly(new Map([["2026-11-28", 200]]), { checkin: "2026-11-28", checkout: "2026-11-30", nights: 2 })).toBeNull();
  });

  it("leitura das diárias do Airbnb em formatos conhecidos; desconhecido ⇒ nada", () => {
    expect([...parseAirbnbCalendarPrices({ calendar: { days: [{ date: "2026-11-27", daily_price: 230 }, { date: "2026-11-28", price: { local_price: 240 } }] } })!]).toEqual([
      ["2026-11-27", 230],
      ["2026-11-28", 240],
    ]);
    expect([...parseAirbnbCalendarPrices({ calendar_days: [{ date: "2026-11-27", price: { native_price: "153" } }] })!]).toEqual([["2026-11-27", 153]]);
    expect(parseAirbnbCalendarPrices({ foo: 1 })).toBeNull();
  });

  it("prompt: nova consulta, camadas, nunca negar sem consulta, referências curtas e sem 'aqui no Airbnb'", () => {
    const sys = buildSystemPrompt("airbnb", undefined, { phase: "post_checkout" });
    expect(sys).toMatch(/Nova consulta de quem já se hospedou/);
    expect(sys).toMatch(/camada mesmo_proprietario/);
    expect(sys).toMatch(/portfolio_consultado sim e nenhuma alternativa/);
    expect(sys).not.toMatch(/calendário da plataforma/);
  });
});

import { deniesOtherAccommodation } from "@/lib/guest-ai/validation/commitment-text";
describe("rede de segurança: negar portfólio sem fonte", () => {
  it("reconhece as negações do caso e deixa o resto passar", () => {
    expect(deniesOtherAccommodation("não temos outra acomodação livre para essas datas específicas no momento")).toBe(true);
    expect(deniesOtherAccommodation("Não há nenhuma outra opção disponível")).toBe(true);
    expect(deniesOtherAccommodation("Temos o Studio 103 livre de 28 a 1º.")).toBe(false);
    expect(deniesOtherAccommodation("não temos disponibilidade nesses dias no studio")).toBe(false);
  });
});

import { checkReplyAgainstDecision } from "@/lib/guest-ai/validation/commitment-text";
describe("bloqueio no validador do texto", () => {
  const d = (reply: string) => ({ reply, commitmentKinds: [], promisedTimes: [], handoff: { needed: false } }) as never;
  const cal = (alternatives: unknown) => ({ occupiedRanges: [], today: TODAY, windowStart: TODAY, windowEnd: "2026-12-05", alternatives }) as never;
  const ev = { credentialReleaseAllowed: false, lateCheckoutAuthorizedTime: null, humanOwnershipActive: false } as never;
  const txt = "Para essas datas não temos outra acomodação livre.";
  it("sem consulta ao portfólio ou com alternativa livre ⇒ nova tentativa; consultado e vazio ⇒ passa", () => {
    expect(checkReplyAgainstDecision(d(txt), { officialCheckin: null, officialCheckout: null, calendar: cal(null) } as never, ev).blocks).toContain("text_denies_portfolio");
    expect(checkReplyAgainstDecision(d(txt), { officialCheckin: null, officialCheckout: null, calendar: cal([{ name: "Studio n° 103" }]) } as never, ev).blocks).toContain("text_denies_portfolio");
    expect(checkReplyAgainstDecision(d(txt), { officialCheckin: null, officialCheckout: null, calendar: cal([]) } as never, ev).blocks).not.toContain("text_denies_portfolio");
  });
});
