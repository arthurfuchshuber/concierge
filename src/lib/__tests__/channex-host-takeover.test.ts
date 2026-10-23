import { describe, expect, it, vi } from "vitest";

type Call = { table: string; op: string; payload?: any; filters: Array<[string, any]> };
const calls: Call[] = [];

vi.mock("@/integrations/supabase/client.server", () => {
  const make = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const b: any = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === "then") {
            calls.push(call);
            const data = table === "property_chat_conversations" && call.op === "select" ? [{ id: "conv-1" }] : [];
            return (resolve: (v: unknown) => void) => resolve({ data, error: null });
          }
          return (...args: any[]) => {
            if (prop === "update") {
              call.op = "update";
              call.payload = args[0];
            } else if (["eq", "in", "gte", "neq"].includes(prop)) call.filters.push([args[0], args[1]]);
            return b;
          };
        },
      },
    );
    return b;
  };
  return { supabaseAdmin: { from: (t: string) => make(t) } };
});

import { hostTakeoverPatch, pauseOnHostMessage } from "@/lib/channex-messages.server";

const hostMsg = {
  messageId: "h1",
  otaMessageId: null,
  text: "Oi! Já estou te ajudando com o portão.",
  sender: "host",
  threadId: "thread-9",
  bookingId: null,
  channexPropertyId: null,
  guestName: null,
};

describe("pauseOnHostMessage: anfitrião responde no Airbnb", () => {
  it("pausa a IA e promove a conversa para 'assigned' (aba Humano), reabrindo resolvidas", async () => {
    calls.length = 0;
    await pauseOnHostMessage(hostMsg, false);
    const upd = calls.find((c) => c.table === "property_chat_conversations" && c.op === "update");
    expect(upd).toBeTruthy();
    expect(upd!.payload).toMatchObject({ ai_paused: true, status: "assigned", resolved_at: null });
    expect(typeof upd!.payload.paused_until).toBe("string");
    expect(typeof upd!.payload.last_message_at).toBe("string");
    expect("assigned_to" in upd!.payload).toBe(false);
    expect(upd!.filters).toContainEqual(["id", "conv-1"]);
  });

  it("mensagem automática do anfitrião NÃO pausa nem muda status", async () => {
    calls.length = 0;
    await pauseOnHostMessage(hostMsg, true);
    expect(calls.find((c) => c.table === "property_chat_conversations" && c.op === "update")).toBeUndefined();
  });
});

describe("hostTakeoverPatch", () => {
  it("monta o patch esperado", () => {
    const now = new Date("2026-10-22T20:00:00Z");
    expect(hostTakeoverPatch({ ai_paused: true, paused_until: "x" }, now)).toEqual({
      ai_paused: true,
      paused_until: "x",
      status: "assigned",
      resolved_at: null,
      last_message_at: "2026-10-22T20:00:00.000Z",
    });
  });
});
