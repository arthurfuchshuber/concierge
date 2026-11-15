/**
 * Teto de custo POR ANÚNCIO e POR CONTA (15/11/2026) contra PostgreSQL real (esquema mínimo + migration nova).
 * Regras: teto da conta = soma dos tetos dos anúncios com a IA ligada; elástico dentro da conta, até 3× o teto do
 * anúncio; contas nunca dividem orçamento; reserva US$ 0,15 por geração em curso.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "./pg/pg-cluster";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const STUB = path.join(__dirname, "pg", "budget-listing-stub.sql");
const MIG = path.join(REPO, "supabase/migrations/20261115190000_copilot_teto_por_anuncio_e_conta.sql");

describe.skipIf(!PG_AVAILABLE)("Copiloto · teto por anúncio e conta (PostgreSQL real)", () => {
  let pg: PgCluster;
  beforeAll(() => {
    pg = startCluster([STUB, MIG], { bin: process.env.GUEST_AI_PG_BIN });
  });
  afterAll(async () => {
    await pg?.stop();
  });
  beforeEach(async () => {
    await pg.sql("truncate public.guest_ai_copilot_suggestions, public.property_chat_messages, public.property_chat_conversations, public.property_listing_raw_data, public.properties");
  });

  const T1 = "a1000000-0000-4000-8000-000000000001";
  const T2 = "a2000000-0000-4000-8000-000000000002";

  async function listing(tenant: string, opts: { enabled?: boolean; limit?: number | null } = {}) {
    const id = randomUUID();
    await pg.sql(`insert into public.properties values ('${id}','${tenant}')`);
    await pg.sql(
      `insert into public.property_listing_raw_data (property_id, owner_id, airbnb_listing_id, airbnb_ai_enabled, ai_daily_cost_limit_usd) values ('${id}', '${tenant}', '${id}', ${opts.enabled ?? true}, ${opts.limit ?? "null"})`,
    );
    return id;
  }
  async function spend(tenant: string, property: string, usd: number) {
    const c = randomUUID();
    const m = randomUUID();
    await pg.sql(`insert into public.property_chat_conversations values ('${c}','${property}')`);
    await pg.sql(`insert into public.property_chat_messages (id, conversation_id, sender_type, role) values ('${m}','${c}','guest','user')`);
    await pg.sql(
      `insert into public.guest_ai_copilot_suggestions (tenant_id, property_id, conversation_id, trigger_message_id, surface, state, outcome_kind, gateway_cost_usd) values ('${tenant}','${property}','${c}','${m}','airbnb','available','reply',${usd})`,
    );
  }
  async function claim(tenant: string, property: string, unit = 1): Promise<string> {
    const c = randomUUID();
    const m = randomUUID();
    await pg.sql(`insert into public.property_chat_conversations values ('${c}','${property}')`);
    await pg.sql(`insert into public.property_chat_messages (id, conversation_id, sender_type, role) values ('${m}','${c}','guest','user')`);
    const out = await pg.sql(
      `select (public.copilot_claim_generation('${tenant}','${property}','${c}','${m}','airbnb',${unit},1))->>'result'`,
    );
    return out.trim();
  }

  it("uma conta com 1 anúncio: teto US$ 1 (0,85 + reserva 0,15 cabe; 0,9 não)", async () => {
    const a = await listing(T1);
    await spend(T1, a, 0.85);
    expect(await claim(T1, a)).toBe("claimed");
    await pg.sql("truncate public.guest_ai_copilot_suggestions");
    await spend(T1, a, 0.9);
    expect(await claim(T1, a)).toBe("daily_budget_exceeded");
  });

  it("elástico: com 3 anúncios (conta US$ 3) um anúncio passa de US$ 1 sem estourar", async () => {
    const [a] = [await listing(T1), await listing(T1), await listing(T1)];
    await spend(T1, a, 1.5);
    expect(await claim(T1, a)).toBe("claimed");
  });

  it("limite máximo por anúncio: 3× o próprio teto, mesmo com folga na conta", async () => {
    const [a] = [await listing(T1), await listing(T1), await listing(T1), await listing(T1)];
    await spend(T1, a, 2.9);
    expect(await claim(T1, a)).toBe("daily_budget_exceeded");
    await pg.sql("truncate public.guest_ai_copilot_suggestions");
    await spend(T1, a, 2.8);
    expect(await claim(T1, a)).toBe("claimed");
  });

  it("teto da conta: outros anúncios da conta consomem a folga e bloqueiam um anúncio parado", async () => {
    const a = await listing(T1);
    const b = await listing(T1);
    const c = await listing(T1);
    await spend(T1, a, 2);
    await spend(T1, b, 0.9);
    expect(await claim(T1, c)).toBe("daily_budget_exceeded");
  });

  it("contas isoladas: o gasto de uma conta não afeta a outra", async () => {
    const a = await listing(T1);
    const x = await listing(T2);
    await spend(T1, a, 5);
    expect(await claim(T1, a)).toBe("daily_budget_exceeded");
    expect(await claim(T2, x)).toBe("claimed");
  });

  it("exceção por anúncio (ai_daily_cost_limit_usd) vale no teto do anúncio e na soma da conta", async () => {
    const a = await listing(T1, { limit: 5 });
    await spend(T1, a, 4);
    expect(await claim(T1, a)).toBe("claimed"); // teto 5 (e 3× = 15)
    await pg.sql("truncate public.guest_ai_copilot_suggestions");
    await spend(T1, a, 4.9);
    expect(await claim(T1, a)).toBe("daily_budget_exceeded");
  });

  it("anúncio sem a IA ligada na conta: o teto da conta é, no mínimo, o do anúncio atendido", async () => {
    const a = await listing(T1, { enabled: false });
    await spend(T1, a, 0.8);
    expect(await claim(T1, a)).toBe("claimed");
    await pg.sql("truncate public.guest_ai_copilot_suggestions");
    await spend(T1, a, 0.95);
    expect(await claim(T1, a)).toBe("daily_budget_exceeded");
  });

  it("geração em curso reserva US$ 0,15 e conta contra o teto", async () => {
    const a = await listing(T1);
    await spend(T1, a, 0.7);
    const c = randomUUID();
    const m = randomUUID();
    await pg.sql(`insert into public.property_chat_conversations values ('${c}','${a}')`);
    await pg.sql(`insert into public.property_chat_messages (id, conversation_id, sender_type, role) values ('${m}','${c}','guest','user')`);
    await pg.sql(
      `insert into public.guest_ai_copilot_suggestions (tenant_id, property_id, conversation_id, trigger_message_id, surface) values ('${T1}','${a}','${c}','${m}','airbnb')`,
    );
    // 0,7 + 0,15 (em curso) + 0,15 (nova) = 1,0 → cabe; com 0,75 já não caberia
    expect(await claim(T1, a)).toBe("claimed");
  });
});
