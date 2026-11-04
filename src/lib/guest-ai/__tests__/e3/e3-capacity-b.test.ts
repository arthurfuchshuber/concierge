/**
 * B3.3 · E3 — Fase 8: ISOLAMENTO DA CAPACIDADE B (tráfego regular: canal → slot → null → fila humana)
 * enquanto a Capacidade A (Shadow) falha, pausa, fica sem banco, esgota orçamento e abre disjuntores.
 * Mais a evidência estrutural do PostgreSQL 17.6 (papéis, ACL, RLS, funções).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestGuestAiReply } from "@/lib/guest-ai/slot.server";
import { runShadowWorker } from "@/lib/guest-ai/shadow-exec/worker.server";
import type { ProviderOutcome } from "@/lib/guest-ai/llm/providers/types";
import {
  PG176_AVAILABLE, startE3Db, controller, worldIo, convSpec, candidateOf, simProvider, shadowToRunning, shadowState, seedConversation, nonShadowChecksum, recordResult,
  type E3Db,
} from "./harness";

let db: E3Db;
const SRC = path.resolve(__dirname, "../../../..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
});
const rel = (p: string) => path.relative(SRC, p);

describe.skipIf(!PG176_AVAILABLE)("E3 · Fase 8 — isolamento da Capacidade B (PostgreSQL 17.6 real)", () => {
  beforeAll(() => {
    db = startE3Db();
  }, 60_000);
  afterAll(() => db?.stop());

  it("caos simultâneo na Capacidade A (falha do Gateway, disjuntor, orçamento esgotado, banco do Shadow indisponível, pausa) ⇒ o slot da Capacidade B responde null em todas as superfícies, sem atraso, e nenhuma tabela fora do Shadow/lease muda", async () => {
    const specs = await Promise.all(Array.from({ length: 12 }, () => seedConversation(db, convSpec())));
    specs[3]!.human.pause = { ...specs[3]!.human.pause, column: { ai_paused: true, paused_until: null } };
    await shadowToRunning(db, specs, { p_daily_cost_limit_usd: 0.08 });
    const before = await nonShadowChecksum(db);
    const tech: ProviderOutcome = { kind: "error", error: { code: "provider_unavailable", retryable: false, httpStatus: 503 }, usage: null, requestId: null };
    const chaos = Promise.all(
      specs.map((s, i) => {
        const ctl = controller(i % 4 === 0 ? { faults: [{ fn: "shadow_get_control", mode: "before" }] } : i % 4 === 1 ? { latencyMs: () => 40 } : {});
        const provider = i % 3 === 0 ? simProvider({ latencyMs: 120, outcome: () => tech }) : simProvider({ latencyMs: 120 });
        return runShadowWorker(candidateOf(s), worldIo(specs, { db, ctl, provider }));
      }),
    );
    // Capacidade B em paralelo: o canal só conhece o slot
    const latencies: number[] = [];
    const replies: unknown[] = [];
    let running = true;
    const traffic = (async () => {
      const surfaces = ["airbnb", "whatsapp", "guide_chat"] as const;
      let k = 0;
      while (running || k < 60) {
        const t0 = performance.now();
        replies.push(await requestGuestAiReply({ surface: surfaces[k % 3]!, conversationId: specs[k % specs.length]!.conv, messageId: specs[k % specs.length]!.msg }));
        latencies.push(performance.now() - t0);
        k++;
        await new Promise((r) => setTimeout(r, 2));
      }
    })();
    const outs = await chaos;
    running = false;
    await traffic;
    const after = await nonShadowChecksum(db);
    const st = await shadowState(db);
    const p99 = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length * 0.99)]!;
    recordResult("capacity-b-isolation", { slotCalls: replies.length, nonNull: replies.filter((r) => r !== null).length, p99Ms: Number(p99.toFixed(3)), maxMs: Number(Math.max(...latencies).toFixed(3)), shadowState: st.state, shadowOutcomes: outs, checksumUnchanged: before === after });
    expect(replies.length).toBeGreaterThanOrEqual(60);
    expect(replies.every((r) => r === null)).toBe(true);
    expect(p99).toBeLessThan(50);
    expect(after).toBe(before);
  }, 120_000);

  it("estrutural: nenhum código fora de shadow-exec/ e data/shadow-store lê ou escreve tabelas guest_ai_shadow_* (resultado Shadow não alimenta a operação)", () => {
    const allowed = new Set(["lib/guest-ai/data/shadow-store.server.ts", "lib/guest-ai/data/client.server.ts"]);
    const offenders = files(SRC)
      .filter((f) => !f.includes("__tests__") && !rel(f).startsWith("lib/guest-ai/shadow-exec/"))
      .filter((f) => /guest_ai_shadow_|shadow_record_execution|shadow_get_control|shadow_reserve_budget/.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((f) => !allowed.has(f) && !f.startsWith("integrations/supabase/types"));
    expect(offenders).toEqual([]);
  });

  it("estrutural: nenhum caminho de envio no Shadow — o fecho de imports não alcança envio/canal; o slot está byte a byte homologado e não importa o Shadow", () => {
    const slot = readFileSync(path.join(SRC, "lib/guest-ai/slot.server.ts"), "utf8");
    expect(createHash("sha256").update(slot).digest("hex")).toBe("39228fefe061fa64fa46e19242e2dc21b3078ab668ac5e354a27413f8b212917");
    expect(slot).not.toMatch(/shadow/i);
    const shadow = files(path.join(SRC, "lib/guest-ai/shadow-exec")).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(shadow).not.toMatch(/channex-messages|channex-sender|airbnb-direct-sender|sendChannexThreadMessage|reportDeliveryFailure|web-push|sendPush/);
  });
});

describe.skipIf(!PG176_AVAILABLE)("E3 · ambiente PostgreSQL 17.6 — evidência estrutural (papéis, ACL, RLS, funções)", () => {
  let pg: E3Db;
  beforeAll(() => {
    pg = startE3Db();
  }, 60_000);
  afterAll(() => pg?.stop());

  it("versão do servidor e parâmetros relevantes", async () => {
    const v = await pg.sql(`select current_setting('server_version') || ' | ' || current_setting('server_version_num') || ' | ' || current_setting('default_transaction_isolation')`);
    recordResult("pg176-environment", { version: v });
    expect(v.startsWith("17.6 | 170006 | read committed")).toBe(true);
  });

  it("tabelas Shadow e lease: RLS ligada, nenhuma política, nenhum privilégio para anon/authenticated/sandbox_exec; service_role só SELECT no lease e nada nas tabelas Shadow (inclusive MAINTAIN, novo no 17)", async () => {
    const rows = await pg.rows<{ tbl: string; rls: boolean; policies: number; acl: string | null }>(
      `select c.relname tbl, c.relrowsecurity rls, (select count(*) from pg_policy p where p.polrelid = c.oid)::int policies, array_to_string(c.relacl, ',') acl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'guest_ai_%' order by 1`,
    );
    recordResult("pg176-acl", rows);
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(r.rls, r.tbl).toBe(true);
      expect(r.policies, r.tbl).toBe(0);
      expect(r.acl ?? "", r.tbl).not.toMatch(/anon|authenticated|sandbox_exec/);
      const sr = (r.acl ?? "").split(",").find((e) => e.startsWith("service_role="));
      if (r.tbl === "guest_ai_conversation_leases") expect(sr).toBe("service_role=r/postgres");
      else expect(sr).toBeUndefined();
    }
    for (const role of ["anon", "authenticated", "service_role", "sandbox_exec"]) {
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "MAINTAIN"]) {
        const n = await pg.sql(`select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'guest_ai_%' and has_table_privilege('${role}', c.oid, '${priv}')`);
        expect(n, `${role} ${priv}`).toBe("0");
      }
    }
  });

  it("funções: todas SECURITY DEFINER com search_path fixo; EXECUTE só service_role e só nas 15 RPCs (internas sem EXECUTE)", async () => {
    const fns = await pg.rows<{ f: string; secdef: boolean; cfg: string; sr: boolean; anon: boolean; auth: boolean }>(
      `select p.proname f, p.prosecdef secdef, array_to_string(p.proconfig, ',') cfg, has_function_privilege('service_role', p.oid, 'execute') sr, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
         from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'shadow_%' or p.proname like 'guest_ai_shadow_%' or p.proname like '%conversation_lease') order by 1`,
    );
    recordResult("pg176-functions", fns);
    expect(fns).toHaveLength(18);
    for (const f of fns) {
      expect(f.secdef, f.f).toBe(true);
      expect(f.cfg, f.f).toBe("search_path=pg_catalog, pg_temp");
      expect(f.anon || f.auth, f.f).toBe(false);
      expect(f.sr, f.f).toBe(!f.f.startsWith("guest_ai_shadow_"));
    }
  });

  it("papel Postgres dedicado ao Shadow (D9) — NÃO existe nesta entrega: o worker usaria service_role (BYPASSRLS)", async () => {
    const roles = await pg.sql(`select coalesce(string_agg(rolname, ','), '') from pg_roles where rolname ilike '%shadow%' or rolname ilike '%guest_ai%'`);
    const bypass = await pg.sql(`select rolbypassrls from pg_roles where rolname = 'service_role'`);
    recordResult("pg176-dedicated-role", { dedicatedRoles: roles, serviceRoleBypassRls: bypass });
    expect(roles).toBe("");
    expect(bypass).toBe("t");
  });
});
