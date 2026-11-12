/**
 * Diretiva de 12/11/2026 — coerência, rajada, portfólio e silêncio (casos Tais, Carlos Eduardo, Juan, Carlos, Ary).
 *
 * Tais (Studio 105, consulta): "Oie" → "Bom dia" → "Desculpa a demora" → "Dia 18 vc tem disponibilidade?" →
 * "Seria apenas uma noite, chego dia 18 e saiu no dia 19". A IA cumprimentou três vezes repetindo a mesma oferta
 * vazia e, nas duas perguntas de datas, mandou a frase de contingência. Fato real: a noite de 18 está LIVRE no
 * calendário, mas o anúncio exige mínimo de 2 noites para chegada em 18/11 (por isso ela via "indisponível").
 */
import { describe, expect, it } from "vitest";
import { isDuplicateRecentReply } from "@/lib/chat/burst-guard";
import { toAirbnbPlainText } from "@/lib/channex-messages.server";
import { formatForChannel } from "@/lib/guest-ai/copilot/channel-format";
import { isCheckoutDoneNotice, isFarewell, isPureGreeting, shouldSilenceBareAck } from "@/lib/guest-ai/ack-silence";
import type { HistoryEntry } from "@/lib/guest-ai/history";
import {
  assessPeriod,
  buildOccupancy,
  calendarFactValue,
  extractRequestedPeriod,
  minNightsFor,
  parseStayRules,
} from "@/lib/guest-ai/calendar-occupancy";
import { fetchPropertyOccupancy, listingUrl } from "@/lib/guest-ai/data/property-calendar.server";
import { COMMERCIAL_CONTINGENCY_REASON, CONTINGENCY_REPLY, isCommercialQuestion, requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from "@/lib/guest-ai/system-prompt";
import { PERSONA_VERSION } from "@/lib/guest-ai/persona";
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";

const TODAY = "2026-11-12";

/** Regra real do Studio 105 (recorte de `raw_settings.availability_rule`, 12/11/2026). */
const RULE_105 = {
  default_min_nights: 2,
  day_of_week_min_nights: [-1, -1, -1, -1, -1, -1, -1],
  max_days_notice: 270,
  seasonal_min_nights: [
    { start_date: "2026-11-02", end_date: "2026-11-18", min_nights: 2 },
    { start_date: "2026-11-19", end_date: "2026-11-21", min_nights: 3 },
  ],
};
const RULE_1_NIGHT = { default_min_nights: 1, day_of_week_min_nights: [-1, -1, -1, -1, -1, -1, -1], max_days_notice: 365, seasonal_min_nights: [] };

// ─────────────── 1. rajada e duplicata ───────────────
describe("trava de duplicata no Airbnb", () => {
  const now = Date.parse("2026-11-12T14:35:20Z");
  it("mesmo texto da última mensagem nossa em menos de 60 s ⇒ não reenvia (as duas contingências da Tais)", () => {
    expect(isDuplicateRecentReply({ content: CONTINGENCY_REPLY, created_at: "2026-11-12T14:34:47Z" }, CONTINGENCY_REPLY, now)).toBe(true);
  });
  it("texto diferente, mais de 60 s ou sem mensagem anterior ⇒ envia", () => {
    expect(isDuplicateRecentReply({ content: "Outra coisa", created_at: "2026-11-12T14:35:00Z" }, CONTINGENCY_REPLY, now)).toBe(false);
    expect(isDuplicateRecentReply({ content: CONTINGENCY_REPLY, created_at: "2026-11-12T14:33:00Z" }, CONTINGENCY_REPLY, now)).toBe(false);
    expect(isDuplicateRecentReply(null, CONTINGENCY_REPLY, now)).toBe(false);
  });
});

describe("link do anúncio do Airbnb atravessa a limpeza do canal (só ele)", () => {
  const url = "https://www.airbnb.com.br/rooms/1793590014642613896";
  it("toAirbnbPlainText mantém o link de anúncio e remove os demais", () => {
    const out = toAirbnbPlainText(`Temos o Studio 4 livre: ${url}\nMaps: https://maps.google.com/x e www.site.com`);
    expect(out).toContain(url);
    expect(out).not.toMatch(/maps\.google|www\.site/);
  });
  it("formatForChannel (Airbnb) também mantém só o link de anúncio", () => {
    const out = formatForChannel(`Veja aqui ${url} e https://exemplo.com/x`, "airbnb");
    expect(out).toContain(url);
    expect(out).not.toContain("exemplo.com");
  });
  it("link de anúncio com outra rota ou domínio não passa", () => {
    expect(toAirbnbPlainText("https://www.airbnb.com/h/studiopyfoz")).not.toContain("studiopyfoz");
    expect(toAirbnbPlainText("https://airbnb.evil.com/rooms/123456789")).not.toContain("evil");
  });
});

// ─────────────── 2 e 5. saudações, despedidas, check-out concluído ───────────────
const H = (speaker: "guest" | "ai" | "team", text: string, at: string, i: number): HistoryEntry =>
  ({ ref: `hist:${speaker}:h${i}`, messageId: `m${i}`, speaker, channel: "airbnb", at, text, media: null, delivery: "delivered", current: false }) as unknown as HistoryEntry;

describe("saudação isolada e anti-eco (caso Tais)", () => {
  it("'Bom dia' 4 s depois do nosso cumprimento ⇒ silêncio (sem novo 'Bom dia, Tais! Tudo bem?')", () => {
    const h = [
      H("guest", "Oie ", "2026-11-12T14:33:07Z", 1),
      H("ai", "Olá, Tais! Tudo bem com você?", "2026-11-12T14:33:26Z", 2),
      H("guest", "Bom dia ", "2026-11-12T14:33:30Z", 3),
    ];
    expect(shouldSilenceBareAck(h)).toBe(true);
  });
  it("'Desculpa a demora' logo depois de uma resposta nossa ⇒ silêncio", () => {
    const h = [H("ai", "Bom dia, Tais!", "2026-11-12T14:33:49Z", 1), H("guest", "Desculpa a demora ", "2026-11-12T14:33:53Z", 2)];
    expect(shouldSilenceBareAck(h)).toBe(true);
  });
  it("primeiro cumprimento da conversa (ou depois de dias) ⇒ responde", () => {
    expect(shouldSilenceBareAck([H("guest", "Oie", "2026-11-12T14:33:07Z", 1)])).toBe(false);
    const old = [H("team", "Deseja seguir com esta data?", "2026-11-09T22:25:49Z", 1), H("guest", "Oie", "2026-11-12T14:33:07Z", 2)];
    expect(shouldSilenceBareAck(old)).toBe(false);
  });
  it("cumprimento com pergunta nova ⇒ sempre vai ao modelo", () => {
    const h = [H("ai", "Bom dia, Tais!", "2026-11-12T14:33:49Z", 1), H("guest", "Dia 18 vc tem disponibilidade?", "2026-11-12T14:34:17Z", 2)];
    expect(shouldSilenceBareAck(h)).toBe(false);
    expect(isPureGreeting("Bom dia, tem vaga?")).toBe(false);
  });
});

describe("despedidas e check-out concluído (casos Carlos Eduardo e Juan)", () => {
  it.each([
    "Olá, bom dia!\nEstimo que esteja bem.\n\nAgradeço pelas informações.\n\nAbraço ",
    "muitíssimo obrigado pelo guia digital, até mais",
    "obrigado por tudo",
    "Boa viagem!",
    "Bom retorno",
    "Até a próxima",
  ])("despedida pura ⇒ silêncio: %s", (t) => {
    expect(isFarewell(t)).toBe(true);
    expect(shouldSilenceBareAck([H("team", "Senhas no guia.", "2026-11-12T11:02:00Z", 1), H("guest", t, "2026-11-12T11:20:34Z", 2)])).toBe(true);
  });
  it.each(["Check out feito ", "check out feito, obrigado por tudo, deu tudo certo", "já saímos do apartamento", "Deixamos as chaves no cofre"])(
    "check-out concluído ⇒ silêncio mesmo com pergunta nossa pendente: %s",
    (t) => {
      expect(isCheckoutDoneNotice(t)).toBe(true);
      const h = [H("team", "Qual é o seu horário estimado de saída?", "2026-11-11T22:01:36Z", 1), H("guest", t, "2026-11-12T05:06:38Z", 2)];
      expect(shouldSilenceBareAck(h)).toBe(true);
    },
  );
  it.each([
    "Obrigado, que horas é o checkout?",
    "Obrigado, mas o chuveiro não esquenta",
    "obrigado, até amanhã",
    "Check out feito, mas esqueci meu carregador",
    "já saímos, onde deixo a chave?",
  ])("com pergunta, pedido ou ressalva ⇒ vai ao modelo: %s", (t) => {
    expect(isFarewell(t) || isCheckoutDoneNotice(t)).toBe(false);
  });
});

// ─────────────── 4. calendário com mínimo de noites e fim da contingência em vendas ───────────────
describe("período consultado e mínimo de noites (caso Tais)", () => {
  const rules = parseStayRules(RULE_105)!;
  it("regra do anúncio: sazonal da chegada ⇒ dia da semana ⇒ padrão", () => {
    expect(minNightsFor(rules, "2026-11-18")).toBe(2);
    expect(minNightsFor(rules, "2026-11-20")).toBe(3);
    expect(minNightsFor(rules, "2026-12-10")).toBe(2);
    expect(parseStayRules({})).toBeNull();
  });
  it("lê o período da mensagem: 'chego dia 18 e saiu no dia 19' ⇒ 18→19; 'Dia 18' ⇒ uma noite; 'do dia 19 a 21' ⇒ 19→21", () => {
    expect(extractRequestedPeriod("Seria apenas uma noite, chego dia 18 e saiu no dia 19", TODAY)).toEqual({ checkin: "2026-11-18", checkout: "2026-11-19", nights: 1 });
    expect(extractRequestedPeriod("Dia 18 vc tem disponibilidade?", TODAY)).toEqual({ checkin: "2026-11-18", checkout: "2026-11-19", nights: 1 });
    expect(extractRequestedPeriod("Do dia 19 a 21 está lotado ?", TODAY)).toEqual({ checkin: "2026-11-19", checkout: "2026-11-21", nights: 2 });
    expect(extractRequestedPeriod("dia 18, duas noites", TODAY)).toEqual({ checkin: "2026-11-18", checkout: "2026-11-20", nights: 2 });
    expect(extractRequestedPeriod("Olá, tudo bem?", TODAY)).toBeNull();
  });
  it("Studio 105: noite de 18 LIVRE, mas mínimo de 2 noites ⇒ não reservável neste anúncio", () => {
    const occ = buildOccupancy(
      [
        { id: "a", property_id: "105", status: "confirmed", source: "channex", checkin_date: "2026-11-12", checkout_date: "2026-11-18" },
        { id: "b", property_id: "105", status: "confirmed", source: "channex", checkin_date: "2026-11-19", checkout_date: "2026-11-23" },
      ],
      { propertyId: "105", today: TODAY },
    );
    const a = assessPeriod(occ, { checkin: "2026-11-18", checkout: "2026-11-19", nights: 1 }, rules);
    expect(a).toMatchObject({ allNightsFree: true, minNights: 2, meetsMinNights: false, bookable: "nao" });
    const fact = calendarFactValue({ ...occ, requested: a, alternatives: [] }) as Record<string, Record<string, unknown>>;
    expect(fact.periodo_consultado).toMatchObject({ noites_status: "noite de 18/11: LIVRE", minimo_noites_na_chegada: 2, cumpre_minimo: false, reservavel_neste_anuncio: "nao" });
  });
  it("noite livre e mínimo cumprido ⇒ reservável (resposta comercial direta)", () => {
    const occ = buildOccupancy([], { propertyId: "x", today: TODAY });
    expect(assessPeriod(occ, { checkin: "2026-11-25", checkout: "2026-11-27", nights: 2 }, rules).bookable).toBe("sim");
  });
  it("noite ocupada ⇒ não; regra desconhecida ⇒ desconhecido (nunca presume reservável)", () => {
    const occ = buildOccupancy([{ id: "b", property_id: "x", status: "confirmed", source: "channex", checkin_date: "2026-11-19", checkout_date: "2026-11-23" }], { propertyId: "x", today: TODAY });
    expect(assessPeriod(occ, { checkin: "2026-11-19", checkout: "2026-11-21", nights: 2 }, rules).bookable).toBe("nao");
    expect(assessPeriod(occ, { checkin: "2026-11-25", checkout: "2026-11-26", nights: 1 }, null).bookable).toBe("desconhecido");
  });
});

describe("contingência fora das consultas comerciais", () => {
  const REQ = { surface: "airbnb" as const, conversationId: "c1", messageId: "m1" };
  const deps = (over: Record<string, unknown>) => ({
    env: { GUEST_AI_AUTONOMOUS: "on" },
    humanActive: async () => false,
    pendingDecision: async () => false,
    generationTimeoutMs: 20,
    generate: () => new Promise(() => {}),
    ...over,
  });
  it("pergunta de datas com timeout ⇒ nada no chat do hóspede; equipe avisada com urgência alta", async () => {
    const r = await requestGuestAiReply(REQ, deps({ validate: async () => ({ propertyId: "p1", reservationId: "r1" }), loadBurst: async () => ["Dia 18 vc tem disponibilidade?"] }) as never);
    expect(r).toEqual({ reply: "", handoff: true, handoffReason: COMMERCIAL_CONTINGENCY_REASON, handoffUrgency: "high" });
  });
  it("consulta sem reserva (inquiry) ⇒ nada no chat, mesmo sem palavra comercial", async () => {
    const r = await requestGuestAiReply(REQ, deps({ validate: async () => ({ propertyId: "p1", reservationId: null }), loadBurst: async () => ["A casa tem garagem coberta pra dois carros"] }) as never);
    expect(r).toMatchObject({ reply: "", handoff: true, handoffUrgency: "high" });
  });
  it("dúvida operacional de hóspede com reserva ⇒ segue o aviso de contingência (caso Gilmar)", async () => {
    const r = await requestGuestAiReply(REQ, deps({ validate: async () => ({ propertyId: "p1", reservationId: "r1" }), loadBurst: async () => ["Boa noite, não consigo acesso à senha do wifi"] }) as never);
    expect(r).toMatchObject({ reply: CONTINGENCY_REPLY, handoffUrgency: "high" });
  });
  it("detector comercial: datas, vaga, valor, noites; 'boa noite' sozinho não conta", () => {
    for (const t of ["Dia 18 vc tem disponibilidade?", "Quanto fica a diária?", "Tem vaga de 19 a 21?", "Seria apenas uma noite"]) expect(isCommercialQuestion([t])).toBe(true);
    expect(isCommercialQuestion(["Boa noite, o chuveiro não esquenta"])).toBe(false);
  });
});

// ─────────────── 3. portfólio com link e datas livres ───────────────
type Row = Record<string, unknown>;
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
const turn = () =>
  issue("turn", {
    surface: "airbnb",
    conversationId: "conv",
    messageId: "m",
    propertyId: "s105",
    tenantId: "owner",
    guestSessionId: "airbnb:1",
    conversationStatus: "ai",
    reservationId: null,
    guestName: "Tais",
    messageCreatedAt: null,
  }) as ValidatedTurn;
const prop = (id: string, name: string, over: Row = {}): Row => ({ id, name, city: "Foz do Iguaçu", owner_id: "owner", archived_at: null, airbnb_listing_url: null, ...over });
const listing = (property_id: string, id: string, rule: unknown, over: Row = {}): Row => ({ property_id, airbnb_listing_id: id, sync_paused_at: null, not_found_at: null, availability_rule: rule, ...over });
const res = (property_id: string, ci: string, co: string, over: Row = {}): Row => ({ id: `${property_id}-${ci}`, property_id, status: "confirmed", source: "channex", checkin_date: ci, checkout_date: co, ...over });

describe("sugestão de portfólio", () => {
  const base = () => ({
    property_chat_messages: [
      { id: "g2", conversation_id: "conv", role: "user", sender_type: "guest", is_internal_note: false, content: "Seria apenas uma noite, chego dia 18 e saiu no dia 19" },
      { id: "g1", conversation_id: "conv", role: "user", sender_type: "guest", is_internal_note: false, content: "Dia 18 vc tem disponibilidade?" },
    ],
    properties: [
      prop("s105", "Studio n° 105 Próximo ao Paraguai"),
      prop("s101", "Studio n° 101 Aconchegante Próximo ao Paraguai"),
      prop("s4", "Studio n° 4 Natureza Próx. a Corredor Turístico", { airbnb_listing_url: "https://www.airbnb.com.br/rooms/1793590014642613896" }),
      prop("s9", "Studio n° 9 Sem Regra"),
      prop("far", "Casa em Curitiba", { city: "Curitiba" }),
      prop("old", "Studio Arquivado", { archived_at: "2026-10-01" }),
    ],
    property_listing_raw_data: [
      listing("s105", "1668254267295787925", RULE_105),
      listing("s101", "1668247859065922881", RULE_105),
      listing("s4", "1793590014642613896", RULE_1_NIGHT),
      listing("s9", "999999999", null),
      listing("far", "888888888", RULE_1_NIGHT),
      listing("old", "777777777", RULE_1_NIGHT),
    ],
    property_reservations: [res("s105", "2026-11-12", "2026-11-18"), res("s105", "2026-11-19", "2026-11-23"), res("s101", "2026-11-14", "2026-11-18")],
  });
  it("Studio 105 não aceita 1 noite em 18/11 ⇒ só o anúncio livre E com mínimo de 1 noite entra, com nome, datas e link", async () => {
    const occ = await fetchPropertyOccupancy(turn(), { today: TODAY }, { db: fakeDb(base()) });
    expect(occ.requested).toMatchObject({ checkin: "2026-11-18", checkout: "2026-11-19", bookable: "nao", minNights: 2 });
    expect(occ.alternatives).toEqual([
      {
        name: "Studio n° 4 Natureza Próx. a Corredor Turístico",
        url: "https://www.airbnb.com.br/rooms/1793590014642613896",
        checkin: "2026-11-18",
        checkout: "2026-11-19",
        nights: 1,
        minNights: 1,
      },
    ]);
    const fact = calendarFactValue(occ) as Record<string, Array<Record<string, unknown>>>;
    expect(fact.alternativas_portfolio![0]).toMatchObject({ acomodacao: "Studio n° 4 Natureza Próx. a Corredor Turístico", link_airbnb: "https://www.airbnb.com.br/rooms/1793590014642613896", entrada: "2026-11-18", saida: "2026-11-19" });
  });
  it("alternativa ocupada no período (bloqueio manual) ⇒ não entra; nenhuma ⇒ lista vazia (sem sugestão cega)", async () => {
    const t = base();
    t.property_reservations.push(res("s4", "2026-11-18", "2026-11-22", { status: "blocked", source: "manual" }));
    const occ = await fetchPropertyOccupancy(turn(), { today: TODAY }, { db: fakeDb(t) });
    expect(occ.alternatives).toEqual([]);
  });
  it("o imóvel da conversa reservável ⇒ nem consulta o portfólio", async () => {
    const t = base();
    t.property_chat_messages[0]!.content = "chego dia 25 e saio dia 27";
    const occ = await fetchPropertyOccupancy(turn(), { today: TODAY }, { db: fakeDb(t) });
    expect(occ.requested?.bookable).toBe("sim");
    expect(occ.alternatives).toBeNull();
  });
  it("link: o cadastrado (se for de anúncio) ou montado pelo id; nada fora disso", () => {
    expect(listingUrl(null, "1668247859065922881")).toBe("https://www.airbnb.com.br/rooms/1668247859065922881");
    expect(listingUrl("https://www.airbnb.com/h/x", "123456789")).toBe("https://www.airbnb.com.br/rooms/123456789");
    expect(listingUrl(null, "abc")).toBeNull();
  });
});

// ─────────────── roteiro ───────────────
describe("roteiro e persona (system.2026-11-12.4 / persona.2026-11-12.3)", () => {
  const sys = buildSystemPrompt("airbnb");
  it("versões", () => {
    expect(SYSTEM_PROMPT_VERSION).toBe("system.2026-11-12.4");
    expect(PERSONA_VERSION).toBe("persona.2026-11-12.3");
  });
  it("período consultado: resposta comercial direta, mínimo de noites e sem promessa vazia", () => {
    expect(sys).toMatch(/Período consultado \(ctx:calendario_ocupacao\.periodo_consultado\)/);
    expect(sys).toMatch(/responda de imediato, em uma ou duas frases claras e comerciais/);
    expect(sys).toMatch(/aceita reservas a partir do mínimo indicado/);
  });
  it("portfólio: nome, datas exatas e link do anúncio; nunca sugestão cega", () => {
    expect(sys).toMatch(/inclua o link_airbnb do anúncio, exatamente como veio/);
    expect(sys).toMatch(/Sem alternativas_portfolio, não sugira outro imóvel/);
    expect(sys).toMatch(/É proibido responder com promessa vazia/);
  });
  it("saudação isolada, anti-eco, sem repetir oferta; despedida sem tréplica", () => {
    expect(sys).toMatch(/Saudação isolada e anti-eco/);
    expect(sys).toMatch(/Nunca repita o mesmo parágrafo, oferta ou conselho/);
    expect(sys).toMatch(/Despedida e saída concluída/);
  });
});
