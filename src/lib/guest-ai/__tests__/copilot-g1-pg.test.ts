/**
 * COPILOTO · GATE G1 contra POSTGRES REAL (cluster local temporário; nada toca a produção).
 * Migrations aplicadas na ordem de produção: base do Copiloto → teto opcional → G1a (aditiva). A G1b
 * (`ops/copilot-g1/g1b-revoke-legacy.sql`) é aplicada no último bloco, como no passo 3 do roteiro.
 * Cobre: privilégios (novas só service_role; antigas intactas até a G1b; nada para anon/authenticated depois),
 * ator explícito com as mesmas regras de acesso e `chat_respond`, `finish_send` estrito (conversa, ator,
 * instante, falha, nota interna), expiração de gerações presas (> 90 s), nova tentativa da mesma mensagem,
 * teto diário contando timeout pelo pior caso, ausência de cron/pg_net e idempotência da G1a e da G1b.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PG_AVAILABLE, startCluster, type PgCluster } from "./pg/pg-cluster";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const SETUP = path.join(__dirname, "pg", "copilot-setup.sql");
const BASE = path.join(REPO, "supabase/migrations/20261105150000_guest_ai_copilot_suggestions.sql");
const BUDGET = path.join(
  REPO,
  "supabase/migrations/20261106200000_copilot_optional_daily_budget.sql",
);
const G1A = path.join(REPO, "supabase/migrations/20261107000000_copilot_g1a_actor_rpcs.sql");
const G1B = path.join(REPO, "ops/copilot-g1/g1b-revoke-legacy.sql");

const T1 = "a1000000-0000-4000-8000-000000000001";
const T2 = "a2000000-0000-4000-8000-000000000002";
const MEMBER = "a3000000-0000-4000-8000-000000000003";
const READONLY = "a6000000-0000-4000-8000-000000000006";
const P1 = "b1000000-0000-4000-8000-000000000001";
const P2 = "b2000000-0000-4000-8000-000000000002";
const C1 = "c1000000-0000-4000-8000-000000000001";
const C1X = "c1000000-0000-4000-8000-0000000000aa"; // outra conversa do MESMO imóvel
const C2 = "c2000000-0000-4000-8000-000000000002";
let seq = 0;
const uid = (p = "d0000000") => `${p}-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

let pg: PgCluster;
type J = Record<string, unknown> & { result?: string };
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
const call = (fn: string, args: Record<string, unknown>) =>
  `select public.${fn}(${Object.entries(args)
    .map(([k, v]) => `${k} => ${lit(v)}`)
    .join(", ")})`;
const sr = async (fn: string, args: Record<string, unknown>): Promise<J> =>
  JSON.parse(await pg.sql(call(fn, args), { role: "service_role" })) as J;
const claimArgs = (msg: string, over: Record<string, unknown> = {}) => ({
  p_tenant_id: T1,
  p_property_id: P1,
  p_conversation_id: C1,
  p_trigger_message_id: msg,
  p_surface: "guide_chat",
  p_daily_cost_limit_usd: 3,
  p_turn_cost_ceiling_usd: 0.15,
  ...over,
});
const storeArgs = (id: string, attempt: number, text = "O check-in é às 15h.") => ({
  p_suggestion_id: id,
  p_attempt: attempt,
  p_state: "available",
  p_text: text,
  p_internal_question: null,
  p_intents: null,
  p_strategy: "answer",
  p_handoff_needed: false,
  p_handoff_urgency: null,
  p_outcome_kind: "reply",
  p_outcome_code: null,
  p_warnings: null,
  p_context_stay_phase: "pre_stay",
  p_context_reservation_linked: true,
  p_context_history_messages: 3,
  p_context_dossier_entries: 1,
  p_context_credential_policy: "deny",
  p_context_sender_identity: "not_applicable",
  p_context_human_in_command: false,
  p_model_id: "google/gemini-3.8-flash",
  p_input_tokens: 900,
  p_output_tokens: 120,
  p_cost_usd: 0.0006,
  p_latency_ms: 800,
  p_gateway_error: null,
});

async function guestMessage(conv = C1): Promise<string> {
  const id = uid("e0000000");
  await pg.sql(
    `insert into public.property_chat_messages (id, conversation_id, sender_type, role) values ('${id}', '${conv}', 'guest', 'user')`,
  );
  return id;
}
async function teamMessage(
  conv: string,
  author: string,
  over: { at?: string; failed?: boolean; note?: boolean } = {},
): Promise<string> {
  const id = uid("f0000000");
  await pg.sql(
    `insert into public.property_chat_messages (id, conversation_id, sender_type, role, sender_user_id, delivery_status, is_internal_note, created_at)
     values ('${id}', '${conv}', 'human', 'assistant', '${author}', ${over.failed ? "'failed'" : "'sent'"}, ${over.note ? "true" : "false"}, ${over.at ?? "now()"})`,
  );
  return id;
}
async function available(conv = C1): Promise<string> {
  const m = await guestMessage(conv);
  const c = await sr("copilot_claim_generation", claimArgs(m, { p_conversation_id: conv }));
  expect(c.result).toBe("claimed");
  const s = await sr(
    "copilot_store_result",
    storeArgs(String(c.suggestion_id), Number(c.generation_attempts)),
  );
  expect(s.result).toBe("stored");
  return String(c.suggestion_id);
}
async function stateOf(id: string): Promise<Record<string, string>> {
  const out = await pg.sql(
    `select row_to_json(x)::text from (select state, outcome_kind, outcome_code, sent_message_id, send_claimed_by from public.guest_ai_copilot_suggestions where id = '${id}') x`,
  );
  return JSON.parse(out) as Record<string, string>;
}
const exec = async (role: string, fn: string): Promise<boolean> =>
  (await pg.sql(`select has_function_privilege('${role}', '${fn}', 'EXECUTE')`)) === "t";

async function seed(): Promise<void> {
  await pg.sql(`truncate public.guest_ai_copilot_suggestions, public.property_chat_messages, public.property_chat_conversations cascade;
    delete from public.property_assignments; delete from public.account_members; delete from public.properties;
    delete from public.account_member_permissions;
    insert into public.properties (id, owner_id) values ('${P1}', '${T1}'), ('${P2}', '${T2}');
    insert into public.property_chat_conversations (id, property_id, guest_session_id) values
      ('${C1}', '${P1}', 'sess-1'), ('${C1X}', '${P1}', 'sess-1x'), ('${C2}', '${P2}', 'sess-2');
    insert into public.account_members (owner_id, member_user_id, role, status, all_properties) values
      ('${T1}', '${T1}', 'owner', 'active', true), ('${T2}', '${T2}', 'owner', 'active', true),
      ('${T1}', '${MEMBER}', 'agent', 'active', false), ('${T1}', '${READONLY}', 'agent', 'active', false);
    insert into public.property_assignments (tenant_id, property_id, user_id, status) values
      ('${T1}', '${P1}', '${MEMBER}', 'active'), ('${T1}', '${P1}', '${READONLY}', 'active');
    insert into public.account_member_permissions (owner_id, member_user_id, permission, granted) values
      ('${T1}', '${MEMBER}', 'chat_respond', true), ('${T1}', '${READONLY}', 'chat_view', true);`);
}

const NEW_FNS = [
  "public.copilot_actor_edit(uuid, uuid, text)",
  "public.copilot_actor_discard(uuid, uuid)",
  "public.copilot_actor_claim_send(uuid, uuid, text)",
  "public.copilot_actor_finish_send(uuid, uuid, uuid, text, uuid, text, text, text)",
  "public.copilot_actor_reconcile_send(uuid, uuid, boolean, text)",
];
const LEGACY_FNS = [
  "public.copilot_edit(uuid, text)",
  "public.copilot_discard(uuid)",
  "public.copilot_claim_send(uuid, text)",
  "public.copilot_finish_send(uuid, uuid, text, uuid, text, text, text)",
  "public.copilot_reconcile_send(uuid, boolean, text)",
];

describe.skipIf(!PG_AVAILABLE)("Copiloto · Gate G1 contra PostgreSQL real", () => {
  beforeAll(() => {
    pg = startCluster([SETUP, BASE, BUDGET, G1A], { bin: process.env.GUEST_AI_PG_BIN });
  }, 120_000);
  afterAll(() => pg?.stop());
  beforeEach(seed);

  it("arquivos G1a e G1b não agendam nem chamam nada externo", () => {
    for (const f of [G1A, G1B]) {
      const sql = readFileSync(f, "utf8").replace(/--.*$/gm, "");
      expect(sql, f).not.toMatch(/cron\.|net\.http|pg_net|http_post|schedule\(/i);
    }
  });

  describe("G1a: privilégios (aditiva)", () => {
    it("novas RPCs do atendente: só service_role; SECURITY DEFINER com search_path fixo", async () => {
      for (const f of NEW_FNS) {
        expect(await exec("anon", f), f).toBe(false);
        expect(await exec("authenticated", f), f).toBe(false);
        expect(await exec("service_role", f), f).toBe(true);
        const meta = await pg.sql(
          `select prosecdef || ' ' || array_to_string(proconfig, ',') from pg_proc where oid = '${f}'::regprocedure`,
        );
        expect(meta, f).toBe("true search_path=pg_catalog, pg_temp");
      }
    });

    it("antigas continuam como estavam até a G1b (nenhuma indisponibilidade no deploy)", async () => {
      for (const f of LEGACY_FNS) expect(await exec("authenticated", f), f).toBe(true);
      expect(
        await exec(
          "authenticated",
          "public.copilot_claim_generation(uuid, uuid, uuid, uuid, text, numeric, numeric)",
        ),
      ).toBe(false);
      expect(
        await exec(
          "service_role",
          "public.copilot_claim_generation(uuid, uuid, uuid, uuid, text, numeric, numeric)",
        ),
      ).toBe(true);
    });

    it("authenticated não consegue chamar as novas nem passando qualquer ator", async () => {
      const id = await available();
      const r = await pg.trySql(
        call("copilot_actor_discard", { p_actor: MEMBER, p_suggestion_id: id }),
        {
          role: "authenticated",
        },
      );
      expect(r.ok).toBe(false);
      expect((await stateOf(id)).state).toBe("available");
    });
  });

  describe("G1a: ações com ator explícito (mesmas regras)", () => {
    it("ator nulo ⇒ unauthenticated; sem acesso ao imóvel ⇒ not_found; sem chat_respond ⇒ forbidden", async () => {
      const id = await available();
      expect(
        (await sr("copilot_actor_edit", { p_actor: null, p_suggestion_id: id, p_text: "x" }))
          .result,
      ).toBe("unauthenticated");
      expect(
        (await sr("copilot_actor_edit", { p_actor: T2, p_suggestion_id: id, p_text: "x" })).result,
      ).toBe("not_found");
      expect(
        (await sr("copilot_actor_edit", { p_actor: READONLY, p_suggestion_id: id, p_text: "x" }))
          .result,
      ).toBe("forbidden");
      expect(
        (await sr("copilot_actor_discard", { p_actor: READONLY, p_suggestion_id: id })).result,
      ).toBe("forbidden");
      expect(
        (
          await sr("copilot_actor_claim_send", {
            p_actor: READONLY,
            p_suggestion_id: id,
            p_text: null,
          })
        ).result,
      ).toBe("forbidden");
    });

    it("editar e descartar gravam a autoria do ator", async () => {
      const id = await available();
      expect(
        (
          await sr("copilot_actor_edit", {
            p_actor: MEMBER,
            p_suggestion_id: id,
            p_text: "Às 15h.",
          })
        ).result,
      ).toBe("edited");
      expect(
        await pg.sql(
          `select edited_by from public.guest_ai_copilot_suggestions where id = '${id}'`,
        ),
      ).toBe(MEMBER);
      expect((await sr("copilot_actor_discard", { p_actor: T1, p_suggestion_id: id })).result).toBe(
        "discarded",
      );
      expect(
        await pg.sql(
          `select discarded_by from public.guest_ai_copilot_suggestions where id = '${id}'`,
        ),
      ).toBe(T1);
    });

    it("envio: 10 reivindicações simultâneas ⇒ 1 claimed, 9 send_in_progress", async () => {
      const id = await available();
      const rs = await Promise.all(
        Array.from({ length: 10 }, () =>
          sr("copilot_actor_claim_send", { p_actor: MEMBER, p_suggestion_id: id, p_text: null }),
        ),
      );
      expect(rs.filter((r) => r.result === "claimed")).toHaveLength(1);
      expect(rs.filter((r) => r.result === "send_in_progress")).toHaveLength(9);
    });
  });

  describe("G1a: finish_send ESTRITO", () => {
    async function claimed(): Promise<{ id: string; token: string }> {
      const id = await available();
      const c = await sr("copilot_actor_claim_send", {
        p_actor: MEMBER,
        p_suggestion_id: id,
        p_text: null,
      });
      expect(c.result).toBe("claimed");
      return { id, token: String(c.send_token) };
    }
    const finish = (id: string, token: string, msg: string | null, actor = MEMBER) =>
      sr("copilot_actor_finish_send", {
        p_actor: actor,
        p_suggestion_id: id,
        p_send_token: token,
        p_outcome: "sent",
        p_message_id: msg,
        p_provider_message_id: null,
        p_channel: "web",
        p_error_code: null,
      });

    it("mensagem inexistente, de outra conversa, de outro autor, falhada, nota interna ou anterior ⇒ message_mismatch", async () => {
      const { id, token } = await claimed();
      const cases = [
        uid("f0000000"), // não existe
        await teamMessage(C1X, MEMBER), // outra conversa do mesmo imóvel
        await teamMessage(C2, MEMBER), // outra conversa de outro tenant
        await teamMessage(C1, T1), // outro autor
        await teamMessage(C1, MEMBER, { failed: true }), // falhada
        await teamMessage(C1, MEMBER, { note: true }), // nota interna
        await teamMessage(C1, MEMBER, { at: "now() - interval '10 minutes'" }), // anterior à reivindicação
      ];
      for (const m of cases) {
        const r = await finish(id, token, m);
        expect(r, m).toMatchObject({ result: "invalid", reason: "message_mismatch" });
        expect((await stateOf(id)).state).toBe("sending");
      }
    });

    it("mensagem desta conversa, deste ator, depois da reivindicação ⇒ sent com o id", async () => {
      const { id, token } = await claimed();
      const m = await teamMessage(C1, MEMBER);
      expect((await finish(id, token, m)).result).toBe("finished");
      expect(await stateOf(id)).toMatchObject({ state: "sent", sent_message_id: m });
    });

    it("token de outro ator ⇒ token_mismatch; sem id ⇒ invalid; falha registrada ⇒ send_failed", async () => {
      const { id, token } = await claimed();
      await pg.sql(
        `update public.account_member_permissions set granted = true where member_user_id = '${READONLY}'`,
      );
      expect((await finish(id, token, await teamMessage(C1, T1), T1)).result).toBe(
        "token_mismatch",
      );
      expect((await finish(id, token, null)).result).toBe("invalid");
      const f = await sr("copilot_actor_finish_send", {
        p_actor: MEMBER,
        p_suggestion_id: id,
        p_send_token: token,
        p_outcome: "failed",
        p_message_id: null,
        p_provider_message_id: null,
        p_channel: "web",
        p_error_code: "send_failed",
      });
      expect(f.result).toBe("finished");
      expect((await stateOf(id)).state).toBe("send_failed");
    });

    it("reconciliação com ator: acha a mensagem do autor da reivindicação ⇒ reconciled_sent", async () => {
      const { id } = await claimed();
      const m = await teamMessage(C1, MEMBER);
      const r = await sr("copilot_actor_reconcile_send", {
        p_actor: MEMBER,
        p_suggestion_id: id,
        p_attempt_finished: false,
        p_error_code: null,
      });
      expect(r.result).toBe("reconciled_sent");
      expect((await stateOf(id)).sent_message_id).toBe(m);
    });
  });

  describe("G1a: gerações presas (R2) e teto diário", () => {
    /** Linha em `generating` iniciada há `secondsAgo` (inserida direto, como uma geração interrompida). */
    async function stuck(conv: string, secondsAgo: number, attempts = 1): Promise<string> {
      const m = await guestMessage(conv);
      const [tenant, prop] = conv === C2 ? [T2, P2] : [T1, P1];
      return await pg.sql(
        `insert into public.guest_ai_copilot_suggestions (tenant_id, property_id, conversation_id, trigger_message_id, surface, generation_started_at, generation_attempts)
         values ('${tenant}', '${prop}', '${conv}', '${m}', 'guide_chat', now() - interval '${secondsAgo} seconds', ${attempts}) returning id`,
      );
    }

    it("presa > 90 s de OUTRAS conversas (inclusive de outro tenant) expira como generation_timeout na próxima reivindicação", async () => {
      const a = await stuck(C1X, 120);
      const b = await stuck(C2, 600);
      const r = await sr("copilot_claim_generation", claimArgs(await guestMessage(C1)));
      expect(r.result).toBe("claimed");
      for (const id of [a, b]) {
        expect(await stateOf(id)).toMatchObject({
          state: "generation_failed",
          outcome_kind: "technical_error",
          outcome_code: "generation_timeout",
        });
      }
    });

    it("presa < 90 s não é tocada; a MESMA mensagem presa > 90 s é reivindicada de novo (nova tentativa)", async () => {
      const young = await stuck(C1X, 30);
      const m = await guestMessage(C1);
      const c = await sr("copilot_claim_generation", claimArgs(m));
      await pg.sql(
        `update public.guest_ai_copilot_suggestions set generation_started_at = now() - interval '120 seconds' where id = '${c.suggestion_id}'`,
      );
      const again = await sr("copilot_claim_generation", claimArgs(m));
      expect(again).toMatchObject({ result: "claimed", reclaimed: true, generation_attempts: 2 });
      expect((await stateOf(young)).state).toBe("generating");
    });

    it("mesma mensagem com tentativas esgotadas expira em vez de ficar presa para sempre", async () => {
      const m = await guestMessage(C1);
      const c = await sr("copilot_claim_generation", claimArgs(m));
      await pg.sql(
        `update public.guest_ai_copilot_suggestions set generation_attempts = 10, generation_started_at = now() - interval '120 seconds' where id = '${c.suggestion_id}'`,
      );
      const r = await sr("copilot_claim_generation", claimArgs(m));
      expect(r.result).toBe("exists");
      expect((await stateOf(String(c.suggestion_id))).outcome_code).toBe("generation_timeout");
    });

    it("gravação tardia de uma geração expirada é recusada (stale)", async () => {
      const id = await stuck(C1X, 120);
      await sr("copilot_claim_generation", claimArgs(await guestMessage(C1)));
      expect((await sr("copilot_store_result", storeArgs(id, 1))).result).toBe("stale");
    });

    it("teto diário: timeout sem custo conhecido CONTINUA contando pelo pior caso do turno", async () => {
      // 4 gerações interrompidas ⇒ 4 × 0,15 = 0,60 reservados mesmo depois de expiradas
      for (let i = 0; i < 4; i++) await stuck(C1X, 120);
      // teto 0,70: 0,60 + 0,15 > 0,70 ⇒ bloqueia sem chamada (a reivindicação expira as 4 e ainda as conta)
      const blocked = await sr(
        "copilot_claim_generation",
        claimArgs(await guestMessage(C1), { p_daily_cost_limit_usd: 0.7 }),
      );
      expect(blocked.result).toBe("daily_budget_exceeded");
      expect(
        await pg.sql(
          `select count(*) from public.guest_ai_copilot_suggestions where outcome_code = 'generation_timeout'`,
        ),
      ).toBe("4");
      // teto 0,75: 0,60 + 0,15 = 0,75 ⇒ ainda cabe
      const ok = await sr(
        "copilot_claim_generation",
        claimArgs(await guestMessage(C1), { p_daily_cost_limit_usd: 0.75 }),
      );
      expect(ok.result).toBe("claimed");
    });

    it("reaplicar a G1a não altera nada (idempotente)", async () => {
      const before = await pg.sql(
        `select md5(string_agg(pg_get_functiondef(oid) || coalesce(proacl::text, ''), '' order by oid::regprocedure::text)) from pg_proc where proname like 'copilot%'`,
      );
      await pg.sql(readFileSync(G1A, "utf8"));
      const after = await pg.sql(
        `select md5(string_agg(pg_get_functiondef(oid) || coalesce(proacl::text, ''), '' order by oid::regprocedure::text)) from pg_proc where proname like 'copilot%'`,
      );
      expect(after).toBe(before);
    });
  });

  describe("G1b: revogação das legadas (passo 3)", () => {
    it("remove as 5 antigas; nenhuma função do Copiloto fica executável por anon/authenticated; reaplicar é no-op", async () => {
      const id = await available();
      await pg.sql(readFileSync(G1B, "utf8"));
      for (const f of LEGACY_FNS) {
        expect(await pg.sql(`select to_regprocedure('${f}') is null`), f).toBe("t");
      }
      const exposed =
        await pg.sql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'copilot%' or p.proname like 'guest_ai_copilot%')
          and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`);
      expect(exposed).toBe("0");
      // chamada direta pelo navegador (authenticated) à antiga ⇒ função inexistente
      expect(
        (
          await pg.trySql(
            `select set_config('request.jwt.claim.sub', '${MEMBER}', false); select public.copilot_discard('${id}')`,
            {
              role: "authenticated",
            },
          )
        ).ok,
      ).toBe(false);
      // o caminho do servidor segue funcionando
      expect(
        (await sr("copilot_actor_discard", { p_actor: MEMBER, p_suggestion_id: id })).result,
      ).toBe("discarded");
      await pg.sql(readFileSync(G1B, "utf8"));
    });
  });
});
