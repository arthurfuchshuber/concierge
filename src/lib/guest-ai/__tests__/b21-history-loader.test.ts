import { describe, expect, it } from "vitest";
import { GuestAiAbortedError, type GuestAiDb } from "@/lib/guest-ai/data/client.server";
import { HISTORY_MAX_ROWS, HISTORY_MESSAGE_COLUMNS, fetchConversationHistory } from "@/lib/guest-ai/data/history.server";
import { issue, GuestAiSecurityError } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import type { HistoryRow } from "@/lib/guest-ai/history";
import { REAL_COLUMNS } from "./helpers/real-columns";
import { CONV, MSG, row } from "./helpers/b21-fixtures";

const TURN_FIELDS: ValidatedTurn = {
  surface: "guide_chat",
  conversationId: CONV,
  messageId: MSG,
  propertyId: "p1",
  tenantId: "t1",
  guestSessionId: "sess",
  conversationStatus: "ai",
  reservationId: null,
  messageCreatedAt: null,
};
const turn = () => issue("turn", { ...TURN_FIELDS }) as ValidatedTurn;

type Call = { table: string; select?: string; eq: Array<[string, unknown]>; order: Array<[string, unknown]>; limit?: number; signal?: AbortSignal };

function fakeDb(result: { data?: unknown; error?: unknown } | (() => Promise<{ data?: unknown; error?: unknown }>)) {
  const calls: Call[] = [];
  const db: GuestAiDb = {
    from(table: string) {
      const c: Call = { table, eq: [], order: [] };
      calls.push(c);
      const q: Record<string, unknown> = {
        select(s: string) { c.select = s; return q; },
        abortSignal(s: AbortSignal) { c.signal = s; return q; },
        eq(k: string, v: unknown) { c.eq.push([k, v]); return q; },
        order(k: string, o: unknown) { c.order.push([k, o]); return q; },
        limit(n: number) {
          c.limit = n;
          return typeof result === "function" ? result() : Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
        },
      };
      return q;
    },
  };
  return { db, calls };
}

describe("B2.1 · leitura do histórico (data/history.server.ts)", () => {
  it("projeção mínima: colunas reais, sem identidade de quem atende, telefone, storage, id externo ou custo", () => {
    const real = new Set(REAL_COLUMNS["property_chat_messages"]);
    expect(HISTORY_MESSAGE_COLUMNS.filter((c) => !real.has(c))).toEqual([]);
    for (const forbidden of ["sender_user_id", "sent_via_number", "attachment_path", "attachment_name", "external_id", "ai_cost_usd", "ai_models", "ai_tokens_in", "ai_tokens_out", "edited_at"]) {
      expect(HISTORY_MESSAGE_COLUMNS as readonly string[]).not.toContain(forbidden);
    }
    expect(HISTORY_MESSAGE_COLUMNS as readonly string[]).not.toContain("*");
  });

  it("consulta filtrada pela conversa DO TURNO, sem notas internas, ordenada e com teto+1", async () => {
    const rows: HistoryRow[] = [row({ created_at: "2026-11-03T10:00:01+00:00" }), row({ id: MSG, created_at: "2026-11-03T10:00:02+00:00" })];
    const { db, calls } = fakeDb({ data: rows });
    const r = await fetchConversationHistory(turn(), { db });
    expect(r.status).toBe("available");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("property_chat_messages");
    expect(calls[0]!.select).toBe(HISTORY_MESSAGE_COLUMNS.join(", "));
    expect(calls[0]!.eq).toEqual([["conversation_id", CONV], ["is_internal_note", false]]);
    expect(calls[0]!.order).toEqual([["created_at", { ascending: true }], ["id", { ascending: true }]]);
    expect(calls[0]!.limit).toBe(HISTORY_MAX_ROWS + 1);
  });

  it("acima do teto ⇒ over_limit explícito (nunca lista cortada)", async () => {
    const rows = Array.from({ length: HISTORY_MAX_ROWS + 1 }, () => row());
    rows[0] = { ...rows[0]!, id: MSG };
    const { db } = fakeDb({ data: rows });
    await expect(fetchConversationHistory(turn(), { db })).resolves.toEqual({ status: "unavailable", reason: "over_limit" });
  });

  it("exatamente no teto ainda é integral", async () => {
    const rows = Array.from({ length: HISTORY_MAX_ROWS }, (_, i) => row({ created_at: new Date(Date.UTC(2026, 10, 3, 0, 0, i)).toISOString() }));
    rows[HISTORY_MAX_ROWS - 1] = { ...rows[HISTORY_MAX_ROWS - 1]!, id: MSG };
    const { db } = fakeDb({ data: rows });
    const r = await fetchConversationHistory(turn(), { db });
    expect(r.status === "available" && r.entries.length).toBe(HISTORY_MAX_ROWS);
  });

  it("erro do banco ⇒ lookup_failed; dados não-array ⇒ lookup_failed", async () => {
    await expect(fetchConversationHistory(turn(), { db: fakeDb({ error: { message: "x" } }).db })).resolves.toEqual({ status: "unavailable", reason: "lookup_failed" });
    await expect(fetchConversationHistory(turn(), { db: fakeDb({ data: { a: 1 } }).db })).resolves.toEqual({ status: "unavailable", reason: "lookup_failed" });
    await expect(fetchConversationHistory(turn(), { db: fakeDb(() => Promise.reject(new Error("rede"))).db })).resolves.toEqual({ status: "unavailable", reason: "lookup_failed" });
  });

  it("linha de outra conversa vinda do banco ⇒ scope_mismatch", async () => {
    const { db } = fakeDb({ data: [row({ id: MSG }), row({ conversation_id: "99999999-9999-4999-8999-999999999999" })] });
    await expect(fetchConversationHistory(turn(), { db })).resolves.toEqual({ status: "unavailable", reason: "scope_mismatch" });
  });

  it("exige ValidatedTurn emitido (objeto forjado é recusado antes do banco)", async () => {
    const { db, calls } = fakeDb({ data: [] });
    await expect(fetchConversationHistory({ ...TURN_FIELDS }, { db })).rejects.toBeInstanceOf(GuestAiSecurityError);
    expect(calls).toHaveLength(0);
  });

  it("cancelamento: sinal já abortado não abre consulta; o sinal é anexado à consulta; abort no meio interrompe", async () => {
    const pre = new AbortController();
    pre.abort();
    const a = fakeDb({ data: [] });
    await expect(fetchConversationHistory(turn(), { db: a.db, signal: pre.signal })).rejects.toBeInstanceOf(GuestAiAbortedError);
    expect(a.calls).toHaveLength(0);

    const ac = new AbortController();
    const b = fakeDb({ data: [row({ id: MSG })] });
    await fetchConversationHistory(turn(), { db: b.db, signal: ac.signal });
    expect(b.calls[0]!.signal).toBe(ac.signal);

    const mid = new AbortController();
    const c = fakeDb(() => { mid.abort(); return Promise.resolve({ data: [row({ id: MSG })], error: null }); });
    await expect(fetchConversationHistory(turn(), { db: c.db, signal: mid.signal })).rejects.toBeInstanceOf(GuestAiAbortedError);

    const failing = new AbortController();
    const d = fakeDb(() => { failing.abort(); return Promise.resolve({ data: null, error: { message: "aborted" } }); });
    await expect(fetchConversationHistory(turn(), { db: d.db, signal: failing.signal })).rejects.toBeInstanceOf(GuestAiAbortedError);
  });
});
