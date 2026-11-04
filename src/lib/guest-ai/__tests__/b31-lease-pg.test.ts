/**
 * B3.1 · lease distribuído com POSTGRES REAL (cluster local temporário; cada consulta = conexão
 * independente via processo `psql`). Concorrência, CAS, SKIP LOCKED, posse obsoleta, expiração e
 * recuperação, tentativas, fechamento estrito do lote, privilégios/RLS, modelo × banco e o adaptador
 * `DistributedLeaseStore` contra o banco. Nenhum acesso à produção.
 *
 * Evidência do gate: com `GUEST_AI_LEASE_EVIDENCE=write`, ao final grava `batch/lease-gate-evidence.ts`
 * com os critérios aprovados e os hashes da migration e do adaptador testados.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATION_PATH, PG_AVAILABLE, sha256File, startCluster, type PgCluster } from "./pg/pg-cluster";
import { applyLeaseEvent, claimReadyBatch, newLeaseRecord, resolveLeaseBackend, LEASE_RUNTIME_CRITERIA, type LeaseEvent, type LeaseRecord } from "@/lib/guest-ai/batch/lease";
import { createDistributedLeaseStore, LEASE_SNAPSHOT_COLUMNS, LEASE_TABLE } from "@/lib/guest-ai/data/lease-store.server";
import { leaseRpcFrom, type GuestAiDb } from "@/lib/guest-ai/data/client.server";

const ROOT = path.resolve(__dirname, "..");
const STORE_PATH = path.join(ROOT, "data/lease-store.server.ts");
const passed = new Set<string>();
const mark = (c: (typeof LEASE_RUNTIME_CRITERIA)[number]) => passed.add(c);
/** Os 5 testes de segurança precisam TODOS passar para o critério de privilégios valer. */
const security = new Set<string>();

let pg: PgCluster;
let seq = 0;
const uuid = (prefix: string) => {
  seq++;
  const h = seq.toString(16).padStart(12, "0");
  return `${prefix}-0000-4000-8000-${h}`;
};
const conv = () => uuid("c0000000");
const msg = () => uuid("a0000000");
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return v.length ? `array[${v.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(",")}]::uuid[]` : "'{}'::uuid[]";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
type J = Record<string, unknown> & { result: string; version?: number; state?: string; owner_token?: string; attempts?: number; message_ids?: string[]; deferred_message_ids?: string[]; batch_id?: string };
const SR = { role: "service_role" };
async function newConv(): Promise<string> {
  const c = conv();
  await pg.sql(`insert into public.property_chat_conversations(id) values ('${c}')`);
  return c;
}
async function tr(c: string, event: string, v: number, o: { token?: string | null; ids?: string[] | null; retryable?: boolean | null; ttl?: number } = {}): Promise<J> {
  const out = await pg.sql(
    `select public.transition_conversation_lease(p_conversation_id => '${c}', p_event => ${lit(event)}, p_expected_version => ${v}, p_owner_token => ${lit(o.token ?? null)}, p_message_ids => ${lit(o.ids ?? null)}, p_retryable => ${lit(o.retryable ?? null)}, p_ttl_seconds => ${o.ttl ?? 30})`,
    SR,
  );
  return JSON.parse(out) as J;
}
async function claim(c: string, v: number, ttl = 30): Promise<J> {
  return JSON.parse(await pg.sql(`select public.claim_conversation_lease('${c}', ${v}, ${ttl})`, SR)) as J;
}
async function row(c: string): Promise<{ state: string; version: number; attempts: number; owner_token: string | null; message_ids: string[]; deferred: string[]; processed: string[] }> {
  // `processed` via to_jsonb: a mesma consulta roda contra o SQL anterior (sem a coluna) nas reproduções
  const out = await pg.sql(`select json_build_object('state', state, 'version', version, 'attempts', attempts, 'owner_token', owner_token, 'message_ids', coalesce(message_ids,'{}'), 'deferred', coalesce(deferred_message_ids,'{}'), 'processed', coalesce(to_jsonb(l)->'processed_message_ids', '[]'::jsonb)) from public.guest_ai_conversation_leases l where conversation_id = '${c}'`);
  return JSON.parse(out);
}
/** Leva a conversa até `ready` com as mensagens dadas; devolve a versão. */
async function ready(c: string, ids: string[]): Promise<number> {
  expect((await tr(c, "observe", 0, { ids })).result).toBe("applied");
  const r = await tr(c, "mark_ready", 1, { ids });
  expect(r.result).toBe("applied");
  return r.version!;
}
/** Fixture de tempo (só no teste, como dono da tabela): vence o prazo do lease agora. */
const expireNow = (c: string) => pg.sql(`update public.guest_ai_conversation_leases set lease_expires_at = now() - interval '1 second' where conversation_id = '${c}'`);

describe.skipIf(!PG_AVAILABLE)("B3.1 · lease distribuído — Postgres real", () => {
  beforeAll(() => {
    pg = startCluster();
    mark("migration_applied");
  }, 60_000);
  afterAll(() => {
    if (process.env.GUEST_AI_LEASE_EVIDENCE === "write" && pg) {
      const criteria = Object.fromEntries(LEASE_RUNTIME_CRITERIA.map((c) => [c, passed.has(c) && (c !== "rls_and_privileges" || security.size === 5)]));
      const body = `/**
 * EVIDÊNCIA do Gate B3.1 — arquivo GERADO pela suíte Postgres real (\`__tests__/b31-lease-pg.test.ts\`
 * com \`GUEST_AI_LEASE_EVIDENCE=write\`). Não editar à mão. Os hashes amarram a evidência à migration e
 * ao adaptador exatos que foram testados; \`b31-lease-gate.test.ts\` falha se divergirem.
 */
export const LEASE_GATE_EVIDENCE = {
  generatedAt: ${JSON.stringify(new Date().toISOString())},
  postgres: ${JSON.stringify(pg.version)},
  migrationSha256: ${JSON.stringify(sha256File(MIGRATION_PATH))},
  storeSha256: ${JSON.stringify(sha256File(STORE_PATH))},
  criteria: ${JSON.stringify(criteria, null, 4).replace(/\n}/, "\n  }")} as Record<string, boolean>,
} as const;
`;
      writeFileSync(path.join(ROOT, "batch/lease-gate-evidence.ts"), body);
    }
    pg?.stop();
  });

  describe("privilégios, RLS e funções (anon / authenticated / service_role)", () => {
    it("clientes não leem nem alteram a tabela; service_role só lê; ninguém escreve direto", async () => {
      const c = await newConv();
      await ready(c, [msg()]);
      for (const role of ["anon", "authenticated", "sandbox_exec"]) {
        for (const q of [
          `select count(*) from public.guest_ai_conversation_leases`,
          `insert into public.guest_ai_conversation_leases(conversation_id, state) values ('${c}', 'collecting')`,
          `update public.guest_ai_conversation_leases set state = 'completed'`,
          `delete from public.guest_ai_conversation_leases`,
        ]) {
          const r = await pg.trySql(q, { role });
          expect(r.ok, `${role}: ${q}`).toBe(false);
          if (!r.ok) expect(r.error).toMatch(/permission denied/);
        }
      }
      expect((await pg.trySql(`select count(*) from public.guest_ai_conversation_leases`, SR)).ok).toBe(true);
      for (const q of [`update public.guest_ai_conversation_leases set attempts = 0`, `delete from public.guest_ai_conversation_leases`, `insert into public.guest_ai_conversation_leases(conversation_id, state) values ('${await newConv()}', 'collecting')`]) {
        const r = await pg.trySql(q, SR);
        expect(r.ok, q).toBe(false);
      }
      security.add("table");
    });
    it("só service_role executa as funções; anon/authenticated/sandbox_exec recebem permission denied", async () => {
      const c = await newConv();
      for (const role of ["anon", "authenticated", "sandbox_exec"]) {
        for (const q of [`select public.claim_conversation_lease('${c}', 1, 30)`, `select public.transition_conversation_lease('${c}', 'observe', 0, null, array['${msg()}']::uuid[])`]) {
          const r = await pg.trySql(q, { role });
          expect(r.ok, `${role}`).toBe(false);
          if (!r.ok) expect(r.error).toMatch(/permission denied for function/);
        }
      }
      expect((await tr(c, "observe", 0, { ids: [msg()] })).result).toBe("applied");
      security.add("functions");
    });
    it("RLS ligada sem política; funções SECURITY DEFINER com search_path fixo; ACL explícita", async () => {
      expect(await pg.sql(`select relrowsecurity::text || ':' || (select count(*) from pg_policies where tablename = 'guest_ai_conversation_leases') from pg_class where relname = 'guest_ai_conversation_leases'`)).toBe("true:0");
      const fns = await pg.sql(`select proname || '|' || prosecdef || '|' || array_to_string(proconfig, ',') || '|' || array_to_string(proacl, ',') from pg_proc where proname in ('claim_conversation_lease', 'transition_conversation_lease') order by 1`);
      for (const line of fns.split("\n")) {
        const [, secdef, config, acl] = line.split("|");
        expect(secdef).toBe("true");
        expect(config).toBe("search_path=pg_catalog, pg_temp");
        expect(acl).not.toMatch(/anon|authenticated|sandbox_exec|=X\/postgres,=X|^=X/);
        expect(acl).toMatch(/service_role=X/);
      }
      expect(await pg.sql(`select array_to_string(relacl, ',') from pg_class where relname = 'guest_ai_conversation_leases'`)).toBe("postgres=arwdDxt/postgres,service_role=r/postgres");
      security.add("rls");
    });
    it("argumentos manipulados não elevam privilégio nem passam da validação", async () => {
      const c = await newConv();
      for (const [ev, v, tok, ids] of [
        ["observe'); drop table public.guest_ai_conversation_leases; --", 0, null, [msg()]],
        ["observe", -1, null, [msg()]],
        ["observe", 0, "'; select 1; --", [msg()]],
        ["observe", 0, null, Array.from({ length: 51 }, () => msg())],
      ] as Array<[string, number, string | null, string[]]>) {
        expect((await tr(c, ev, v, { token: tok, ids })).result).toBe("invalid_argument");
      }
      const dup = msg();
      expect((await tr(c, "observe", 0, { ids: [dup, dup] })).result).toBe("invalid_argument");
      expect((await claim(c, 1, 3)).result).toBe("invalid_argument"); // prazo abaixo de 5 s
      expect((await claim(c, 1, 301)).result).toBe("invalid_argument");
      expect(await pg.sql(`select count(*) from pg_class where relname = 'guest_ai_conversation_leases'`)).toBe("1");
      security.add("arguments");
      mark("rls_and_privileges");
    });
    it("constraints do banco barram estados incoerentes mesmo para o dono da tabela", async () => {
      const c = await newConv();
      // Cada linha inválida viola UMA constraint (as demais colunas são válidas): o erro precisa citá-la.
      const B = `gen_random_uuid(), array['${msg()}']::uuid[]`;
      const T = `'${"a".repeat(64)}'`;
      const bad: Array<[string, string]> = [
        [`insert into public.guest_ai_conversation_leases(conversation_id, state, version) values ('${c}', 'collecting', 0)`, "gacl_version_ck"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state, attempts) values ('${c}', 'collecting', 4)`, "gacl_attempts_ck"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state, batch_id, message_ids, owner_token) values ('${c}', 'completed', ${B}, ${T})`, "gacl_owner_ck"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state, batch_id, message_ids, lease_expires_at) values ('${c}', 'claimed', ${B}, now())`, "gacl_owner_ck"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state, batch_id, message_ids, owner_token, lease_expires_at) values ('${c}', 'claimed', ${B}, 'abc', now())`, "gacl_owner_format_ck"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state, batch_id, message_ids, lease_expires_at) values ('${c}', 'ready', ${B}, now())`, "gacl_expiry_ck"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state, batch_id, message_ids) values ('${c}', 'ready', null, array['${msg()}']::uuid[])`, "gacl_batch_ck"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state, batch_id, message_ids) values ('${c}', 'ready', gen_random_uuid(), '{}')`, "gacl_batch_ck"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state, message_ids) values ('${c}', 'collecting', array[null]::uuid[])`, "gacl_messages_ck"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state, deferred_message_ids) values ('${c}', 'collecting', array[null]::uuid[])`, "gacl_deferred_ck"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state) values ('${c}', 'whatever')`, "gacl_"],
        [`insert into public.guest_ai_conversation_leases(conversation_id, state) values ('${conv()}', 'collecting')`, "foreign key"],
      ];
      for (const [q, constraint] of bad) {
        const r = await pg.trySql(q);
        expect(r.ok, q).toBe(false);
        if (!r.ok) expect(r.error, q).toContain(constraint);
      }
      security.add("constraints");
      // linhas coerentes passam (prova de que as constraints não barram estados legítimos)
      expect((await pg.trySql(`insert into public.guest_ai_conversation_leases(conversation_id, state, batch_id, message_ids, owner_token, lease_expires_at, attempts) values ('${c}', 'claimed', ${B}, ${T}, now(), 1); delete from public.guest_ai_conversation_leases where conversation_id = '${c}'`)).ok).toBe(true);
    });
  });

  describe("concorrência real (conexões independentes)", () => {
    it("10 workers disputam a MESMA conversa ao mesmo tempo: exatamente 1 adquire; os demais recebem conflito/indisponível/versão obsoleta", async () => {
      const c = await newConv();
      const v = await ready(c, [msg(), msg()]);
      const results = await Promise.all(Array.from({ length: 10 }, () => claim(c, v)));
      const acquired = results.filter((r) => r.result === "acquired");
      expect(acquired).toHaveLength(1);
      for (const r of results.filter((x) => x.result !== "acquired")) expect(["conflict", "unavailable", "stale_version"]).toContain(r.result);
      const st = await row(c);
      expect(st).toMatchObject({ state: "claimed", attempts: 1, owner_token: acquired[0]!.owner_token });
      mark("cas_version");
    });
    it("SKIP LOCKED: com a linha travada por outra transação, o claim volta NA HORA com `unavailable` (não espera)", async () => {
      const c = await newConv();
      const v = await ready(c, [msg()]);
      const holder = pg.sql(`begin; select 1 from public.guest_ai_conversation_leases where conversation_id = '${c}' for update; select pg_sleep(2); commit;`);
      await new Promise((r) => setTimeout(r, 400));
      const t0 = Date.now();
      const r = await claim(c, v);
      const elapsed = Date.now() - t0;
      expect(r.result).toBe("unavailable");
      expect(elapsed).toBeLessThan(1500);
      await holder;
      expect((await claim(c, v)).result).toBe("acquired");
      mark("skip_locked_real_concurrency");
    });
    it("conversas diferentes: um claim travado em uma não bloqueia a outra", async () => {
      const a = await newConv();
      const b = await newConv();
      await ready(a, [msg()]);
      const vb = await ready(b, [msg()]);
      const holder = pg.sql(`begin; select 1 from public.guest_ai_conversation_leases where conversation_id = '${a}' for update; select pg_sleep(2); commit;`);
      await new Promise((r) => setTimeout(r, 400));
      const t0 = Date.now();
      expect((await claim(b, vb)).result).toBe("acquired");
      expect(Date.now() - t0).toBeLessThan(1500);
      await holder;
      // e em paralelo puro: 5 conversas, 5 aquisições
      const cs = await Promise.all(Array.from({ length: 5 }, async () => {
        const c = await newConv();
        return { c, v: await ready(c, [msg()]) };
      }));
      const rs = await Promise.all(cs.map(({ c, v }) => claim(c, v)));
      expect(rs.every((r) => r.result === "acquired")).toBe(true);
      mark("different_conversations_parallel");
    });
  });

  describe("posse obsoleta (versão + token juntos)", () => {
    it("versão obsoleta, token antigo, token de outro e conclusão depois de perder a posse ⇒ recusados", async () => {
      const c = await newConv();
      const v = await ready(c, [msg()]);
      const a = await claim(c, v);
      expect(a.result).toBe("acquired");
      expect((await tr(c, "start", v, { token: a.owner_token })).result).toBe("stale_version"); // versão antiga
      expect((await tr(c, "start", a.version!, { token: "f".repeat(64) })).result).toBe("stale_owner"); // token de outro
      expect((await tr(c, "start", a.version!, { token: null })).result).toBe("stale_owner"); // só a versão não basta
      const s = await tr(c, "start", a.version!, { token: a.owner_token });
      expect(s).toMatchObject({ result: "applied", state: "processing" });
      // perde a posse: prazo vence e outro worker recupera
      await expireNow(c);
      const b = await claim(c, s.version!);
      expect(b.result).toBe("recovered");
      expect(b.owner_token).not.toBe(a.owner_token);
      expect(b.version).toBe(s.version! + 1);
      // o antigo tenta concluir: com a versão que conhecia ⇒ obsoleta; com a nova versão ⇒ token antigo recusado
      expect((await tr(c, "complete", s.version!, { token: a.owner_token })).result).toBe("stale_version");
      expect((await tr(c, "complete", b.version!, { token: a.owner_token })).result).toBe("stale_owner");
      expect((await tr(c, "fail", b.version!, { token: a.owner_token, retryable: true })).result).toBe("stale_owner");
      expect((await tr(c, "cancel", b.version!, { token: a.owner_token })).result).toBe("stale_owner");
      expect((await row(c)).owner_token).toBe(b.owner_token);
      mark("stale_owner_rejected");
    });
  });

  describe("expiração e recuperação", () => {
    it("prazo REAL de 5 s vence; outro worker recupera com nova posse e nova versão; o antigo não renova nem age", async () => {
      const c = await newConv();
      const v = await ready(c, [msg()]);
      const a = await claim(c, v, 5);
      expect(a.result).toBe("acquired");
      expect((await claim(c, a.version!)).result).toBe("conflict"); // vigente
      await new Promise((r) => setTimeout(r, 5_600));
      expect((await tr(c, "renew", a.version!, { token: a.owner_token })).result).toBe("lease_expired"); // dono vencido não renova
      expect((await tr(c, "start", a.version!, { token: a.owner_token })).result).toBe("lease_expired");
      const b = await claim(c, a.version!);
      expect(b).toMatchObject({ result: "recovered", attempts: 2 });
      expect(b.version).toBe(a.version! + 1);
      expect((await tr(c, "renew", b.version!, { token: a.owner_token })).result).toBe("stale_owner");
      const rn = await tr(c, "renew", b.version!, { token: b.owner_token, ttl: 60 });
      expect(rn).toMatchObject({ result: "applied", state: "claimed" });
      mark("expired_owner_cannot_renew");
    }, 20_000);
    it("expire explícito libera a posse; recuperação após falha do worker; nunca duas posses válidas", async () => {
      const c = await newConv();
      const v = await ready(c, [msg(), msg()]);
      const a = await claim(c, v);
      expect((await tr(c, "expire", a.version!)).result).toBe("noop"); // ainda vigente
      await expireNow(c);
      const e = await tr(c, "expire", a.version!);
      expect(e).toMatchObject({ result: "applied", state: "expired" });
      expect((await row(c)).owner_token).toBeNull();
      const racers = await Promise.all(Array.from({ length: 6 }, () => claim(c, e.version!)));
      expect(racers.filter((r) => r.result === "recovered")).toHaveLength(1);
      const st = await row(c);
      expect(st.state).toBe("claimed");
      expect(st.owner_token).not.toBe(a.owner_token);
      expect(st.message_ids).toHaveLength(2); // nenhuma mensagem perdida na recuperação
      mark("expiry_recovery_new_owner");
    });
  });

  describe("tentativas (máximo 3; conflito não conta)", () => {
    it("falha retentável volta a ready até a 3ª tentativa; a 3ª falha encerra em failed; conflito não incrementa", async () => {
      const c = await newConv();
      let v = await ready(c, [msg()]);
      for (let k = 1; k <= 3; k++) {
        const a = await claim(c, v);
        expect(a).toMatchObject({ result: "acquired", attempts: k });
        expect((await claim(c, a.version!)).result).toBe("conflict");
        expect((await row(c)).attempts).toBe(k); // conflito de concorrência não é tentativa
        const s = await tr(c, "start", a.version!, { token: a.owner_token });
        const f = await tr(c, "fail", s.version!, { token: a.owner_token, retryable: true });
        expect(f.state).toBe(k < 3 ? "ready" : "failed");
        v = f.version!;
      }
      expect((await claim(c, v)).result).toBe("not_claimable");
      expect((await row(c)).attempts).toBe(3);
    });
    it("expirações sucessivas: a 4ª aquisição é recusada (attempts_exhausted); falha definitiva vai direto a failed", async () => {
      const c = await newConv();
      let v = await ready(c, [msg()]);
      for (let k = 1; k <= 3; k++) {
        const a = await claim(c, v);
        expect(a.attempts).toBe(k);
        await expireNow(c);
        v = a.version!;
      }
      expect((await claim(c, v)).result).toBe("attempts_exhausted");
      const d = await newConv();
      const vd = await ready(d, [msg()]);
      const a = await claim(d, vd);
      const f = await tr(d, "fail", a.version!, { token: a.owner_token, retryable: false });
      expect(f).toMatchObject({ result: "applied", state: "failed" });
      mark("retries_capped_at_3");
    });
  });

  describe("GuestMessageBatch: fechamento estrito, adiamento, sem perda nem duplicação", () => {
    it("lote fechado é imutável: mensagens depois do claim vão para deferred, na ordem, sem duplicar", async () => {
      const c = await newConv();
      const [m1, m2, m3, m4] = [msg(), msg(), msg(), msg()];
      const v = await ready(c, [m1!, m2!]);
      const a = await claim(c, v);
      const d1 = await tr(c, "observe", a.version!, { ids: [m1!, m2!, m3!] });
      expect(d1).toMatchObject({ result: "deferred", deferred_message_ids: [m3] });
      expect((await tr(c, "observe", d1.version!, { ids: [m1!, m2!, m3!] })).result).toBe("noop"); // repetido
      const d2 = await tr(c, "observe", d1.version!, { ids: [m1!, m2!, m3!, m4!] });
      expect(d2.deferred_message_ids).toEqual([m3, m4]);
      expect((await row(c)).message_ids).toEqual([m1, m2]); // lote reivindicado intacto
      expect((await tr(c, "mark_ready", d2.version!, { ids: [m1!, m2!, m3!] })).result).toBe("invalid_transition");
      const s = await tr(c, "start", d2.version!, { token: a.owner_token });
      const done = await tr(c, "complete", s.version!, { token: a.owner_token });
      expect(done.state).toBe("completed");
      expect((await tr(c, "complete", done.version!, { token: a.owner_token })).result).toBe("already_processed");
      // próximo ciclo: só as adiadas/novas, sem as já concluídas, na ordem. Revisão final (ponto 4):
      // mesmo que o coletor reapresente SÓ as concluídas, as adiadas abrem o novo ciclo (antes: noop).
      const next = await tr(c, "observe", done.version!, { ids: [m1!, m2!] });
      expect(next).toMatchObject({ result: "applied", state: "collecting" });
      expect((await row(c))).toMatchObject({ message_ids: [m3, m4], deferred: [], attempts: 0 });
      expect((await tr(c, "observe", next.version!, { ids: [m1!, m2!, m3!, m4!] })).result).toBe("noop"); // repetição: idempotente
      mark("deferred_no_loss_no_dup");
    });
    it("mark_ready exige coleta, versão, mensagens distintas (1–20); observação concorrente na criação: 1 vence", async () => {
      const c = await newConv();
      const ids = Array.from({ length: 21 }, () => msg());
      const creators = await Promise.all([tr(c, "observe", 0, { ids: [ids[0]!] }), tr(c, "observe", 0, { ids: [ids[1]!] }), tr(c, "observe", 0, { ids: [ids[2]!] })]);
      expect(creators.filter((r) => r.result === "applied")).toHaveLength(1);
      expect(creators.filter((r) => r.result === "stale_version")).toHaveLength(2);
      const winner = (await row(c)).message_ids;
      const all = await tr(c, "observe", 1, { ids }); // todas pendentes (as perdedoras da corrida também entram)
      expect(all).toMatchObject({ result: "applied", version: 2 });
      expect([...(await row(c)).message_ids].slice(0, 1)).toEqual(winner);
      const ordered = [...winner, ...ids.filter((x) => !winner.includes(x))];
      expect((await tr(c, "mark_ready", 2, { ids })).result).toBe("invalid_argument"); // 21
      expect((await tr(c, "mark_ready", 2, { ids: [] })).result).toBe("invalid_argument");
      expect((await tr(c, "mark_ready", 7, { ids: [ids[0]!] })).result).toBe("stale_version");
      const r = await tr(c, "mark_ready", 2, { ids: ordered.slice(0, 20) });
      expect(r).toMatchObject({ result: "applied", state: "ready" });
      expect(r.message_ids).toEqual(ordered.slice(0, 20)); // ordem preservada
      expect((await row(c)).deferred).toEqual(ordered.slice(20)); // o que não coube no lote continua pendente
      expect(String(r.batch_id)).toMatch(/^[0-9a-f-]{36}$/);
      // mensagem nova antes do claim reabre a coleta (o lote pronto deixa de valer; nada se perde)
      expect((await tr(c, "observe", r.version!, { ids })).result).toBe("noop"); // nada novo: lote pronto preservado
      const re = await tr(c, "observe", r.version!, { ids: [msg()] });
      expect(re.state).toBe("collecting");
      expect((await claim(c, re.version!)).result).toBe("not_claimable");
      mark("batch_strict_closure");
    });
  });

  describe("modelo de referência (TS) × banco: mesmas sequências, mesmos resultados", () => {
    const MAP: Record<string, string> = { acquired: "applied", recovered: "applied", conflict: "lease_held", stale_version: "version_conflict", not_claimable: "invalid_transition", attempts_exhausted: "attempts_exhausted", applied: "applied", deferred: "deferred", noop: "noop", stale_owner: "stale_owner", lease_expired: "lease_expired", invalid_transition: "invalid_transition", already_processed: "already_processed", invalid_argument: "invalid_event", pending_overflow: "pending_overflow" };
    const modelOutcome = (r: ReturnType<typeof applyLeaseEvent>) => (r.ok ? r.effect : r.reason);
    it("sequências representativas sem expiração produzem estado, versão, tentativas e desfecho idênticos", async () => {
      const now = () => new Date().toISOString();
      // Cada passo descreve o MESMO evento para os dois lados; `stale` usa a versão anterior.
      type Step = { kind: string; ids?: string[]; token?: "wrong"; retryable?: boolean; stale?: boolean };
      const steps = (ids: string[]): Step[] => [
        { kind: "observe", ids },
        { kind: "observe", ids: [...ids, "x"] },
        { kind: "observe", ids, stale: true },
        { kind: "mark_ready", ids },
        { kind: "claim" },
        { kind: "claim" },
        { kind: "claim", stale: true },
        { kind: "start", token: "wrong" },
        { kind: "start" },
        { kind: "observe", ids: [...ids, "y"] },
        { kind: "renew" },
        { kind: "complete" },
        { kind: "complete" },
        { kind: "observe", ids },
        { kind: "cancel" },
        { kind: "observe", ids: [...ids, "z"] },
        { kind: "mark_ready", ids: ["z"] },
        { kind: "claim" },
        { kind: "fail", retryable: true },
        { kind: "cancel" },
        { kind: "cancel" },
        // revisão: mesmo lote após cancelamento preserva tentativas; mensagem nova zera; expire com CAS
        { kind: "observe", ids: ["z"] },
        { kind: "observe", ids: ["z", "w"] },
        { kind: "mark_ready", ids: ["z", "w"] },
        { kind: "claim" },
        { kind: "expire" },
        { kind: "expire", stale: true },
        { kind: "observe", ids: ["z", "w", "q"] },
        { kind: "renew" },
        { kind: "complete", token: "wrong" },
        // revisão final (ponto 4): dispensa explícita, reapresentação de concluídas/dispensadas, lote ⊆ pendentes
        { kind: "observe", ids: ["z", "w", "q", "r"] },
        { kind: "acknowledge", ids: ["q"] },
        { kind: "acknowledge", ids: ["q"] },
        { kind: "observe", ids: ["q"] },
        { kind: "mark_ready", ids: ["z", "s"] },
        { kind: "mark_ready", ids: ["z"] },
        { kind: "acknowledge", ids: ["z"] },
        { kind: "observe", ids: ["z", "w", "r", "s"] },
        { kind: "mark_ready", ids: ["z", "w"] },
        { kind: "claim" },
        { kind: "start" },
        { kind: "observe", ids: ["t"] },
        { kind: "acknowledge", ids: ["t"] },
        { kind: "complete" },
        { kind: "observe", ids: ["z", "w"] },
        { kind: "observe", ids: ["z", "w", "r", "s", "t"] },
        { kind: "acknowledge", ids: ["r", "s", "t"] },
        { kind: "observe", ids: ["z", "w", "q", "r", "s", "t"] },
      ];
      const c = await newConv();
      const base = [msg(), msg()];
      const alias: Record<string, string> = { x: msg(), y: msg(), z: msg(), w: msg(), q: msg(), r: msg(), s: msg(), t: msg() };
      const realIds = (xs: string[]) => xs.map((x) => alias[x] ?? x);
      let model: LeaseRecord = newLeaseRecord(c, now());
      let token: string | null = null;
      for (const [i, s] of steps(base).entries()) {
        const ids = s.ids ? realIds(s.ids) : undefined;
        const v = s.stale ? model.version - 1 : model.version;
        const tok = s.token === "wrong" ? "e".repeat(64) : token;
        let db: J;
        let ev: LeaseEvent;
        if (s.kind === "claim") {
          db = await claim(c, v);
          ev = { type: "claim", token: db.owner_token ?? "pending-token", ttlMs: 30_000, expectedVersion: v, now: now() };
        } else {
          db = await tr(c, s.kind, v, { ids: ids ?? null, token: ["start", "renew", "complete", "fail", "cancel"].includes(s.kind) ? tok : null, retryable: s.kind === "fail" ? !!s.retryable : null });
          ev =
            s.kind === "observe" ? { type: "observe", messageIds: ids!, now: now(), expectedVersion: v }
            : s.kind === "mark_ready" ? { type: "mark_ready", batchId: "b", messageIds: ids!, expectedVersion: v, now: now() }
            : s.kind === "renew" ? { type: "renew", token: tok ?? "", ttlMs: 30_000, expectedVersion: v, now: now() }
            : s.kind === "fail" ? { type: "fail", token: tok ?? "", retryable: !!s.retryable, expectedVersion: v, now: now() }
            : s.kind === "cancel" ? { type: "cancel", expectedVersion: v, now: now(), token: tok }
            : s.kind === "expire" ? { type: "expire", expectedVersion: v, now: now() }
            : s.kind === "acknowledge" ? { type: "acknowledge", messageIds: ids!, expectedVersion: v, now: now() }
            : ({ type: s.kind, token: tok ?? "", expectedVersion: v, now: now() } as LeaseEvent);
        }
        const m = applyLeaseEvent(model, ev);
        expect(MAP[db.result], `passo ${i} ${s.kind}: banco=${db.result} modelo=${modelOutcome(m)}`).toBe(modelOutcome(m));
        if (m.ok) model = m.record;
        if (db.result === "acquired" || db.result === "recovered") token = db.owner_token!;
        const st = await row(c);
        expect({ state: st.state, version: st.version, attempts: st.attempts }, `passo ${i}`).toEqual({ state: model.state, version: model.version, attempts: model.attempts });
        expect(st.message_ids).toEqual([...model.messageIds]);
        expect(st.deferred).toEqual([...model.deferredMessageIds]);
        expect(st.processed).toEqual([...model.processedMessageIds]);
      }
      mark("model_matches_database");
    });
  });

  describe("revisão de homologação · ponto 1 — observe × worker legítimo", () => {
    it("mensagens repetidas durante o processamento não tiram a autoridade do dono (versão de posse estável)", async () => {
      const c = await newConv();
      const [m1, m2, m3, m4] = [msg(), msg(), msg(), msg()];
      const v = await ready(c, [m1!]);
      const a = await claim(c, v);
      const s = await tr(c, "start", a.version!, { token: a.owner_token });
      // 3 chegadas seguidas (inclusive repetidas) com a versão que o coletor leu
      for (const ids of [[m1!, m2!], [m1!, m2!, m3!], [m1!, m2!, m3!], [m1!, m2!, m3!, m4!]]) {
        const o = await tr(c, "observe", s.version!, { ids });
        expect(["deferred", "noop"]).toContain(o.result);
        expect(o.version).toBe(s.version); // adiamento não muda a versão de posse
      }
      expect(await row(c)).toMatchObject({ state: "processing", message_ids: [m1], deferred: [m2, m3, m4] });
      // o dono segue operando com a versão que conhece + token
      const rn = await tr(c, "renew", s.version!, { token: a.owner_token });
      expect(rn).toMatchObject({ result: "applied", state: "processing" });
      const o2 = await tr(c, "observe", rn.version!, { ids: [m1!, m2!, m3!, m4!, msg()] });
      expect(o2).toMatchObject({ result: "deferred", version: rn.version });
      const done = await tr(c, "complete", rn.version!, { token: a.owner_token });
      expect(done).toMatchObject({ result: "applied", state: "completed" });
    });
    it("worker antigo continua impedido mesmo com a versão recuperada por leitura (token é exigido)", async () => {
      const c = await newConv();
      const v = await ready(c, [msg()]);
      const a = await claim(c, v);
      const s = await tr(c, "start", a.version!, { token: a.owner_token });
      await expireNow(c);
      const b = await claim(c, s.version!);
      expect(b.result).toBe("recovered");
      await tr(c, "observe", b.version!, { ids: [msg(), msg()] });
      const cur = Number(await pg.sql(`select version from public.guest_ai_conversation_leases where conversation_id = '${c}'`, SR)); // leitura como o adaptador faz
      for (const ev of ["start", "renew", "complete"]) expect((await tr(c, ev, cur, { token: a.owner_token })).result, ev).toBe("stale_owner");
      expect((await tr(c, "fail", cur, { token: a.owner_token, retryable: true })).result).toBe("stale_owner");
    });
    it("concorrência real observe × renew × complete: o dono conclui, nenhuma mensagem adiada se perde nem duplica", async () => {
      for (let round = 0; round < 5; round++) {
        const c = await newConv();
        const base = msg();
        const v = await ready(c, [base]);
        const a = await claim(c, v);
        const s = await tr(c, "start", a.version!, { token: a.owner_token });
        const extra = [msg(), msg(), msg()];
        const [o1, o2, rn, o3] = await Promise.all([
          tr(c, "observe", s.version!, { ids: [base, extra[0]!] }),
          tr(c, "observe", s.version!, { ids: [base, extra[0]!, extra[1]!] }),
          tr(c, "renew", s.version!, { token: a.owner_token }),
          tr(c, "observe", s.version!, { ids: [base, ...extra] }),
        ]);
        expect(rn.result).toBe("applied");
        // observações concorrentes à renovação: aplicadas antes dela, ou recusadas por versão (o coletor relê)
        for (const o of [o1, o2, o3]) expect(["deferred", "noop", "stale_version"]).toContain(o.result);
        const cur = Number(await pg.sql(`select version from public.guest_ai_conversation_leases where conversation_id = '${c}'`, SR));
        await tr(c, "observe", cur, { ids: [base, ...extra] }); // coletor relê e repete
        const [done, late] = await Promise.all([tr(c, "complete", rn.version!, { token: a.owner_token }), tr(c, "observe", rn.version!, { ids: [base, ...extra, msg()] })]);
        expect(done.result).toBe("applied");
        expect(["deferred", "stale_version", "applied"]).toContain(late.result);
        const st = await row(c);
        expect(st.message_ids.includes(base) || st.state === "collecting").toBe(true);
        const all = [...st.message_ids, ...st.deferred];
        expect(new Set(all).size).toBe(all.length); // sem duplicação
        if (st.state === "completed") expect(st.deferred.slice(0, 3)).toEqual(extra);
      }
    });
  });

  describe("revisão de homologação · ponto 2 — tentativas por lote", () => {
    it("lote anterior esgotado (3) + expiração + mensagem nova ⇒ novo lote com orçamento próprio", async () => {
      const c = await newConv();
      const old = msg();
      let v = await ready(c, [old]);
      for (let k = 1; k <= 3; k++) {
        const a = await claim(c, v);
        await expireNow(c);
        v = a.version!;
      }
      expect((await claim(c, v)).result).toBe("attempts_exhausted");
      const e = await tr(c, "expire", v);
      expect(e.state).toBe("expired");
      const fresh = msg();
      const o = await tr(c, "observe", e.version!, { ids: [old, fresh] });
      expect(o).toMatchObject({ result: "applied", state: "collecting" });
      expect((await row(c)).attempts).toBe(0);
      const r = await tr(c, "mark_ready", o.version!, { ids: [old, fresh] });
      const a = await claim(c, r.version!);
      expect(a).toMatchObject({ result: "acquired", attempts: 1 });
    });
    it("recuperação do MESMO lote não zera o contador (expirado, falho ou cancelado, sem mensagem nova)", async () => {
      for (const terminal of ["expired", "failed", "cancelled"] as const) {
        const c = await newConv();
        const m = msg();
        let v = await ready(c, [m]);
        const a1 = await claim(c, v);
        v = a1.version!;
        if (terminal === "expired") {
          await expireNow(c);
          v = (await tr(c, "expire", v)).version!;
        } else if (terminal === "failed") {
          v = (await tr(c, "fail", v, { token: a1.owner_token, retryable: false })).version!;
        } else {
          v = (await tr(c, "cancel", v, { token: a1.owner_token })).version!;
        }
        const o = await tr(c, "observe", v, { ids: [m] });
        expect(o.state, terminal).toBe("collecting");
        expect((await row(c)).attempts, terminal).toBe(1); // mesmas mensagens ⇒ mesmo lote ⇒ contador preservado
        const r = await tr(c, "mark_ready", o.version!, { ids: [m] });
        expect((await claim(c, r.version!)).attempts, terminal).toBe(2);
      }
    });
    it("lote esgotado sem mensagem nova continua bloqueado após novo ciclo (não contorna o limite)", async () => {
      const c = await newConv();
      const m = msg();
      let v = await ready(c, [m]);
      for (let k = 1; k <= 3; k++) {
        const a = await claim(c, v);
        const f = await tr(c, "fail", a.version!, { token: a.owner_token, retryable: true });
        v = f.version!;
      }
      expect((await row(c))).toMatchObject({ state: "failed", attempts: 3 });
      const o = await tr(c, "observe", v, { ids: [m] });
      const r = await tr(c, "mark_ready", o.version!, { ids: [m] });
      expect((await claim(c, r.version!)).result).toBe("attempts_exhausted");
    });
  });

  describe("revisão de homologação · ponto 3 — CAS no expire", () => {
    it("versão correta expira; versão obsoleta é recusada; lease válido não expira; repetição é recusada ou noop", async () => {
      const c = await newConv();
      const v = await ready(c, [msg()]);
      const a = await claim(c, v);
      expect(await tr(c, "expire", a.version!)).toMatchObject({ result: "noop", version: a.version }); // ainda válido
      await expireNow(c);
      expect((await tr(c, "expire", a.version! - 1)).result).toBe("stale_version");
      const e = await tr(c, "expire", a.version!);
      expect(e).toMatchObject({ result: "applied", state: "expired", version: a.version! + 1 });
      expect((await tr(c, "expire", a.version!)).result).toBe("stale_version"); // repetição com a versão antiga
      expect(await tr(c, "expire", e.version!)).toMatchObject({ result: "noop", version: e.version }); // repetição atual: nada muda
    });
    it("expire concorrente com renew (dono vigente): renew vence; expire com a versão antiga é recusado", async () => {
      for (let round = 0; round < 5; round++) {
        const c = await newConv();
        const v = await ready(c, [msg()]);
        const a = await claim(c, v);
        const [rn, ex] = await Promise.all([tr(c, "renew", a.version!, { token: a.owner_token }), tr(c, "expire", a.version!)]);
        expect(rn.result).toBe("applied");
        expect(["noop", "stale_version"]).toContain(ex.result); // nunca expira lease vigente
        expect((await row(c)).state).toBe("claimed");
      }
    });
    it("expire concorrente com recuperação por outro worker: uma só transição vence; nunca duas posses", async () => {
      for (let round = 0; round < 5; round++) {
        const c = await newConv();
        const v = await ready(c, [msg()]);
        const a = await claim(c, v);
        await expireNow(c);
        const [ex, rec] = await Promise.all([tr(c, "expire", a.version!), claim(c, a.version!)]);
        const won = [ex.result === "applied", rec.result === "recovered"].filter(Boolean).length;
        expect(won).toBe(1);
        expect(["stale_version", "applied"]).toContain(ex.result);
        expect(["recovered", "stale_version", "unavailable"]).toContain(rec.result);
        const st = await row(c);
        expect(st.state === "claimed" ? st.owner_token === rec.owner_token : st.owner_token === null).toBe(true);
      }
    });
  });

  describe("revisão final · ponto 4 — integridade das mensagens adiadas (coletor pode reapresentar só as novas)", () => {
    /** Pendentes reais do lease: lote fechado/em coleta + adiadas (ordem preservada). */
    const pending = async (c: string) => {
      const st = await row(c);
      return { state: st.state, all: [...st.message_ids, ...st.deferred], st };
    };
    /** Processa o lote atual até o fim (claim → start → complete) e devolve as mensagens do lote. */
    const drain = async (c: string) => {
      const before = await row(c);
      const r = await tr(c, "mark_ready", before.version, { ids: before.message_ids.slice(0, 20) });
      expect(r.result, "mark_ready").toBe("applied");
      const a = await claim(c, r.version!);
      expect(a.result).toBe("acquired");
      const s = await tr(c, "start", a.version!, { token: a.owner_token });
      const d = await tr(c, "complete", s.version!, { token: a.owner_token });
      expect(d.result).toBe("applied");
      return r.message_ids as string[];
    };
    async function processingWith(lote: string[]) {
      const c = await newConv();
      const v = await ready(c, lote);
      const a = await claim(c, v);
      const s = await tr(c, "start", a.version!, { token: a.owner_token });
      return { c, a, s };
    }

    it("lote concluído REAPRESENTADO pelo coletor (sem resposta entre ciclos) nunca volta a ser pendente", async () => {
      const [m1, m2, n1] = [msg(), msg(), msg()];
      const { c, a, s } = await processingWith([m1!, m2!]);
      const done = await tr(c, "complete", s.version!, { token: a.owner_token });
      const o = await tr(c, "observe", done.version!, { ids: [m1!, m2!, n1!] });
      expect(o).toMatchObject({ result: "applied", state: "collecting" });
      expect((await pending(c)).all).toEqual([n1]);
      // ciclo seguinte: o coletor continua mandando as concluídas (trailing) — não podem reentrar
      const o2 = await tr(c, "observe", o.version!, { ids: [m1!, m2!, n1!] });
      expect(o2.result).toBe("noop");
      expect((await pending(c)).all).toEqual([n1]);
      expect(await drain(c)).toEqual([n1]);
      const st = await row(c);
      const o3 = await tr(c, "observe", st.version, { ids: [m1!, m2!, n1!] }); // tudo já concluído
      expect(o3.result).toBe("noop");
      expect((await row(c)).processed).toEqual([m1, m2, n1]);
    });
    it("acknowledge: mensagem dispensada e reapresentada pelo coletor não volta a ser pendente", async () => {
      const [p1, g1] = [msg(), msg()];
      const c = await newConv();
      await tr(c, "observe", 0, { ids: [p1!, g1!] });
      const k = await tr(c, "acknowledge", 1, { ids: [p1!] });
      expect(k.result).toBe("applied");
      expect((await tr(c, "observe", k.version!, { ids: [p1!, g1!] })).result).toBe("noop");
      expect((await pending(c)).all).toEqual([g1]);
      expect((await tr(c, "acknowledge", k.version!, { ids: [p1!] })).result).toBe("noop"); // idempotente
    });
    it("janela de processadas é limitada (≤ 200, sem nulos) e guarda as mais recentes", async () => {
      const c = await newConv();
      await tr(c, "observe", 0, { ids: [msg()] });
      const ids201 = Array.from({ length: 201 }, () => msg());
      await expect(pg.sql(`update public.guest_ai_conversation_leases set processed_message_ids = '{${ids201.join(",")}}' where conversation_id = '${c}'`)).rejects.toThrow(/gacl_processed_ck/);
      await expect(pg.sql(`update public.guest_ai_conversation_leases set processed_message_ids = array[null]::uuid[] where conversation_id = '${c}'`)).rejects.toThrow(/gacl_processed_ck/);
      // 199 já processadas + lote de 2 concluído ⇒ a mais antiga sai, as 2 do lote ficam por último
      const old = Array.from({ length: 199 }, () => msg());
      const c2 = await newConv();
      const [b1, b2] = [msg(), msg()];
      const v = await ready(c2, [b1!, b2!]);
      await pg.sql(`update public.guest_ai_conversation_leases set processed_message_ids = '{${old.join(",")}}' where conversation_id = '${c2}'`);
      const a = await claim(c2, v);
      const s = await tr(c2, "start", a.version!, { token: a.owner_token });
      expect((await tr(c2, "complete", s.version!, { token: a.owner_token })).result).toBe("applied");
      const p = (await row(c2)).processed;
      expect(p).toHaveLength(200);
      expect(p).toEqual([...old.slice(1), b1, b2]);
    });
    it("processing → adiada → complete → observe só com OUTRA mensagem nova: a adiada entra no novo ciclo (nada se perde)", async () => {
      const [m1, d1, n1] = [msg(), msg(), msg()];
      const { c, a, s } = await processingWith([m1!]);
      expect((await tr(c, "observe", s.version!, { ids: [d1!] })).result).toBe("deferred"); // coletor manda só a nova
      const done = await tr(c, "complete", s.version!, { token: a.owner_token });
      const o = await tr(c, "observe", done.version!, { ids: [n1!] }); // só a outra nova
      expect(o).toMatchObject({ result: "applied", state: "collecting" });
      expect((await pending(c)).all).toEqual([d1, n1]); // adiada preservada, na ordem de chegada
      expect(await drain(c)).toEqual([d1, n1]);
    });
    it("complete e depois observe SEM nada novo: as adiadas abrem novo ciclo sozinhas", async () => {
      const [m1, d1] = [msg(), msg()];
      const { c, a, s } = await processingWith([m1!]);
      await tr(c, "observe", s.version!, { ids: [m1!, d1!] });
      const done = await tr(c, "complete", s.version!, { token: a.owner_token });
      const o = await tr(c, "observe", done.version!, { ids: [m1!] }); // só a já concluída
      expect(o).toMatchObject({ result: "applied", state: "collecting" });
      expect((await pending(c)).all).toEqual([d1]);
    });
    it("processing → adiada → fail → recuperação do mesmo lote: lote e adiada continuam pendentes", async () => {
      const [m1, d1] = [msg(), msg()];
      const { c, a, s } = await processingWith([m1!]);
      await tr(c, "observe", s.version!, { ids: [d1!] });
      const f = await tr(c, "fail", s.version!, { token: a.owner_token, retryable: true });
      expect(f.state).toBe("ready");
      expect((await pending(c)).all).toEqual([m1, d1]);
      const b = await claim(c, f.version!);
      expect(b).toMatchObject({ result: "acquired", message_ids: [m1] }); // mesmo lote (imutável); adiada segue adiada
      // falha definitiva + novo ciclo com só uma nova: lote não concluído + adiada + nova
      const f2 = await tr(c, "fail", b.version!, { token: b.owner_token, retryable: false });
      const n1 = msg();
      await tr(c, "observe", f2.version!, { ids: [n1] });
      expect((await pending(c)).all).toEqual([m1, d1, n1]);
    });
    it("processing → adiada → expiração → recuperação por outro worker: nada se perde; novo ciclo incorpora tudo", async () => {
      const [m1, d1, n1] = [msg(), msg(), msg()];
      const { c, s } = await processingWith([m1!]);
      await tr(c, "observe", s.version!, { ids: [d1!] });
      await expireNow(c);
      const b = await claim(c, s.version!);
      expect(b).toMatchObject({ result: "recovered", message_ids: [m1] });
      expect((await row(c)).deferred).toEqual([d1]);
      await expireNow(c);
      const e = await tr(c, "expire", b.version!);
      await tr(c, "observe", e.version!, { ids: [n1!] }); // coletor manda só a nova
      expect((await pending(c)).all).toEqual([m1, d1, n1]);
    });
    it("processing → adiada → cancel → novo ciclo com só uma nova: lote cancelado + adiada + nova preservados", async () => {
      const [m1, d1, n1] = [msg(), msg(), msg()];
      const { c, a, s } = await processingWith([m1!]);
      await tr(c, "observe", s.version!, { ids: [d1!] });
      const x = await tr(c, "cancel", s.version!, { token: a.owner_token });
      await tr(c, "observe", x.version!, { ids: [n1!] });
      expect((await pending(c)).all).toEqual([m1, d1, n1]);
    });
    it("várias adiadas, observações repetidas e parcialmente sobrepostas: sem duplicar, ordem de chegada", async () => {
      const lote = msg();
      const [a1, a2, a3, a4] = [msg(), msg(), msg(), msg()];
      const { c, a, s } = await processingWith([lote]);
      for (const ids of [[a1!], [a1!, a2!], [a2!, a3!], [lote, a1!, a3!, a4!], [a4!], [a1!, a2!, a3!, a4!]]) await tr(c, "observe", s.version!, { ids });
      expect((await row(c)).deferred).toEqual([a1, a2, a3, a4]);
      const done = await tr(c, "complete", s.version!, { token: a.owner_token });
      for (let k = 0; k < 3; k++) await tr(c, "observe", (await row(c)).version, { ids: [a3!, a1!] }); // repetição
      expect((await pending(c)).all).toEqual([a1, a2, a3, a4]);
      expect(done.state).toBe("completed");
      expect(await drain(c)).toEqual([a1, a2, a3, a4]); // processadas uma vez cada, no próximo lote
      const after = await tr(c, "observe", (await row(c)).version, { ids: [a1!, a2!, a3!, a4!] });
      expect(after.result).toBe("noop"); // já concluídas: não voltam
    });
    it("observe concorrente com complete / fail / expire / recuperação: nenhuma mensagem perdida nem duplicada", async () => {
      for (const op of ["complete", "fail", "expire", "recover"] as const) {
        for (let round = 0; round < 3; round++) {
          const m1 = msg();
          const extra = [msg(), msg()];
          const { c, a, s } = await processingWith([m1]);
          if (op === "expire" || op === "recover") await expireNow(c);
          const action =
            op === "complete" ? tr(c, "complete", s.version!, { token: a.owner_token })
            : op === "fail" ? tr(c, "fail", s.version!, { token: a.owner_token, retryable: false })
            : op === "expire" ? tr(c, "expire", s.version!)
            : claim(c, s.version!);
          const [r1, o1, o2] = await Promise.all([action, tr(c, "observe", s.version!, { ids: [extra[0]!] }), tr(c, "observe", s.version!, { ids: [extra[1]!] })]);
          // observação recusada por versão é repetida pelo coletor com a versão atual
          for (const [o, id] of [[o1, extra[0]], [o2, extra[1]]] as const) {
            if (o.result === "stale_version") await tr(c, "observe", (await row(c)).version, { ids: [id!] });
          }
          void r1;
          const st = await row(c);
          const all = [...st.message_ids, ...st.deferred];
          expect(new Set(all).size, `${op}#${round}`).toBe(all.length);
          for (const id of extra) expect(all.includes(id!), `${op}#${round} perdeu ${id}`).toBe(true);
          if (op === "complete") {
            // lote concluído: nunca volta a ficar pendente (no máximo continua como o lote concluído do registro)
            expect(st.deferred.includes(m1) || (st.state !== "completed" && st.message_ids.includes(m1)), `${op}#${round} reprocessaria o lote`).toBe(false);
          } else {
            expect(all.includes(m1), `${op}#${round} perdeu o lote não concluído`).toBe(true);
          }
        }
      }
    }, 90_000);
    it("excedente acima do limite do lote/array fica pendente (explícito); estouro total é recusado sem truncar", async () => {
      const c = await newConv();
      const first = Array.from({ length: 30 }, () => msg());
      expect((await tr(c, "observe", 0, { ids: first })).result).toBe("applied");
      // lote fechado com 20; os 10 restantes continuam pendentes (adiados), não somem
      const r = await tr(c, "mark_ready", 1, { ids: first.slice(0, 20) });
      expect(r.result).toBe("applied");
      expect((await pending(c)).all).toEqual(first);
      const a = await claim(c, r.version!);
      const s = await tr(c, "start", a.version!, { token: a.owner_token });
      const more = Array.from({ length: 45 }, () => msg());
      await tr(c, "observe", s.version!, { ids: more });
      const done = await tr(c, "complete", s.version!, { token: a.owner_token });
      const o = await tr(c, "observe", done.version!, { ids: [msg()] });
      expect(o.state).toBe("collecting");
      const p = await pending(c);
      expect(p.all).toHaveLength(56); // 10 restantes + 45 + 1, nenhuma perdida
      expect(p.st.message_ids.length).toBeLessThanOrEqual(50); // limite do array respeitado; excedente em deferred
      expect(p.all.slice(0, 10)).toEqual(first.slice(20));
      // lote só com mensagens pendentes (não aceita id estranho)
      expect((await tr(c, "mark_ready", o.version!, { ids: [msg()] })).result).toBe("invalid_argument");
      // estouro do teto total de pendentes ⇒ recusa explícita, nada muda
      const big = Array.from({ length: 50 }, () => msg());
      let v = o.version!;
      let last: J = { result: "" };
      for (let k = 0; k < 4; k++) {
        last = await tr(c, "observe", v, { ids: big.map(() => msg()) });
        if (last.result !== "applied") break;
        v = last.version!;
      }
      expect(last.result).toBe("pending_overflow");
      expect((await pending(c)).all.length).toBeLessThanOrEqual(200);
    });
    it("acknowledge: remoção EXPLÍCITA (ex.: mensagens da pausa já tratadas pela equipe) — nunca implícita", async () => {
      const c = await newConv();
      const [b1, b2, n1] = [msg(), msg(), msg()];
      await tr(c, "observe", 0, { ids: [b1!, b2!, n1!] });
      const k = await tr(c, "acknowledge", 1, { ids: [b1!, b2!] });
      expect(k).toMatchObject({ result: "applied", state: "collecting" });
      expect((await pending(c)).all).toEqual([n1]);
      const v = (await row(c)).version;
      const r = await tr(c, "mark_ready", v, { ids: [n1!] });
      const a = await claim(c, r.version!);
      expect((await tr(c, "acknowledge", a.version!, { ids: [n1!] })).result).toBe("invalid_transition"); // lote reivindicado é imutável
    });
  });

  describe("adaptador DistributedLeaseStore contra o banco real", () => {
    /** RPC real: cada chamada é um processo psql (conexão própria) como service_role. */
    const rpcClient = {
      async rpc(fn: string, args: Record<string, unknown>) {
        const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
        const r = await pg.trySql(`select public.${fn}(${named})`, SR);
        return r.ok ? { data: JSON.parse(r.out), error: null } : { data: null, error: { message: r.error } };
      },
    };
    /** Leitura real como service_role, pela projeção do adaptador (sem token). */
    const db: GuestAiDb = {
      from(table: string) {
        let select = "";
        let id = "";
        const q = {
          select(s: string) { select = s; return q; },
          eq(_k: string, v: string) { id = v; return q; },
          async maybeSingle() {
            const r = await pg.trySql(`select row_to_json(t) from (select ${select} from public.${table} where conversation_id = ${lit(id)}) t`, SR);
            return r.ok ? { data: r.out ? JSON.parse(r.out) : null, error: null } : { data: null, error: { message: r.error } };
          },
        };
        return q;
      },
    };
    it("adiamento durante a posse tem teto explícito: a 201ª pendente é recusada como pending_overflow tipado (sem truncar, versão intacta)", async () => {
      const store = createDistributedLeaseStore({ rpc: leaseRpcFrom(rpcClient), db });
      const c = await newConv();
      const v = await ready(c, [msg()]);
      const a = await claim(c, v);
      const st = await tr(c, "start", a.version!, { token: a.owner_token });
      const extra: string[] = [];
      for (let k = 0; k < 4; k++) {
        const ids = Array.from({ length: 50 }, () => msg());
        extra.push(...ids);
        expect((await store.transition(c, "observe", st.version!, { messageIds: ids })).result).toBe("deferred");
      }
      const over = await store.transition(c, "observe", st.version!, { messageIds: [msg()] });
      expect(over).toEqual({ result: "pending_overflow", version: st.version });
      const r = await row(c);
      expect(r).toMatchObject({ state: "processing", version: st.version });
      expect(r.deferred).toEqual(extra); // as 200 adiadas intactas, na ordem
    });
    it("fluxo completo pelo adaptador: observe → mark_ready → claim (concorrente) → start → renew → complete; projeção sem token", async () => {
      const store = createDistributedLeaseStore({ rpc: leaseRpcFrom(rpcClient), db });
      const store2 = createDistributedLeaseStore({ rpc: leaseRpcFrom(rpcClient), db });
      const backend = resolveLeaseBackend(store);
      expect(backend.available).toBe(true);
      const c = await newConv();
      const ids = [msg(), msg()];
      expect(await store.transition(c, "observe", 0, { messageIds: ids })).toMatchObject({ result: "applied", version: 1, state: "collecting" });
      const r = await store.transition(c, "mark_ready", 1, { messageIds: ids });
      expect(r).toMatchObject({ result: "applied", state: "ready", messageIds: ids });
      const snap = await store.load(c);
      expect(snap).toMatchObject({ state: "ready", version: 2, messageIds: ids, attempts: 0 });
      expect(Object.keys(snap!)).not.toContain("ownerToken");
      expect(LEASE_SNAPSHOT_COLUMNS as readonly string[]).not.toContain("owner_token");
      const [o1, o2] = await Promise.all([claimReadyBatch(backend, { conversationId: c }), claimReadyBatch(resolveLeaseBackend(store2), { conversationId: c })]);
      const winners = [o1, o2].filter((o) => o.ok);
      expect(winners).toHaveLength(1);
      const loser = [o1, o2].find((o) => !o.ok)!;
      expect(["conflict", "unavailable", "stale_version"]).toContain((loser as { reason: string }).reason);
      const w = (winners[0] as { claim: { version: number; ownerToken: string } }).claim;
      const s = await store.transition(c, "start", w.version, { ownerToken: w.ownerToken });
      expect(s).toMatchObject({ result: "applied", state: "processing" });
      const rn = await store.transition(c, "renew", s.version!, { ownerToken: w.ownerToken });
      const done = await store.transition(c, "complete", rn.version!, { ownerToken: w.ownerToken });
      expect(done).toMatchObject({ result: "applied", state: "completed" });
      expect(await store.transition(c, "complete", done.version!, { ownerToken: "0".repeat(64) })).toMatchObject({ result: "already_processed" });
      expect(await store.claim("00000000-0000-4000-8000-000000000000", 1)).toMatchObject({ result: "not_found" });
      mark("store_adapter_against_real_db");
    });
    it("função fora da lista fechada nunca sai do processo; erro do banco vira store_error (nunca sucesso)", async () => {
      const calls: string[] = [];
      const rpc = leaseRpcFrom({ async rpc(fn: string) { calls.push(fn); return { data: null, error: null }; } });
      expect(await rpc.call("drop_everything" as never, {})).toEqual({ data: null, error: { code: "lease_rpc_not_allowed" } });
      expect(calls).toEqual([]);
      const broken = createDistributedLeaseStore({ rpc: leaseRpcFrom({ async rpc() { return { data: null, error: { message: "function does not exist" } }; } }), db });
      expect(await broken.claim(conv(), 1)).toEqual({ result: "store_error", version: null });
      const weird = createDistributedLeaseStore({ rpc: leaseRpcFrom({ async rpc() { return { data: { result: "acquired", version: 2 }, error: null }; } }), db });
      expect(await weird.claim(conv(), 1)).toEqual({ result: "store_error", version: null });
      const full = { result: "acquired", version: 3, state: "claimed", attempts: 1, batch_id: "9ea277b3-fc27-4716-97e5-84a31a9fbd4b", message_ids: ["a0000000-0000-4000-8000-000000000001"], lease_expires_at: "2026-11-04T00:00:00Z", owner_token: "f".repeat(64) };
      const ok = createDistributedLeaseStore({ rpc: leaseRpcFrom({ async rpc() { return { data: full, error: null }; } }), db });
      expect(await ok.claim(conv(), 2)).toMatchObject({ result: "acquired", ownerToken: "f".repeat(64) });
      for (const bad of [{ owner_token: "curto" }, { owner_token: null }, { batch_id: "x" }, { message_ids: [] }, { state: "ready" }, { result: "talvez" }]) {
        const st = createDistributedLeaseStore({ rpc: leaseRpcFrom({ async rpc() { return { data: { ...full, ...bad }, error: null }; } }), db });
        expect(await st.claim(conv(), 2), JSON.stringify(bad)).toEqual({ result: "store_error", version: null });
      }
      const tBad = createDistributedLeaseStore({ rpc: leaseRpcFrom({ async rpc() { return { data: { result: "applied", version: "2", state: "ready" }, error: null }; } }), db });
      expect(await tBad.transition(conv(), "start", 1)).toEqual({ result: "store_error", version: null });
      expect(LEASE_TABLE).toBe("guest_ai_conversation_leases");
    });
  });
});
