/**
 * ENTREGA 4 · ENSAIO INTEGRADO em PostgreSQL 17.6 descartável com papéis, privilégios padrão e estrutura
 * legada iguais aos da produção auditada (ver `prodlike.ts`). Só dados sintéticos; nenhuma credencial real;
 * nenhuma chamada externa. Os cenários de fluxo do worker (lease expirado, worker perdido, pausas, falha do
 * Gateway, orçamento, disjuntor) rodam na suíte `e3/*` contra a MESMA configuração (lease + Shadow + piloto).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
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
const TENANT_A = "00000000-0000-4000-8000-00000000aaaa";
const TENANT_B = "00000000-0000-4000-8000-00000000bbbb";
const P = Array.from({ length: 7 }, (_, i) => `b4000000-0000-4000-8000-00000000000${i + 1}`);

type Check = { check_name: string; expected: string; found: string; ok: boolean | null };
const stripSemi = (s: string) => s.trim().replace(/;\s*$/, "");
async function validate(db: ProdLike): Promise<Check[]> {
  return db.rows<Check>(stripSemi(readSql(OPS("02-validate.sql"))));
}
async function preflight(db: ProdLike): Promise<Check[]> {
  return db.rows<Check>(stripSemi(readSql(OPS("01-preflight.sql"))));
}
const failing = (cs: Check[]) => cs.filter((c) => c.ok === false);
/** Impressão digital do legado: conteúdo + estrutura + ACL + políticas + gatilhos das tabelas não Shadow. */
async function legacyFingerprint(db: ProdLike): Promise<string> {
  return db.sql(`select md5(
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from public.properties x) ||
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from public.property_chat_conversations x) ||
    (select coalesce(string_agg(x::text, '|' order by x::text), '') from public.property_chat_messages x) ||
    (select string_agg(table_name || column_name || data_type || is_nullable || coalesce(column_default, ''), '|' order by table_name, column_name)
       from information_schema.columns where table_schema = 'public' and table_name not like 'guest\\_ai\\_%') ||
    (select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, '|' order by c.relname)
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname not like 'guest\\_ai\\_%') ||
    (select coalesce(string_agg(polname || pg_get_expr(polqual, polrelid), '|' order by polname), '') from pg_policy) ||
    (select coalesce(string_agg(tgname, '|' order by tgname), '') from pg_trigger where not tgisinternal) ||
    (select coalesce(string_agg(conname || pg_get_constraintdef(oid), '|' order by conname), '') from pg_constraint where conrelid in
       (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname not like 'guest\\_ai\\_%')))`);
}
async function seedLegacy(db: ProdLike) {
  await db.sql(`insert into public.properties (id, owner_id, name, slug) values
    ${P.map((p, i) => `('${p}', '${i < 5 ? TENANT_A : TENANT_B}', 'Imóvel sintético ${i + 1}', 'sint-${i + 1}')`).join(",")}`);
  await db.sql(`insert into public.property_chat_conversations (id, property_id, guest_session_id) values
    ('c4000000-0000-4000-8000-000000000001', '${P[0]}', 'web:sintetico-1'), ('c4000000-0000-4000-8000-000000000002', '${P[5]}', 'web:sintetico-2')`);
  await db.sql(
    `insert into public.property_chat_messages (conversation_id, role, content) values ('c4000000-0000-4000-8000-000000000001', 'user', 'mensagem sintética')`,
  );
}
const applyAll = (db: ProdLike) => [db.file(MIG.lease), db.file(MIG.shadow), db.file(MIG.pilot)];
async function rpc(
  db: ProdLike,
  fn: string,
  args: Record<string, unknown>,
  role?: string,
): Promise<Record<string, unknown>> {
  const lit = (v: unknown) =>
    v === null || v === undefined
      ? "null"
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : `'${String(v).replace(/'/g, "''")}'`;
  const named = Object.entries(args)
    .map(([k, v]) => `${k} => ${lit(v)}`)
    .join(", ");
  return JSON.parse(await db.sql(`select public.${fn}(${named})`, role ? { role } : undefined));
}
const admin = (db: ProdLike, fn: string, args: Record<string, unknown>) => rpc(db, fn, args);
async function toRunningWithManifest(db: ProdLike, props: Array<{ p: string; t: string }>) {
  for (const x of props) {
    const r = await admin(db, "shadow_manifest_add", {
      p_actor: ACTOR,
      p_manifest_version: 1,
      p_tenant_id: x.t,
      p_property_id: x.p,
      p_selection_reason: "highest_volume",
      p_twin_status: "verified",
      p_history_status: "verified",
    });
    if (r.result !== "applied") throw new Error(`manifest:${String(r.result)}`);
  }
  let v = Number((await rpc(db, "shadow_get_control", {}, "service_role")).state_version);
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
    p_budget_day_timezone: "America/Sao_Paulo",
    p_telemetry_retention_days: 30,
    p_tick_interval_seconds: 60,
    p_max_conversations_per_tick: 3,
    p_manifest_version: 1,
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
const enable = (db: ProdLike, p: string, t: string, version: number) =>
  admin(db, "shadow_set_property_enabled", {
    p_actor: ACTOR,
    p_property_id: p,
    p_tenant_id: t,
    p_enabled: true,
    p_expected_version: version,
    p_reason: "pilot_enable",
    p_evidence_sha256: EVID,
  });
const disable = (
  db: ProdLike,
  p: string,
  t: string,
  version: number | null = null,
  reason = "pilot_disable",
) =>
  admin(db, "shadow_set_property_enabled", {
    p_actor: ACTOR,
    p_property_id: p,
    p_tenant_id: t,
    p_enabled: false,
    p_expected_version: version,
    p_reason: reason,
    p_evidence_sha256: null,
  });

describe.skipIf(!PG176_OK)(
  "E4 · ensaio de migração (PostgreSQL 17.6, papéis e privilégios da produção)",
  () => {
    it("1 · banco VAZIO de dados (estrutura legada mínima): preflight ok ⇒ aplicação ⇒ validação 100% ok; impressão digital registrada", async () => {
      const db = startProdLike();
      try {
        expect(db.version).toBe("17.6");
        expect(
          await db.sql(
            `select rolsuper::text || ',' || rolcreaterole::text || ',' || rolbypassrls::text from pg_roles where rolname = current_user`,
          ),
        ).toBe("false,true,true");
        const pre = await preflight(db);
        expect(failing(pre)).toEqual([]);
        const t0 = performance.now();
        const res = applyAll(db);
        const ms = Math.round(performance.now() - t0);
        expect(res).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
        const val = await validate(db);
        record("e4-01-empty", { preflight: pre, validate: val, applyMs: ms });
        // inclui as impressões digitais: a do arquivo de validação tem de bater com a aplicação ensaiada
        expect(failing(val)).toEqual([]);
        expect(val.filter((c) => c.check_name.startsWith("fingerprint")).length).toBe(2);
      } finally {
        db.stop();
      }
    }, 120_000);

    it("2 · banco com estrutura LEGADA e dados: nada legado muda (conteúdo, colunas, ACL, RLS, políticas, gatilhos, constraints)", async () => {
      const db = startProdLike();
      try {
        await seedLegacy(db);
        const before = await legacyFingerprint(db);
        expect(applyAll(db)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
        expect(await legacyFingerprint(db)).toBe(before);
        expect(failing(await validate(db))).toEqual([]);
      } finally {
        db.stop();
      }
    }, 120_000);

    it("3 · REEXECUÇÃO: cada migration reaplicada aborta pela guarda (ou pelo CREATE do lease) SEM nenhum efeito; impressão digital idêntica", async () => {
      const db = startProdLike();
      try {
        await seedLegacy(db);
        applyAll(db);
        const fp = async () =>
          (await validate(db))
            .filter((c) => c.check_name.startsWith("fingerprint"))
            .map((c) => c.found)
            .join("|") + (await legacyFingerprint(db));
        const before = await fp();
        const again = applyAll(db);
        record(
          "e4-03-rerun",
          again.map((r) =>
            r.ok
              ? "ok"
              : (r as { error: string }).error.split("\n").find((l) => l.includes("ERROR")),
          ),
        );
        expect(again.every((r) => !r.ok)).toBe(true);
        expect((again[1] as { error: string }).error).toContain("objetos já existem");
        expect((again[2] as { error: string }).error).toContain("objetos já existem");
        expect(await fp()).toBe(before);
        // preflight num banco já aplicado acusa (não deixa aplicar por cima)
        expect(
          failing(await preflight(db))
            .map((c) => c.check_name)
            .sort(),
        ).toEqual(["no_guest_ai_relations", "no_lease_functions", "no_shadow_functions"]);
        // aplicação fora de ordem é recusada (piloto sem Shadow; Shadow sem lease)
        const empty = startProdLike();
        try {
          expect((empty.file(MIG.pilot) as { error: string }).error).toContain(
            "migration Shadow (E3.1) ausente",
          );
          expect((empty.file(MIG.shadow) as { error: string }).error).toContain(
            "pré-requisito ausente",
          );
          expect(
            await empty.sql(`select count(*) from pg_class where relname like 'guest\\_ai\\_%'`),
          ).toBe("0");
        } finally {
          empty.stop();
        }
      } finally {
        db.stop();
      }
    }, 180_000);

    it("4 · ROLLBACK: só o piloto volta EXATAMENTE ao estado Shadow (E3.1); rollback total remove tudo; legado intacto; reaplicação limpa funciona", async () => {
      const db = startProdLike();
      try {
        await seedLegacy(db);
        const legacy0 = await legacyFingerprint(db);
        db.file(MIG.lease);
        db.file(MIG.shadow);
        const shadowOnly = await db.sql(
          `select md5(string_agg(p.proname || md5(p.prosrc) || coalesce(p.proacl::text, ''), '|' order by p.proname)) from pg_proc p where p.proname like 'shadow\\_%' or p.proname like 'guest\\_ai\\_shadow\\_%'`,
        );
        db.file(MIG.pilot);
        // rollback recusado com o Shadow ativo
        await toRunningWithManifest(db, [{ p: P[0]!, t: TENANT_A }]);
        expect((db.file(OPS("03a-rollback-pilot.sql")) as { error: string }).error).toContain(
          "Shadow ativo",
        );
        await admin(db, "shadow_emergency_stop", { p_actor: ACTOR });
        expect(db.file(OPS("03a-rollback-pilot.sql"))).toEqual({ ok: true });
        expect(
          await db.sql(
            `select md5(string_agg(p.proname || md5(p.prosrc) || coalesce(p.proacl::text, ''), '|' order by p.proname)) from pg_proc p where p.proname like 'shadow\\_%' or p.proname like 'guest\\_ai\\_shadow\\_%'`,
          ),
        ).toBe(shadowOnly);
        expect(
          await db.sql(
            `select count(*) from pg_class where relname like 'guest\\_ai\\_shadow\\_property%'`,
          ),
        ).toBe("0");
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
    }, 180_000);

    describe("com as três migrations aplicadas", () => {
      let db: ProdLike;
      beforeAll(async () => {
        db = startProdLike();
        await seedLegacy(db);
        applyAll(db);
      }, 120_000);
      afterAll(() => db?.stop());

      it("5 · RLS e ACL: clientes não leem, não escrevem, não usam sequências; service_role só as 13 RPCs do worker; administrativas recusadas para service_role", async () => {
        for (const role of ["anon", "authenticated", "service_role", "sandbox_exec"]) {
          for (const t of [
            "guest_ai_shadow_control",
            "guest_ai_shadow_property_switch",
            "guest_ai_shadow_property_switch_log",
            "guest_ai_shadow_executions",
            "guest_ai_shadow_inflight",
          ]) {
            expect(
              (await db.trySql(`select 1 from public.${t} limit 1`, { role })).ok,
              `${role} ${t}`,
            ).toBe(false);
          }
          expect(
            (
              await db.trySql(
                `select nextval('public.guest_ai_shadow_property_switch_log_id_seq')`,
                { role },
              )
            ).ok,
            role,
          ).toBe(false);
        }
        for (const fn of [
          "shadow_set_property_enabled(null, null, null, null, null, null, null)",
          "shadow_emergency_stop(null)",
          "shadow_admin_reconcile(null)",
          "shadow_manifest_add(null, null, null, null, null, null, null)",
          "shadow_transition(null, null, null, null, null)",
        ]) {
          for (const role of ["anon", "authenticated", "service_role", "sandbox_exec"]) {
            const r = await db.trySql(`select public.${fn}`, { role });
            expect(r.ok, `${role} ${fn}`).toBe(false);
            if (!r.ok) expect(r.error).toMatch(/permission denied/);
          }
        }
        expect(
          JSON.parse(await db.sql(`select public.shadow_get_control()`, { role: "service_role" }))
            .state,
        ).toBe("disabled");
      });

      it("6/7/8 · habilitação individual dos 5 imóveis do mesmo tenant + isolamento entre tenants + 6º imóvel recusado em todas as barreiras", async () => {
        await toRunningWithManifest(
          db,
          P.slice(0, 5).map((p) => ({ p, t: TENANT_A })),
        );
        // estado inicial: TODOS desabilitados; o tick não vê nenhum
        expect(
          JSON.parse(await db.sql(`select public.shadow_get_manifest()`, { role: "service_role" }))
            .entries,
        ).toEqual([]);
        // 6º imóvel: a versão ATIVA do manifesto é imutável; uma versão futura só vale depois de reconfigurar (fora de running)
        expect(
          (
            await admin(db, "shadow_manifest_add", {
              p_actor: ACTOR,
              p_manifest_version: 1,
              p_tenant_id: TENANT_B,
              p_property_id: P[5],
              p_selection_reason: "highest_volume",
              p_twin_status: "verified",
              p_history_status: "verified",
            })
          ).result,
        ).toBe("version_immutable");
        expect(
          (
            await admin(db, "shadow_manifest_add", {
              p_actor: ACTOR,
              p_manifest_version: 2,
              p_tenant_id: TENANT_B,
              p_property_id: P[5],
              p_selection_reason: "highest_volume",
              p_twin_status: "verified",
              p_history_status: "verified",
            })
          ).result,
        ).toBe("applied");
        // nem habilitação fora do manifesto, nem com tenant trocado
        expect((await enable(db, P[5]!, TENANT_B, 0)).result).toBe("not_in_manifest");
        expect((await enable(db, P[0]!, TENANT_B, 0)).result).toBe("not_in_manifest");
        // habilitar exige referência da autorização e versão; motivo coerente
        expect(
          (
            await admin(db, "shadow_set_property_enabled", {
              p_actor: ACTOR,
              p_property_id: P[0],
              p_tenant_id: TENANT_A,
              p_enabled: true,
              p_expected_version: 0,
              p_reason: "pilot_enable",
              p_evidence_sha256: null,
            })
          ).result,
        ).toBe("invalid_argument");
        expect(
          (
            await admin(db, "shadow_set_property_enabled", {
              p_actor: ACTOR,
              p_property_id: P[0],
              p_tenant_id: TENANT_A,
              p_enabled: true,
              p_expected_version: null,
              p_reason: "pilot_enable",
              p_evidence_sha256: EVID,
            })
          ).result,
        ).toBe("invalid_argument");
        expect((await enable(db, P[0]!, TENANT_A, 7)).result).toBe("stale_version");
        // um a um, independentes
        for (let i = 0; i < 5; i++) {
          expect(await enable(db, P[i]!, TENANT_A, 0)).toEqual({
            result: "applied",
            enabled: true,
            version: 1,
          });
          const seen = JSON.parse(
            await db.sql(`select public.shadow_get_manifest()`, { role: "service_role" }),
          ).entries.map((e: { property_id: string }) => e.property_id);
          expect(seen.sort()).toEqual(P.slice(0, i + 1).sort());
        }
        expect((await enable(db, P[0]!, TENANT_A, 1)).result).toBe("noop");
        // desabilitar UM não afeta os outros; desabilitar nunca é bloqueado (sem versão)
        expect(await disable(db, P[2]!, TENANT_A)).toMatchObject({
          result: "applied",
          enabled: false,
          version: 2,
        });
        expect(
          JSON.parse(await db.sql(`select public.shadow_get_manifest()`, { role: "service_role" }))
            .entries,
        ).toHaveLength(4);
        // tenant trocado é recusado também ao DESABILITAR (nenhum efeito entre tenants em nenhuma direção)
        expect((await disable(db, P[1]!, TENANT_B)).result).toBe("tenant_mismatch");
        // imóvel ARQUIVADO não pode ser (re)habilitado, mesmo no manifesto e com versão correta
        await db.sql(`update public.properties set archived_at = now() where id = '${P[2]}'`);
        expect((await enable(db, P[2]!, TENANT_A, 2)).result).toBe("archived");
        await db.sql(`update public.properties set archived_at = null where id = '${P[2]}'`);
        // imóvel arquivado pela Capacidade B some do tick sem nenhuma ação no Shadow
        await db.sql(`update public.properties set archived_at = now() where id = '${P[4]}'`);
        expect(
          JSON.parse(await db.sql(`select public.shadow_get_manifest()`, { role: "service_role" }))
            .entries,
        ).toHaveLength(3);
        await db.sql(`update public.properties set archived_at = null where id = '${P[4]}'`);
        // histórico auditável: quem, papel do banco, quando, antes/depois, motivo, evidência
        const log = await db.rows<{
          property_id: string;
          from_enabled: boolean;
          to_enabled: boolean;
          actor: string;
          db_role: string;
          reason_code: string;
          evidence_sha256: string | null;
        }>(
          `select property_id, from_enabled, to_enabled, actor, db_role, reason_code, evidence_sha256 from public.guest_ai_shadow_property_switch_log order by id`,
        );
        record("e4-06-switch-log", log);
        expect(log).toHaveLength(6);
        expect(log.every((l) => l.actor === ACTOR && l.db_role === "postgres")).toBe(true);
        expect(log[5]).toMatchObject({
          property_id: P[2],
          from_enabled: true,
          to_enabled: false,
          reason_code: "pilot_disable",
          evidence_sha256: null,
        });
        // histórico imutável: nem o dono altera pela via normal sem deixar rastro de função; clientes nem leem
        expect(
          (
            await db.trySql(
              `update public.guest_ai_shadow_property_switch_log set actor = gen_random_uuid()`,
              { role: "service_role" },
            )
          ).ok,
        ).toBe(false);
      });

      it("8b · teto de 5 HABILITADOS e de 5 por versão do manifesto (lista autorizada fechada)", async () => {
        const db2 = startProdLike();
        try {
          await seedLegacy(db2);
          applyAll(db2);
          for (let i = 0; i < 5; i++)
            expect(
              (
                await admin(db2, "shadow_manifest_add", {
                  p_actor: ACTOR,
                  p_manifest_version: 1,
                  p_tenant_id: P.indexOf(P[i]!) < 5 ? TENANT_A : TENANT_B,
                  p_property_id: P[i],
                  p_selection_reason: "highest_volume",
                  p_twin_status: "verified",
                  p_history_status: "verified",
                })
              ).result,
            ).toBe("applied");
          expect(
            (
              await admin(db2, "shadow_manifest_add", {
                p_actor: ACTOR,
                p_manifest_version: 1,
                p_tenant_id: TENANT_B,
                p_property_id: P[5],
                p_selection_reason: "highest_volume",
                p_twin_status: "verified",
                p_history_status: "verified",
              })
            ).result,
          ).toBe("pilot_cap_reached");
          // força (como dono, fora da função) um 6º no manifesto para provar a 2ª barreira: no máximo 5 habilitados
          await db2.sql(
            `insert into public.guest_ai_shadow_manifest (manifest_version, tenant_id, property_id, selection_reason, twin_status, history_status, authorized_by) values (1, '${TENANT_B}', '${P[5]}', 'highest_volume', 'verified', 'verified', '${ACTOR}')`,
          );
          await db2.sql(`update public.guest_ai_shadow_control set manifest_version = 1`);
          for (let i = 0; i < 5; i++)
            expect((await enable(db2, P[i]!, TENANT_A, 0)).result).toBe("applied");
          expect((await enable(db2, P[5]!, TENANT_B, 0)).result).toBe("pilot_cap_reached");
        } finally {
          db2.stop();
        }
      }, 120_000);

      it("10/11 · trava global: 20 aquisições concorrentes ⇒ 1; TTL = 55 s pelo relógio do banco; liberação só pelo dono", async () => {
        const rs = await Promise.all(
          Array.from({ length: 20 }, () => rpc(db, "shadow_acquire_tick", {}, "service_role")),
        );
        expect(rs.filter((r) => r.result === "acquired")).toHaveLength(1);
        const [ttl] = await db.rows<{ s: number }>(
          `select round(extract(epoch from tick_expires_at - now()))::int s from public.guest_ai_shadow_control`,
        );
        expect(ttl!.s).toBeGreaterThanOrEqual(54);
        expect(ttl!.s).toBeLessThanOrEqual(55);
        const tok = rs.find((r) => r.result === "acquired")!.tick_token;
        expect(
          (await rpc(db, "shadow_release_tick", { p_tick_token: tok }, "service_role")).result,
        ).toBe("released");
      });

      it("20 · EMERGÊNCIA: parada global imediata (sem religar), reivindicação e reserva recusadas, execução em andamento termina, abandonadas reconciliadas, imóvel desabilitado sem versão", async () => {
        // uma execução em andamento (lote pronto e reivindicado) com reserva
        const conv = "c4000000-0000-4000-8000-000000000001";
        const m = "a4000000-0000-4000-8000-000000000001";
        await db.sql(
          `select public.transition_conversation_lease('${conv}', 'observe', 0, null, array['${m}']::uuid[])`,
          { role: "service_role" },
        );
        await db.sql(
          `select public.transition_conversation_lease('${conv}', 'mark_ready', 1, null, array['${m}']::uuid[])`,
          { role: "service_role" },
        );
        const tick = await rpc(db, "shadow_acquire_tick", {}, "service_role");
        const exec = "e4000000-0000-4000-8000-000000000001";
        // barreira da REIVINDICAÇÃO: imóvel no manifesto, mas desabilitado ⇒ property_disabled (nada muda no lease)
        expect(await disable(db, P[0]!, TENANT_A, 1)).toMatchObject({
          result: "applied",
          enabled: false,
          version: 2,
        });
        expect(
          (
            await rpc(
              db,
              "shadow_claim_execution",
              {
                p_tick_token: tick.tick_token,
                p_execution_id: "e4000000-0000-4000-8000-0000000000d1",
                p_conversation_id: conv,
                p_expected_version: 2,
                p_tenant_id: TENANT_A,
                p_property_id: P[0],
                p_channel: "web",
              },
              "service_role",
            )
          ).result,
        ).toBe("property_disabled");
        expect(await enable(db, P[0]!, TENANT_A, 2)).toMatchObject({
          result: "applied",
          enabled: true,
          version: 3,
        });
        const claim = await rpc(
          db,
          "shadow_claim_execution",
          {
            p_tick_token: tick.tick_token,
            p_execution_id: exec,
            p_conversation_id: conv,
            p_expected_version: 2,
            p_tenant_id: TENANT_A,
            p_property_id: P[0],
            p_channel: "web",
          },
          "service_role",
        );
        expect(claim.result).toBe("claimed");
        expect(
          (
            await rpc(
              db,
              "shadow_reserve_budget",
              { p_execution_id: exec, p_tokens: 83072, p_cost: "0.13072000", p_calls: 2 },
              "service_role",
            )
          ).result,
        ).toBe("reserved");
        // E1
        const stop = await admin(db, "shadow_emergency_stop", { p_actor: ACTOR });
        expect(stop).toMatchObject({ result: "stopped", from: "running", state: "paused" });
        expect(await admin(db, "shadow_emergency_stop", { p_actor: ACTOR })).toMatchObject({
          result: "already_stopped",
          state: "paused",
        });
        expect((await rpc(db, "shadow_acquire_tick", {}, "service_role")).result).toBe(
          "state_not_running",
        );
        expect(
          (
            await rpc(
              db,
              "shadow_reserve_budget",
              {
                p_execution_id: "e4000000-0000-4000-8000-000000000099",
                p_tokens: 10,
                p_cost: "0.01000000",
                p_calls: 1,
              },
              "service_role",
            )
          ).result,
        ).toBe("not_claimed");
        // E2: imóvel desabilitado sem versão, com motivo de emergência
        expect(await disable(db, P[1]!, TENANT_A, null, "emergency_disable")).toMatchObject({
          result: "applied",
          enabled: false,
        });
        // E5 antes do prazo do lease: a execução em andamento NÃO é tocada
        expect(await admin(db, "shadow_admin_reconcile", { p_actor: ACTOR })).toEqual({
          result: "ok",
          reconciled: 0,
        });
        // ... depois do prazo (worker perdido): sela, liquida pelo pior caso, registra; repetir é seguro
        await db.sql(
          `update public.guest_ai_conversation_leases set lease_expires_at = now() - interval '1 second' where conversation_id = '${conv}'`,
        );
        expect(await admin(db, "shadow_admin_reconcile", { p_actor: ACTOR })).toMatchObject({
          result: "ok",
          reconciled: 1,
        });
        expect(await admin(db, "shadow_admin_reconcile", { p_actor: ACTOR })).toEqual({
          result: "ok",
          reconciled: 0,
        });
        const after = await db.rows<{ decision: string; technical_code: string }>(
          `select decision, technical_code from public.guest_ai_shadow_executions where execution_id = '${exec}'`,
        );
        expect(after).toEqual([{ decision: "technical_failure", technical_code: "worker_lost" }]);
        expect(
          await db.sql(
            `select settlement_kind || ':' || settled_cost from public.guest_ai_shadow_budget_reservations where execution_id = '${exec}'`,
          ),
        ).toBe("orphan_worst_case:0.13072000");
        expect(
          await db.sql(
            `select state from public.guest_ai_conversation_leases where conversation_id = '${conv}'`,
          ),
        ).toBe("failed");
        // nada religa sozinho: a transição registrada é MANUAL, com autor
        expect(
          await db.sql(
            `select string_agg(from_state || '>' || to_state || ':' || automatic || ':' || (actor is not null), ',' order by id) from public.guest_ai_shadow_transitions where to_state = 'paused'`,
          ),
        ).toBe("running>paused:false:true");
        expect((await rpc(db, "shadow_get_control", {}, "service_role")).state).toBe("paused");
      });

      it("21 · Capacidade B preservada: inserir/alterar/excluir imóvel e conversa (inclusive do piloto, com manifesto, habilitação e lease) funciona como antes", async () => {
        const pid = P[0]!;
        // conversa com lease (FK em cascata) é excluída normalmente
        expect(
          (
            await db.trySql(
              `delete from public.property_chat_conversations where id = 'c4000000-0000-4000-8000-000000000001'`,
              { role: "service_role" },
            )
          ).ok,
        ).toBe(true);
        expect(
          await db.sql(
            `select count(*) from public.guest_ai_conversation_leases where conversation_id = 'c4000000-0000-4000-8000-000000000001'`,
          ),
        ).toBe("0");
        // imóvel do piloto (no manifesto e com habilitação) é alterado e excluído sem bloqueio
        expect(
          (
            await db.trySql(`update public.properties set name = 'Renomeado' where id = '${pid}'`, {
              role: "service_role",
            })
          ).ok,
        ).toBe(true);
        expect(
          (
            await db.trySql(`delete from public.properties where id = '${pid}'`, {
              role: "service_role",
            })
          ).ok,
        ).toBe(true);
        // e deixa de valer para o Shadow (não existe mais), sem resíduo que reabilite outro imóvel
        expect(
          JSON.parse(await db.sql(`select public.shadow_get_manifest()`)).entries.map(
            (e: { property_id: string }) => e.property_id,
          ),
        ).not.toContain(pid);
        expect(
          (
            await db.trySql(
              `insert into public.properties (owner_id, name) values ('${TENANT_A}', 'Novo')`,
              { role: "service_role" },
            )
          ).ok,
        ).toBe(true);
      });

      it("22 · nenhuma função Shadow/lease escreve fora de guest_ai_* (nenhum caminho de envio pelo banco); nenhuma referencia tabela de mensagens", async () => {
        const writes = await db.rows<{ proname: string; target: string }>(`
        select p.proname, m[2] target from pg_proc p, regexp_matches(p.prosrc, '(insert\\s+into|update|delete\\s+from)\\s+public\\.([a-z_]+)', 'gi') m
         where p.proname like 'shadow\\_%' or p.proname like 'guest\\_ai\\_shadow\\_%' or p.proname like '%\\_conversation\\_lease'`);
        record("e4-22-writes", writes);
        expect(writes.length).toBeGreaterThan(10);
        expect(writes.filter((w) => !w.target.startsWith("guest_ai_"))).toEqual([]);
        expect(
          await db.sql(
            `select count(*) from pg_proc where (proname like 'shadow\\_%' or proname like 'guest\\_ai\\_shadow\\_%') and prosrc ~* '(chat_messages|net\\.http|pg_notify|http_post)'`,
          ),
        ).toBe("0");
      });
    });

    it("9 · CRON criado DESABILITADO (API do pg_cron reproduzida): job nasce inativo na mesma transação; recriação recusada; falha no meio desfaz tudo", async () => {
      const db = startProdLike({ legacy: false });
      try {
        // réplica mínima da API pública do pg_cron/pg_net/vault usada pelo script (o 17.6 local não tem a extensão)
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
        // se a desativação falhar, a criação é desfeita (nunca fica um job ativo)
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
