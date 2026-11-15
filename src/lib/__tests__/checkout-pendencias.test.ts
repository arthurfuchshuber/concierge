import { describe, expect, it, vi } from "vitest";
import { closePendenciesAtCheckout, pendencyCutoffMs } from "../checkout-pendencias.server";

describe("pendências de retorno × checkout (15/11/2026)", () => {
  const base = { checkoutDate: "2026-12-07", standardTime: "11:00", lateCheckout: null, timeZone: "America/Sao_Paulo" };

  it("corte = horário oficial de checkout no fuso do imóvel; late checkout formal manda; sem horário, fim do dia", () => {
    expect(pendencyCutoffMs(base)).toBe(Date.UTC(2026, 11, 7, 14, 0));
    expect(pendencyCutoffMs({ ...base, lateCheckout: { time: "14:00", approvedAt: "2026-12-06T10:00:00Z", by: "u1" } })).toBe(Date.UTC(2026, 11, 7, 17, 0));
    expect(pendencyCutoffMs({ ...base, standardTime: null })).toBe(Date.UTC(2026, 11, 8, 2, 59));
    expect(pendencyCutoffMs({ ...base, checkoutDate: "" })).toBeNull();
  });

  // cliente falso mínimo: cada from() devolve as linhas da tabela e registra updates/rpc
  function fake(tables: Record<string, unknown[]>) {
    const calls: Array<{ table: string; patch: unknown }> = [];
    const rpc = vi.fn(async () => ({ error: null }));
    const from = (table: string) => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ["select", "eq", "not", "in", "limit"]) b[m] = chain;
      b["update"] = (patch: unknown) => { calls.push({ table, patch }); return b; };
      b["then"] = (res: (v: unknown) => unknown) => res({ data: tables[table] ?? [], error: null });
      return b;
    };
    return { client: { from, rpc } as never, calls, rpc };
  }

  it("após o checkout: expira a decisão pendente e libera o encaminhamento; chamado de ocorrência não é tocado", async () => {
    const t = fake({
      property_chat_conversations: [{ id: "c1", status: "needs_human", property_id: "p1", reservation_id: "r1" }],
      guest_ai_human_decisions: [{ id: "d1", conversation_id: "c1" }],
      guest_ai_incidents: [],
      property_reservations: [{ id: "r1", checkout_date: "2026-12-07", property_id: "p1" }],
      properties: [{ id: "p1", checkout_time: "11:00", city: "Foz do Iguaçu", country: "BR" }],
      guest_arrival_status: [],
    });
    const out = await closePendenciesAtCheckout(t.client, new Date("2026-12-07T15:00:00Z"));
    expect(out).toEqual({ conversations: 1, decisions: 1 });
    expect(t.rpc).toHaveBeenCalledWith("guest_ai_decision_expire", { p_decision_id: "d1" });
    expect(t.calls.some((c) => c.table === "guest_ai_incidents")).toBe(false);
  });

  it("antes do checkout nada muda; conversa com chamado de ocorrência aberto não sai da fila", async () => {
    const tables = {
      property_chat_conversations: [{ id: "c1", status: "needs_human", property_id: "p1", reservation_id: "r1" }],
      guest_ai_human_decisions: [],
      property_reservations: [{ id: "r1", checkout_date: "2026-12-07", property_id: "p1" }],
      properties: [{ id: "p1", checkout_time: "11:00", city: "Foz do Iguaçu", country: "BR" }],
      guest_arrival_status: [],
    };
    const early = fake({ ...tables, guest_ai_incidents: [] });
    expect(await closePendenciesAtCheckout(early.client, new Date("2026-12-07T13:00:00Z"))).toEqual({ conversations: 0, decisions: 0 });
    const withIncident = fake({ ...tables, guest_ai_incidents: [{ conversation_id: "c1", reservation_id: "r1" }] });
    expect(await closePendenciesAtCheckout(withIncident.client, new Date("2026-12-07T15:00:00Z"))).toEqual({ conversations: 0, decisions: 0 });
  });
});
