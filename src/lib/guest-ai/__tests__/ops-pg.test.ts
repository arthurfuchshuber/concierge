/**
 * GATE G2a · migration `20261107010000_guest_ai_ops_actions.sql` contra POSTGRES REAL (cluster local
 * temporário; nada toca a produção). Cobre: privilégios (RPC só service_role; tabela só leitura por
 * membros do imóvel), modo `shadow` imposto pelo banco, escopo (conversa/imóvel/conta, mensagem, evidência
 * do hóspede, reserva do mesmo imóvel), idempotência concorrente, vocabulário fechado, RLS entre contas,
 * idempotência da própria migration e ausência de cron/chamada externa.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "./pg/pg-cluster";
import { OPS_ACTIONS, OPS_REFUSAL_CODES } from "@/lib/guest-ai/ops/contracts";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const SETUP = path.join(__dirname, "pg", "copilot-setup.sql");
const MIGRATION = path.join(REPO, "supabase/migrations/20261107010000_guest_ai_ops_actions.sql");

const T1 = "a1000000-0000-4000-8000-000000000001";
const T2 = "a2000000-0000-4000-8000-000000000002";
const MEMBER = "a3000000-0000-4000-8000-000000000003";
const P1 = "b1000000-0000-4000-8000-000000000001";
const P2 = "b2000000-0000-4000-8000-000000000002";
const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c2000000-0000-4000-8000-000000000002";
const R1 = "f1000000-0000-4000-8000-000000000001";
const R2 = "f2000000-0000-4000-8000-000000000002";
let seq = 0;
const uid = (p = "d0000000") => `${p}-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

let pg: PgCluster;
type J = Record<string, unknown> & { result?: string; reason?: string };
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const call = (args: Record<string, unknown>) =>
  `select public.guest_ai_ops_record(${Object.entries(args)
    .map(([k, v]) => `${k} => ${lit(v)}${k === "p_proposed_date" && v ? "::date" : ""}`)
    .join(", ")})`;
const record = async (args: Record<string, unknown>): Promise<J> =>
  JSON.parse(await pg.sql(call(args), { role: "service_role" })) as J;

async function message(conv = C1, role = "user", note = false): Promise<string> {
  const id = uid("e0000000");
  await pg.sql(
    `insert into public.property_chat_messages (id, conversation_id, sender_type, role, is_internal_note) values ('${id}', '${conv}', '${role === "user" ? "guest" : "human"}', '${role}', ${note})`,
  );
  return id;
}
const args = (msg: string, over: Record<string, unknown> = {}) => ({
  p_tenant_id: T1,
  p_property_id: P1,
  p_conversation_id: C1,
  p_trigger_message_id: msg,
  p_reservation_id: R1,
  p_suggestion_id: null,
  p_action: "checkin_done",
  p_mode: "shadow",
  p_outcome: "would_apply",
  p_code: null,
  p_evidence_message_id: msg,
  p_proposed_date: null,
  p_proposed_time: null,
  p_madrugada: false,
  p_card_before: { exists: false },
  ...over,
});

async function seed(): Promise<void> {
  await pg.sql(`truncate public.guest_ai_ops_actions, public.property_chat_messages, public.property_chat_conversations cascade;
    delete from public.property_reservations; delete from public.property_assignments; delete from public.account_members; delete from public.properties;
    insert into public.properties (id, owner_id) values ('${P1}', '${T1}'), ('${P2}', '${T2}');
    insert into public.property_chat_conversations (id, property_id, guest_session_id) values ('${C1}', '${P1}', 'airbnb:1'), ('${C2}', '${P2}', 'airbnb:2');
    insert into public.property_reservations (id, property_id) values ('${R1}', '${P1}'), ('${R2}', '${P2}');
    insert into public.account_members (owner_id, member_user_id, role, status, all_properties) values
      ('${T1}', '${T1}', 'owner', 'active', true), ('${T2}', '${T2}', 'owner', 'active', true), ('${T1}', '${MEMBER}', 'agent', 'active', false);
    insert into public.property_assignments (tenant_id, property_id, user_id, status) values ('${T1}', '${P1}', '${MEMBER}', 'active');`);
}

describe.skipIf(!PG_AVAILABLE)(
  "G2a · auditoria das ações operacionais contra PostgreSQL real",
  () => {
    beforeAll(async () => {
      pg = startCluster([SETUP], { bin: process.env.GUEST_AI_PG_BIN });
      await pg.sql(
        `create table if not exists public.property_reservations (id uuid primary key, property_id uuid not null)`,
      );
      await pg.sql(readFileSync(MIGRATION, "utf8"));
    }, 120_000);
    afterAll(() => pg?.stop());
    beforeEach(seed);

    it("migration sem cron, chamada externa ou escrita em card", () => {
      const sql = readFileSync(MIGRATION, "utf8").replace(/--.*$/gm, "");
      expect(sql).not.toMatch(/cron\.|net\.http|pg_net|http_post|guest_arrival_status/i);
    });

    it("privilégios: RPC só service_role; tabela só SELECT para authenticated; nada para anon", async () => {
      const fn =
        "public.guest_ai_ops_record(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, text, boolean, jsonb)";
      const ex = async (role: string) =>
        (await pg.sql(`select has_function_privilege('${role}', '${fn}', 'EXECUTE')`)) === "t";
      expect(await ex("anon")).toBe(false);
      expect(await ex("authenticated")).toBe(false);
      expect(await ex("service_role")).toBe(true);
      expect(
        await pg.sql(
          `select prosecdef || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = '${fn}'::regprocedure`,
        ),
      ).toBe("true search_path=pg_catalog, pg_temp");
      for (const role of ["anon", "authenticated", "service_role"]) {
        const ins = await pg.trySql(
          `insert into public.guest_ai_ops_actions (tenant_id, property_id, conversation_id, trigger_message_id, action, mode, outcome) values ('${T1}', '${P1}', '${C1}', '${uid()}', 'checkin_done', 'shadow', 'would_apply')`,
          { role },
        );
        expect(ins.ok, role).toBe(false);
      }
      expect(
        (await pg.trySql(`select 1 from public.guest_ai_ops_actions`, { role: "anon" })).ok,
      ).toBe(false);
      expect(
        (
          await pg.trySql(
            `select ${"public.guest_ai_ops_record"}(null,null,null,null,null,null,null,null,null,null,null,null,null,null,null)`,
            { role: "authenticated" },
          )
        ).ok,
      ).toBe(false);
    });

    it("registra would_apply e refused; reentrega da mesma mensagem + ação ⇒ exists (uma linha só)", async () => {
      const m = await message();
      expect((await record(args(m))).result).toBe("recorded");
      expect((await record(args(m))).result).toBe("exists");
      expect(
        (
          await record(
            args(m, {
              p_action: "eta_checkin",
              p_outcome: "refused",
              p_code: "eta_out_of_bounds",
              p_proposed_date: "2026-11-10",
              p_proposed_time: "13:00",
            }),
          )
        ).result,
      ).toBe("recorded");
      expect(await pg.sql(`select count(*) from public.guest_ai_ops_actions`)).toBe("2");
    });

    it("10 registros simultâneos da mesma mensagem + ação ⇒ 1 recorded, 9 exists", async () => {
      const m = await message();
      const rs = await Promise.all(Array.from({ length: 10 }, () => record(args(m))));
      expect(rs.filter((r) => r.result === "recorded")).toHaveLength(1);
      expect(rs.filter((r) => r.result === "exists")).toHaveLength(9);
    });

    it("G2a impõe só observação: modo on, desfecho applied ⇒ recusado pelo banco", async () => {
      const m = await message();
      expect(await record(args(m, { p_mode: "on" }))).toMatchObject({
        result: "invalid",
        reason: "mode",
      });
      expect(await record(args(m, { p_outcome: "applied" }))).toMatchObject({
        result: "invalid",
        reason: "values",
      });
      expect(await pg.sql(`select count(*) from public.guest_ai_ops_actions`)).toBe("0");
    });

    it("escopo: outro tenant, mensagem de outra conversa, evidência da equipe/nota interna, reserva de outro imóvel ⇒ invalid", async () => {
      const m = await message();
      expect(await record(args(m, { p_tenant_id: T2 }))).toMatchObject({ reason: "scope" });
      expect(await record(args(m, { p_property_id: P2 }))).toMatchObject({ reason: "scope" });
      const other = await message(C2);
      expect(await record(args(other))).toMatchObject({ reason: "message" });
      const team = await message(C1, "assistant");
      expect(await record(args(m, { p_evidence_message_id: team }))).toMatchObject({
        reason: "evidence",
      });
      const note = await message(C1, "user", true);
      expect(await record(args(m, { p_evidence_message_id: note }))).toMatchObject({
        reason: "evidence",
      });
      expect(await record(args(m, { p_reservation_id: R2 }))).toMatchObject({
        reason: "reservation",
      });
      expect(await pg.sql(`select count(*) from public.guest_ai_ops_actions`)).toBe("0");
    });

    it("vocabulário fechado e coerência: ação, código, hora e campos de previsão", async () => {
      const m = await message();
      expect(await record(args(m, { p_action: "release_keys" }))).toMatchObject({
        reason: "values",
      });
      expect(await record(args(m, { p_outcome: "refused", p_code: null }))).toMatchObject({
        reason: "values",
      });
      expect(await record(args(m, { p_code: "lexical_negation" }))).toMatchObject({
        reason: "values",
      }); // código só em recusa
      expect(await record(args(m, { p_outcome: "refused", p_code: "Código Livre" }))).toMatchObject(
        { reason: "values" },
      );
      expect(
        await record(args(m, { p_action: "eta_checkin", p_proposed_time: "16h30" })),
      ).toMatchObject({ reason: "values" });
      expect(await record(args(m, { p_proposed_time: "16:30" }))).toMatchObject({
        reason: "values",
      }); // previsão só em eta_*
      expect(await record(args(m, { p_card_before: [1] }))).toMatchObject({ reason: "values" });
      // paridade TS × SQL
      for (const a of OPS_ACTIONS)
        expect((await record(args(await message(), { p_action: a }))).result, a).toBe("recorded");
      for (const c of OPS_REFUSAL_CODES) expect(c).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    });

    it("saída antecipada leva só a nova data do card; madrugada só na previsão de chegada", async () => {
      expect(
        (
          await record(
            args(await message(), { p_action: "early_departure", p_proposed_date: "2026-11-11" }),
          )
        ).result,
      ).toBe("recorded");
      expect(
        await record(
          args(await message(), {
            p_action: "early_departure",
            p_proposed_date: "2026-11-11",
            p_proposed_time: "10:00",
          }),
        ),
      ).toMatchObject({ reason: "values" });
      expect(
        (
          await record(
            args(await message(), {
              p_action: "eta_checkin",
              p_proposed_date: "2026-11-10",
              p_proposed_time: "01:30",
              p_madrugada: true,
            }),
          )
        ).result,
      ).toBe("recorded");
      expect(
        await record(
          args(await message(), {
            p_action: "eta_checkout",
            p_proposed_date: "2026-11-13",
            p_proposed_time: "04:00",
            p_madrugada: true,
          }),
        ),
      ).toMatchObject({ reason: "values" });
      expect(
        await record(args(await message(), { p_action: "checkout_done", p_madrugada: true })),
      ).toMatchObject({ reason: "values" });
    });

    it("RLS: dono e membro do imóvel leem; outra conta não vê nada", async () => {
      await record(args(await message()));
      const count = async (who: string) =>
        Number(
          (
            await pg.sql(
              `select set_config('request.jwt.claim.sub', '${who}', false); select count(*) from public.guest_ai_ops_actions`,
              { role: "authenticated" },
            )
          )
            .split("\n")
            .pop(),
        );
      expect(await count(T1)).toBe(1);
      expect(await count(MEMBER)).toBe(1);
      expect(await count(T2)).toBe(0);
      const upd = await pg.trySql(
        `select set_config('request.jwt.claim.sub', '${T1}', false); update public.guest_ai_ops_actions set outcome = 'refused'`,
        { role: "authenticated" },
      );
      expect(upd.ok).toBe(false);
    });

    it("reaplicar a migration não altera nada (idempotente)", async () => {
      await record(args(await message()));
      const snap = async () =>
        pg.sql(`select md5(pg_get_functiondef('public.guest_ai_ops_record(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, text, boolean, jsonb)'::regprocedure) ||
        coalesce((select relacl::text from pg_class where oid = 'public.guest_ai_ops_actions'::regclass), '') ||
        (select string_agg(polname, ',') from pg_policy where polrelid = 'public.guest_ai_ops_actions'::regclass))`);
      const before = await snap();
      await pg.sql(readFileSync(MIGRATION, "utf8"));
      expect(await snap()).toBe(before);
      expect(await pg.sql(`select count(*) from public.guest_ai_ops_actions`)).toBe("1");
    });
  },
);
