import { describe, expect, it } from "vitest";
import { detectStayForecast, forecastAllowed } from "@/lib/ai/stay-intent-resolver.server";
import { applyStayForecastOnIngest } from "@/lib/ai/conversation-link.server";

describe("detectStayForecast — chegada", () => {
  it("frase da Lucélia: 'Chegaremos por volta das 00:00'", () => {
    expect(detectStayForecast("Chegaremos por volta das 00:00")).toEqual({ kind: "checkin", time: "00:00" });
  });
  it("'Pensei que seria checkin automático, desculpe o horário.' não é previsão", () => {
    expect(detectStayForecast("Pensei que seria checkin automático, desculpe o horário.")).toBeNull();
  });
  it("horários normalizados", () => {
    expect(detectStayForecast("Chegamos às 18h")).toEqual({ kind: "checkin", time: "18:00" });
    expect(detectStayForecast("Previsão de chegada 20:30")).toEqual({ kind: "checkin", time: "20:30" });
    expect(detectStayForecast("Chego umas 15h")).toEqual({ kind: "checkin", time: "15:00" });
  });
});

describe("detectStayForecast — saída", () => {
  it("reconhece saída com horário", () => {
    expect(detectStayForecast("Vamos sair amanhã às 10h")).toEqual({ kind: "checkout", time: "10:00" });
    expect(detectStayForecast("Sairemos por volta das 11h")).toEqual({ kind: "checkout", time: "11:00" });
    expect(detectStayForecast("Vou desocupar às 08h")).toEqual({ kind: "checkout", time: "08:00" });
  });
  it("saída no limite", () => {
    expect(detectStayForecast("Vamos sair no limite do horário")).toEqual({ kind: "checkout", time: "limite" });
    expect(detectStayForecast("Eu vou sair nos últimos minutos")).toEqual({ kind: "checkout", time: "limite" });
  });
});

describe("detectStayForecast — não é previsão", () => {
  it("dúvida sobre o horário oficial e incerteza", () => {
    expect(detectStayForecast("Que horas é o checkin?")).toBeNull();
    expect(detectStayForecast("O check-in é às 15h?")).toBeNull();
    expect(detectStayForecast("Talvez a gente chegue às 22h")).toBeNull();
    expect(detectStayForecast("No sé si llegamos a las 22h")).toBeNull();
  });
  it("sem horário ou fora do assunto", () => {
    expect(detectStayForecast("Obrigado, tudo certo!")).toBeNull();
    expect(detectStayForecast("Chegamos à tarde")).toBeNull();
    expect(detectStayForecast("")).toBeNull();
  });
});

describe("detectStayForecast — espanhol e perguntas de antecipação (23/10/2026)", () => {
  it("'consigo ingresar antes? Meio dia?' → check-in 12:00", () => {
    expect(detectStayForecast("consigo ingresar antes? Meio dia?")).toEqual({ kind: "checkin", time: "12:00" });
  });
  it("pedidos de antecipação com horário são previsão", () => {
    expect(detectStayForecast("Podemos chegar às 12h?")).toEqual({ kind: "checkin", time: "12:00" });
    expect(detectStayForecast("Será que dá pra chegar mais cedo, umas 11h?")).toEqual({ kind: "checkin", time: "11:00" });
    expect(detectStayForecast("Posso sair às 14h")).toEqual({ kind: "checkout", time: "14:00" });
  });
  it("espanhol", () => {
    expect(detectStayForecast("Llegamos a las 18h")).toEqual({ kind: "checkin", time: "18:00" });
    expect(detectStayForecast("Podemos ingresar a las 12:00?")).toEqual({ kind: "checkin", time: "12:00" });
    expect(detectStayForecast("Salimos a las 10h")).toEqual({ kind: "checkout", time: "10:00" });
  });
});

describe("forecastAllowed — madrugada no check-in", () => {
  it("check-in 15:00 aceita 00:00 e 01:30 (chegada tardia)", () => {
    expect(forecastAllowed({ kind: "checkin", time: "00:00", standard: "15:00" }).ok).toBe(true);
    expect(forecastAllowed({ kind: "checkin", time: "01:30", standard: "15:00" }).ok).toBe(true);
  });
  it("continua recusando 10:00 diurno sem alinhamento prévio", () => {
    const r = forecastAllowed({ kind: "checkin", time: "10:00", standard: "15:00" });
    expect(r.ok).toBe(false);
    expect(r.permitido).toBe("15:00");
    expect(forecastAllowed({ kind: "checkin", time: "10:00", standard: "15:00", agreed: "10:00" }).ok).toBe(true);
  });
  it("check-out não muda", () => {
    expect(forecastAllowed({ kind: "checkout", time: "10:30", standard: "11:00" }).ok).toBe(true);
    expect(forecastAllowed({ kind: "checkout", time: "14:00", standard: "11:00" }).ok).toBe(false);
  });
});

/** Banco falso mínimo: tabela → linhas devolvidas; registra inserts/updates. */
function fakeAdmin(tables: Record<string, unknown[]>) {
  const writes: Array<{ table: string; op: "insert" | "update"; values: Record<string, unknown> }> = [];
  const admin = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ["select", "eq", "lte", "gte", "order", "limit", "in", "neq", "is", "or"]) b[m] = chain;
      b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      b.insert = (values: Record<string, unknown>) => {
        writes.push({ table, op: "insert", values });
        return Promise.resolve({ data: null, error: null });
      };
      b.update = (values: Record<string, unknown>) => {
        writes.push({ table, op: "update", values });
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      };
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
      return b;
    },
  };
  return { admin: admin as never, writes };
}

describe("applyStayForecastOnIngest", () => {
  const base = {
    property_chat_conversations: [{ id: "c1", reservation_id: "res-1", guest_name: "Lucélia" }],
    property_reservations: [
      { id: "res-1", property_id: "prop-1", checkin_date: "2026-10-24", checkout_date: "2026-10-26", status: "confirmed" },
    ],
    properties: [{ checkin_time: "15:00:00", checkout_time: "11:00:00" }],
    guide_access_logs: [{ id: "log-1" }],
    guest_arrival_status: [],
  };

  it("grava a previsão de check-in (00:00) no painel mesmo sem IA", async () => {
    const { admin, writes } = fakeAdmin(base);
    const r = await applyStayForecastOnIngest(admin, {
      conversationId: "c1",
      propertyId: "prop-1",
      message: "Chegaremos por volta das 00:00",
    });
    expect(r).toEqual({ ok: true, kind: "checkin", time: "00:00" });
    const w = writes.find((x) => x.table === "guest_arrival_status");
    expect(w?.op).toBe("insert");
    expect(w?.values).toMatchObject({
      property_id: "prop-1",
      kind: "checkin",
      reservation_id: "res-1",
      arrival_time_override: "00:00",
      arrival_time_source: "guest",
    });
  });

  it("grava a previsão de check-out", async () => {
    const { admin, writes } = fakeAdmin(base);
    const r = await applyStayForecastOnIngest(admin, { conversationId: "c1", propertyId: "prop-1", message: "Sairemos às 10h" });
    expect(r).toEqual({ ok: true, kind: "checkout", time: "10:00" });
    expect(writes.find((x) => x.table === "guest_arrival_status")?.values).toMatchObject({ kind: "checkout", arrival_time_override: "10:00" });
  });

  it("mensagem sem previsão não toca no banco", async () => {
    const { admin, writes } = fakeAdmin(base);
    expect(await applyStayForecastOnIngest(admin, { conversationId: "c1", propertyId: "prop-1", message: "Que horas é o checkin?" })).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("previsão ANTES do check-in oficial (10h) agora é gravada — sem trava", async () => {
    const { admin, writes } = fakeAdmin(base);
    expect(await applyStayForecastOnIngest(admin, { conversationId: "c1", propertyId: "prop-1", message: "Chegamos às 10h" })).toEqual({ ok: true, kind: "checkin", time: "10:00" });
    expect(writes.find((x) => x.table === "guest_arrival_status")?.values).toMatchObject({ arrival_time_override: "10:00", arrival_time_source: "guest" });
  });
  it("pergunta de antecipação em espanhol grava 12:00", async () => {
    const { admin, writes } = fakeAdmin(base);
    const r = await applyStayForecastOnIngest(admin, { conversationId: "c1", propertyId: "prop-1", message: "consigo ingresar antes? Meio dia?" });
    expect(r).toEqual({ ok: true, kind: "checkin", time: "12:00" });
    expect(writes.find((x) => x.table === "guest_arrival_status")?.values).toMatchObject({ arrival_time_override: "12:00" });
  });
});
