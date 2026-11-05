/**
 * ENTREGA 4 · revisão GLOBAL — ENSAIO INTEGRADO em PostgreSQL 17.6 descartável com papéis, privilégios
 * padrão, índices e estrutura legada iguais aos da produção auditada (ver `prodlike.ts`). Só dados
 * sintéticos; nenhuma credencial real; nenhuma chamada externa (nenhum provedor, nenhum Gateway).
 *
 * Base global sintética = a distribuição REAL do inventário de produção (04/11/2026: 44 imóveis, 3 tenants,
 * 43 elegíveis, 1 sem canal de hóspede) + um conjunto de casos de borda que exercita CADA motivo de
 * inelegibilidade. Os cenários de fluxo do worker (pausas explícita/derivada, falha do Gateway, falha do
 * banco, disjuntor, worker perdido, lease expirado) rodam na suíte `e3/*` contra a MESMA configuração
 * (lease + Shadow + escopo global) com o worker real.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildExecutionRecord,
  NO_GATEWAY,
  validateExecutionRecord,
} from "@/lib/guest-ai/shadow-exec/extract";
import { recordToRow } from "@/lib/guest-ai/data/shadow-store.server";
import { MIG, OPS, PG176_OK, readSql, startProdLike, type ProdLike } from "./prodlike";

const RESULTS = process.env.E4_RESULTS_DIR ?? "/tmp/e4-results";
const record = (name: string, data: unknown) => {
  try {
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(`${RESULTS}/${name}.json`, JSON.stringify(data, null, 1));
  } catch {
    /* auxiliar */
  }
};
const ACTOR = "ac000000-0000-4000-8000-0000000000e4";
const EVID = "e4".repeat(32);
const hex = (n: number, w = 12) => n.toString(16).padStart(w, "0");
const U = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${hex(n)}`;
// tenants sintéticos (A, B, C reproduzem a produção; E, X, W, V são casos de borda)
const T = {
  A: U("0000000a", 1),
  B: U("0000000b", 2),
  C: U("0000000c", 3),
  E: U("0000000e", 4),
  X: U("0000000f", 5),
  W: U("0000000d", 6),
  V: U("00000009", 7),
};
const PA = Array.from({ length: 11 }, (_, i) => U("a1000000", i + 1));
const PB = Array.from({ length: 32 }, (_, i) => U("b1000000", i + 1));
const PC = [U("c1000000", 1)];
const PE = Array.from({ length: 10 }, (_, i) => U("e1000000", i + 1));
const PX = U("f1000000", 1);
const PW = U("d1000000", 1);
const PV = U("91000000", 1);

type Check = { check_name: string; expected: string; found: string; ok: boolean | null };
const stripSemi = (s: string) => s.trim().replace(/;\s*$/, "");
const validate = (db: ProdLike) => db.rows<Check>(stripSemi(readSql(OPS("02-validate.sql"))));
const preflight = (db: ProdLike) => db.rows<Check>(stripSemi(readSql(OPS("01-preflight.sql"))));
const inventory = (db: ProdLike) =>
  db.rows<{ tenant: string; status: string; properties: number }>(
    stripSemi(readSql(OPS("06-inventory.sql"))),
  );
const failing = (cs: Check[]) => cs.filter((c) => c.ok !== true);
const applyAll = (db: ProdLike) => [db.file(MIG.lease), db.file(MIG.shadow), db.file(MIG.global)];

const lit = (v: unknown) =>
  v === null || v === undefined
    ? "null"
    : typeof v === "number" || typeof v === "boolean"
      ? String(v)
      : typeof v === "object"
        ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
        : `'${String(v).replace(/'/g, "''")}'`;
async function rpc(
  db: ProdLike,
  fn: string,
  args: Record<string, unknown> = {},
  role?: string,
): Promise<Record<string, unknown>> {
  const named = Object.entries(args)
    .map(([k, v]) => `${k} => ${lit(v)}`)
    .join(", ");
  return JSON.parse(await db.sql(`select public.${fn}(${named})`, role ? { role } : undefined));
}
const sr = (db: ProdLike, fn: string, args: Record<string, unknown> = {}) =>
  rpc(db, fn, args, "service_role");
const admin = (db: ProdLike, fn: string, args: Record<string, unknown> = {}) => rpc(db, fn, args);
const gate = async (db: ProdLike, t: string, p: string) =>
  await db.sql(`select coalesce(public.guest_ai_shadow_property_gate('${t}', '${p}'), 'ACTIVE')`);

/** Legado + estrutura legada da produção (só dados sintéticos). */
async function seedProdInventory(db: ProdLike) {
  const props: string[] = [];
  const add = (
    id: string,
    owner: string,
    o: {
      published?: boolean;
      guide?: boolean;
      checkin?: string | null;
      checkout?: string | null;
      archived?: boolean;
    } = {},
  ) =>
    props.push(
      `('${id}', '${owner}', 'Imóvel sintético ${id.slice(0, 8)}-${id.slice(-3)}', 'sint-${id}', ${o.published ?? true}, ${o.guide ?? true}, ${lit(o.checkin === undefined ? "15:00" : o.checkin)}, ${lit(o.checkout === undefined ? "11:00" : o.checkout)}, ${o.archived ? "now()" : "null"})`,
    );
  PA.forEach((p, i) => add(p, T.A, { published: i < 8 }));
  PB.forEach((p, i) => add(p, T.B, { published: i < 31 }));
  add(PC[0]!, T.C);
  add(PE[0]!, T.E, { archived: true });
  add(PE[1]!, T.E);
  add(PE[2]!, T.E);
  add(PE[3]!, T.E);
  add(PE[4]!, T.E);
  add(PE[5]!, T.E, { checkin: null });
  add(PE[6]!, T.E, { checkout: "   " });
  add(PE[7]!, T.E, { published: false });
  add(PE[8]!, T.E, { published: false });
  add(PE[9]!, T.E, { guide: false });
  add(PX, T.X);
  add(PW, T.W, { published: false });
  add(PV, T.V, { published: false });
  await db.sql(
    `insert into public.properties (id, owner_id, name, slug, published, guide_created, checkin_time, checkout_time, archived_at) values ${props.join(",")}`,
  );
  await db.sql(
    `insert into public.profiles (id) values ${[T.A, T.B, T.C, T.E, T.W, T.V].map((t) => `('${t}')`).join(",")}`,
  );
  // anúncios: os 11 de A (consistentes); casos de borda de E
  const l = PA.map((p, i) => `('${p}', '${T.A}', 'L-A-${i}', 'CX-A-${i}', null, null, null)`);
  l.push(`('${PE[1]}', '${T.A}', 'L-E-1', 'CX-E-1', null, null, null)`); // anúncio de OUTRO dono
  l.push(`('${PE[2]}', '${T.E}', 'L-E-2', 'CX-SHARED', null, null, null)`); // mesma propriedade Channex em dois imóveis
  l.push(`('${PE[3]}', '${T.E}', 'L-E-3', 'CX-SHARED', null, null, null)`);
  l.push(`('${PE[7]}', '${T.E}', 'L-E-7', 'CX-E-7', now(), null, null)`); // não encontrado
  l.push(`('${PE[8]}', '${T.E}', 'L-E-8', 'CX-E-8', null, now(), 'account_disconnected')`); // conta desconectada
  await db.sql(
    `insert into public.property_listing_raw_data (property_id, owner_id, airbnb_listing_id, channex_property_id, not_found_at, sync_paused_at, paused_reason) values ${l.join(",")}`,
  );
  await db.sql(
    `insert into public.channex_twin_links (owner_id, property_id) values ${PA.slice(0, 4)
      .map((p) => `('${T.A}', '${p}')`)
      .join(",")}, ('${T.A}', '${PE[4]}')`,
  );
  await db.sql(
    `insert into public.host_whatsapp_config (owner_id, status) values ('${T.W}', 'active'), ('${T.V}', 'pending')`,
  );
}
const EXPECTED_REASONS: Record<string, string> = {
  [PB[31]!]: "no_guest_channel",
  [PE[0]!]: "archived",
  [PE[1]!]: "listing_inconsistent",
  [PE[2]!]: "listing_inconsistent",
  [PE[3]!]: "listing_inconsistent",
  [PE[4]!]: "listing_inconsistent",
  [PE[5]!]: "operational_data_missing",
  [PE[6]!]: "operational_data_missing",
  [PE[7]!]: "no_guest_channel",
  [PE[8]!]: "no_guest_channel",
  [PE[9]!]: "no_guest_channel",
  [PX]: "tenant_unresolved",
  [PV]: "no_guest_channel",
};
const ALL_PROPS = [...PA, ...PB, ...PC, ...PE, PX, PW, PV];
const OWNER: Record<string, string> = Object.fromEntries([
  ...PA.map((p) => [p, T.A]),
  ...PB.map((p) => [p, T.B]),
  ...PC.map((p) => [p, T.C]),
  ...PE.map((p) => [p, T.E]),
  [PX, T.X],
  [PW, T.W],
  [PV, T.V],
]);

/** Volta o Shadow ao estado inicial (só o dono, no teste). */
async function resetShadow(db: ProdLike) {
  await db.sql(`truncate public.guest_ai_shadow_executions, public.guest_ai_shadow_budget_reservations, public.guest_ai_shadow_budget_days, public.guest_ai_shadow_transitions,
    public.guest_ai_shadow_access_log, public.guest_ai_shadow_inflight, public.guest_ai_shadow_property_switch, public.guest_ai_shadow_tenant_switch,
    public.guest_ai_shadow_switch_log, public.guest_ai_shadow_property_eligibility, public.guest_ai_conversation_leases;
    delete from public.guest_ai_shadow_control; insert into public.guest_ai_shadow_control (id, state, daily_cost_limit_usd) values (1, 'disabled', 1.00)`);
  await db.sql(
    `delete from public.property_chat_messages; delete from public.property_chat_conversations`,
  );
}
async function toRunning(db: ProdLike) {
  let v = Number((await sr(db, "shadow_get_control")).state_version);
  const cfg = await admin(db, "shadow_configure", {
    p_expected_version: v,
    p_actor: ACTOR,
    p_model_id: "openai/gpt-5.6-sol",
    p_reasoning_effort: "low",
    p_max_input_tokens: 40000,
    p_max_output_tokens: 1536,
    p_max_total_tokens: 42000,
    p_max_turn_cost_usd: 0.15,
    p_daily_cost_limit_usd: 1,
    p_max_daily_tokens: 5000000,
    p_max_daily_calls: 500,
    p_error_window_minutes: 60,
    p_error_min_sample: 20,
    p_budget_day_timezone: "UTC",
    p_telemetry_retention_days: 30,
    p_tick_interval_seconds: 60,
    p_max_conversations_per_tick: 3,
  });
  if (cfg.result !== "applied") throw new Error(`cfg:${String(cfg.result)}`);
  v = Number(cfg.state_version);
  v = Number(
    (
      await admin(db, "shadow_authorize_retention", {
        p_expected_version: v,
        p_actor: ACTOR,
        p_scope: "openai_responses",
        p_evidence_sha256: EVID,
      })
    ).state_version,
  );
  v = Number(
    (
      await admin(db, "shadow_transition", {
        p_expected_version: v,
        p_to: "ready",
        p_actor: ACTOR,
        p_reason: "authorized_activation",
      })
    ).state_version,
  );
  const r = await admin(db, "shadow_transition", {
    p_expected_version: v,
    p_to: "running",
    p_actor: ACTOR,
    p_reason: "authorized_activation",
  });
  if (r.result !== "applied") throw new Error(`running:${String(r.result)}`);
}
const openScope = async (db: ProdLike, version = 0) => {
  const r = await admin(db, "shadow_set_scope", {
    p_actor: ACTOR,
    p_expected_scope_version: version,
    p_scope: "all_eligible",
    p_reason: "authorized_global_activation",
    p_evidence_sha256: EVID,
  });
  if (r.result !== "applied") throw new Error(`scope:${String(r.result)}`);
};
/** Conversa sintética com mensagem de hóspede há `ageSeconds` (e, opcionalmente, resposta posterior da equipe). */
async function conv(
  db: ProdLike,
  n: number,
  property: string,
  ageSeconds: number,
  session = `sess-${n}`,
) {
  const id = U("c0000000", n);
  const msg = U("d0000000", n);
  await db.sql(`insert into public.property_chat_conversations (id, property_id, guest_session_id, last_message_at) values ('${id}', '${property}', '${session}', now() - interval '${ageSeconds} seconds');
    insert into public.property_chat_messages (id, conversation_id, role, sender_type, content, created_at) values ('${msg}', '${id}', 'user', 'guest', 'mensagem sintética', now() - interval '${ageSeconds} seconds')`);
  return { id, msg, property };
}
async function acquire(db: ProdLike) {
  const t = await sr(db, "shadow_acquire_tick");
  if (t.result !== "acquired") throw new Error(`tick:${String(t.result)}`);
  return String(t.tick_token);
}
const list = (db: ProdLike, token: string, limit = 3, lookback = 240) =>
  sr(db, "shadow_list_candidates", {
    p_tick_token: token,
    p_lookback_seconds: lookback,
    p_limit: limit,
  });
type Cand = {
  conversation_id: string;
  property_id: string;
  tenant_id: string;
  surface: string;
  message_id: string;
};
/** Registro SEM lote (desfecho bloqueado) — o que o worker grava; marca a conversa como avaliada. */
async function recordBlocked(db: ProdLike, c: Cand) {
  const r = validateExecutionRecord(
    buildExecutionRecord(
      null,
      {
        executionId: crypto.randomUUID(),
        tenantId: c.tenant_id,
        propertyId: c.property_id,
        conversationId: c.conversation_id,
        channel: "web",
        batchId: null,
        leaseVersion: null,
        modelId: null,
        startedAt: new Date(Date.now() + 1000).toISOString(),
        finishedAt: new Date(Date.now() + 1100).toISOString(),
        totalMs: 100,
        leaseMs: 0,
        contextMs: 0,
        gatewayMs: 0,
        validationMs: 0,
        gateway: NO_GATEWAY,
        estimatedInputTokens: null,
        pauseState: "not_evaluated",
        executionState: "blocked",
        technicalCode: null,
        blockCode: "pause_active",
        integrityCode: null,
        budgetExceeded: null,
        tokenLimitViolation: false,
        concurrencyDetected: false,
        forcedDecision: "human_pause_active",
      },
      "chain.2026-11-03.3",
    ),
  );
  if (!r) throw new Error("registro inválido");
  const out = await sr(db, "shadow_record_execution", { p_record: recordToRow(r) });
  if (out.result !== "recorded") throw new Error(`record:${String(out.result)}`);
}
/** Lote pronto no lease (o que o worker faz antes de reivindicar). */
async function readyBatch(db: ProdLike, convId: string, msg: string) {
  await db.sql(
    `select public.transition_conversation_lease('${convId}', 'observe', 0, null, array['${msg}']::uuid[])`,
    { role: "service_role" },
  );
  await db.sql(
    `select public.transition_conversation_lease('${convId}', 'mark_ready', 1, null, array['${msg}']::uuid[])`,
    { role: "service_role" },
  );
  return 2;
}
const claim = (
  db: ProdLike,
  token: string,
  exec: string,
  convId: string,
  tenant: string,
  property: string,
  version = 2,
) =>
  sr(db, "shadow_claim_execution", {
    p_tick_token: token,
    p_execution_id: exec,
    p_conversation_id: convId,
    p_expected_version: version,
    p_tenant_id: tenant,
    p_property_id: property,
    p_channel: "web",
  });

/** Impressão digital do legado: conteúdo + estrutura + ACL + políticas + gatilhos + índices das tabelas não Shadow. */
async function legacyFingerprint(db: ProdLike): Promise<string> {
  return db.sql(`select md5(
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from public.properties x) ||
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from public.property_chat_conversations x) ||
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from public.property_chat_messages x) ||
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from public.property_listing_raw_data x) ||
    (select string_agg(table_name || column_name || data_type || is_nullable || coalesce(column_default, ''), '|' order by table_name, column_name)
       from information_schema.columns where table_schema = 'public' and table_name not like 'guest\\_ai\\_%') ||
    (select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, '|' order by c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname not like 'guest\\_ai\\_%') ||
    (select coalesce(string_agg(polname || pg_get_expr(polqual, polrelid), '|' order by polname), '') from pg_policy) ||
    (select coalesce(string_agg(tgname, '|' order by tgname), '') from pg_trigger where not tgisinternal) ||
    (select coalesce(string_agg(indexname || indexdef, '|' order by indexname), '') from pg_indexes where schemaname = 'public' and tablename not like 'guest\\_ai\\_%') ||
    (select coalesce(string_agg(conname || pg_get_constraintdef(oid), '|' order by conname), '') from pg_constraint where conrelid in
       (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname not like 'guest\\_ai\\_%')))`);
}

describe.skipIf(!PG176_OK)(
  "E4 global · ensaio (PostgreSQL 17.6, papéis, privilégios e índices da produção)",
  () => {
    it("A1 · GATE A: inventário (antes) ⇒ preflight ⇒ aplicação inerte ⇒ validação 100% ⇒ NENHUM imóvel ativo, escopo `none`, nenhum cron", async () => {
      const db = startProdLike();
      try {
        await seedProdInventory(db);
        expect(db.version.startsWith("17.6")).toBe(true);
        const before = await inventory(db);
        const pre = await preflight(db);
        expect(failing(pre)).toEqual([]);
        const t0 = performance.now();
        expect(applyAll(db)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
        const applyMs = Math.round(performance.now() - t0);
        const val = await validate(db);
        record("e4g-A1-gate-a", {
          inventoryBefore: before,
          preflight: pre,
          validate: val,
          applyMs,
        });
        expect(failing(val)).toEqual([]);
        expect(val.filter((c) => c.check_name.startsWith("fingerprint")).length).toBe(3); // funções, colunas, constraints
        // nada ativo, por qualquer caminho: a porta recusa todos os 57 imóveis com `scope_off`
        expect(
          await db.sql(
            `select string_agg(distinct public.guest_ai_shadow_property_gate(owner_id, id), ',') from public.properties`,
          ),
        ).toBe("scope_off");
        expect((await sr(db, "shadow_get_control")).state).toBe("disabled");
        // nenhum worker consegue começar: sem trava (estado ≠ running), sem candidatas
        expect((await sr(db, "shadow_acquire_tick")).result).toBe("state_not_running");
        expect((await list(db, "c".repeat(64))).result).toBe("state_not_running");
      } finally {
        db.stop();
      }
    }, 180_000);

    it("A2 · estrutura LEGADA com dados: nada legado muda (conteúdo, colunas, ACL, RLS, políticas, gatilhos, índices, constraints)", async () => {
      const db = startProdLike();
      try {
        await seedProdInventory(db);
        await conv(db, 1, PA[0]!, 30, "airbnb:th-1");
        const before = await legacyFingerprint(db);
        applyAll(db);
        expect(await legacyFingerprint(db)).toBe(before);
      } finally {
        db.stop();
      }
    }, 180_000);

    it("A3 · REEXECUÇÃO: cada migration reaplicada aborta sem efeito; ordem trocada é recusada; impressão digital idêntica", async () => {
      const db = startProdLike();
      try {
        await seedProdInventory(db);
        const fp = async () =>
          (await validate(db))
            .filter((c) => c.check_name.startsWith("fingerprint"))
            .map((c) => c.found)
            .join("|");
        // ordem trocada (global antes do Shadow) ⇒ recusada pela guarda
        db.file(MIG.lease);
        expect((db.file(MIG.global) as { error: string }).error).toContain("pré-requisito ausente");
        db.file(MIG.shadow);
        db.file(MIG.global);
        const f1 = await fp();
        const again = applyAll(db);
        record(
          "e4g-A3-rerun",
          again.map((r) =>
            r.ok
              ? "ok"
              : (r as { error: string }).error.split("\n").find((l) => l.includes("ERROR")),
          ),
        );
        expect(again.every((r) => !r.ok)).toBe(true);
        expect((again[2] as { error: string }).error).toContain("já existem");
        expect(await fp()).toBe(f1);
      } finally {
        db.stop();
      }
    }, 180_000);

    it("A4 · ROLLBACK: 03a volta EXATAMENTE à base (porta FECHADA: nenhuma reivindicação passa); 03b remove tudo; legado intacto; reaplicação limpa", async () => {
      const db = startProdLike();
      try {
        await seedProdInventory(db);
        const legacy0 = await legacyFingerprint(db);
        // impressão digital do estado base (lease + Shadow, sem a global)
        db.file(MIG.lease);
        db.file(MIG.shadow);
        const baseFp = async () =>
          db.sql(`select md5(string_agg(p.proname || md5(p.prosrc) || coalesce(p.proacl::text, ''), '|' order by p.proname)) || ':' ||
        (select md5(string_agg(table_name || '.' || column_name || ':' || data_type, '|' order by table_name, column_name)) from information_schema.columns where table_schema = 'public' and table_name like 'guest\\_ai\\_%')
        from pg_proc p where p.proname like 'shadow\\_%' or p.proname like 'guest\\_ai\\_shadow\\_%'`);
        const base = await baseFp();
        db.file(MIG.global);
        // rollback recusado com o Shadow ativo
        await toRunning(db);
        expect((db.file(OPS("03a-rollback-global.sql")) as { error: string }).error).toContain(
          "Shadow ativo",
        );
        await admin(db, "shadow_emergency_stop", { p_actor: ACTOR });
        expect(db.file(OPS("03a-rollback-global.sql"))).toEqual({ ok: true });
        expect(await baseFp()).toBe(base);
        // base sozinha é FAIL-CLOSED: a porta fecha todo imóvel e a reivindicação recusa
        expect(await gate(db, T.A, PA[0]!)).toBe("scope_off");
        expect(db.file(OPS("03b-rollback-all.sql"))).toEqual({ ok: true });
        expect(
          await db.sql(`select count(*) from pg_class where relname like 'guest\\_ai\\_%'`),
        ).toBe("0");
        expect(
          await db.sql(
            `select count(*) from pg_proc where proname like 'shadow\\_%' or proname like 'guest\\_ai\\_shadow\\_%' or proname like '%\\_conversation\\_lease'`,
          ),
        ).toBe("0");
        expect(await legacyFingerprint(db)).toBe(legacy0);
        expect(failing(await preflight(db))).toEqual([]);
        expect(applyAll(db)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
        expect(failing(await validate(db))).toEqual([]);
      } finally {
        db.stop();
      }
    }, 240_000);

    describe("com as três migrations aplicadas e a BASE GLOBAL sintética (distribuição da produção + casos de borda)", () => {
      let db: ProdLike;
      beforeAll(async () => {
        db = startProdLike();
        await seedProdInventory(db);
        applyAll(db);
      }, 180_000);
      afterAll(() => db?.stop());

      it("G1 · INVENTÁRIO × FOTO: todos os imóveis classificados; motivos exatos; SQL somente leitura (06) = função do banco", async () => {
        await resetShadow(db);
        const snap = await admin(db, "shadow_refresh_eligibility", { p_actor: ACTOR });
        record("e4g-G1-refresh", snap);
        expect(snap).toMatchObject({
          result: "ok",
          properties: 57,
          tenants: 7,
          eligible: 44,
          ineligible: 13,
          rule_version: "eligibility.2026-11-05.1",
        });
        expect(snap.by_reason).toEqual({
          archived: 1,
          tenant_unresolved: 1,
          listing_inconsistent: 4,
          no_guest_channel: 5,
          operational_data_missing: 2,
        });
        const rows = await db.rows<{
          property_id: string;
          eligible: boolean;
          reason_code: string | null;
          tenant_id: string;
        }>(
          `select property_id, eligible, reason_code, tenant_id from public.guest_ai_shadow_property_eligibility`,
        );
        expect(rows).toHaveLength(ALL_PROPS.length);
        for (const r of rows) {
          expect(r.reason_code, r.property_id).toBe(EXPECTED_REASONS[r.property_id] ?? null);
          expect(r.tenant_id).toBe(OWNER[r.property_id]);
        }
        // a distribuição da produção: A 11/11, B 31/32 (1 sem canal), C 1/1
        const inv = await inventory(db);
        const byTenant = (t: string) =>
          Object.fromEntries(
            inv
              .filter((r) => r.tenant === t.slice(0, 8))
              .map((r) => [r.status, Number(r.properties)]),
          );
        expect(byTenant(T.A)).toEqual({ eligible: 11 });
        expect(byTenant(T.B)).toEqual({ eligible: 31, no_guest_channel: 1 });
        expect(byTenant(T.C)).toEqual({ eligible: 1 });
        // o script SQL puro (roda ANTES da aplicação) dá exatamente a foto da função
        const fromSnap = await db.rows<{ tenant: string; status: string; properties: number }>(
          `select left(tenant_id::text, 8) tenant, coalesce(reason_code, 'eligible') status, count(*)::int properties from public.guest_ai_shadow_property_eligibility group by 1, 2 order by 1, 2`,
        );
        expect(inv.map((r) => ({ ...r, properties: Number(r.properties) }))).toEqual(fromSnap);
        // refazer é idempotente; imóvel excluído some da foto
        expect(await admin(db, "shadow_refresh_eligibility", { p_actor: ACTOR })).toMatchObject({
          properties: 57,
          eligible: 44,
        });
      });

      it("G2 · ESCOPO GLOBAL sem teto: `none` bloqueia tudo; abrir exige evidência/CAS; aberto ⇒ TODOS os 44 elegíveis ativos e cada inelegível com o seu motivo", async () => {
        await resetShadow(db);
        for (const p of ALL_PROPS) expect(await gate(db, OWNER[p]!, p), p).toBe("scope_off");
        expect(
          (
            await admin(db, "shadow_set_scope", {
              p_actor: ACTOR,
              p_expected_scope_version: 0,
              p_scope: "all_eligible",
              p_reason: "authorized_global_activation",
              p_evidence_sha256: null,
            })
          ).result,
        ).toBe("invalid_argument");
        expect(
          (
            await admin(db, "shadow_set_scope", {
              p_actor: ACTOR,
              p_expected_scope_version: null,
              p_scope: "all_eligible",
              p_reason: "authorized_global_activation",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("invalid_argument");
        expect(
          (
            await admin(db, "shadow_set_scope", {
              p_actor: ACTOR,
              p_expected_scope_version: 0,
              p_scope: "all_eligible",
              p_reason: "authorized_disable",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("invalid_argument");
        expect(
          (
            await admin(db, "shadow_set_scope", {
              p_actor: ACTOR,
              p_expected_scope_version: 7,
              p_scope: "all_eligible",
              p_reason: "authorized_global_activation",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("stale_version");
        await openScope(db);
        expect(
          (
            await admin(db, "shadow_set_scope", {
              p_actor: ACTOR,
              p_expected_scope_version: 1,
              p_scope: "all_eligible",
              p_reason: "authorized_global_activation",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("noop");
        const active = ALL_PROPS.filter((p) => !EXPECTED_REASONS[p]);
        expect(active).toHaveLength(44);
        for (const p of ALL_PROPS)
          expect(await gate(db, OWNER[p]!, p), p).toBe(EXPECTED_REASONS[p] ?? "ACTIVE");
        // nenhum teto: o banco aceita quantos imóveis forem elegíveis (aqui, 44 — 8,8× o antigo teto de 5)
        expect(
          await db.sql(
            `select count(*) from public.properties p where public.guest_ai_shadow_property_gate(p.owner_id, p.id) is null`,
          ),
        ).toBe("44");
        // tenant errado nunca vira "ativo"
        expect(await gate(db, T.B, PA[0]!)).toBe("tenant_mismatch");
        // fechar nunca é bloqueado (sem versão); histórico registra os dois atos
        expect(
          await admin(db, "shadow_set_scope", {
            p_actor: ACTOR,
            p_expected_scope_version: null,
            p_scope: "none",
            p_reason: "authorized_global_deactivation",
          }),
        ).toMatchObject({ result: "applied", scope: "none" });
        const log = await db.rows<{
          subject_kind: string;
          from_value: string;
          to_value: string;
          db_role: string;
          reason_code: string;
          evidence_sha256: string | null;
        }>(
          `select subject_kind, from_value, to_value, db_role, reason_code, evidence_sha256 from public.guest_ai_shadow_switch_log order by id`,
        );
        expect(log).toEqual([
          {
            subject_kind: "global",
            from_value: "none",
            to_value: "all_eligible",
            db_role: "postgres",
            reason_code: "authorized_global_activation",
            evidence_sha256: EVID,
          },
          {
            subject_kind: "global",
            from_value: "all_eligible",
            to_value: "none",
            db_role: "postgres",
            reason_code: "authorized_global_deactivation",
            evidence_sha256: null,
          },
        ]);
      });

      it("G3 · ISOLAMENTO e interruptores: tenant desligado tira só os imóveis dele; imóvel desligado tira só ele; religar exige evidência/CAS; nada cruza tenants", async () => {
        await resetShadow(db);
        await openScope(db);
        expect(
          await admin(db, "shadow_set_tenant_enabled", {
            p_actor: ACTOR,
            p_tenant_id: T.B,
            p_enabled: false,
            p_expected_version: null,
            p_reason: "emergency_disable",
          }),
        ).toMatchObject({ result: "applied", enabled: false, version: 1 });
        for (const p of PB.slice(0, 31)) expect(await gate(db, T.B, p)).toBe("tenant_disabled");
        for (const p of [...PA, ...PC, PW]) expect(await gate(db, OWNER[p]!, p), p).toBe("ACTIVE");
        expect(
          await admin(db, "shadow_set_property_enabled", {
            p_actor: ACTOR,
            p_property_id: PA[3],
            p_tenant_id: T.A,
            p_enabled: false,
            p_expected_version: null,
            p_reason: "authorized_disable",
          }),
        ).toMatchObject({ result: "applied", version: 1 });
        expect(await gate(db, T.A, PA[3]!)).toBe("property_disabled");
        for (const p of PA.filter((x) => x !== PA[3]))
          expect(await gate(db, T.A, p), p).toBe("ACTIVE");
        // tenant trocado é recusado em qualquer direção; imóvel inexistente não é "religado"
        expect(
          (
            await admin(db, "shadow_set_property_enabled", {
              p_actor: ACTOR,
              p_property_id: PA[3],
              p_tenant_id: T.B,
              p_enabled: true,
              p_expected_version: 1,
              p_reason: "authorized_enable",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("tenant_mismatch");
        expect(
          (
            await admin(db, "shadow_set_property_enabled", {
              p_actor: ACTOR,
              p_property_id: PA[5],
              p_tenant_id: T.B,
              p_enabled: false,
              p_expected_version: null,
              p_reason: "authorized_disable",
            })
          ).result,
        ).toBe("tenant_mismatch");
        expect(
          (
            await admin(db, "shadow_set_property_enabled", {
              p_actor: ACTOR,
              p_property_id: U("99999999", 9),
              p_tenant_id: T.A,
              p_enabled: true,
              p_expected_version: 0,
              p_reason: "authorized_enable",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("not_found");
        expect(
          (
            await admin(db, "shadow_set_tenant_enabled", {
              p_actor: ACTOR,
              p_tenant_id: T.X,
              p_enabled: false,
              p_expected_version: null,
              p_reason: "authorized_disable",
            })
          ).result,
        ).toBe("not_found");
        // religar exige evidência, motivo coerente e versão
        expect(
          (
            await admin(db, "shadow_set_tenant_enabled", {
              p_actor: ACTOR,
              p_tenant_id: T.B,
              p_enabled: true,
              p_expected_version: 1,
              p_reason: "authorized_enable",
              p_evidence_sha256: null,
            })
          ).result,
        ).toBe("invalid_argument");
        expect(
          (
            await admin(db, "shadow_set_tenant_enabled", {
              p_actor: ACTOR,
              p_tenant_id: T.B,
              p_enabled: true,
              p_expected_version: null,
              p_reason: "authorized_enable",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("invalid_argument");
        expect(
          (
            await admin(db, "shadow_set_tenant_enabled", {
              p_actor: ACTOR,
              p_tenant_id: T.B,
              p_enabled: true,
              p_expected_version: 9,
              p_reason: "authorized_enable",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("stale_version");
        expect(
          (
            await admin(db, "shadow_set_tenant_enabled", {
              p_actor: ACTOR,
              p_tenant_id: T.B,
              p_enabled: true,
              p_expected_version: 1,
              p_reason: "authorized_disable",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("invalid_argument");
        expect(
          await admin(db, "shadow_set_tenant_enabled", {
            p_actor: ACTOR,
            p_tenant_id: T.B,
            p_enabled: true,
            p_expected_version: 1,
            p_reason: "authorized_enable",
            p_evidence_sha256: EVID,
          }),
        ).toMatchObject({ result: "applied", enabled: true, version: 2 });
        expect(await gate(db, T.B, PB[0]!)).toBe("ACTIVE");
        expect(
          (
            await admin(db, "shadow_set_tenant_enabled", {
              p_actor: ACTOR,
              p_tenant_id: T.B,
              p_enabled: true,
              p_expected_version: 2,
              p_reason: "authorized_enable",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("noop");
        const log = await db.rows<{
          subject_kind: string;
          tenant_id: string;
          property_id: string | null;
          from_value: string;
          to_value: string;
          version: number;
          actor: string;
          db_role: string;
        }>(
          `select subject_kind, tenant_id, property_id, from_value, to_value, version, actor, db_role from public.guest_ai_shadow_switch_log where subject_kind <> 'global' order by id`,
        );
        record("e4g-G3-switch-log", log);
        expect(
          log.map((l) => `${l.subject_kind}:${l.from_value}>${l.to_value}:v${l.version}`),
        ).toEqual([
          "tenant:enabled>disabled:v1",
          "property:enabled>disabled:v1",
          "tenant:disabled>enabled:v2",
        ]);
        expect(log.every((l) => l.actor === ACTOR && l.db_role === "postgres")).toBe(true);
        // histórico imutável: ninguém além do dono escreve; nem o dono apaga pelas funções
        expect(
          (
            await db.trySql(
              `update public.guest_ai_shadow_switch_log set actor = gen_random_uuid()`,
              { role: "service_role" },
            )
          ).ok,
        ).toBe(false);
      });

      it("G4 · CANDIDATAS no banco: só imóveis ativos, rodízio entre tenants + ordem de chegada, teto 3, só ids/códigos, exige trava, exclui avaliadas/em andamento/fora da janela", async () => {
        await resetShadow(db);
        await toRunning(db);
        await openScope(db);
        const a = [
          await conv(db, 1, PA[0]!, 200, "airbnb:th-1"),
          await conv(db, 2, PA[1]!, 150),
          await conv(db, 3, PA[2]!, 100),
          await conv(db, 4, PA[3]!, 50),
        ];
        const b = [
          await conv(db, 5, PB[0]!, 180, "wa:+5545999990000"),
          await conv(db, 6, PB[1]!, 30),
        ];
        const c = [await conv(db, 7, PC[0]!, 120)];
        await conv(db, 8, PB[31]!, 60); // inelegível (sem canal)
        await conv(db, 9, PE[0]!, 60); // arquivado
        await conv(db, 10, PA[4]!, 400); // fora da janela de 240 s
        const disabledProp = await conv(db, 11, PA[5]!, 90);
        await admin(db, "shadow_set_property_enabled", {
          p_actor: ACTOR,
          p_property_id: PA[5],
          p_tenant_id: T.A,
          p_enabled: false,
          p_expected_version: null,
          p_reason: "authorized_disable",
        });
        const running = await conv(db, 12, PA[6]!, 170);
        await db.sql(
          `insert into public.guest_ai_shadow_inflight (execution_id, conversation_id, tenant_id, property_id, channel, batch_id, lease_version) values (gen_random_uuid(), '${running.id}', '${T.A}', '${PA[6]}', 'web', gen_random_uuid(), 2)`,
        );
        const token = await acquire(db);
        const evaluated = await conv(db, 13, PA[7]!, 160);
        await recordBlocked(db, {
          conversation_id: evaluated.id,
          property_id: PA[7]!,
          tenant_id: T.A,
          surface: "guide_chat",
          message_id: evaluated.msg,
        });
        const r = await list(db, token, 10);
        record("e4g-G4-candidates", r);
        expect(r.result).toBe("ok");
        const got = r.candidates as Cand[];
        // teto do controle (3), rodízio: o mais antigo de cada tenant primeiro
        expect(got.map((x) => x.conversation_id)).toEqual([a[0]!.id, b[0]!.id, c[0]!.id]);
        expect(got.map((x) => x.surface)).toEqual(["airbnb", "whatsapp", "guide_chat"]);
        expect(got.map((x) => x.tenant_id)).toEqual([T.A, T.B, T.C]);
        for (const x of got)
          expect(Object.keys(x).sort()).toEqual([
            "conversation_id",
            "message_id",
            "property_id",
            "surface",
            "tenant_id",
          ]);
        expect(JSON.stringify(r)).not.toMatch(/sintética|\+5545|th-1|sess-/);
        // DRENAGEM completa (cada página avaliada e registrada): o conjunto servido é EXATAMENTE o elegível —
        // nada inelegível, desligado, em andamento, já avaliado, arquivado ou fora da janela; nada repetido
        const drained: string[] = [];
        for (let page = 0; page < 10; page++) {
          const pg = (await list(db, token)).candidates as Cand[];
          if (pg.length === 0) break;
          for (const x of pg) {
            drained.push(x.conversation_id);
            await recordBlocked(db, x);
          }
        }
        expect([...drained].sort()).toEqual([...a, ...b, ...c].map((x) => x.id).sort());
        expect(
          drained.some((id) =>
            [
              disabledProp.id,
              running.id,
              evaluated.id,
              U("c0000000", 8),
              U("c0000000", 9),
              U("c0000000", 10),
            ].includes(id),
          ),
        ).toBe(false);
        // portões: trava alheia, escopo fechado, estado ≠ running, argumentos fora da faixa
        expect((await list(db, "d".repeat(64))).result).toBe("tick_not_held");
        for (const [l, lb] of [
          [0, 240],
          [3, 30],
          [3, 901],
        ] as const)
          expect((await list(db, token, l, lb)).result).toBe("invalid_argument");
        await admin(db, "shadow_set_scope", {
          p_actor: ACTOR,
          p_expected_scope_version: null,
          p_scope: "none",
          p_reason: "authorized_global_deactivation",
        });
        expect((await list(db, token)).result).toBe("scope_off");
      });

      it("G5 · PICO DE DEMANDA: 30 conversas simultâneas (20/7/3 por tenant) drenadas em 10 ticks de 3, cada uma UMA vez; o menor tenant é atendido nos 3 primeiros ticks", async () => {
        await resetShadow(db);
        await toRunning(db);
        await openScope(db);
        const plan: Array<[string, number]> = [
          ...Array.from({ length: 20 }, (_, i) => [PA[i % 8]!, 220 - i * 5] as [string, number]),
          ...Array.from({ length: 7 }, (_, i) => [PB[i]!, 215 - i * 15] as [string, number]),
          ...Array.from({ length: 3 }, (_, i) => [PC[0]!, 60 - i * 10] as [string, number]),
        ];
        // conversas distintas no mesmo imóvel são permitidas (uma por hóspede)
        for (const [i, [p, age]] of plan.entries()) await conv(db, 100 + i, p, age);
        const served: string[][] = [];
        for (let tick = 0; tick < 15; tick++) {
          const token = await acquire(db);
          const r = await list(db, token);
          const got = r.candidates as Cand[];
          if (got.length === 0) {
            await sr(db, "shadow_release_tick", { p_tick_token: token });
            break;
          }
          expect(got.length).toBeLessThanOrEqual(3);
          for (const x of got) await recordBlocked(db, x);
          served.push(got.map((x) => `${x.tenant_id.slice(0, 8)}:${x.conversation_id}`));
          await sr(db, "shadow_release_tick", { p_tick_token: token });
        }
        record("e4g-G5-peak", { ticks: served.length, served });
        expect(served).toHaveLength(10);
        const flat = served.flat();
        expect(new Set(flat).size).toBe(30);
        const cTicks = served
          .map((t, i) => (t.some((x) => x.startsWith(T.C.slice(0, 8))) ? i : -1))
          .filter((i) => i >= 0);
        expect(cTicks).toEqual([0, 1, 2]);
        expect(
          served.slice(0, 3).every((t) => new Set(t.map((x) => x.split(":")[0])).size === 3),
        ).toBe(true);
      });

      it("G6 · TRAVA GLOBAL e cron concorrente: 20 aquisições simultâneas ⇒ 1; TTL 55 s pelo banco; tick interrompido (trava vencida) é retomado sem intervenção", async () => {
        await resetShadow(db);
        await toRunning(db);
        const rs = await Promise.all(
          Array.from({ length: 20 }, () => sr(db, "shadow_acquire_tick")),
        );
        expect(rs.filter((r) => r.result === "acquired")).toHaveLength(1);
        expect(rs.filter((r) => r.result === "busy")).toHaveLength(19);
        const ttl = Number(
          await db.sql(
            `select extract(epoch from tick_expires_at - now()) from public.guest_ai_shadow_control`,
          ),
        );
        expect(ttl).toBeGreaterThan(53);
        expect(ttl).toBeLessThanOrEqual(55);
        expect((await sr(db, "shadow_release_tick", { p_tick_token: "f".repeat(64) })).result).toBe(
          "noop",
        );
        // processo morreu com a trava: depois do prazo, o próximo tick adquire normalmente
        await db.sql(
          `update public.guest_ai_shadow_control set tick_expires_at = now() - interval '1 second'`,
        );
        expect((await sr(db, "shadow_acquire_tick")).result).toBe("acquired");
      });

      it("G7 · EMERGÊNCIA e RECUPERAÇÃO: parada global imediata; execução em curso termina; órfã reconciliada; desligar tenant/imóvel/escopo nunca bloqueado; nada religa sozinho", async () => {
        await resetShadow(db);
        await toRunning(db);
        await openScope(db);
        const k = await conv(db, 200, PA[0]!, 30);
        const v = await readyBatch(db, k.id, k.msg);
        const token = await acquire(db);
        const exec = U("e4000000", 1);
        expect((await claim(db, token, exec, k.id, T.A, PA[0]!, v)).result).toBe("claimed");
        expect(
          (
            await sr(db, "shadow_reserve_budget", {
              p_execution_id: exec,
              p_tokens: 83072,
              p_cost: "0.13072000",
              p_calls: 2,
            })
          ).result,
        ).toBe("reserved");
        // barreira da reivindicação: imóvel desligado entre a escolha e o claim ⇒ property_blocked
        const k2 = await conv(db, 201, PA[1]!, 30);
        const v2 = await readyBatch(db, k2.id, k2.msg);
        await admin(db, "shadow_set_property_enabled", {
          p_actor: ACTOR,
          p_property_id: PA[1],
          p_tenant_id: T.A,
          p_enabled: false,
          p_expected_version: null,
          p_reason: "emergency_disable",
        });
        expect(await claim(db, token, U("e4000000", 2), k2.id, T.A, PA[1]!, v2)).toEqual({
          result: "property_blocked",
          reason: "property_disabled",
        });
        // E1
        expect(await admin(db, "shadow_emergency_stop", { p_actor: ACTOR })).toMatchObject({
          result: "stopped",
          from: "running",
          state: "paused",
        });
        expect(await admin(db, "shadow_emergency_stop", { p_actor: ACTOR })).toMatchObject({
          result: "already_stopped",
        });
        expect((await sr(db, "shadow_acquire_tick")).result).toBe("state_not_running");
        expect((await list(db, token)).result).toBe("state_not_running");
        expect(
          (
            await sr(db, "shadow_reserve_budget", {
              p_execution_id: U("e4000000", 3),
              p_tokens: 10,
              p_cost: "0.01000000",
              p_calls: 1,
            })
          ).result,
        ).toBe("not_claimed");
        // E1b / E2: escopo e tenant desligados sem versão (nunca bloqueados)
        expect(
          (
            await admin(db, "shadow_set_scope", {
              p_actor: ACTOR,
              p_expected_scope_version: null,
              p_scope: "none",
              p_reason: "emergency_scope_off",
            })
          ).result,
        ).toBe("applied");
        expect(
          (
            await admin(db, "shadow_set_tenant_enabled", {
              p_actor: ACTOR,
              p_tenant_id: T.C,
              p_enabled: false,
              p_expected_version: null,
              p_reason: "emergency_disable",
            })
          ).result,
        ).toBe("applied");
        // E5: antes do prazo do lease a execução em curso NÃO é tocada; depois (worker perdido) é selada, liquidada pelo pior caso, registrada
        expect(await admin(db, "shadow_admin_reconcile", { p_actor: ACTOR })).toEqual({
          result: "ok",
          reconciled: 0,
        });
        await db.sql(
          `update public.guest_ai_conversation_leases set lease_expires_at = now() - interval '1 second' where conversation_id = '${k.id}'`,
        );
        expect(await admin(db, "shadow_admin_reconcile", { p_actor: ACTOR })).toMatchObject({
          result: "ok",
          reconciled: 1,
        });
        expect(await admin(db, "shadow_admin_reconcile", { p_actor: ACTOR })).toEqual({
          result: "ok",
          reconciled: 0,
        });
        expect(
          await db.sql(
            `select decision || ':' || technical_code from public.guest_ai_shadow_executions where execution_id = '${exec}'`,
          ),
        ).toBe("technical_failure:worker_lost");
        expect(
          await db.sql(
            `select settlement_kind || ':' || settled_cost from public.guest_ai_shadow_budget_reservations where execution_id = '${exec}'`,
          ),
        ).toBe("orphan_worst_case:0.13072000");
        // nada religa sozinho: só transições MANUAIS com autor; retomar exige autorização explícita e o escopo de novo com evidência
        expect(
          await db.sql(
            `select string_agg(from_state || '>' || to_state || ':' || automatic, ',' order by id) from public.guest_ai_shadow_transitions where to_state = 'paused'`,
          ),
        ).toBe("running>paused:false");
        const st = await sr(db, "shadow_get_control");
        expect(st).toMatchObject({ state: "paused", property_scope: "none" });
        const resumed = await admin(db, "shadow_transition", {
          p_expected_version: Number(st.state_version),
          p_to: "running",
          p_actor: ACTOR,
          p_reason: "authorized_resume",
        });
        expect(resumed.result).toBe("applied");
        const t2 = await acquire(db);
        expect((await list(db, t2)).result).toBe("scope_off");
        await openScope(db, 2);
        expect((await list(db, t2)).result).toBe("ok");
        // tenant C continua desligado depois da recuperação (desligamento não é desfeito por religar o escopo)
        expect(await gate(db, T.C, PC[0]!)).toBe("tenant_disabled");
      });

      it("G8 · A1 · LIMITE DIÁRIO e VIRADA DE DIA em UTC: o dia do orçamento é a data UTC; dia anterior esgotado não bloqueia hoje; teto de hoje esgotado ⇒ recusa SEM desarme (segue running)", async () => {
        await resetShadow(db);
        await toRunning(db);
        await openScope(db);
        await db.sql(
          `insert into public.guest_ai_shadow_budget_days (budget_day, settled_cost, settled_calls) values (((now() at time zone 'UTC')::date - 1), 1.00, 8)`,
        );
        const k = await conv(db, 300, PA[0]!, 20);
        const v = await readyBatch(db, k.id, k.msg);
        const token = await acquire(db);
        const exec = U("e4000000", 30);
        expect((await claim(db, token, exec, k.id, T.A, PA[0]!, v)).result).toBe("claimed");
        const res = await sr(db, "shadow_reserve_budget", {
          p_execution_id: exec,
          p_tokens: 83072,
          p_cost: "0.13072000",
          p_calls: 2,
        });
        expect(res.result).toBe("reserved");
        expect(String(res.budget_day)).toBe(
          await db.sql(`select ((now() at time zone 'UTC')::date)::text`),
        );
        // hoje quase no teto (US$ 0,90 liquidados): a próxima reserva de pior caso passaria de US$ 1,00 ⇒ recusa (A1: sem desarme)
        await db.sql(
          `update public.guest_ai_shadow_budget_days set settled_cost = 0.90 where budget_day = (now() at time zone 'UTC')::date`,
        );
        const k2 = await conv(db, 301, PA[1]!, 20);
        const v2 = await readyBatch(db, k2.id, k2.msg);
        const exec2 = U("e4000000", 31);
        expect((await claim(db, token, exec2, k2.id, T.A, PA[1]!, v2)).result).toBe("claimed");
        expect(
          await sr(db, "shadow_reserve_budget", {
            p_execution_id: exec2,
            p_tokens: 83072,
            p_cost: "0.13072000",
            p_calls: 2,
          }),
        ).toEqual({ result: "exceeded", limit: "daily_cost" });
        expect((await sr(db, "shadow_get_control")).state).toBe("running");
        expect(
          await db.sql(
            `select count(*) from public.guest_ai_shadow_transitions where to_state = 'budget_exhausted' and automatic`,
          ),
        ).toBe("0");
        await sr(db, "shadow_release_tick", { p_tick_token: token });
      });

      it("G9 · PERMISSÕES EFETIVAS (não só catálogo): quem administra, quem executa, quem lê; contornos (GRANT, ALTER, RLS, search_path, papel de login sem SET) recusados", async () => {
        await resetShadow(db);
        await toRunning(db);
        const TABLES = (
          await db.sql(
            `select string_agg(relname, ',' order by relname) from pg_class where relkind = 'r' and relname like 'guest\\_ai\\_%'`,
          )
        ).split(",");
        const ADMIN_CALLS = [
          `shadow_set_scope('${ACTOR}', null, 'none', 'authorized_global_deactivation')`,
          `shadow_set_tenant_enabled('${ACTOR}', '${T.A}', false, null, 'authorized_disable')`,
          `shadow_set_property_enabled('${ACTOR}', '${PA[0]}', '${T.A}', false, null, 'authorized_disable')`,
          `shadow_refresh_eligibility('${ACTOR}')`,
          `shadow_emergency_stop('${ACTOR}')`,
          `shadow_admin_reconcile('${ACTOR}')`,
          `shadow_transition(1, 'paused', '${ACTOR}', 'authorized_pause')`,
          `shadow_purge_expired()`,
        ];
        const WORKER_CALLS = [
          `shadow_get_control()`,
          `shadow_property_status('${T.A}', '${PA[0]}')`,
          `shadow_list_candidates('${"c".repeat(64)}', 240, 3)`,
          `shadow_acquire_tick()`,
        ];
        const matrix: Record<string, Record<string, string>> = {};
        const mark = (who: string, what: string, ok: boolean) =>
          ((matrix[who] ??= {})[what] = ok ? "PERMITIDO" : "negado");
        // papéis por SET ROLE (como o PostgREST usa) e papéis de LOGIN conectando diretamente
        const viaSet = ["anon", "authenticated", "service_role"];
        const viaLogin = [
          "sandbox_exec",
          "authenticator",
          "supabase_read_only_user",
          "supabase_etl_admin",
        ];
        const run = async (who: string, q: string) =>
          viaSet.includes(who) ? db.trySql(q, { role: who }) : db.sqlAs(who, q);
        for (const who of [...viaSet, ...viaLogin]) {
          for (const c of ADMIN_CALLS) {
            const r = await run(who, `select public.${c}`);
            mark(who, `exec ${c.split("(")[0]}`, r.ok);
            expect(r.ok, `${who} ${c}`).toBe(false);
          }
          for (const c of WORKER_CALLS) {
            const r = await run(who, `select public.${c}`);
            mark(who, `exec ${c.split("(")[0]}`, r.ok);
            expect(r.ok, `${who} ${c}`).toBe(who === "service_role");
          }
          for (const t of TABLES) {
            const sel = await run(who, `select count(*) from public.${t}`);
            mark(who, `select ${t}`, sel.ok);
            // pg_read_all_data + BYPASSRLS: os papéis de leitura da plataforma LEEM (resíduo documentado; sem texto livre)
            expect(sel.ok, `${who} select ${t}`).toBe(
              ["supabase_read_only_user", "supabase_etl_admin"].includes(who) ||
                (who === "service_role" && t === "guest_ai_conversation_leases"),
            );
            const ins = await run(who, `delete from public.${t}`);
            mark(who, `delete ${t}`, ins.ok);
            expect(ins.ok, `${who} delete ${t}`).toBe(false);
          }
          expect(
            (await run(who, `select nextval('public.guest_ai_shadow_switch_log_id_seq')`)).ok,
            `${who} nextval`,
          ).toBe(false);
          expect(
            (
              await run(
                who,
                `grant execute on function public.shadow_set_scope(uuid, integer, text, text, text) to ${who === "authenticator" ? "authenticator" : "public"}`,
              )
            ).ok,
            `${who} grant`,
          ).toBe(false);
          expect(
            (
              await run(
                who,
                `alter table public.guest_ai_shadow_control disable row level security`,
              )
            ).ok,
            `${who} alter`,
          ).toBe(false);
          expect(
            (
              await run(
                who,
                `create or replace function public.guest_ai_shadow_property_gate(uuid, uuid) returns text language sql as $$ select null::text $$`,
              )
            ).ok,
            `${who} replace`,
          ).toBe(false);
          expect(
            (
              await run(
                who,
                `create function public.shadow_x() returns int language sql as $$ select 1 $$`,
              )
            ).ok,
            `${who} create`,
          ).toBe(false);
        }
        // authenticator (NOINHERIT): sem SET ROLE nada executa; com SET ROLE service_role vira o worker (= quem tem a chave service_role)
        expect(
          (
            await db.sqlAs(
              "authenticator",
              `set role service_role; select public.shadow_get_control()`,
            )
          ).ok,
        ).toBe(true);
        expect(
          (
            await db.sqlAs(
              "authenticator",
              `set role service_role; select public.shadow_set_scope('${ACTOR}', null, 'none', 'authorized_global_deactivation')`,
            )
          ).ok,
        ).toBe(false);
        expect((await db.sqlAs("sandbox_exec", `set role service_role`)).ok).toBe(false);
        // RLS efetiva: mesmo que alguém conceda SELECT por engano, papel sujeito a RLS não vê linha nenhuma
        await admin(db, "shadow_set_scope", {
          p_actor: ACTOR,
          p_expected_scope_version: 0,
          p_scope: "all_eligible",
          p_reason: "authorized_global_activation",
          p_evidence_sha256: EVID,
        });
        await db.sql(`grant select on public.guest_ai_shadow_switch_log to authenticated`);
        expect(
          await db.sql(`select count(*) from public.guest_ai_shadow_switch_log`, {
            role: "authenticated",
          }),
        ).toBe("0");
        await db.sql(`revoke select on public.guest_ai_shadow_switch_log from authenticated`);
        // search_path fixo: objetos temporários do chamador não desviam as funções
        const hijack = await db.sql(
          `create temp table guest_ai_shadow_control (id int, state text, property_scope text); insert into guest_ai_shadow_control values (1, 'running', 'all_eligible');
        select ((public.shadow_get_control())->>'state') || ':' || ((public.shadow_property_status('${T.B}', '${PA[0]}'))->>'reason')`,
          { role: "service_role" },
        );
        expect(hijack).toBe("running:tenant_mismatch");
        // a porta interna nem é executável pelo worker (só pela RPC de status)
        expect(
          (
            await db.trySql(`select public.guest_ai_shadow_property_gate('${T.A}', '${PA[0]}')`, {
              role: "service_role",
            })
          ).ok,
        ).toBe(false);
        record("e4g-G9-permissions", matrix);
        // catálogo coerente com o comportamento
        expect(
          await db.sql(
            `select count(*) from pg_proc where (proname like 'shadow\\_%' or proname like 'guest\\_ai\\_shadow\\_%' or proname like '%\\_conversation\\_lease') and (not prosecdef or array_to_string(proconfig, ',') <> 'search_path=pg_catalog, pg_temp' or pg_get_userbyid(proowner) <> 'postgres')`,
          ),
        ).toBe("0");
      }, 240_000);

      it("G10 · CAPACIDADE B preservada: excluir/arquivar/alterar imóvel e conversa (com interruptor, foto e lease) funciona; a porta acompanha AO VIVO", async () => {
        await resetShadow(db);
        await toRunning(db);
        await openScope(db);
        await admin(db, "shadow_refresh_eligibility", { p_actor: ACTOR });
        const k = await conv(db, 400, PA[9]!, 20);
        await readyBatch(db, k.id, k.msg);
        await admin(db, "shadow_set_property_enabled", {
          p_actor: ACTOR,
          p_property_id: PA[10],
          p_tenant_id: T.A,
          p_enabled: false,
          p_expected_version: null,
          p_reason: "authorized_disable",
        });
        // arquivar (como a desconexão da conta do Airbnb faz) tira o imóvel na hora
        await db.sql(`update public.properties set archived_at = now() where id = '${PA[9]}'`);
        expect(await gate(db, T.A, PA[9]!)).toBe("archived");
        await db.sql(
          `update public.properties set archived_at = null, name = name || ' (editado)' where id = '${PA[9]}'`,
        );
        expect(await gate(db, T.A, PA[9]!)).toBe("ACTIVE");
        // excluir conversa com lease e imóvel com interruptor e foto: nada do Shadow prende a operação convencional
        expect(
          (await db.trySql(`delete from public.property_chat_conversations where id = '${k.id}'`))
            .ok,
        ).toBe(true);
        expect(
          await db.sql(
            `select count(*) from public.guest_ai_conversation_leases where conversation_id = '${k.id}'`,
          ),
        ).toBe("0");
        expect(
          (
            await db.trySql(
              `delete from public.property_listing_raw_data where property_id = '${PA[10]}'; delete from public.properties where id = '${PA[10]}'`,
            )
          ).ok,
        ).toBe(true);
        expect(await gate(db, T.A, PA[10]!)).toBe("property_not_found");
        // imóvel já excluído: tenant trocado continua recusado (o interruptor guarda o tenant original)
        expect(
          (
            await admin(db, "shadow_set_property_enabled", {
              p_actor: ACTOR,
              p_property_id: PA[10],
              p_tenant_id: T.B,
              p_enabled: false,
              p_expected_version: null,
              p_reason: "emergency_disable",
            })
          ).result,
        ).toBe("tenant_mismatch");
        // desligar um imóvel já excluído é aceito (registra a saída); religar não
        expect(
          (
            await admin(db, "shadow_set_property_enabled", {
              p_actor: ACTOR,
              p_property_id: PA[10],
              p_tenant_id: T.A,
              p_enabled: true,
              p_expected_version: 1,
              p_reason: "authorized_enable",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("not_found");
        expect(await admin(db, "shadow_refresh_eligibility", { p_actor: ACTOR })).toMatchObject({
          properties: 56,
        });
        // gatilho legado continua disparando
        expect(
          await db.sql(
            `select updated_at > created_at from public.properties where id = '${PA[9]}'`,
          ),
        ).toBe("t");
      });

      it("G11 · NENHUM caminho de envio pelo banco: nenhuma função Shadow/lease escreve fora de guest_ai_*, notifica, chama rede ou toca a fila de mensagens", async () => {
        const fns = await db.rows<{ proname: string; prosrc: string }>(
          `select proname, prosrc from pg_proc where proname like 'shadow\\_%' or proname like 'guest\\_ai\\_shadow\\_%' or proname like '%\\_conversation\\_lease'`,
        );
        expect(fns.length).toBe(35);
        const writesOutside = fns
          .flatMap((f) =>
            [
              ...f.prosrc.matchAll(/(insert\s+into|update|delete\s+from)\s+public\.([a-z_]+)/gi),
            ].map((m) => `${f.proname}:${m[2]}`),
          )
          .filter((x) => !x.split(":")[1]!.startsWith("guest_ai_"));
        expect(writesOutside).toEqual([]);
        for (const f of fns)
          expect(f.prosrc, f.proname).not.toMatch(
            /pg_notify|net\.http|dblink|http_post|pgmq|copy\s|lo_export|sinch|send_|webhook|messages_app/i,
          );
        // a fila de mensagens só é LIDA, e só pela escolha de candidatas
        const readers = fns
          .filter((f) => /property_chat_messages/.test(f.prosrc))
          .map((f) => f.proname);
        expect(readers).toEqual(["shadow_list_candidates"]);
      });
    });

    it("G12 · ESCALA: 2.000 imóveis / 200 tenants / 20.000 conversas / 40.000 mensagens — foto e escolha de candidatas dentro do tick, usando o índice de produção", async () => {
      const db = startProdLike();
      try {
        await db.sql(`insert into public.profiles (id) select ('0000' || lpad(to_hex(t), 4, '0') || '-0000-4000-8000-000000000000')::uuid from generate_series(1, 200) t;
        insert into public.properties (id, owner_id, name, slug) select ('a2' || lpad(to_hex(i), 6, '0') || '-0000-4000-8000-000000000000')::uuid, ('0000' || lpad(to_hex(1 + (i % 200)), 4, '0') || '-0000-4000-8000-000000000000')::uuid, 'Imóvel sintético ' || i, 'esc-' || i from generate_series(1, 2000) i;
        insert into public.property_chat_conversations (id, property_id, guest_session_id, last_message_at)
          select gen_random_uuid(), ('a2' || lpad(to_hex(1 + (j % 2000)), 6, '0') || '-0000-4000-8000-000000000000')::uuid, 'sess-' || j,
                 case when j <= 300 then now() - make_interval(secs => (j % 200)) else now() - make_interval(days => 1 + (j % 90)) end
            from generate_series(1, 20000) j;
        insert into public.property_chat_messages (conversation_id, role, sender_type, content, created_at)
          select c.id, 'user', 'guest'::public.chat_sender_type, 'sintética', c.last_message_at - interval '30 seconds' from public.property_chat_conversations c
          union all select c.id, 'user', 'guest'::public.chat_sender_type, 'sintética', c.last_message_at from public.property_chat_conversations c;
        analyze;`);
        applyAll(db);
        const t0 = performance.now();
        const snap = await admin(db, "shadow_refresh_eligibility", { p_actor: ACTOR });
        const refreshMs = Math.round(performance.now() - t0);
        expect(snap).toMatchObject({ properties: 2000, tenants: 200, eligible: 2000 });
        await toRunning(db);
        await openScope(db);
        const token = await acquire(db);
        const times: number[] = [];
        let r: Record<string, unknown> = {};
        for (let i = 0; i < 5; i++) {
          const s = performance.now();
          r = await list(db, token);
          times.push(Math.round(performance.now() - s));
        }
        expect((r.candidates as Cand[]).length).toBe(3);
        const plan = await db.sql(
          `explain select x.id from public.properties p cross join lateral (select x.id from public.property_chat_conversations x where x.property_id = p.id and x.last_message_at >= now() - interval '240 seconds' order by x.last_message_at desc limit 50) x where p.archived_at is null`,
        );
        record("e4g-G12-scale", { refreshMs, listMs: times, plan: plan.split("\n").slice(0, 8) });
        expect(plan).toMatch(/idx_pcc_property/);
        expect(Math.max(...times)).toBeLessThan(2000);
        expect(refreshMs).toBeLessThan(10000);
      } finally {
        db.stop();
      }
    }, 300_000);

    it("B1 · GATE B — CRON criado DESABILITADO (API do pg_cron reproduzida): job nasce inativo na mesma transação; recriação recusada; falha no meio desfaz tudo", async () => {
      const db = startProdLike({ legacy: false });
      try {
        db.admin(
          `create schema cron authorization postgres; create schema net authorization postgres; create schema vault authorization postgres;`,
        );
        await db.sql(`
      create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean not null default true);
      create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
      create function cron.alter_job(id bigint, active boolean) returns void language sql as $$ update cron.job set active = alter_job.active where jobid = id $$;
      create view vault.decrypted_secrets as select 'cron_secret'::text as name, 'segredo-sintetico'::text as decrypted_secret;`);
        expect(db.file(OPS("04-cron-create-disabled.sql"), { singleTransaction: false })).toEqual({
          ok: true,
        });
        expect(
          await db.sql(`select jobname || ':' || schedule || ':' || active from cron.job`),
        ).toBe("guest-ai-shadow-tick:* * * * *:false");
        expect(
          await db.sql(
            `select command ~ 'shadow-tick' and command ~ 'x-cron-secret' and command ~ 'timeout_milliseconds := 60000' from cron.job`,
          ),
        ).toBe("t");
        expect(
          (
            db.file(OPS("04-cron-create-disabled.sql"), { singleTransaction: false }) as {
              error: string;
            }
          ).error,
        ).toContain("já existe");
        await db.sql(
          `delete from cron.job; create or replace function cron.alter_job(id bigint, active boolean) returns void language sql as $$ select null::void $$;`,
        );
        expect(
          (
            db.file(OPS("04-cron-create-disabled.sql"), { singleTransaction: false }) as {
              error: string;
            }
          ).error,
        ).toContain("não ficou inativo");
        expect(await db.sql(`select count(*) from cron.job`)).toBe("0");
      } finally {
        db.stop();
      }
    }, 120_000);
  },
);

// ─────────────────────────── GATE A · BUNDLE ÚNICO (Caminho 2 ratificado) ───────────────────────────
// O bundle é executado como a interface SQL do Lovable Cloud executa (verificado na produção, só leitura): o texto
// INTEIRO numa única mensagem do protocolo simples (postgres.js `unsafe` sem parâmetros) ⇒ uma transação implícita.
type Row = Record<string, string | boolean | null>;
const BUNDLE = OPS("gateA-bundle.sql");
async function simple(db: ProdLike, text: string): Promise<{ ok: true; rows: Row[] } | { ok: false; error: string }> {
  const { default: postgres } = await import("postgres");
  const c = postgres({ path: `${db.dir}/.s.PGSQL.${db.port}`, user: "postgres", database: "app", max: 1, onnotice: () => {} });
  try {
    const r = (await c.unsafe(text)) as unknown;
    const last = Array.isArray(r) && Array.isArray(r[r.length - 1]) ? (r[r.length - 1] as Row[]) : (r as Row[]);
    return { ok: true, rows: last };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  } finally {
    await c.end();
  }
}
const objectCount = (db: ProdLike) =>
  db.sql(`select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'S') and c.relname like 'guest\\_ai\\_%')
      || ':' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and (p.proname like 'shadow\\_%' or p.proname like 'guest\\_ai\\_shadow\\_%' or p.proname like '%\\_conversation\\_lease'))`);
const snapshotB = (db: ProdLike) => db.rows<Row>(stripSemi(readSql(OPS("08-fotografia-capacidade-b.sql"))));
type MRow = { item: string; verificacao: string; esperado: string; encontrado: string | null; resultado: string };
const matrix = (db: ProdLike) => db.rows<MRow>(stripSemi(readSql(OPS("07-matriz-pos-gateA.sql"))).replace(/\n\s*order by item$/, ""));

describe.skipIf(!PG176_OK)("Gate A · bundle único gateA-bundle.sql (PostgreSQL 17.6, papéis e privilégios da produção)", () => {
  it("B1 · REPRODUZÍVEL: o arquivo é idêntico à geração a partir das 3 migrations; cabeçalho com SHA-256 e ordem; cada migration integral exatamente uma vez", async () => {
    const { createHash } = await import("node:crypto");
    // @ts-expect-error — módulo .mjs sem tipos (gerador operacional)
    const { buildBundle } = await import("../../ops/e4/gen-gateA-bundle.mjs");
    const file = readSql(BUNDLE);
    expect(buildBundle()).toBe(file);
    expect(buildBundle()).toBe(buildBundle());
    let at = -1;
    for (const [i, m] of [MIG.lease, MIG.shadow, MIG.global].entries()) {
      const text = readSql(m);
      const sha = createHash("sha256").update(text).digest("hex");
      expect(file).toContain(`--   ${i + 1}/3  supabase/migrations/${m.split("/").pop()}  sha256 ${sha}`);
      const pos = file.indexOf(text);
      expect(pos).toBeGreaterThan(at); // ordem de dependência
      expect(file.indexOf(text, pos + 1)).toBe(-1); // uma vez só
      at = pos;
    }
    expect(/^\s*(begin|commit|rollback)\s*;/im.test(file)).toBe(false);
    expect(/^\s*\\/m.test(file)).toBe(false);
  });

  it("B2 · APLICAÇÃO em MENSAGEM ÚNICA: sonda ok ⇒ bundle ⇒ 02-validate 100% ⇒ matriz sem FALHA (41 linhas) ⇒ Capacidade B idêntica ⇒ inventário igual ⇒ nada ativo", async () => {
    const db = startProdLike();
    try {
      await seedProdInventory(db);
      expect(failing(await preflight(db))).toEqual([]);
      const probe = await simple(db, readSql(OPS("09-sonda-transacao.sql")));
      expect(probe).toMatchObject({ ok: true, rows: [{ mesma_transacao: true, set_local_efetivo: true, papel: "postgres", mensagem_unica: true, texto_integral_visivel: true }] });
      const inv0 = await inventory(db);
      const snap0 = await snapshotB(db);
      const t0 = performance.now();
      const r = await simple(db, readSql(BUNDLE));
      const applyMs = Math.round(performance.now() - t0);
      expect(r.ok, r.ok ? "" : r.error).toBe(true);
      expect(await objectCount(db)).toBe("15:35"); // 12 tabelas + 3 sequências; 35 funções
      const val = await validate(db);
      expect(failing(val)).toEqual([]);
      expect(val).toHaveLength(39);
      const m = await matrix(db);
      record("e4g-B2-bundle", { applyMs, probe, validate: val, matrix: m, snap0 });
      expect(m).toHaveLength(41);
      expect(m.filter((x) => x.resultado === "FALHA")).toEqual([]);
      expect(m.filter((x) => x.resultado === "comparar").map((x) => x.item).sort()).toEqual(["M06.2 Elegibilidade", "M11 Slot", "M12.4 Capacidade B", "M12.5 Capacidade B"]);
      expect(m.filter((x) => x.item.startsWith("M08")).every((x) => x.resultado === "ok")).toBe(true);
      expect(await snapshotB(db)).toEqual(snap0);
      expect(await inventory(db)).toEqual(inv0);
      expect((await sr(db, "shadow_get_control")).state).toBe("disabled");
      expect((await sr(db, "shadow_acquire_tick")).result).toBe("state_not_running");
      // a configuração aceita SÓ UTC (A1): São Paulo é recusado pelo banco
      const cfg = (tz: string) => db.trySql(`update public.guest_ai_shadow_control set budget_day_timezone = '${tz}' where id = 1`);
      expect((await cfg("America/Sao_Paulo")).ok).toBe(false);
      expect((await cfg("UTC")).ok).toBe(true);
      await db.sql(`update public.guest_ai_shadow_control set budget_day_timezone = null where id = 1`);
    } finally {
      db.stop();
    }
  }, 180_000);

  it("B3 · ATOMICIDADE: erro DEPOIS de todo o conteúdo ⇒ nada fica (0 objetos, 0 locks, Capacidade B idêntica); depois o bundle aplica limpo", async () => {
    const db = startProdLike();
    try {
      await seedProdInventory(db);
      const snap0 = await snapshotB(db);
      const r = await simple(db, `${readSql(BUNDLE)}\nselect 1/0;\n`);
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(/division by zero/);
      expect(await objectCount(db)).toBe("0:0");
      expect(await db.sql(`select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.pid <> pg_backend_pid() and l.relation = 'public.property_chat_conversations'::regclass`)).toBe("0");
      expect(await snapshotB(db)).toEqual(snap0);
      expect((await simple(db, readSql(BUNDLE))).ok).toBe(true);
      expect(failing(await validate(db))).toEqual([]);
    } finally {
      db.stop();
    }
  }, 180_000);

  it("B4 · AUTOCOMMIT por comando (interface que separa os comandos) ⇒ a guarda recusa ANTES de qualquer DDL; nada aplicado", async () => {
    const db = startProdLike();
    try {
      await seedProdInventory(db);
      const r = db.file(BUNDLE, { singleTransaction: false }); // psql -f: cada comando na própria transação, ON_ERROR_STOP
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(/gate_a_bundle: comandos fora de uma transação única/);
      expect(await objectCount(db)).toBe("0:0");
      const probe = await (async () => {
        const p = db.file(OPS("09-sonda-transacao.sql"), { singleTransaction: false });
        return p;
      })();
      expect(probe.ok).toBe(true); // a sonda roda, mas não prova a transação nesse modo (o operador vê mesma_transacao = false)
    } finally {
      db.stop();
    }
  }, 180_000);

  it("B5 · lock_timeout EFETIVO: outra transação segura property_chat_conversations ⇒ o bundle desiste em ~3 s sem fila e sem aplicar nada; liberado o lock, aplica", async () => {
    const db = startProdLike();
    try {
      await seedProdInventory(db);
      const { default: postgres } = await import("postgres");
      const holder = postgres({ path: `${db.dir}/.s.PGSQL.${db.port}`, user: "postgres", database: "app", max: 1, onnotice: () => {} });
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const tx = holder.begin(async (t) => {
        await t`lock table public.property_chat_conversations in share mode`;
        await held;
      });
      await new Promise((r) => setTimeout(r, 300));
      const t0 = performance.now();
      const r = await simple(db, readSql(BUNDLE));
      const ms = Math.round(performance.now() - t0);
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(/lock timeout/i);
      expect(ms).toBeGreaterThanOrEqual(2_900);
      expect(ms).toBeLessThan(8_000);
      expect(await objectCount(db)).toBe("0:0");
      release();
      await tx;
      await holder.end();
      expect((await simple(db, readSql(BUNDLE))).ok).toBe(true);
      record("e4g-B5-lock-timeout", { ms, error: r.ok ? null : r.error });
    } finally {
      db.stop();
    }
  }, 180_000);

  it("B7 · INTEGRIDADE do texto recebido: cortado no fim, cortado entre comandos (marcadores preservados), sem comentários ou com CRLF ⇒ a guarda aborta ANTES de qualquer DDL", async () => {
    const db = startProdLike();
    try {
      await seedProdInventory(db);
      const full = readSql(BUNDLE);
      const g = full.indexOf("-- ═════════════════ 3/3");
      const variants: Array<[string, string, RegExp]> = [
        ["cortado no fim (sem a migration global nem o marcador FIM)", full.slice(0, g), /marcadores de conteúdo ausentes/],
        ["cortado ENTRE comandos com marcadores preservados", full.slice(0, g) + full.slice(full.indexOf("\n-- ═══ FIM DO CONTEÚDO")), /difere do gerado \(SHA-256\)/],
        ["comentários de linha removidos pela interface", full.replace(/^--.*$/gm, ""), /marcadores de conteúdo ausentes/],
        ["quebras de linha convertidas para CRLF", full.replace(/\n/g, "\r\n"), /marcadores de conteúdo ausentes/],
        ["um caractere do conteúdo alterado", full.replace("'property_not_found', 'archived'", "'property_not_found', 'archivee'"), /difere do gerado \(SHA-256\)/],
      ];
      const out: Record<string, string> = {};
      for (const [name, text, re] of variants) {
        expect(text).not.toBe(full);
        const r = await simple(db, text);
        expect(r.ok, name).toBe(false);
        expect(r.ok ? "" : r.error, name).toMatch(re);
        expect(await objectCount(db), name).toBe("0:0");
        out[name] = r.ok ? "" : r.error;
      }
      record("e4g-B7-integridade", out);
      expect((await simple(db, full)).ok).toBe(true);
      expect(await objectCount(db)).toBe("15:35");
    } finally {
      db.stop();
    }
  }, 180_000);

  it("B6 · REEXECUÇÃO do bundle já aplicado ⇒ recusada sem efeito; validação e matriz continuam 100%", async () => {
    const db = startProdLike();
    try {
      await seedProdInventory(db);
      expect((await simple(db, readSql(BUNDLE))).ok).toBe(true);
      const r = await simple(db, readSql(BUNDLE));
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toMatch(/already exists|já existem/);
      expect(await objectCount(db)).toBe("15:35");
      expect(failing(await validate(db))).toEqual([]);
      expect((await matrix(db)).filter((x) => x.resultado === "FALHA")).toEqual([]);
    } finally {
      db.stop();
    }
  }, 180_000);
});
