import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askHumanSupervisor, type EscalationInput } from "../human-loop/escalations.server";

type Row = Record<string, unknown>;
function database(rows: Row[] = []) {
  const inserted: Row[] = [];
  const client = {
    from: vi.fn(() => {
      let matches = [...rows];
      let payload: Row | undefined;
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          matches = matches.filter((row) => {
            const [field, key] = column.split("->>");
            const actual = key ? (row[field] as Row | undefined)?.[key] : row[field];
            return actual === value;
          });
          return query;
        }),
        gte: vi.fn((column: string, value: string) => {
          matches = matches.filter((row) => String(row[column]) >= value);
          return query;
        }),
        limit: vi.fn((limit: number) => { matches = matches.slice(0, limit); return query; }),
        insert: vi.fn((value: Row) => { payload = value; return query; }),
        single: vi.fn(async () => {
          if (payload) { inserted.push(payload); rows.push({ ...payload, id: "new-card", created_at: new Date().toISOString() }); }
          return { data: { id: "new-card" }, error: null };
        }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: matches, error: null }).then(resolve),
      };
      return query;
    }),
  } as unknown as SupabaseClient;
  return { client, inserted };
}
function request(supabase: SupabaseClient): EscalationInput {
  return {
    supabase, ownerId: "owner", propertyId: "property", conversationId: "conversation",
    agent: "generalist", trigger: "unknown_information", reason: "Confirmar senha da porta",
    question: "Qual é a senha da porta?", guestMessage: "Qual a senha da porta?",
    contextSnapshot: { draft: { summary: "Hóspede precisa da senha da porta" } },
  };
}
const pending = (snapshot: Row = {}) => ({
  id: "old-card", owner_id: "owner", property_id: "property", conversation_id: "conversation",
  status: "pending", trigger: "unknown_information", question_to_human: "Tem ferro?",
  context_snapshot: snapshot, created_at: new Date().toISOString(),
});

describe("perguntas distintas não são absorvidas por cartões pendentes", () => {
  it.each([{}, { proactive: true }, { proactive: true, host_learning: true }])(
    "cria a nova dúvida preservando pergunta e rascunho com pendência %j", async (snapshot) => {
      const db = database([pending(snapshot)]);
      expect(await askHumanSupervisor(request(db.client))).toBe("new-card");
      expect(db.inserted).toHaveLength(1);
      expect(db.inserted[0]?.question_to_human).toBe("Qual é a senha da porta?");
      expect(db.inserted[0]?.context_snapshot).toMatchObject({ draft: { summary: "Hóspede precisa da senha da porta" } });
    },
  );
  it("reaproveita a mesma pergunta numa repetição imediata", async () => {
    const db = database();
    const input = request(db.client);
    expect(await askHumanSupervisor(input)).toBe("new-card");
    expect(await askHumanSupervisor(input)).toBe("new-card");
    expect(db.inserted).toHaveLength(1);
  });
  it("não absorve outro assunto após a primeira pergunta", async () => {
    const db = database();
    const input = request(db.client);
    await askHumanSupervisor(input);
    await askHumanSupervisor({ ...input, question: "Tem ferro de passar?", guestMessage: "Tem ferro?" });
    expect(db.inserted).toHaveLength(2);
  });
  it("uma pendência antiga não absorve uma nova ocorrência da mesma pergunta", async () => {
    const rows: Row[] = [];
    const db = database(rows);
    const input = request(db.client);
    await askHumanSupervisor(input);
    rows[0].created_at = "2020-01-01T00:00:00.000Z";
    await askHumanSupervisor(input);
    expect(db.inserted).toHaveLength(2);
  });
  it.each([{ proactive: true }, { proactive: true, host_learning: true }])(
    "mesmo texto em cartão auxiliar %j não absorve a dúvida do hóspede", async (flags) => {
      const db = database();
      const input = request(db.client);
      await askHumanSupervisor({ ...input, contextSnapshot: flags });
      await askHumanSupervisor(input);
      expect(db.inserted).toHaveLength(2);
    },
  );
  it("pergunta já respondida não absorve nova pergunta", async () => {
    const rows: Row[] = [];
    const db = database(rows);
    const input = request(db.client);
    await askHumanSupervisor(input);
    rows[0].status = "answered";
    await askHumanSupervisor(input);
    expect(db.inserted).toHaveLength(2);
  });
  it("não reaproveita cartões de outro imóvel", async () => {
    const db = database();
    const input = request(db.client);
    await askHumanSupervisor(input);
    await askHumanSupervisor({ ...input, propertyId: "other-property" });
    expect(db.inserted).toHaveLength(2);
  });
  it("sem conversa, cria perguntas independentes", async () => {
    const db = database();
    const input = { ...request(db.client), conversationId: null, propertyId: null };
    await askHumanSupervisor(input);
    await askHumanSupervisor(input);
    expect(db.inserted).toHaveLength(2);
  });
});