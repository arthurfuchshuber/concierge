import { describe, expect, it } from "vitest";
import { loadReservationSiblingHistory, mergeCrossChannelHistory } from "@/lib/ai/conversation-link.server";

const T = (min: number) => new Date(Date.UTC(2026, 9, 22, 18, min)).toISOString();

describe("mergeCrossChannelHistory", () => {
  it("intercala Airbnb + Guia em ordem cronológica", () => {
    const airbnb = [
      { role: "user", content: "Como abre o portão?", at: T(0) },
      { role: "assistant", content: "Digite 1234 no teclado.", at: T(1) },
    ];
    const guia = [{ role: "user", content: "E o cofre?", at: T(5) }];
    expect(mergeCrossChannelHistory(guia, airbnb).map((m) => m.content)).toEqual([
      "Como abre o portão?",
      "Digite 1234 no teclado.",
      "E o cofre?",
    ]);
  });
  it("sem outros canais devolve o próprio histórico; respeita o limite e remove duplicata", () => {
    const own = [{ role: "user", content: "oi", at: T(1) }];
    expect(mergeCrossChannelHistory(own, [])).toBe(own);
    const many = Array.from({ length: 50 }, (_, i) => ({ role: "user", content: `m${i}`, at: T(i) }));
    expect(mergeCrossChannelHistory([], many, 30)).toHaveLength(30);
    expect(mergeCrossChannelHistory(own, [own[0]!])).toHaveLength(1);
  });
});

/** Banco falso em memória com os filtros usados pelo carregador. */
function fakeDb(db: Record<string, any[]>) {
  return {
    from(table: string) {
      let rows = [...(db[table] ?? [])];
      let order: { c: string; asc: boolean } | null = null;
      let lim = Infinity;
      let single = false;
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b),
        neq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] !== v)), b),
        gte: (c: string, v: string) => ((rows = rows.filter((r) => r[c] >= v)), b),
        order: (c: string, o: { ascending: boolean }) => ((order = { c, asc: o.ascending }), b),
        limit: (n: number) => ((lim = n), b),
        maybeSingle: () => ((single = true), b),
        then: (res: (v: unknown) => void) => {
          if (order) rows.sort((x, y) => (x[order!.c] < y[order!.c] ? -1 : 1) * (order!.asc ? 1 : -1));
          rows = rows.slice(0, lim);
          res({ data: single ? (rows[0] ?? null) : rows, error: null });
        },
      };
      return b;
    },
  };
}

describe("loadReservationSiblingHistory (guide-chat com código de reserva)", () => {
  const recent = new Date().toISOString();
  const msgAt = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const db = {
    property_chat_conversations: [
      { id: "guia", reservation_id: "R1", last_message_at: recent },
      { id: "airbnb", reservation_id: "R1", last_message_at: recent },
      { id: "velha", reservation_id: "R1", last_message_at: new Date(Date.now() - 20 * 86_400_000).toISOString() },
      { id: "outra", reservation_id: "R2", last_message_at: recent },
    ],
    property_chat_messages: [
      { conversation_id: "airbnb", role: "user", content: "Onde fica o cofre?", created_at: msgAt(5), sender_type: "guest" },
      { conversation_id: "airbnb", role: "assistant", content: "Ao lado do portão.", created_at: msgAt(4), sender_type: "ai" },
      { conversation_id: "outra", role: "user", content: "outra reserva", created_at: msgAt(3), sender_type: "guest" },
      { conversation_id: "velha", role: "user", content: "muito antiga", created_at: msgAt(60 * 24 * 20), sender_type: "guest" },
    ],
  };

  it("traz só as conversas recentes da MESMA reserva, em outros canais", async () => {
    const h = await loadReservationSiblingHistory(fakeDb(db) as never, { conversationId: "guia" });
    expect(h.map((m) => m.content)).toEqual(["Onde fica o cofre?", "Ao lado do portão."]);
  });
  it("conversa sem reserva ligada não puxa nada", async () => {
    const h = await loadReservationSiblingHistory(
      fakeDb({ ...db, property_chat_conversations: [{ id: "guia", reservation_id: null, last_message_at: recent }] }) as never,
      { conversationId: "guia" },
    );
    expect(h).toEqual([]);
  });
});
