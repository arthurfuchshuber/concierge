import { describe, expect, it } from "vitest";
import { planPostPauseSweep, sweepConfig, type SweepMessage } from "../post-pause-sweep.server";

const CFG = sweepConfig({});
const T0 = Date.parse("2026-11-16T14:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const msg = (id: string, who: "guest" | "human" | "ai" | "system", min: number, extra: Partial<SweepMessage> = {}): SweepMessage => ({
  id,
  role: who === "guest" ? "user" : "assistant",
  sender_type: who,
  created_at: at(min),
  ...extra,
});
const none = () => [] as string[];

describe("varredura pós-pausa · quem é elegível", () => {
  const base = [msg("g1", "guest", 0), msg("h1", "human", 1), msg("g2", "guest", 3)];

  it("hóspede escreveu durante a pausa e a pausa já venceu ⇒ elegível (caso José Guilherme)", () => {
    const plan = planPostPauseSweep(base, none, T0 + 13 * 60_000, CFG);
    expect(plan?.triggerId).toBe("g2");
    expect(plan?.pauseEndsAt).toBe(at(11));
  });

  it("pausa ainda vigente ⇒ não", () => {
    expect(planPostPauseSweep(base, none, T0 + 8 * 60_000, CFG)).toBeNull();
  });

  it("folga de segurança depois do fim da pausa", () => {
    expect(planPostPauseSweep(base, none, T0 + 11 * 60_000 + 10_000, CFG)).toBeNull();
    expect(planPostPauseSweep(base, none, T0 + 11 * 60_000 + 40_000, CFG)?.triggerId).toBe("g2");
  });

  it("alguém já falou depois do hóspede (humano, IA ou sistema) ⇒ não", () => {
    for (const who of ["human", "ai", "system"] as const) {
      expect(planPostPauseSweep([...base, msg("x", who, 4)], none, T0 + 30 * 60_000, CFG)).toBeNull();
    }
  });

  it("hóspede escreveu DEPOIS da pausa ⇒ o webhook já deu o turno normal, a varredura não entra", () => {
    const m = [msg("h1", "human", 0), msg("g1", "guest", 12)];
    expect(planPostPauseSweep(m, none, T0 + 30 * 60_000, CFG)).toBeNull();
  });

  it("sem fala humana antes ⇒ não (não é caso de pausa)", () => {
    expect(planPostPauseSweep([msg("g1", "guest", 0)], none, T0 + 30 * 60_000, CFG)).toBeNull();
  });

  it("fala humana mais nova renova a janela: conta a última", () => {
    const m = [msg("h1", "human", 0), msg("h2", "human", 8), msg("g1", "guest", 15)];
    const plan = planPostPauseSweep(m, none, T0 + 19 * 60_000 + 40_000, CFG);
    expect(plan?.triggerId).toBe("g1");
    expect(plan?.pauseEndsAt).toBe(at(18));
  });

  it("nota interna da equipe não conta como fala ao hóspede", () => {
    const m = [...base, msg("n", "human", 5, { is_internal_note: true })];
    expect(planPostPauseSweep(m, none, T0 + 13 * 60_000, CFG)?.triggerId).toBe("g2");
  });

  it("espera velha demais não é retomada", () => {
    expect(planPostPauseSweep(base, none, T0 + 11 * 60_000 + CFG.maxAgeMs + 60_000, CFG)).toBeNull();
  });

  it("já houve turno da IA depois da pausa ⇒ não repete; sugestão feita DURANTE a pausa não conta", () => {
    expect(planPostPauseSweep(base, () => [at(12)], T0 + 20 * 60_000, CFG)).toBeNull();
    expect(planPostPauseSweep(base, () => [at(3.2)], T0 + 20 * 60_000, CFG)?.triggerId).toBe("g2");
  });

  it("desligada por GUEST_AI_POST_PAUSE_SWEEP=off", () => {
    expect(planPostPauseSweep(base, none, T0 + 13 * 60_000, sweepConfig({ GUEST_AI_POST_PAUSE_SWEEP: "off" }))).toBeNull();
  });

  it("vários recados na pausa: responde ao bloco pela última mensagem", () => {
    const m = [msg("h1", "human", 0), msg("g1", "guest", 2), msg("g2", "guest", 4)];
    expect(planPostPauseSweep(m, none, T0 + 13 * 60_000, CFG)?.triggerId).toBe("g2");
  });
});

// ── executor com banco falso ─────────────────────────────────────────────────────────────────────────────────
import { runPostPauseSweep } from "../post-pause-sweep.server";

type Call = { table: string; op: string; filters: Array<[string, unknown]> };

function fakeDb(data: Record<string, unknown>, opts: { rpcError?: boolean } = {}) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const from = (table: string) => {
    const c: Call = { table, op: "select", filters: [] };
    const rows = () => {
      calls.push(c);
      const d = data[table];
      return { data: d ?? [], error: null };
    };
    const chain: Record<string, unknown> = {};
    const add = (name: string) => (...a: unknown[]) => {
      if (name === "delete" || name === "update") c.op = name;
      else c.filters.push([name, a[0]]);
      return chain;
    };
    for (const n of ["select", "eq", "like", "in", "gte", "lt", "is", "order", "limit", "delete", "update", "not", "neq"]) chain[n] = add(n);
    chain["maybeSingle"] = () => {
      const r = rows();
      const d = r.data as unknown;
      return Promise.resolve({ data: Array.isArray(d) ? (d[0] ?? null) : d, error: null });
    };
    chain["then"] = (res: (v: unknown) => unknown) => Promise.resolve(rows()).then(res);
    return chain;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (opts.rpcError) return Promise.resolve({ data: null, error: { message: "denied" } });
    data["guest_ai_turns"] = [];
    return Promise.resolve({ data: 1, error: null });
  };
  return { db: { from, rpc }, calls, rpcCalls };
}

const CONV = {
  id: "c1", property_id: "p1", status: "ai", assigned_to: null, guest_name: "José", guest_session_id: "airbnb:thread-1",
  ai_paused: true, paused_until: new Date(T0 + 11 * 60_000).toISOString(),
};
const MSGS = [msg("g2", "guest", 3), msg("h1", "human", 1), msg("g1", "guest", 0)];

describe("varredura pós-pausa · executor", () => {
  const now = () => T0 + 14 * 60_000;

  it("descarta a sugestão da pausa e roda o turno da IA com a mensagem do hóspede", async () => {
    const f = fakeDb({
      property_chat_conversations: [CONV],
      property_chat_messages: MSGS.map((m) => ({ ...m, content: "Tem disponibilidade 17/18/19?" })),
      guest_ai_turns: [{ created_at: at(3.1) }],
      properties: { name: "Casa X", owner_id: "o1" },
      property_listing_raw_data: [{ airbnb_ai_enabled: true }],
    });
    const turns: unknown[] = [];
    const r = await runPostPauseSweep({ db: f.db, now, env: {}, runTurn: async (_d, t) => void turns.push(t) });
    expect(r).toMatchObject({ checked: 1, eligible: 1, answered: 1 });
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ convId: "c1", threadId: "thread-1", guestMessageId: "g2", ownerId: "o1", propertyName: "Casa X" });
    expect(f.rpcCalls).toHaveLength(1);
    expect(f.rpcCalls[0]).toMatchObject({
      fn: "guest_ai_release_unsent_turn",
      args: { p_conversation_id: "c1", p_trigger_message_id: "g2", p_before: at(11) },
    });
  });

  it("anúncio com a IA desligada ⇒ não responde nem descarta nada", async () => {
    const f = fakeDb({
      property_chat_conversations: [CONV],
      property_chat_messages: MSGS,
      guest_ai_turns: [],
      properties: { name: "Casa X", owner_id: "o1" },
      property_listing_raw_data: [{ airbnb_ai_enabled: false }],
    });
    const turns: unknown[] = [];
    const r = await runPostPauseSweep({ db: f.db, now, env: {}, runTurn: async (_d, t) => void turns.push(t) });
    expect(turns).toHaveLength(0);
    expect(r.answered).toBe(0);
    expect(f.rpcCalls).toHaveLength(0);
  });

  it("conversa assumida por uma pessoa no painel ⇒ ignorada", async () => {
    const f = fakeDb({
      property_chat_conversations: [{ ...CONV, status: "assigned", assigned_to: "u1" }],
      property_chat_messages: MSGS,
    });
    const turns: unknown[] = [];
    const r = await runPostPauseSweep({ db: f.db, now, env: {}, runTurn: async (_d, t) => void turns.push(t) });
    expect(turns).toHaveLength(0);
    expect(r.eligible).toBe(0);
  });

  it("não consegue descartar a sugestão da pausa ⇒ NÃO roda o turno (cairia na contingência e encaminharia à equipe)", async () => {
    const f = fakeDb(
      {
        property_chat_conversations: [CONV],
        property_chat_messages: MSGS,
        guest_ai_turns: [{ created_at: at(3.1) }],
        properties: { name: "Casa X", owner_id: "o1" },
        property_listing_raw_data: [{ airbnb_ai_enabled: true }],
      },
      { rpcError: true },
    );
    const turns: unknown[] = [];
    const r = await runPostPauseSweep({ db: f.db, now, env: {}, runTurn: async (_d, t) => void turns.push(t) });
    expect(turns).toHaveLength(0);
    expect(r).toMatchObject({ answered: 0, skipped: 1 });
  });

  it("falha num turno não derruba a varredura", async () => {
    const f = fakeDb({
      property_chat_conversations: [CONV],
      property_chat_messages: MSGS,
      guest_ai_turns: [],
      properties: { name: "Casa X", owner_id: "o1" },
      property_listing_raw_data: [{ airbnb_ai_enabled: true }],
    });
    const r = await runPostPauseSweep({ db: f.db, now, env: {}, runTurn: async () => { throw new Error("boom"); } });
    expect(r.skipped).toBe(1);
  });

  it("desligada ⇒ nem consulta o banco", async () => {
    const f = fakeDb({});
    const r = await runPostPauseSweep({ db: f.db, now, env: { GUEST_AI_POST_PAUSE_SWEEP: "off" } });
    expect(r.checked).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
});
