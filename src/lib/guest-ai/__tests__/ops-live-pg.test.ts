/**
 * GATE G2c · migration `20261107020000_guest_ai_ops_live.sql` (sobre a G2a) contra POSTGRES REAL (cluster local
 * temporário; nada toca a produção). Cobre: privilégios das 3 RPCs; regras de modo/desfecho no banco (live só
 * com claim/finish; record live só recusa; shadow igual à G2a); ciclo claim → finish (applied com foto depois e
 * `applied_at`; refused com motivo); reentrega e 10 reservas simultâneas ⇒ uma só; finish duas vezes ⇒
 * invalid_state; escopo do claim; idempotência da migration; e as consultas de monitoramento (só leitura).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "./pg/pg-cluster";
import { OPS_ACTIONS, OPS_AUDIT_OUTCOMES } from "@/lib/guest-ai/ops/contracts";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const SETUP = path.join(__dirname, "pg", "copilot-setup.sql");
const G2A = path.join(REPO, "supabase/migrations/20261107010000_guest_ai_ops_actions.sql");
const G2C = path.join(REPO, "supabase/migrations/20261107020000_guest_ai_ops_live.sql");
const OPS_DIR = path.join(REPO, "ops/guest-ai-ops");

const T1 = "a1000000-0000-4000-8000-000000000001";
const T2 = "a2000000-0000-4000-8000-000000000002";
const P1 = "b1000000-0000-4000-8000-000000000001";
const P2 = "b2000000-0000-4000-8000-000000000002";
const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c2000000-0000-4000-8000-000000000002";
const R1 = "f1000000-0000-4000-8000-000000000001";
const R2 = "f2000000-0000-4000-8000-000000000002";
let seq = 0;
const uid = (p = "d0000000") => `${p}-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

let pg: PgCluster;
type J = Record<string, unknown> & { result?: string; reason?: string; id?: string };
const lit = (v: unknown, k = ""): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'${k === "p_proposed_date" ? "::date" : ""}`;
};
const call = async (fn: string, args: Record<string, unknown>): Promise<J> =>
  JSON.parse(
    await pg.sql(
      `select public.${fn}(${Object.entries(args)
        .map(([k, v]) => `${k} => ${lit(v, k)}`)
        .join(", ")})`,
      { role: "service_role" },
    ),
  ) as J;

async function message(conv = C1, role = "user"): Promise<string> {
  const id = uid("e0000000");
  await pg.sql(
    `insert into public.property_chat_messages (id, conversation_id, sender_type, role) values ('${id}', '${conv}', '${role === "user" ? "guest" : "human"}', '${role}')`,
  );
  return id;
}
const scope = (msg: string, over: Record<string, unknown> = {}) => ({
  p_tenant_id: T1,
  p_property_id: P1,
  p_conversation_id: C1,
  p_trigger_message_id: msg,
  p_reservation_id: R1,
  p_suggestion_id: null,
  p_action: "checkin_done",
  p_evidence_message_id: msg,
  p_proposed_date: null,
  p_proposed_time: null,
  p_madrugada: false,
  p_card_before: { exists: true, status: "pending" },
  ...over,
});
const record = (msg: string, over: Record<string, unknown> = {}) => {
  const { p_card_before, ...rest } = scope(msg);
  return call("guest_ai_ops_record", {
    ...rest,
    p_mode: "live",
    p_outcome: "refused",
    p_code: "not_in_stay",
    p_card_before,
    ...over,
  });
};
const row = async (id: string) =>
  JSON.parse(
    await pg.sql(
      `select row_to_json(x)::text from (select mode, outcome, code, card_after, applied_at is not null as applied from public.guest_ai_ops_actions where id = '${id}') x`,
    ),
  ) as Record<string, unknown>;

async function seed(): Promise<void> {
  await pg.sql(`truncate public.guest_ai_ops_actions, public.property_chat_messages, public.property_chat_conversations, public.guest_arrival_status cascade;
    delete from public.property_reservations; delete from public.properties;
    insert into public.properties (id, owner_id, name) values ('${P1}', '${T1}', 'Casa 1'), ('${P2}', '${T2}', 'Casa 2');
    insert into public.property_chat_conversations (id, property_id, guest_session_id) values ('${C1}', '${P1}', 'airbnb:1'), ('${C2}', '${P2}', 'airbnb:2');
    insert into public.property_reservations (id, property_id) values ('${R1}', '${P1}'), ('${R2}', '${P2}');`);
}

describe.skipIf(!PG_AVAILABLE)("G2c · auditoria em modo live contra PostgreSQL real", () => {
  beforeAll(async () => {
    pg = startCluster([SETUP], { bin: process.env.GUEST_AI_PG_BIN });
    await pg.sql(`create table if not exists public.property_reservations (id uuid primary key, property_id uuid not null);
      alter table public.properties add column if not exists name text;
      create table if not exists public.guest_arrival_status (id uuid primary key default gen_random_uuid(), reservation_id uuid, kind text,
        status text, done_at timestamptz, arrival_time_override text, arrival_time_source text, late_checkout_time text, updated_at timestamptz default now());`);
    await pg.sql(readFileSync(G2A, "utf8"));
    await pg.sql(readFileSync(G2C, "utf8"));
  }, 120_000);
  afterAll(() => pg?.stop());
  beforeEach(seed);

  it("migration sem cron, chamada externa ou escrita em card", () => {
    const sql = readFileSync(G2C, "utf8").replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/cron\.|net\.http|pg_net|http_post|guest_arrival_status/i);
  });

  it("privilégios: as 3 RPCs só para service_role, SECURITY DEFINER e search_path fixo", async () => {
    for (const fn of [
      "public.guest_ai_ops_record(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, text, boolean, jsonb)",
      "public.guest_ai_ops_claim(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, date, text, boolean, jsonb)",
      "public.guest_ai_ops_finish(uuid, text, text, jsonb)",
    ]) {
      for (const [role, want] of [
        ["anon", "f"],
        ["authenticated", "f"],
        ["service_role", "t"],
      ] as const) {
        expect(
          await pg.sql(`select has_function_privilege('${role}', '${fn}', 'EXECUTE')`),
          `${fn} ${role}`,
        ).toBe(want);
      }
      expect(
        await pg.sql(
          `select prosecdef || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = '${fn}'::regprocedure`,
        ),
      ).toBe("true search_path=pg_catalog, pg_temp");
    }
  });

  it("record: shadow igual à G2a; live só aceita recusa (aplicação só por claim/finish)", async () => {
    const m = await message();
    expect(
      (await record(m, { p_mode: "shadow", p_outcome: "would_apply", p_code: null })).result,
    ).toBe("recorded");
    expect((await record(m, { p_action: "checkout_done" })).result).toBe("recorded");
    expect(
      await record(m, { p_action: "eta_checkin", p_outcome: "applied", p_code: null }),
    ).toMatchObject({ reason: "outcome" });
    expect(
      await record(m, { p_action: "eta_checkin", p_outcome: "would_apply", p_code: null }),
    ).toMatchObject({ reason: "outcome" });
    expect(await record(m, { p_action: "eta_checkin", p_mode: "on" })).toMatchObject({
      reason: "mode",
    });
  });

  it("claim → finish applied: foto depois e applied_at; reentrega ⇒ exists; finish de novo ⇒ invalid_state", async () => {
    const m = await message();
    const c = await call("guest_ai_ops_claim", scope(m));
    expect(c.result).toBe("claimed");
    expect((await call("guest_ai_ops_claim", scope(m))).result).toBe("exists");
    expect(await row(c.id!)).toMatchObject({ mode: "live", outcome: "claimed", applied: false });
    const after = { exists: true, status: "done" };
    expect(
      (
        await call("guest_ai_ops_finish", {
          p_id: c.id,
          p_outcome: "applied",
          p_code: null,
          p_card_after: after,
        })
      ).result,
    ).toBe("finished");
    expect(await row(c.id!)).toMatchObject({
      outcome: "applied",
      code: null,
      card_after: after,
      applied: true,
    });
    expect(
      (
        await call("guest_ai_ops_finish", {
          p_id: c.id,
          p_outcome: "refused",
          p_code: "x",
          p_card_after: null,
        })
      ).result,
    ).toBe("invalid_state");
  });

  it("claim → finish refused com motivo; sem motivo ⇒ invalid", async () => {
    const m = await message();
    const c = await call("guest_ai_ops_claim", scope(m));
    expect(
      await call("guest_ai_ops_finish", {
        p_id: c.id,
        p_outcome: "refused",
        p_code: null,
        p_card_after: null,
      }),
    ).toMatchObject({ reason: "values" });
    expect(
      (
        await call("guest_ai_ops_finish", {
          p_id: c.id,
          p_outcome: "refused",
          p_code: "panel_refused",
          p_card_after: null,
        })
      ).result,
    ).toBe("finished");
    expect(await row(c.id!)).toMatchObject({
      outcome: "refused",
      code: "panel_refused",
      applied: false,
    });
    expect(
      await call("guest_ai_ops_finish", {
        p_id: c.id,
        p_outcome: "claimed",
        p_code: null,
        p_card_after: null,
      }),
    ).toMatchObject({ reason: "arguments" });
  });

  it("10 reservas simultâneas da mesma mensagem + ação ⇒ 1 claimed, 9 exists", async () => {
    const m = await message();
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => call("guest_ai_ops_claim", scope(m))),
    );
    expect(rs.filter((r) => r.result === "claimed")).toHaveLength(1);
    expect(rs.filter((r) => r.result === "exists")).toHaveLength(9);
  });

  it("escopo do claim: reserva obrigatória e do mesmo imóvel; evidência do hóspede; mensagem da conversa", async () => {
    const m = await message();
    expect(await call("guest_ai_ops_claim", scope(m, { p_reservation_id: null }))).toMatchObject({
      reason: "arguments",
    });
    expect(await call("guest_ai_ops_claim", scope(m, { p_reservation_id: R2 }))).toMatchObject({
      reason: "reservation",
    });
    expect(await call("guest_ai_ops_claim", scope(m, { p_tenant_id: T2 }))).toMatchObject({
      reason: "scope",
    });
    const team = await message(C1, "assistant");
    expect(
      await call("guest_ai_ops_claim", scope(m, { p_evidence_message_id: team })),
    ).toMatchObject({ reason: "evidence" });
    expect(await call("guest_ai_ops_claim", scope(await message(C2)))).toMatchObject({
      reason: "message",
    });
    expect(await call("guest_ai_ops_claim", scope(m, { p_action: "release_keys" }))).toMatchObject({
      reason: "values",
    });
    expect(await pg.sql(`select count(*) from public.guest_ai_ops_actions`)).toBe("0");
  });

  it("late_checkout: evidência é mensagem da EQUIPE humana; uma concessão ⇒ um registro, em qualquer turno", async () => {
    const staff = await message(C1, "assistant");
    const guest = await message();
    const lc = (trigger: string, evidence: string) =>
      call(
        "guest_ai_ops_claim",
        scope(trigger, {
          p_action: "late_checkout",
          p_evidence_message_id: evidence,
          p_proposed_date: "2026-11-10",
          p_proposed_time: "13:00",
        }),
      );
    // pedido do hóspede nunca é evidência de late checkout; mensagem da equipe nunca prova ação do hóspede
    expect(await lc(guest, guest)).toMatchObject({ reason: "evidence" });
    expect(
      await call("guest_ai_ops_claim", scope(guest, { p_evidence_message_id: staff })),
    ).toMatchObject({
      reason: "evidence",
    });
    await pg.sql(
      `insert into public.property_chat_messages (id, conversation_id, sender_type, role) values ('${uid("e0000000")}', '${C1}', 'ai', 'assistant')`,
    );
    const ai = await pg.sql(
      `select id from public.property_chat_messages where sender_type = 'ai' limit 1`,
    );
    expect(await lc(guest, ai)).toMatchObject({ reason: "evidence" });
    const c = await lc(guest, staff);
    expect(c.result).toBe("claimed");
    // turno seguinte do hóspede encontra a MESMA concessão ⇒ exists (nunca duas gravações)
    expect((await lc(await message(), staff)).result).toBe("exists");
    expect(
      (
        await record(await message(), {
          p_action: "late_checkout",
          p_evidence_message_id: staff,
          p_code: "card_done",
        })
      ).result,
    ).toBe("exists");
    expect(
      (
        await call("guest_ai_ops_finish", {
          p_id: c.id,
          p_outcome: "applied",
          p_code: null,
          p_card_after: { exists: true, late_checkout_time: "13:00" },
        })
      ).result,
    ).toBe("finished");
  });

  it("coerência no banco: applied exige applied_at; shadow nunca aplica", async () => {
    const ins = (mode: string, outcome: string, extra = "") =>
      pg.trySql(
        `insert into public.guest_ai_ops_actions (tenant_id, property_id, conversation_id, trigger_message_id, action, mode, outcome${extra ? ", applied_at" : ""}) values ('${T1}', '${P1}', '${C1}', '${uid()}', 'checkin_done', '${mode}', '${outcome}'${extra})`,
      );
    expect((await ins("live", "applied")).ok).toBe(false);
    expect((await ins("live", "applied", ", now()")).ok).toBe(true);
    expect((await ins("shadow", "applied", ", now()")).ok).toBe(false);
    expect((await ins("shadow", "claimed")).ok).toBe(false);
    expect((await ins("live", "would_apply")).ok).toBe(false);
    // paridade TS × SQL das ações (com a G2c) e dos desfechos
    const staff = await message(C1, "assistant");
    for (const a of OPS_ACTIONS) {
      const m = await message();
      const r = await record(m, {
        p_action: a,
        p_evidence_message_id: a === "late_checkout" ? staff : m,
      });
      expect(r.result, a).toBe("recorded");
    }
    for (const o of OPS_AUDIT_OUTCOMES)
      expect(
        await pg.sql(
          `select pg_get_constraintdef(oid) like '%${o}%' from pg_constraint where conname = 'guest_ai_ops_actions_mode_outcome'`,
        ),
      ).toBe("t");
  });

  it("reaplicar a G2c não altera nada (idempotente)", async () => {
    const m = await message();
    await call("guest_ai_ops_claim", scope(m));
    const snap = () =>
      pg.sql(`select md5(string_agg(conname || pg_get_constraintdef(oid), ',' order by conname)) || (select md5(string_agg(pg_get_functiondef(oid), '' order by proname)) from pg_proc where proname like 'guest_ai_ops_%')
        from pg_constraint where conrelid = 'public.guest_ai_ops_actions'::regclass`);
    const before = await snap();
    await pg.sql(readFileSync(G2C, "utf8"));
    expect(await snap()).toBe(before);
    expect(await pg.sql(`select count(*) from public.guest_ai_ops_actions`)).toBe("1");
  });

  it("consultas de monitoramento (ops/guest-ai-ops) são só leitura e rodam sobre a estrutura real", async () => {
    const m = await message();
    const c = await call("guest_ai_ops_claim", scope(m));
    await call("guest_ai_ops_finish", {
      p_id: c.id,
      p_outcome: "applied",
      p_code: null,
      p_card_after: { exists: true, status: "done" },
    });
    await record(m, {
      p_action: "eta_checkin",
      p_proposed_date: "2026-11-10",
      p_proposed_time: "13:00",
      p_code: "eta_out_of_bounds",
    });
    await pg.sql(
      `insert into public.guest_arrival_status (reservation_id, kind, status, done_at) values ('${R1}', 'checkin', 'pending', null)`,
    );
    const files = [
      "01-resumo.sql",
      "02-volume-diario.sql",
      "03-detalhe-recente.sql",
      "04-conferencia-g2b.sql",
      "05-escritas-interrompidas.sql",
    ];
    for (const f of files) {
      const code = readFileSync(path.join(OPS_DIR, f), "utf8").replace(/--.*$/gm, "").trim();
      expect(code, f).toMatch(/^(select|with)\b/i);
      expect(code, f).not.toMatch(
        /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|call|do)\b/i,
      );
      const r = await pg.trySql(`begin read only; ${code.replace(/;\s*$/, "")}; rollback;`);
      expect(r.ok, f).toBe(true);
    }
    // a conferência aponta a conclusão aplicada que a equipe desfez (card voltou a pendente)
    const q = (
      await pg.sql(readFileSync(path.join(OPS_DIR, "04-conferencia-g2b.sql"), "utf8"))
    ).split("\n");
    expect(q.some((l) => l.startsWith("live|checkin_done|1|0|1|"))).toBe(true);
  });
});
