/**
 * CONSULTA VISÍVEL À IA (15/11/2026, caso Lauriete): o evento `inquiry` da Channex (channex_raw_records,
 * entity_type webhook:inquiry) traz período, hóspedes e valor. Leitura → contexto → fatos do compositor → calendário.
 */
import { describe, expect, it } from "vitest";
import { composeTurnPrompt } from "@/lib/guest-ai/composer";
import { fetchPropertyOccupancy } from "@/lib/guest-ai/data/property-calendar.server";
import { issue } from "@/lib/guest-ai/trust";
import { buildSystemPrompt } from "@/lib/guest-ai/system-prompt";
import { normalizeHistory } from "@/lib/guest-ai/history";
import type { InquiryDetails, ValidatedTurn } from "@/lib/guest-ai/types";
import { loadInquiryDetails, parseInquiryPayload, threadIdFromSession } from "@/lib/guest-ai-inquiry/store.server";
import { conversationContext, CONV, MSG, row, TEST_GUARD } from "./helpers/b21-fixtures";

const THREAD = "bfd6ee9a-e2b9-43ab-bf3b-41b830d2711f";
const event = (payout: string, extra: Record<string, unknown> = {}) => ({
  payload: {
    message_thread_id: THREAD,
    status: "active",
    booking_details: {
      checkin_date: "2026-12-03",
      checkout_date: "2026-12-07",
      nights: 4,
      number_of_guests: 4,
      number_of_adults: 3,
      number_of_children: 1,
      number_of_infants: 0,
      number_of_pets: 0,
      payout_amount: payout,
      currency: "BRL",
      ...extra,
    },
  },
});

describe("parseInquiryPayload", () => {
  it("converte o evento real: datas, pessoas e repasse (string → número)", () => {
    expect(parseInquiryPayload(event("1633.29"), "2026-11-15T14:12:00Z")).toEqual({
      checkinDate: "2026-12-03",
      checkoutDate: "2026-12-07",
      nights: 4,
      guests: 4,
      adults: 3,
      children: 1,
      infants: 0,
      pets: 0,
      payoutAmount: 1633.29,
      currency: "BRL",
      status: "active",
      receivedAt: "2026-11-15T14:12:00Z",
    });
  });
  it("sem datas válidas/coerentes ⇒ null; campos soltos viram null", () => {
    expect(parseInquiryPayload(null)).toBeNull();
    expect(parseInquiryPayload({ payload: {} })).toBeNull();
    expect(parseInquiryPayload(event("1", { checkin_date: "2026-12-07", checkout_date: "2026-12-03" }))).toBeNull();
    expect(parseInquiryPayload(event("1", { checkin_date: "03/12/2026" }))).toBeNull();
    const q = parseInquiryPayload(event("abc", { number_of_guests: "x", currency: null }))!;
    expect(q.payoutAmount).toBeNull();
    expect(q.guests).toBeNull();
    expect(q.currency).toBeNull();
  });
});

describe("threadIdFromSession", () => {
  it("só airbnb:<uuid>", () => {
    expect(threadIdFromSession(`airbnb:${THREAD}`)).toBe(THREAD);
    expect(threadIdFromSession("wa:5511999999999")).toBeNull();
    expect(threadIdFromSession(null)).toBeNull();
  });
});

describe("loadInquiryDetails", () => {
  const fake = (rows: unknown[] | null, error: unknown = null) => {
    const calls: Array<[string, unknown, unknown?]> = [];
    const q: Record<string, unknown> = {
      select: (c: string) => (calls.push(["select", c]), q),
      eq: (k: string, v: unknown) => (calls.push(["eq", k, v]), q),
      order: (k: string, o: unknown) => (calls.push(["order", k, o]), q),
      limit: () => Promise.resolve({ data: rows, error }),
    };
    return { calls, db: { from: (t: string) => (calls.push(["from", t]), q) } };
  };
  it("lê o evento MAIS RECENTE da thread (webhook:inquiry, first_seen_at desc)", async () => {
    const { db, calls } = fake([{ payload: event("1633.29"), first_seen_at: "2026-11-15T14:12:00Z" }]);
    const q = await loadInquiryDetails(db, `airbnb:${THREAD}`);
    expect(q?.payoutAmount).toBe(1633.29);
    expect(calls).toContainEqual(["from", "channex_raw_records"]);
    expect(calls).toContainEqual(["eq", "entity_type", "webhook:inquiry"]);
    expect(calls).toContainEqual(["eq", "payload->payload->>message_thread_id", THREAD]);
    expect(calls).toContainEqual(["order", "first_seen_at", { ascending: false }]);
  });
  it("sem registro, erro, thread inválida ou exceção ⇒ null (nunca presume)", async () => {
    expect(await loadInquiryDetails(fake([]).db, `airbnb:${THREAD}`)).toBeNull();
    expect(await loadInquiryDetails(fake(null, { message: "x" }).db, `airbnb:${THREAD}`)).toBeNull();
    expect(await loadInquiryDetails(fake([]).db, "wa:1")).toBeNull();
    expect(await loadInquiryDetails({ from: () => { throw new Error("boom"); } }, `airbnb:${THREAD}`)).toBeNull();
  });
});

const INQ: InquiryDetails = {
  checkinDate: "2026-12-03", checkoutDate: "2026-12-07", nights: 4, guests: 4, adults: 3, children: 1, infants: 0, pets: 0,
  payoutAmount: 1633.29, currency: "BRL", status: "active", receivedAt: null,
};
const compose = (inquiry: InquiryDetails | null) => {
  const context = conversationContext({ phase: "inquiry", stay: null, audiences: ["P"] });
  context.guest = { ...context.guest, inquiry } as never;
  const history = normalizeHistory([row({ id: MSG, created_at: "2026-11-03T10:00:00.000000+00:00", content: "Olá, tudo bem?" })], { conversationId: CONV, currentMessageId: MSG });
  const r = composeTurnPrompt({ context, history }, { guard: TEST_GUARD });
  if (r.kind !== "prompt") throw new Error(r.kind);
  return r.prompt.messages[0]!.content as string;
};

describe("fatos do compositor", () => {
  it("com a consulta: período, hóspedes e valor (como repasse ao anfitrião)", () => {
    const u = compose(INQ);
    expect(u).toContain('"id":"ctx:consulta_periodo"');
    expect(u).toContain('"checkin":"2026-12-03"');
    expect(u).toContain('"noites":4');
    expect(u).toContain('"id":"ctx:consulta_hospedes"');
    expect(u).toContain('"adultos":3');
    expect(u).toContain('"criancas":1');
    expect(u).toContain('"id":"ctx:consulta_valor"');
    expect(u).toContain("repasse_ao_anfitriao");
  });
  it("sem a consulta: nenhum fato ctx:consulta_*; sem valor: só período e hóspedes", () => {
    expect(compose(null)).not.toContain("ctx:consulta_");
    const u = compose({ ...INQ, payoutAmount: null });
    expect(u).toContain("ctx:consulta_periodo");
    expect(u).not.toContain("ctx:consulta_valor");
  });
  it("o prompt do sistema manda usar os fatos e não citar o repasse como preço", () => {
    const s = buildSystemPrompt("airbnb");
    expect(s).toContain("ctx:consulta_periodo");
    expect(s).toContain("ctx:consulta_hospedes");
    expect(s).toContain("ctx:consulta_valor");
    expect(s).toMatch(/NÃO o preço final pago pelo hóspede/);
  });
});

describe("calendário com o período da consulta", () => {
  const P = "studio-101";
  const turn = issue("turn", { surface: "airbnb", conversationId: "conv", messageId: "m", propertyId: P, tenantId: "t", guestSessionId: `airbnb:${THREAD}`, conversationStatus: "ai", reservationId: null, guestName: null, messageCreatedAt: null }) as ValidatedTurn;
  const fakeDb = (reservations: Array<Record<string, unknown>>) => {
    const q = (table: string) => {
      const f: Array<[string, string, unknown]> = [];
      const match = () => (table === "property_reservations" ? reservations : []).filter((r) => f.every(([op, k, v]) => (op === "eq" ? r[k] === v : op === "in" ? (v as unknown[]).includes(r[k]) : op === "gt" ? String(r[k]) > String(v) : op === "lt" ? String(r[k]) < String(v) : op === "lte" ? String(r[k]) <= String(v) : true)));
      const o: Record<string, unknown> = {
        select: () => o,
        eq: (k: string, v: unknown) => (f.push(["eq", k, v]), o),
        neq: () => o,
        in: (k: string, v: unknown) => (f.push(["in", k, v]), o),
        gt: (k: string, v: unknown) => (f.push(["gt", k, v]), o),
        lt: (k: string, v: unknown) => (f.push(["lt", k, v]), o),
        lte: (k: string, v: unknown) => (f.push(["lte", k, v]), o),
        order: () => o,
        limit: () => Promise.resolve({ data: match(), error: null }),
        maybeSingle: () => Promise.resolve({ data: match()[0] ?? null, error: null }),
      };
      return o;
    };
    return { from: (t: string) => q(t) } as never;
  };
  const res = (id: string, ci: string, co: string) => ({ id, property_id: P, status: "confirmed", source: "channex", checkin_date: ci, checkout_date: co });

  it("sem mensagem com datas, o período da consulta é avaliado (ocupado ⇒ não reservável)", async () => {
    const occ = await fetchPropertyOccupancy(turn, { today: "2026-11-15", guestTexts: ["Olá, tudo bem?"], inquiryPeriod: { checkin: "2026-12-03", checkout: "2026-12-07", nights: 4 } }, { db: fakeDb([res("x", "2026-12-05", "2026-12-08")]) });
    expect(occ.requested?.bookable).toBe("nao");
    expect(occ.windowStart <= "2026-12-03" && occ.windowEnd >= "2026-12-06").toBe(true);
  });
  it("livre ⇒ reservável; sem inquiryPeriod nada muda", async () => {
    const livre = await fetchPropertyOccupancy(turn, { today: "2026-11-15", guestTexts: ["Olá"], inquiryPeriod: { checkin: "2026-12-03", checkout: "2026-12-07", nights: 4 } }, { db: fakeDb([]) });
    expect(livre.requested?.bookable).not.toBe("nao");
    const sem = await fetchPropertyOccupancy(turn, { today: "2026-11-15", guestTexts: ["Olá"] }, { db: fakeDb([]) });
    expect(sem.requested).toBeUndefined();
  });
});
